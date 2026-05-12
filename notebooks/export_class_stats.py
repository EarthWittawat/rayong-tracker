"""Standalone exporter for `public/class-stats.json`.

The notebook §10 cell does the same thing, but it depends on the heavy
Data / SR / GenAI stages running first. This script reads only the LDD
landuse shapefile, computes per-quadrant + per-Sentinel-2-tile class
shares + imbalance metrics, and writes the JSON that powers the
ClassInsights panel on the board.

Usage (PowerShell):

    conda activate rayong-tracker
    python notebooks/export_class_stats.py `
        --shp "D:/work/GIS/rf/preprocess/full_dataset/Landuse_ryg/ระยอง2567/การใช้ที่ดิน"

The path can be the shapefile itself or the directory holding it; we
will glob for *.shp inside if you pass a directory.
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd


# --- constants mirror the web app's RayongMap (lib/rayong.ts) ----------------

RAYONG_CENTER = {"lng": 101.4291, "lat": 12.8539}

# Default minorities; pass --minority A203 --minority A302 ... to override.
DEFAULT_MINORITY_CLASSES = ("A203", "A302", "A401")

PALETTE = [
    "#3F7D58", "#3F6E97", "#C96442", "#B68A2E", "#7B5BA6", "#9B5C7A",
    "#4F7A95", "#7C7A52", "#A85C9D", "#5F8A6E", "#8B6F47", "#D4A748",
]
MINORITY_COLOR = "#B14B3D"
OTHER_COLOR = "#9A968D"

# Optional human-readable labels for LDD codes (extend as the team learns them).
LABELS: dict[str, str] = {
    # "A101": "Paddy rice",
    # "A203": "Cassava",
}


# --- helpers ----------------------------------------------------------------


def quadrant_of(lng: float, lat: float) -> str:
    east = lng >= RAYONG_CENTER["lng"]
    north = lat >= RAYONG_CENTER["lat"]
    return ("N" if north else "S") + ("E" if east else "W")


def s2_tile_of(lng: float, lat: float, mgrs_obj) -> str | None:
    if mgrs_obj is None:
        return None
    try:
        s = mgrs_obj.toMGRS(lat, lng, MGRSPrecision=0)
        return s[:5] if isinstance(s, str) and len(s) >= 5 else None
    except Exception:
        return None


def shannon(shares: list[float]) -> float:
    return -sum(s * math.log2(s) for s in shares if s > 0)


def gini(shares: list[float]) -> float:
    xs = sorted(float(s) for s in shares if s > 0)
    n = len(xs)
    if n == 0:
        return 0.0
    cum = sum((i + 1) * s for i, s in enumerate(xs))
    return (2 * cum) / (n * sum(xs)) - (n + 1) / n


def max_min_ratio(shares: list[float]) -> float:
    nz = [s for s in shares if s > 0]
    return (max(nz) / min(nz)) if nz else 0.0


def metrics_of(block: dict) -> dict:
    shares = [c["share"] for c in block["classes"]]
    return {
        "shannon": round(shannon(shares), 4),
        "gini": round(gini(shares), 4),
        "max_min_ratio": round(max_min_ratio(shares), 3),
    }


# --- main -------------------------------------------------------------------


def resolve_shapefile(path: Path) -> Path:
    if path.is_file() and path.suffix.lower() == ".shp":
        return path
    if path.is_dir():
        cands = sorted(path.glob("*.shp"))
        if not cands:
            raise FileNotFoundError(f"no .shp inside {path}")
        return cands[0]
    raise FileNotFoundError(f"not a .shp file or directory: {path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Export public/class-stats.json from the LDD landuse shapefile.")
    parser.add_argument("--shp", type=Path, required=True, help="LDD landuse shapefile or directory containing one")
    parser.add_argument("--class-col", default="LU_CODE", help="Column with the class code (default LU_CODE)")
    parser.add_argument("--top-n", type=int, default=8, help="Top-N classes by area to keep verbatim (rest -> 'other')")
    parser.add_argument("--minority", action="append", default=list(DEFAULT_MINORITY_CLASSES),
                        help="Class codes to always include and flag as minority. Repeatable.")
    parser.add_argument("--out", type=Path, default=None, help="Output JSON path (default: <repo>/public/class-stats.json)")
    parser.add_argument("--skip-s2", action="store_true", help="Skip the per-Sentinel-2-tile breakdown (no mgrs dependency)")
    args = parser.parse_args()

    # Repo root = parent of notebooks/
    repo_root = Path(__file__).resolve().parents[1]
    out_path = args.out or (repo_root / "public" / "class-stats.json")

    shp = resolve_shapefile(args.shp)
    print(f"reading {shp.name} ...")
    lu = gpd.read_file(shp)
    if args.class_col not in lu.columns:
        raise ValueError(
            f"class column '{args.class_col}' not in shapefile. "
            f"available columns: {list(lu.columns)}"
        )

    # Project to UTM 47N for accurate planar area, lat/lng for centroid binning.
    lu_m = lu.to_crs(32647).copy()
    lu_ll = lu.to_crs(4326).copy()
    lu_ll["area_km2"] = (lu_m.area / 1e6).values
    cen_ll = lu_m.geometry.centroid.to_crs(4326)
    lu_ll["_cen_lng"] = cen_ll.x.values
    lu_ll["_cen_lat"] = cen_ll.y.values

    # Sentinel-2 tile (optional, via the mgrs package)
    mgrs_obj = None
    if not args.skip_s2:
        try:
            import mgrs as _mgrs_mod
            mgrs_obj = _mgrs_mod.MGRS()
        except Exception:
            print("note: `pip install mgrs` to include the per-S2-tile breakdown (skipping for now).")

    lu_ll["_quadrant"] = [quadrant_of(x, y) for x, y in zip(lu_ll._cen_lng, lu_ll._cen_lat)]
    lu_ll["_s2_tile"] = [s2_tile_of(x, y, mgrs_obj) for x, y in zip(lu_ll._cen_lng, lu_ll._cen_lat)]

    cls_col = args.class_col
    lu_ll[cls_col] = lu_ll[cls_col].astype(str).fillna("__unk__")

    # Top-N classes by total area + always-pinned minority classes
    total_by_class = lu_ll.groupby(cls_col)["area_km2"].sum().sort_values(ascending=False)
    top_ids = list(total_by_class.head(args.top_n).index)
    minority_ids = list(args.minority)
    keep_ids = list(dict.fromkeys(top_ids + minority_ids))
    lu_ll["_class"] = lu_ll[cls_col].where(lu_ll[cls_col].isin(keep_ids), other="other")

    ordered = keep_ids + (["other"] if "other" in lu_ll["_class"].unique() else [])

    class_defs = []
    for i, cid in enumerate(ordered):
        is_min = cid in minority_ids
        color = MINORITY_COLOR if is_min else (OTHER_COLOR if cid == "other" else PALETTE[i % len(PALETTE)])
        class_defs.append({
            "id": cid,
            "label": LABELS.get(cid, cid),
            "color": color,
            "minority": bool(is_min),
        })

    def area_block(df):
        grp = df.groupby("_class")["area_km2"].sum().reindex(ordered, fill_value=0.0)
        total = float(grp.sum())
        rows = []
        for cid in ordered:
            a = float(grp.loc[cid])
            rows.append({"id": cid, "area_km2": a, "share": (a / total) if total > 0 else 0.0})
        rows.sort(key=lambda c: -c["share"])
        return {"area_km2_total": total, "classes": rows}

    areas = []
    ov = area_block(lu_ll)
    areas.append({"key": "overall", "label": "All Rayong", "kind": "overall", **ov, "metrics": metrics_of(ov)})

    QUAD_LABELS = {"NW": "Northwest", "NE": "Northeast", "SW": "Southwest", "SE": "Southeast"}
    for q in ("NW", "NE", "SW", "SE"):
        sub = lu_ll[lu_ll["_quadrant"] == q]
        block = area_block(sub)
        areas.append({"key": q, "label": QUAD_LABELS[q], "kind": "quadrant", **block, "metrics": metrics_of(block)})

    if mgrs_obj is not None:
        for tile, sub in sorted(lu_ll.groupby("_s2_tile")):
            if not tile:
                continue
            block = area_block(sub)
            if block["area_km2_total"] < 1.0:  # skip slivers
                continue
            areas.append({"key": str(tile), "label": str(tile), "kind": "s2_tile", **block, "metrics": metrics_of(block)})

    payload = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": f"LDD landuse · {shp.name}",
        "classes": class_defs,
        "areas": areas,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    s2_count = sum(1 for a in areas if a["kind"] == "s2_tile")
    print(f"wrote {out_path}")
    print(f"  {len(class_defs)} classes · {len(areas)} areas (1 overall + 4 quadrant + {s2_count} S2 tiles)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
