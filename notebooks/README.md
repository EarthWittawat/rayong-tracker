# `notebooks/` — SynthCrop pipeline

`pipeline.ipynb` is the end-to-end research notebook backing the **SynthCrop Progress Tracker** (the web app under `app/`). It implements a Sentinel-2 → super-resolution → generative augmentation → feature engineering → Random Forest workflow for crop-type classification over Rayong province, split at the centroid into NW / NE / SW / SE quadrants.

`regen_quadrant.ipynb` is a standalone helper that rebuilds **one** quadrant's S2 monthly + OpenSR caches when the main driver flags a dirty cache (duplicate bounds, smoke-test slice, missing months).

## Sections

| §    | Stage  | Topic                                                                                       |
| ---- | ------ | ------------------------------------------------------------------------------------------- |
| 1    | —      | imports, `Config` dataclass, TAXONOMY (15 classes), quadrant-AOI resolution                 |
| 2    | Data   | CDSE openEO · Sentinel-2 L2A monthly median, SCL cloud masking, resampled to UTM 47 N        |
| 3    | SR     | OpenSR latent-diffusion 4× (10 m → 2.5 m) on B02 / B03 / B04 / B08, per-quadrant cache       |
| 4    | —      | LDD landuse rasterise helpers + minority-window extractor (NoData-rejecting, mask-aware)    |
| 4.5  | Feat   | pixel-table builder (slim 12-col SR-only feature set) + per-class pixel-cap subsample       |
| **5**| —      | **Full Rayong driver** · loops `CFG.quadrants`, pools windows up to `samples_per_minor`, concatenates per-AOI pixel tables into `DF`, disk-caches the result |
| 6    | —      | native-vs-SR side-by-side + zoom + monthly strip + reflectance histograms (sanity AOI)       |
| 6.5  | —      | RGB / class-mask overlay / NDVI grid of the windows that feed the LoRA                       |
| 7    | GenAI  | per-class LoRA fine-tune of opensr-ldsrs2 · mask-weighted MSE in latent space · 4-band reflectance · inline RGB+NDVI snapshots every 10 epochs · synth_rows pickled to cache |
| 7.0  | —      | generative-model audit table (settings + failure modes)                                       |
| 7.1  | —      | RGB / false-colour NIR / NDVI grid of synthetic patches per minority class                   |
| 7.2  | —      | real-window vs synth side-by-side per class                                                  |
| 7.3  | —      | sample-count diagnostic · before SR / after SR / after GenAI                                 |
| 8    | RF     | stage-1 RF + minority-focused stage-2 cascade · auto-reloads `DF` + `synth_rows` from cache  |
| 9    | —      | mapping notebook outputs back to tracker-board `done / total` counts                         |
| 10   | —      | export `public/class-stats.json` for the website's Class Distribution panel                  |

GPU recommended for §3 and §7. CPU-only is fine for §4 – §6, §8.

## Taxonomy

The notebook collapses raw LDD `LU_CODE` values into 15 buckets defined by `TAXONOMY` in §1. Codes verified against the `LU_DES_EN` column of `data/landuse_ryg/LU_RYG_2567.dbf`:

| # | Class       | LDD code(s)                              | LU_DES_EN                              |
| - | ----------- | ---------------------------------------- | -------------------------------------- |
| 1 | Rice        | A101                                     | Active paddy field                     |
| 2 | Cassava     | A204                                     | Cassava                                |
| 3 | Pineapple   | A205                                     | Pineapple                              |
| 4 | Para rubber | A302                                     | Para rubber                            |
| 5 | Oil palm    | A303                                     | Oil palm                               |
| 6 | Durian      | A403                                     | Durian                                 |
| 7 | Mango       | A407                                     | Mango                                  |
| 8 | Jackfruit   | A416                                     | Jack fruit                             |
| 9 | Coconut     | A405                                     | Coconut                                |
| 10| Mangosteen  | A419                                     | Mangosteen                             |
| 11| Longan      | A413                                     | Longan                                 |
| 12| Rambutan    | A404                                     | Rambutan                               |
| 13| Langsat     | A420                                     | Langsat, Longkong                      |
| 14| Reservoir   | W101 · W102 · W103 · W201 · W202 · W203  | River / Lake / Ocean / Reservoir / Farm pond / Irrigation canal (unified water class) |
| 15| Others      | (catch-all)                              | everything not matched above           |

Minority classes (the ones LoRA targets) default to `("Mango", "Rambutan", "Langsat", "Longan", "Mangosteen", "Coconut", "Jackfruit")`. Adjust `CFG.minority_classes` to retarget.

## Environment

`environment.yml` pins a conda-forge + pip stack: geospatial GDAL chain through conda-forge, PyTorch + diffusion stack through pip with a `+cu121` local-version tag so the resolver picks the CUDA wheel.

```bash
conda env create -f environment.yml
conda activate rayong-tracker

# register the kernel so Jupyter shows it
python -m ipykernel install --user --name rayong-tracker --display-name "Python (rayong-tracker)"
```

Refresh after editing the env file:

```bash
conda env update -f environment.yml --prune
```

## §7 GenAI — latent-LoRA on opensr-ldsrs2

We synthesise minority-class Sentinel-2 patches by **fine-tuning a small LoRA adapter on the same `opensr-ldsrs2` latent diffusion model already used for super-resolution**. Trains in latent space, conditioned on the LR latent — so the output is 4-band reflectance with the right radiometry, not RGB-only natural-image samples.

### Model architecture

```
   real 4-band patch x ∈ ℝ^(4 × 512 × 512)                         ← WINDOW_PX = 512 SR-px
            │
            │   bilinear-up to LORA_TARGET_PX (256)
            ▼
   ┌────────────────────┐
   │  VAE encoder Eφ    │  (frozen, CompVis)
   └────────────────────┘
            │  z₀  (scale s ≈ 0.18215)
   ┌────────┴─────────┐
   ▼                  ▼
   LR latent z_c      q(z_t | z₀) forward noising
   = Eφ(LR↑256)       z_t = √ᾱ_t z₀ + √(1-ᾱ_t) ε
   ↑                          │
   LR = area-down(x, 4) =     │       SELF_PAIR_PROB = 0.5
   128 LR-px @ 10 m           │       50 % use SAME-patch LR (matches inference)
   (matches opensr tile)      │       50 % use a DIFFERENT class-X patch
            │                  │       (class-conditional prior)
            └────── concat ────┘
                    │  8-channel
                    ▼
       ┌──────────────────────────┐
       │  UNet_θ  (CompVis vanilla │ ← LoRA on  qkv · proj_out · in_layers.2 · out_layers.3 · skip_connection
       │  attention)              │   (Conv1d attention + Conv2d 3×3 ResBlock projections)
       └──────────────────────────┘
                    │  ε̂_θ
              DDIM denoise (T_sample steps, η)
                    │
                    ▼
       ┌────────────────────┐
       │  VAE decoder Dφ    │
       └────────────────────┘
                    │
                    ▼
       synthetic x̂ ∈ ℝ^(4 × 512 × 512)
```

### Hyperparameters

| Knob                  | Default | Note                                                            |
| --------------------- | ------- | --------------------------------------------------------------- |
| `WINDOW_PX`           | 512     | SR-side, 1280 m FOV. `LR_DIV = 4` → 128 LR-px = opensr tile     |
| `LORA_RANK`           | 32      |                                                                  |
| `LORA_ALPHA`          | 64      | α = 2 × rank                                                    |
| `LORA_LR`             | 5e-5    | AdamW + cosine schedule                                          |
| `LORA_EPOCHS`         | 60      | with inline RGB+NDVI viz every `VIZ_EVERY_EPOCHS = 10`           |
| `LORA_BATCH`          | 4       |                                                                  |
| `MASK_LOSS_WEIGHT`    | 8.0     | class pixels carry 9× background weight in latent MSE            |
| `SELF_PAIR_PROB`      | 0.5     | mix of self-paired vs cross-class-X-paired z_c                  |
| `SR_SYNTH_STEPS`      | 200     | DDIM denoise steps at sampling time                              |
| `SR_SYNTH_ETA`        | 0.1     | near-deterministic DDIM                                          |
| `SAMPLE_NOISE`        | 0.0     | LR jitter (off; diversity comes from cross-pair + augment)       |
| `SAMPLE_AUG`          | True    | random hflip / vflip / 90° rot on each LR seed                  |
| `N_SYNTH_PER_CLASS`   | 200     | synth patches sampled per class after training                   |
| Trainable params      | ~7.7 M / ~121 M (≈6.4 %)                                                  |

LoRA targets the **full** UNet attention path plus ResBlock 3×3 convs and skip-connection projections — not just `q / k / v / proj_out`. This gives the adapter enough capacity to shift class texture without expanding to full fine-tuning.

### Loss

ε-prediction DDPM in latent space, **mask-weighted** so the adapter focuses on class pixels rather than the rest of the scene:

```
L_LoRA(θ) = E_{x, ε, t} [ (1 + λ · mask↓z) ⊙ ‖ε − ε_θ([z_t ‖ z_c], t)‖₂² ]

z₀  = s · Eφ(x↑256).sample()
z_c = s · Eφ(LR↑256).sample()
z_t = √ᾱ_t · z₀ + √(1 − ᾱ_t) · ε
ε   ~ N(0, I),   t ~ Uniform{1, …, 1000}
λ   = MASK_LOSS_WEIGHT = 8.0
mask↓z = area-downsample of the class mask to z's spatial grid
```

LoRA reparameterisation: every target weight `W ∈ ℝ^(d_out × d_in)` becomes `W' = W + (α/r) B A` with `A ∈ ℝ^(r × d_in)`, `B ∈ ℝ^(d_out × r)`. Only `A`, `B` train.

### Sampling

After training, the LoRA-wrapped UNet stays attached inside `model.model.diffusion_model`, so a regular `model.forward(LR_seed, sampling_steps=T, sampling_eta=η)` call uses the adapted weights. The seed pipeline:

1. Take a real minority window at the SR scale (4 × 512 × 512).
2. Area-downsample by `LR_DIV = 4` → 128 LR-px @ 10 m (opensr's native tile size, no MIN_LR_PX clamp).
3. Optionally random flip / rot (`SAMPLE_AUG`).
4. Optional Gaussian jitter (`SAMPLE_NOISE`; off by default).
5. DDIM denoise 200 steps at η = 0.1, decode through the VAE.

Outputs land in `data/_cache/synth/<class>/patch_NNN.{npy, png}` and per-class LoRA weights in `data/_cache/lora/<class>.pt`. The pickled feature rows used by §8 RF are written to `data/_cache/synth_rows.pkl`.

### Training-time visualisation

`train_lora_class` runs a 30-step sample on a **fixed** seed (`real_patches[0]`) every `VIZ_EVERY_EPOCHS = 10` and plots inline:

- RGB (B04 / B03 / B02, 99-percentile stretch)
- NDVI (RdYlGn, vmin = −0.2, vmax = 0.9)

Fixed seed + low η = the panel-to-panel difference is the LoRA's contribution, not seed variance. Watch the loss-print line for hard convergence; treat the viz as visual confirmation, not the metric.

## §5 Full Rayong driver

Replaces the old single-AOI sanity loop. Iterates every entry in `CFG.quadrants` (default `("NW", "NE", "SW", "SE")`):

1. `load_sr_stack_from_cache(rayong_<q>)` — dask-chunked SR loader, filters to `CFG.time_start..time_end` window and uses `xr.concat(..., join="exact")` so a stray-month tif fails loud instead of silently mis-aligning the grid.
2. `load_landuse_for(sr_q)` + `rasterize_labels(...)` — province-wide LDD rasterised onto the per-AOI SR grid.
3. `extract_class_context_windows(...)` — per-class window extraction with NoData rejection (>2 % black or NaN) + mask check (≥1 % whole-window class). Per-AOI cap = `CFG.samples_per_minor / len(CFG.quadrants)` so the pool can't blow past `samples_per_minor` total.
4. `build_pixel_table(sr_q, labels_q, stride=8)` — slim 12-feature SR-only table with per-class pixel cap (default 100 000 per AOI). Per-AOI tables tagged with the `aoi` column and concatenated into `DF`.
5. Sanity AOI's SR / `LABELS` / `lu` bound to module-level globals for the §6 sanity viz cells. Other quadrants are `del`'d to free memory between iterations.

`DF` written to `data/_out/pixel_table_full.parquet` (or `.pkl` fallback) so §8 RF can lazy-reload after a kernel restart and skip the driver entirely.

## Data

All shapefiles, caches, and outputs live under `<repo>/data/` — see `data/README.md` for the expected layout. The notebook resolves every path from `CFG.repo_root` so you don't need to touch absolute paths on a fresh laptop.

Cache layout under `data/_cache/`:

```
s2_monthly/rayong_<q>/openEO_YYYY-MM-DDZ.tif    ← raw openEO output
s2_sr/rayong_<q>/sr_YYYYMM.tif                  ← OpenSR cache (per quadrant, per month)
lora/<class>.pt                                  ← per-class LoRA adapter weights
synth/<class>/patch_NNN.npy + patch_NNN.png      ← 4-band synth patches + RGB preview
synth_rows.pkl                                   ← pickled synth feature rows for §8
```

## Running

1. `conda activate rayong-tracker`
2. `jupyter lab pipeline.ipynb`
3. First run authenticates with CDSE via browser-based OIDC; the token is cached afterwards.
4. Run top-to-bottom. §5 driver covers all four quadrants. The §6 viz cells fall back to `CFG.aoi_quadrant` (default `SE`) for the sanity AOI; override there if you want the viz on a different quadrant.
5. Heavy stages (§2 Data, §3 SR, §5 driver, §7 LoRA) cache to `data/_cache/` and `data/_out/`. Re-running after a kernel restart skips straight to §8 RF if both caches exist.
6. Run §10 once `lu` is loaded to refresh `public/class-stats.json`, then commit the JSON to update the website's Class Distribution panel.

A standalone refresh of the class-stats snapshot — without running any of the heavy stages — is available via:

```bash
python notebooks/export_class_stats.py
```

### Rebuilding one quadrant — `regen_quadrant.ipynb`

When the §5 driver's per-AOI summary flags a bad cache (duplicate bounds, smoke-test slice, missing months), open `regen_quadrant.ipynb`, set `QUADRANT = "NW" / "NE" / "SW" / "SE"` in the config cell, and run top-to-bottom. It fetches a fresh S2 monthly cache via openEO and runs OpenSR 4× from scratch, verifying the regenerated tif's UTM bounds against the canonical Rayong centroid split before declaring success. Re-run `pipeline.ipynb` §5 driver afterwards — the new tifs are picked up automatically.
