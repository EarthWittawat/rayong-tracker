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

## Running it

1. Install heavy deps (first cell, commented out by default — uncomment + run once).
2. Authenticate with CDSE on first use (browser-based OIDC, cached afterwards).
3. Clone DiffusionSat into `../external/DiffusionSat` if you want §4b.
4. Adjust `CFG.aoi_bbox`, `CFG.minority_classes`, and the LDD paths if your shapefile column isn't `LU_CODE`.

GPU required for §3, §4. CPU works for §6–§8 only.

## Editing

Don't hand-edit `pipeline.ipynb`. Edit `_build_notebook.py` and re-run:

```bash
python _build_notebook.py
```

This emits a deterministic notebook (sorted, fresh cell IDs each run).
