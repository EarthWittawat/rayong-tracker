# Notebooks

End-to-end pipeline that mirrors the five tracker stages (`Data · SR · GenAI · Feat · RF`).

## `pipeline.ipynb`

Section map:

| § | Tracker stage | Topic |
|---|---|---|
| 1 | — | setup, config dataclass, GPU check |
| 2 | `Data` | CDSE openEO → S2 L2A monthly median, SCL cloud mask |
| 3 | `SR` | OpenSR / SEN2SR-LDM 4× super-resolution (10 m → 2.5 m) |
| 4 | `GenAI` | minority-class generation: 4a LoRA-adapted SEN2SR, 4b DiffusionSat, 4c comparison + FID |
| 5 | — | side-by-side viz (native vs SR) |
| 6 | `Feat` | LDD landuse → rasterise on SR grid → per-class patch extraction |
| 7 | `Feat` | pixel table: temporal stats + NDVI/NDWI/EVI + GLCM/LBP texture |
| 8 | `RF` | stage-1 RF + cascade for minority classes; confusion matrix, importance |
| 9 | — | mapping notebook outputs → tracker board task counts |

## Conda environment

`environment.yml` pins a clean conda-forge + pip stack (geospatial GDAL chain through conda-forge, PyTorch + diffusion stack through pip). Create + activate:

```bash
# from this directory
conda env create -f environment.yml
conda activate rayong-tracker

# (optional) register the kernel so Jupyter shows it
python -m ipykernel install --user --name rayong-tracker --display-name "Python (rayong-tracker)"
```

If your GPU driver is CUDA 11.8 (or you have no GPU), edit the pip block before running `env create`:

- CUDA 11.8 → swap `cu121` for `cu118`
- CPU only  → swap `cu121` for `cpu`

To refresh after editing `environment.yml`:

```bash
conda env update -f environment.yml --prune
```

DiffusionSat is not on PyPI — clone it once into `../external/DiffusionSat` if you want §4b:

```bash
git clone https://github.com/samar-khanna/DiffusionSat.git ../external/DiffusionSat
```

## Running it

1. Activate the env: `conda activate rayong-tracker`.
2. Launch: `jupyter lab pipeline.ipynb` (or VS Code / nbclassic).
3. Authenticate with CDSE on first use (browser-based OIDC, cached afterwards).
4. Adjust `CFG.aoi_bbox`, `CFG.minority_classes`, and the LDD paths if your shapefile column isn't `LU_CODE`.
5. After §6 has loaded `lu` + `LU_SHP`, run §10 to export `public/class-stats.json` for the website's *Class distribution* panel — then commit the JSON.

GPU required for §3, §4. CPU works for §6–§8 only.

## Editing

Don't hand-edit `pipeline.ipynb`. Edit `_build_notebook.py` and re-run:

```bash
python _build_notebook.py
```

This emits a deterministic notebook (sorted, fresh cell IDs each run).
