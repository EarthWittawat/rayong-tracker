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
| 6   | GenAI  | base SR diffusion sampler seeded by real LR patches; DSAT path is a separate env   |
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

### DiffusionSat (optional, separate env)

DSAT pins `diffusers==0.18.2` / `huggingface_hub==0.16.4`, which conflicts with the main `synthcrop` env. Use a dedicated env:

```bash
conda env create -f environment-diffusionsat.yml
conda activate synthcrop-dsat

# register the kernel so JupyterLab can see it
python -m ipykernel install --user --name synthcrop-dsat --display-name "Python (synthcrop-dsat)"

# one-time: clone the DSAT repo next to this folder
git clone https://github.com/samar-khanna/DiffusionSat.git external/DiffusionSat
```

**Weights are not on a public HF repo.** `samar-khanna/DiffusionSat` returns 401 / "Repository Not Found". Open `external/DiffusionSat/README.md`, find the Google Drive link under *Pre-trained checkpoints*, download the snapshot folder, then point the loader at it:

```bash
# either: drop the snapshot under the conventional path the notebook tries first
mv ~/Downloads/diffusionsat_snapshot notebooks/external/DiffusionSat/weights/snapshot

# or: set an explicit env var (Windows PowerShell example)
$env:DSAT_MODEL_PATH = "D:\\path\\to\\diffusionsat_snapshot"
```

Once the local path resolves, the notebook + CLI load DSAT without hitting HF.

Then you have two ways to sample, both producing the same `.npy + .png` layout under `data/_cache/synth/<class>/`:

| How                     | When to use                                                              |
| ----------------------- | ------------------------------------------------------------------------ |
| `diffusionsat.ipynb`    | Default. Open in JupyterLab, pick the `Python (synthcrop-dsat)` kernel, run top-to-bottom. Inline preview at the end. |
| `diffusionsat_synth.py` | Batch / headless / scripted runs. Same logic, CLI args.                  |

After either run, switch back to the `Python (synthcrop)` kernel in `pipeline.ipynb` and re-run §6.1 — it picks up the DSAT outputs automatically.

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

