# `data/` — pipeline inputs + caches

Everything the notebook reads from disk (and writes back) lives under this folder. Every path resolves relatively to the repo root, so as long as you put the shapefiles in the right subdirectory the notebook will pick them up regardless of which laptop you're on.

```
data/
├── landuse_ryg/        ← LDD landuse shapefile (.shp / .shx / .dbf / .prj / …)
│                         e.g. LU_RYG_2567.shp + siblings
├── admin_ryg/          ← LDD administrative-boundary shapefile (optional, used for clipping)
├── _cache/             ← S2 monthly composites + SR tiles + intermediate artefacts (gitignored)
└── _out/               ← Final models, figures, exported tables (gitignored)
```

## Setup checklist

1. Drop the LDD landuse shapefile (`LU_RYG_2567.shp` and all sibling files: `.shx`, `.dbf`, `.prj`, `.cpg`, `.sbn`, `.sbx`) into `data/landuse_ryg/`.
2. (Optional) Drop the administrative boundary shapefile into `data/admin_ryg/`.
3. The `_cache/` and `_out/` directories are created on first run.

## Moving from an old layout

If your shapefiles are still on the old `D:/work/GIS/rf/preprocess/...` path, migrate with PowerShell (run once from the repo root):

```powershell
New-Item -ItemType Directory -Force data\landuse_ryg, data\admin_ryg | Out-Null
Copy-Item "D:/work/GIS/rf/preprocess/full_dataset/Landuse_ryg/ระยอง2567/การใช้ที่ดิน/*" data\landuse_ryg\ -Recurse -Force
Copy-Item "D:/work/GIS/rf/preprocess/full_dataset/Landuse_ryg/ระยอง2567/ขอบเขตการปกครอง/*" data\admin_ryg\ -Recurse -Force
```

## Not in git

The shapefile + cache + outputs are all gitignored. Each teammate keeps their own copy locally. To refresh the website's `public/class-stats.json` after editing the shapefile, re-run:

```powershell
conda run -n rayong-tracker python notebooks/export_class_stats.py --shp data/landuse_ryg
```

…then `git add public/class-stats.json` and commit.
