# SynthCrop pipeline — comprehensive walkthrough

A single notebook (`notebooks/pipeline.ipynb`) carries every step from raw
Sentinel-2 acquisition through a final Random Forest classifier, with a
LoRA-fine-tuned latent diffusion model in the middle to oversample minority
classes. This document is a long-form explanation of what each section
does, why, the knobs that control it, and the failure modes observed in
practice. It is intended as input material for downstream report
generation — the reader should be able to reconstruct any individual stage
without re-reading the notebook.

---

## 1. Goal

Pixel-level land-use classification of the four orchard crops grown around
Rayong, Thailand:

- **Durian**
- **Langsat**
- **Rambutan**
- **Mangosteen**

Background is the broader **Others** class (built-up, rice, rubber, palm,
forest, water, bare soil, …). Class imbalance is the dominant difficulty:
the four orchard crops together account for low single-digit percent of
pixels in the AOI. Vanilla Random Forest on raw pixel features collapses
to predicting Others almost everywhere.

The pipeline addresses imbalance with a **diffusion-based augmentation
stage**: a Latent Diffusion model is briefly fine-tuned (LoRA) on real
class-containing context windows so it can generate plausible synthetic
Sentinel-2-like patches for the minority classes. Synthetic pixels join
the real training set before the classifier sees it.

---

## 2. Data and area of interest

### 2.1 AOI

Rayong province is split into four quadrants around the polygon centroid
(`101.4291°E, 12.8539°N`):

| Key  | West edge | East edge | South edge | North edge |
|------|-----------|-----------|------------|------------|
| `NW` | 100.9845  | 101.4291  | 12.8539    | 13.1635    |
| `NE` | 101.4291  | 101.8305  | 12.8539    | 13.1635    |
| `SW` | 100.9845  | 101.4291  | 12.5834    | 12.8539    |
| `SE` | 101.4291  | 101.8305  | 12.5834    | 12.8539    |

`aoi_quadrant` in `CFG` picks one of `FULL / NW / NE / SW / SE / CUSTOM`.
The notebook resolves `aoi_bbox` from the quadrant table; `CUSTOM` lets
the user supply an explicit `(west, south, east, north)` tuple in
EPSG:4326 degrees.

Each quadrant covers a quarter of the province, ~40 km × 35 km, which is
big enough to span multiple Sentinel-2 MGRS tiles (`T47PRR`, `T47PRS`,
`T48PRR`, `T48PRS`). The pipeline mosaics across them server-side; see
§3.2 for the alignment fix that became necessary once the bbox crossed
tile boundaries.

### 2.2 Time window

Default `time_start = 2024-10-01`, `time_end = 2024-12-31` — the trailing
wet-to-dry transition, when durian and rambutan canopies are most
distinct from surrounding crops. Smoke-test mode caps the window to the
first `smoke_months = 2` months.

### 2.3 Bands

| Bands         | Native res | Purpose                                          |
|---------------|------------|--------------------------------------------------|
| B02 B03 B04 B08 | 10 m      | RGB + NIR — fed to SR and to all feature stages  |
| B05 B06 B07     | 20 m      | Red-edge — indices (NDRE, CIRE)                  |
| B11 B12         | 20 m      | SWIR — moisture / canopy stress (NDMI, BSI)      |
| SCL             | 20 m      | Scene classification — used for the cloud mask   |

The 20 m bands stay at native resolution after SR; the feature extractor
bilinear-upsamples them on demand. Only the 10 m bands are super-resolved.

### 2.4 Labels

LDD (Land Development Department) shapefile of polygonal land-use parcels
rasterised onto the SR grid. Each polygon carries an `LU_CODE` whose
prefix maps to the taxonomy in §1. The label raster is `LABELS[H, W]`
with `int32` class ids; class id 0 is the masked / out-of-AOI sentinel.

---

## 3. Stage 1 — Sentinel-2 acquisition (CDSE openEO)

### 3.1 Connection

The notebook talks to the Copernicus Data Space Ecosystem openEO endpoint
(`openeo.dataspace.copernicus.eu`). One openEO job is submitted per
notebook run when the cache is empty; subsequent runs reuse the GeoTIFFs
under `data/_cache/s2_monthly/<aoi_name>/`.

### 3.2 Request graph

The graph that produces the per-month median composite:

```
load_collection(SENTINEL2_L2A,
                spatial_extent=buffered_bbox,
                temporal_extent=[start, end],
                bands=[B02..B12, SCL],
                max_cloud_cover=85)
  ↓
mask((SCL == 3) | (SCL == 8) | (SCL == 9) | (SCL == 10))
                                # 3=cloud shadow, 8/9=cloud, 10=cirrus
  ↓
filter_bands(B02..B12)          # drop SCL after masking
  ↓
resample_spatial(resolution=10,
                 method=bilinear,
                 projection=32647)   # pin to UTM zone 47N
  ↓
aggregate_temporal_period(period=month, reducer=median)
  ↓
execute_batch → GeoTIFF per month
```

Two safeguards added after the team saw cut corners on quadrants that
straddled MGRS tiles:

1. **Bbox buffered by 0.005° (~500 m).** Reprojection-rounding loss at
   the AOI edges was lopping off slivers; the buffer adds overlap that
   then gets trimmed on read.
2. **`projection=32647` (UTM 47N).** Without an explicit target CRS the
   server picked the source grid of the first contributing MGRS tile and
   clipped the rest of the bbox to it. With every tile reprojected to
   the same grid before the temporal reducer, the mosaic stays
   continuous.

Diagnostic prints in the cell show the requested bbox plus the actual
bounds + CRS of the first downloaded TIF — any future clipping shows up
loudly.

### 3.3 Cache layout

```
data/_cache/s2_monthly/<aoi_name>/
    2024-10.tif
    2024-11.tif
    2024-12.tif
```

`load_s2_stack(s2_dir)` filters the cache to the months inside the
current `CFG.time_start..time_end` window, stacks them into a
`(time, band, y, x)` xarray, and returns it. Prior full-year runs leave
their TIFs alongside the new month set; without the date filter the SR
loop would iterate every cached month regardless of the current AOI/time
window.

---

## 4. Stage 2 — Super-resolution (OpenSR latent diffusion ×4)

### 4.1 Model

`opensr_model.SRLatentDiffusion`, checkpoint `opensr-ldsrs2_v1_0_0.ckpt`,
loaded once at module level and cached in `_SR_MODEL`. The architecture:

- A 4-channel VAE (autoencoder KL) maps RGB+NIR reflectance into a
  4-channel latent space, ch_mult = [1, 2, 4] (×4 spatial downsample
  → input 512 maps to latent 128).
- A 113 M-parameter LDM-style UNet operates on those latents. The UNet
  consumes 8 channels: a noisy HR latent `z_t` concatenated with the
  encoded LR conditioning `z_c`.
- DDIM sampling at inference time (`ddim_eta` and `custom_steps` tunable
  per call).

### 4.2 Forward pass

```
x_LR (B, 4, 64, 64)
  ↓  bilinear upsample ×4
x_LR↑ (B, 4, 256, 256)
  ↓  VAE encode
z_c (B, 4, 64, 64)
  ↓  concat with noisy z_t
UNet → ε̂ (predicted noise, 4 channels)
  ↓  DDIM denoise for T steps
z_0 (B, 4, 64, 64)
  ↓  VAE decode
x_SR (B, 4, 256, 256)   # × 4 spatial resolution
```

`SR_SYNTH_STEPS = 150` and `SR_SYNTH_ETA = 0.2` are used at synth time
inside `_sample_synth_patch`. The earlier `CFG.sr_steps` (25–50) value is
kept for the full-raster SR pass, where throughput matters more than
fine detail.

### 4.3 Output

For each month in the time window, the SR model produces a 4-band
2.5 m/pixel raster (4× upsample of the 10 m S2 grid). The 20 m bands
B05–B07, B11, B12 are kept native and bilinear-upsampled to the SR grid
only at feature time.

---

## 5. Stage 3 — Generative augmentation (per-class LoRA)

This is the most involved stage and the one that took the most
debugging. The high-level pitch: fine-tune a low-rank adapter on each
minority class so the diffusion model can synthesise extra
class-containing scenes for the classifier.

### 5.1 Real training windows

`extract_class_context_windows(class_name, n=200, window_px=128)` walks
class-labeled pixels in `LABELS`, picks N random centres (jittered by
± window/6), and crops a 128 × 128 SR-pixel window around each. At
2.5 m/pixel that is ~320 m × 320 m — enough to contain an orchard plus
neighbouring crops / roads / soil for the model to anchor against.

Filters:
- Window must lie entirely inside the raster bounds.
- Class coverage inside the window must be ≥ `MIN_CLASS_FRAC = 0.005`
  (0.5 % of pixels) — guarantees the target class is actually in frame
  rather than at an edge.

Returns `(imgs, masks)`:
- `imgs` shape `(N, 4, 128, 128)`, reflectance in `[0, 1]`.
- `masks` shape `(N, 128, 128)` boolean — `True` where the pixel belongs
  to the target class.

§5.5 "Inspect training windows" plots a grid of (RGB · class-mask
overlay · NDVI) for every class so the operator can eyeball data quality
before any GPU time is burned.

### 5.2 Why context windows, not single-pixel concatenations

An earlier version sampled individual class pixels and packed them into
a flat array. That produced training inputs with no spatial structure —
no orchard edges, no neighbouring crop, no road / soil / water. The
adapter trained on those inputs converged to noise because there was
literally no pattern for it to latch onto. The context-window
formulation makes the LoRA learn "given any class-X LR neighbourhood,
sample a plausible class-X HR scene" rather than "denoise a bag of
unrelated pixels".

### 5.3 LoRA target modules

`_pick_lora_targets(unet)` walks `unet.named_modules()` and picks
modules whose names suffix-match one of:

- `qkv` — fused Q/K/V Conv1d inside each `AttentionBlock`.
- `proj_out` — the AttentionBlock's output projection Conv1d.
- `in_layers.2` — the first 3×3 Conv2d inside each ResBlock.
- `out_layers.3` — the second 3×3 Conv2d inside each ResBlock.
- `skip_connection` — ResBlock projection Conv2d (only present when the
  block changes channel count; Identity skip_connections are filtered
  out by the `isinstance(..., (nn.Linear, nn.Conv1d, nn.Conv2d))`
  guard).

Why include ResBlock convs and not just attention? The UNet has only 6
AttentionBlocks; the bulk of the 113 M parameters live in ResBlock 3×3
convs. Attention-only adaptation can shift *what the model attends to*
but not the texture it actually paints. Including the conv layers gives
the adapter the capacity to learn per-class surface texture.

70 modules wrapped in the current build (54 ResBlock convs + 12
attention + 14 Conv2d skip projections), trainable parameter count ≈
5–10 M depending on rank.

### 5.4 LoRA config

| Knob | Value | Notes                                                          |
|------|-------|----------------------------------------------------------------|
| `LORA_RANK`    | 48 | Adapter inner dimension                                        |
| `LORA_ALPHA`   | 48 | 1:1 with rank — adapter contribution scales with capacity      |
| `LORA_DROPOUT` | 0  | No dropout — small dataset, want fit                            |
| `LORA_EPOCHS`  | 45 | Loss plateaus around ep 25–30 on rank 24; 45 gives the 48-rank adapter time to settle |
| `LORA_BATCH`   | 4  | Drop to 2 if OOM on small GPUs                                 |
| `LORA_LR`      | 1e-4 | CosineAnnealingLR with T_max = epochs                         |

### 5.5 Training loop (DDPM ε-prediction in latent space)

For each minority class with at least one valid window:

1. PEFT-unload any prior LoRA wrap (lets repeated cell runs start clean
   without a kernel restart).
2. Restore the UNet to its pristine state.
3. `get_peft_model(unet, LoraConfig(...))` injects the 70-module LoRA
   wrap into the live UNet in-place.
4. AdamW + CosineAnnealingLR over the trainable parameters only.
5. Each step:
   - Sample a batch of N windows.
   - Build cross-patch pairs: pair patch `i` with a *different* patch
     `j` of the same class (`perm = (arange(n) + 1 + randint(0, n-1)) % n`).
     Without this, `z_0 ≈ z_cond` and the loss collapses to denoising
     an identity, teaching the adapter nothing.
   - `x_gt_up = F.interpolate(x_gt_64, size=256)`,
     `x_lr_up = F.interpolate(x_lr_64, size=256)`. Matches the upsample
     used inside `opensr_model._tensor_encode` at inference.
   - VAE-encode both:
     `z_0 = encode(x_gt_up)`, `z_c = encode(x_lr_up)`.
   - Sample diffusion timestep `t ~ Uniform{1..T}`, noise `ε ~ N(0, I)`.
   - `z_t = √ᾱ_t z_0 + √(1-ᾱ_t) ε`.
   - `ε̂ = UNet([z_t ‖ z_c], t)`.
   - MSE loss `L = ||ε - ε̂||²` backpropagates only into the LoRA
     parameters; the base UNet stays frozen.

After `LORA_EPOCHS`, the LoRA state dict (only `lora_A` / `lora_B`
weights) is pickled to
`data/_cache/lora/<class>.pt` for later reuse.

### 5.6 Sampling synthetic patches

`_sample_synth_patch(model, seed_patch, noise=SAMPLE_NOISE=0.005)`:

1. Promote the seed patch to a 1×4×64×64 tensor.
2. Inject light Gaussian noise (`σ = 0.005`) into the LR seed so each
   sample drifts to a different point on the manifold rather than
   reproducing the seed verbatim.
3. `model.forward(lr, sampling_steps=150, sampling_eta=0.2)` — DDIM
   denoise to a 4-band 512×512 SR scene.
4. Clip to `[0, 1]` and persist as a `.npy` + a tone-mapped `.png` under
   `data/_cache/synth/<class>/patch_NNN.png` (and matching NPY).

`N_SYNTH_PER_CLASS = 200` (40 in smoke mode). Per minority class the
notebook also caches `VIZ_PER_CLASS = 4` patches for the inline
side-by-side panel.

### 5.7 Failure modes observed and resolved

- **`UNet not found inside SRLatentDiffusion`** — the LDM UNet sits at
  `model.model.diffusion_model` (note: double `.model`). The candidate
  path list now tries that first.
- **`Target module Identity() is not supported`** — PEFT errored when
  `skip_connection` was Identity (no projection needed when channels
  match). `_pick_lora_targets` now returns only modules that pass the
  `isinstance(..., (nn.Linear, nn.Conv1d, nn.Conv2d))` test.
- **Loss collapses to ≈ 0** — the original training loop fed the same
  patch as both GT and conditioning, so `z_0 ≈ z_c` and the DDPM loss
  measured nothing useful. Fixed with cross-patch pairing (§5.5 step 5).
- **`encode_first_stage` not on SRLatentDiffusion** — VAE / scheduler
  members live on the wrapped inner LatentDiffusion (`model.model`).
  Wrapped by `_inner_ldm(model)`.

---

## 6. Stage 4 — Feature extraction

For each pixel that survives the cloud mask, the feature vector concatenates:

| Family    | Channels | Formula / source                                              |
|-----------|----------|---------------------------------------------------------------|
| Reflectance | 9        | All 9 S2 bands (10 m post-SR + 20 m bilinear-upsampled)       |
| Indices   | 6        | NDVI, NDMI, NDRE, GNDVI, BSI, EVI                              |
| GLCM texture | 4 × 4 = 16 | contrast, dissimilarity, homogeneity, ASM on a 9×9 window in 4 angles |
| LBP texture  | 1     | Uniform LBP histogram, radius 2, neighbours 16                |

Indices use the standard normalised-difference formulas — e.g.
`NDVI = (B08 − B04) / (B08 + B04 + ε)`, `NDMI = (B08 − B11) / (B08 + B11 + ε)`,
`BSI = ((B11 + B04) − (B08 + B02)) / ((B11 + B04) + (B08 + B02) + ε)`.

GLCM is computed on a quantised 8-level grey raster (NDVI mapped to
`[0, 7]`); LBP on the NIR band. Both run on the SR-resolution grid so
texture patterns reflect the fine 2.5 m structure rather than coarse
10 m blocks.

The feature stack is materialised as
`(features, total_pixels)` int8/float32 arrays, with row index = pixel
in raster scan order. Synthetic patches go through the same feature
extractor — every synth row carries a `y = x = -1` sentinel so the
classifier can tell them apart from real pixels if needed.

---

## 7. Stage 5 — Random Forest cascade

`CFG.rf_n_estimators = 600` (200 in smoke mode), `max_depth = None`,
`min_samples_leaf = 4`, `class_weight = "balanced"` plus the
diffusion-sampled rows.

The classifier runs in two passes (cascade):

1. **Stage A — binary "is this an orchard crop?"** Random Forest on a
   sub-sample with `Others` vs `{Durian ∪ Langsat ∪ Rambutan ∪ Mangosteen}`
   labels. Output is a single probability per pixel.
2. **Stage B — fine class among orchard candidates.** A second Random
   Forest trained only on pixels labelled `{Durian, Langsat, Rambutan,
   Mangosteen}` (real + synthetic). At inference, this is applied only
   to pixels where stage A's `P(orchard) > 0.5`.

Cascading saves training time on the dominant Others class and lets
stage B see a near-balanced label distribution.

The final prediction raster is written to `data/_out/preds_<aoi_name>.tif`
plus a confusion matrix and per-class metrics CSV.

---

## 8. Configuration knobs

All knobs live in the `Config` dataclass near the top of the notebook
plus a small block of LoRA-specific knobs in §6.

| Knob | Default | Where it bites                                  |
|------|---------|--------------------------------------------------|
| `aoi_quadrant` | `"SE"` | Which quarter of Rayong to process              |
| `aoi_bbox`     | quadrant table | Used when `aoi_quadrant == "CUSTOM"`     |
| `time_start` / `time_end` | `2024-10-01..12-31` | Per-month S2 medians inside this window  |
| `smoke_test`   | `False` | Shrinks AOI + time + RF size for fast iteration |
| `bands_10m`, `bands_20m` | per §2.3 | S2 bands fetched + super-resolved        |
| `sr_steps`     | 50 (full) / 25 (smoke) | DDIM steps in full-raster SR             |
| `WINDOW_PX`    | 128     | Side length of real training windows (SR pixels)|
| `MIN_CLASS_FRAC` | 0.005 | Min class-coverage per accepted window          |
| `LORA_RANK / ALPHA / EPOCHS / BATCH / LR` | 48 / 48 / 45 / 4 / 1e-4 | LoRA fit |
| `SR_SYNTH_STEPS` | 150 | DDIM steps used at synth time                  |
| `SR_SYNTH_ETA`   | 0.2 | Lower = more deterministic class identity      |
| `SAMPLE_NOISE`   | 0.005 | Pixel-space jitter injected into LR seed     |
| `N_SYNTH_PER_CLASS` | 200 (40 smoke) | Synth patches generated per minority class |
| `rf_n_estimators`  | 600 (200 smoke) | RF tree count for both cascade stages |

---

## 9. Reproducibility notes

- All RNG paths take a seed from `CFG.seed`, threaded into
  `np.random.RandomState`, `torch.Generator`, and any sklearn estimator
  that accepts `random_state`.
- `data/_cache/` holds every intermediate (S2 monthlies, SR rasters,
  real-window arrays, LoRA state dicts, synth patches, feature matrix);
  any individual step is rerunnable in isolation by deleting its cache
  sub-folder.
- `data/_out/` holds the final classifier outputs (raster + metrics).
- The notebook is laid out in numbered sections so a downstream reader
  can quote section IDs ("see §5.5") in a report.

---

## 10. Open work

- **Window resolution.** 128 SR-pixels is a compromise. 192 / 256 would
  capture more environment but at 4× memory.
- **Data scarcity.** Some quadrants have < 200 real Rambutan windows
  even with `MIN_CLASS_FRAC` relaxed; the classifier sees synth-heavy
  rows for those classes. A larger training window or a wider time
  window would help.
- **Per-tile artefacts.** The MGRS-tile alignment fix in §3.2 closed
  the visible cuts, but seasonal acquisition gaps still leave individual
  months sparser at the AOI edges. The monthly-median reducer hides
  this; switching to a yearly composite would smooth it further.
- **LoRA capacity ceiling.** At rank 48 the loss curve has room to
  descend further; the next jump is rank 64 with `LORA_BATCH = 2` to
  fit the bigger basis on consumer GPUs.
