# `notebooks/` — SynthCrop pipeline

`pipeline.ipynb` is the end-to-end research notebook backing the **SynthCrop Progress Tracker** (the web app under `app/`). It implements a five-stage Sentinel-2 → super-resolution → generative augmentation → feature engineering → Random Forest workflow for crop-type classification.

## Stages

| §   | Stage  | Topic                                                                              |
| --- | ------ | ---------------------------------------------------------------------------------- |
| 1   | —      | imports, `Config` dataclass, TAXONOMY (15 classes), quadrant-AOI resolution        |
| 2   | Data   | CDSE openEO · Sentinel-2 L2A monthly median with SCL cloud masking                 |
| 3   | SR     | OpenSR latent diffusion ×4 (10 m → 2.5 m) on B02 / B03 / B04 / B08                 |
| 4   | —      | native-vs-SR side-by-side + zoom + monthly strip + reflectance histograms          |
| 5   | Feat   | LDD landuse → 15-class raster on SR grid → per-class patch extraction              |
| 6   | GenAI  | latent-LoRA fine-tuning of opensr-ldsrs2 per minority class · 4-band reflectance   |
| 6.1 | —      | RGB / false-colour NIR / NDVI grid of synthetic patches per minority class         |
| 7   | Feat   | pixel table: monthly stats + NDVI / NDWI · synth rows concatenated                 |
| 8   | RF     | stage-1 RF + minority-focused stage-2 cascade · classification report + figures    |
| 9   | —      | mapping notebook outputs back to tracker-board `done / total` counts               |
| 10  | —      | export `public/class-stats.json` for the website's Class Distribution panel        |

GPU recommended for §3 and §6. CPU-only is fine for §5, §7, §8.

### Taxonomy

The notebook collapses raw LDD `LU_CODE` values into 15 buckets defined by `TAXONOMY` in §1:

| # | Class       | Default LDD codes |
| - | ----------- | ----------------- |
| 1 | Rice        | A101              |
| 2 | Cassava     | A201              |
| 3 | Pineapple   | A202              |
| 4 | Para rubber | A301              |
| 5 | Oil palm    | A302              |
| 6 | Durian      | A401              |
| 7 | Mango       | A402              |
| 8 | Jackfruit   | A403              |
| 9 | Coconut     | A303              |
| 10| Mangosteen  | A404              |
| 11| Longan      | A405              |
| 12| Rambutan    | A406              |
| 13| Langsat     | A407              |
| 14| Reservoir   | W201 / W101       |
| 15| Others      | (catch-all)       |

Adjust the code lists in `TAXONOMY` if your LDD layer uses different codes — anything that doesn't match falls into **Others**.

## Environment

`environment.yml` pins a conda-forge + pip stack: geospatial GDAL chain through conda-forge, PyTorch + diffusion stack through pip with a `+cu121` local-version tag so the resolver picks the CUDA wheel.

```bash
conda env create -f environment.yml
conda activate synthcrop

# register the kernel so Jupyter shows it
python -m ipykernel install --user --name synthcrop --display-name "Python (synthcrop)"
```

Refresh after editing the env file:

```bash
conda env update -f environment.yml --prune
```

### §6 GenAI — latent-LoRA on opensr-ldsrs2

We synthesise minority-class Sentinel-2 patches by **fine-tuning a small LoRA adapter on the same `opensr-ldsrs2` latent diffusion model already used for super-resolution**. Trains in latent space, conditioned on the LR latent — so the output is 4-band reflectance with the right radiometry, not RGB-only natural-image samples.

DiffusionSat was considered and removed: it emits RGB only, isn't class-conditioned on Thai crops, and the weights aren't on a public HF repo.

#### Model architecture

```
   real 4-band patch x ∈ ℝ^(4×256×256)
            │
            ▼
   ┌────────────────────┐
   │  VAE encoder Eφ    │  (frozen, CompVis)
   └────────────────────┘
            │  z₀  (scale s ≈ 0.18215)
   ┌────────┴─────────┐
   ▼                  ▼
   LR latent z_c      q(z_t | z₀) forward noising
   = Eφ(LR↑256)       z_t = √ᾱ_t z₀ + √(1-ᾱ_t) ε
            │                  │
            └────── concat ────┘
                    │  8-channel
                    ▼
       ┌──────────────────────────┐
       │  UNet_θ  (CompVis vanilla │ ← LoRA on q / k / v / proj_out
       │  attention, Conv2d 1×1)  │   (Conv2d 1×1 projections)
       └──────────────────────────┘
                    │  ε̂_θ
              DDIM denoise (T steps)
                    │
                    ▼
       ┌────────────────────┐
       │  VAE decoder Dφ    │
       └────────────────────┘
                    │
                    ▼
       synthetic x̂ ∈ ℝ^(4×256×256)
```

- VAE: frozen, CompVis-style autoencoder, 4-channel input/output. Latent: 4 channels, 4× spatial downsample.
- UNet: 113 M params, vanilla CompVis attention (q / k / v / proj_out are Conv2d 1×1). First conv expects 8 channels (= `[z_t ‖ z_c]`).
- LoRA: rank `r=8`, `α=16`, applied only to attention projections. ≈10 MB trainable per class vs ≈110 MB frozen base.

#### Loss

ε-prediction DDPM in latent space:

```
L_LoRA(θ) = E_{x, ε, t} [ || ε − ε_θ([z_t ‖ z_c], t) ||₂² ]

z₀ = s · Eφ(x).sample()                          (real patch encode)
z_c = s · Eφ(LR↑).sample()                       (LR-upsample encode, conditioning)
z_t = √ᾱ_t · z₀ + √(1 − ᾱ_t) · ε                  (forward DDPM step)
ε  ~ N(0, I),   t ~ Uniform{1, …, T},  T = 1000
```

LoRA reparameterisation: every target weight `W ∈ ℝ^(d_out × d_in)` becomes `W' = W + (α/r) B A` with `A ∈ ℝ^(r × d_in)`, `B ∈ ℝ^(d_out × r)`. Only `A`, `B` train.

#### Sampling

After training, the LoRA-wrapped UNet is reattached into `model.model.diffusion_model`, so the regular `model.forward(LR_seed, sampling_steps=T)` call uses the adapted weights. LR seeds are real minority patches with light Gaussian noise (`σ ≈ 0.03`) for sample-to-sample diversity. Outputs land in `data/_cache/synth/<class>/patch_NNN.{npy, png}` and per-class LoRA weights in `data/_cache/lora/<class>.pt`.

## Data

All shapefiles, caches, and outputs live under `<repo>/data/` — see `data/README.md` for the expected layout. The notebook resolves every path from `CFG.repo_root` so you don't need to touch absolute paths on a fresh laptop.

## Running

1. `conda activate synthcrop`
2. `jupyter lab pipeline.ipynb`
3. First run authenticates with CDSE via browser-based OIDC; the token is cached afterwards.
4. Set `CFG.aoi_quadrant` (`FULL` / `NW` / `NE` / `SW` / `SE`) for your assigned area, or `CUSTOM` + paste a drawn bbox from the website's map readout panel into `CFG.aoi_bbox`.
5. Heavy stages (Data, SR, RF) cache to `data/_cache/` and `data/_out/` — re-running after a kernel restart is fast.
6. Run §10 once `lu` is loaded to refresh `public/class-stats.json`, then commit the JSON to update the website's Class Distribution panel.

A standalone refresh of the class-stats snapshot — without running any of the heavy stages — is available via:

```bash
python notebooks/export_class_stats.py
```

