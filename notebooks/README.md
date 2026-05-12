# `notebooks/` — SynthCrop pipeline

`pipeline.ipynb` is the end-to-end research notebook backing the **SynthCrop Progress Tracker** (the web app under `app/`). It implements a five-stage Sentinel-2 → super-resolution → generative augmentation → feature engineering → Random Forest workflow for crop-type classification.

## Stages

| § | Stage  | Topic                                                                                |
| - | ------ | ------------------------------------------------------------------------------------ |
| 1 | —      | imports, `Config` dataclass, quadrant-AOI resolution, GPU check                      |
| 2 | Data   | CDSE openEO · Sentinel-2 L2A monthly median with SCL cloud masking                   |
| 3 | SR     | OpenSR latent diffusion ×4 (10 m → 2.5 m) on B02 / B03 / B04 / B08                   |
| 4 | GenAI  | minority-class synthesis · 4a LoRA-fine-tuned SEN2SR · 4b DiffusionSat               |
| 5 | —      | full-AOI + zoom + monthly strip + per-band reflectance histograms                    |
| 6 | Feat   | LDD landuse → rasterise on SR grid → per-class patch extraction                      |
| 7 | Feat   | pixel table: temporal band stats + NDVI / NDWI / EVI + GLCM / LBP texture            |
| 8 | RF     | stage-1 Random Forest + minority-focused cascade · classification report + figures   |
| 9 | —      | mapping notebook outputs back to tracker-board `done / total` counts                 |
| 10| —      | export `public/class-stats.json` for the website's Class Distribution panel          |

GPU recommended for §3 and §4a. CPU-only is fine for §6–§8.

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

DiffusionSat is not on PyPI — clone once if you intend to run §4b:

```bash
git clone https://github.com/samar-khanna/DiffusionSat.git ../external/DiffusionSat
```

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

