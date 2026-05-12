# `data/` — pipeline inputs + caches

All shapefiles, cached rasters, and exports the notebook touches live under this folder. Paths resolve relative to the repo root, so the same notebook works on any machine without editing absolute paths.

```
data/
├── landuse_ryg/   LDD landuse shapefile (.shp / .shx / .dbf / .prj / …)
├── admin_ryg/     LDD administrative-boundary shapefile (optional, used for clipping)
├── _cache/        S2 monthly composites + SR tiles + intermediate artefacts (gitignored)
└── _out/          Final models, figures, exported tables (gitignored)
```

## Setup

1. Place the LDD landuse shapefile (all sibling files: `.shp`, `.shx`, `.dbf`, `.prj`, `.cpg`, `.sbn`, `.sbx`) inside `data/landuse_ryg/`.
2. (Optional) Place the administrative-boundary shapefile inside `data/admin_ryg/`.
3. `_cache/` and `_out/` are created automatically on first run.

## Not in git

The shapefile + cache + outputs are gitignored. Each teammate keeps a local copy. To refresh the website's `public/class-stats.json` after editing the shapefile:

```bash
conda run -n synthcrop python notebooks/export_class_stats.py
```

Then commit `public/class-stats.json` to deploy the updated Class Distribution panel.
