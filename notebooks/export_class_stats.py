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
DEFAULT_MINORITY_CLASSES: tuple[str, ...] = ()

# Curated preset for the Rayong AOI: the 14 named classes the team trains the
# classifier on, plus an 'Others' catch-all. Matchers are first-match-wins
# prefixes against LU_DES_EN (case-insensitive). Mixed polygons like
# 'Cassava/Para rubber' fall to the first crop ('Cassava' here).
# NOTE: prefix matching is first-win, so longer / more-specific names must
# come BEFORE their shorter neighbours. 'Mangosteen' before 'Mango', etc.
PRESET_RAYONG_CROPS_15: list[tuple[str, list[str]]] = [
    ("Rice",        ["Active paddy field", "Abandoned paddy field"]),
    ("Cassava",     ["Cassava"]),
    ("Pineapple",   ["Pineapple"]),
    ("Para rubber", ["Para rubber"]),
    ("Oil palm",    ["Oil palm", "Oil Palm"]),
    ("Durian",      ["Durian", "Durain"]),
    ("Mangosteen",  ["Mangosteen"]),     # must precede Mango
    ("Mango",       ["Mango"]),
    ("Jackfruit",   ["Jack fruit"]),
    ("Coconut",     ["Coconut"]),
    ("Longan",      ["Longan"]),
    ("Rambutan",    ["Rambutan", "Rambutam"]),
    ("Langsat",     ["Langsat"]),
    ("Reservoir",   ["Reservoir"]),
]
PRESETS: dict[str, list[tuple[str, list[str]]]] = {
    "rayong-crops-15": PRESET_RAYONG_CROPS_15,
}


def apply_preset(des_value: str, mapping: list[tuple[str, list[str]]]) -> str:
    """Assign a target class name based on the first matching prefix."""
    if not isinstance(des_value, str):
        return "Others"
    s = des_value.strip()
    s_lower = s.lower()
    for target, prefixes in mapping:
        for pref in prefixes:
            if s_lower.startswith(pref.lower()):
                return target
    return "Others"

# 18 distinct hues — covers the typical 12-16 LDD classes plus a few spares.
PALETTE = [
    "#3F7D58",  # forest-green
    "#3F6E97",  # info blue
    "#C96442",  # accent rust
    "#B68A2E",  # warn amber
    "#7B5BA6",  # purple
    "#9B5C7A",  # mauve
    "#4F7A95",  # slate blue
    "#7C7A52",  # olive
    "#A85C9D",  # magenta
    "#5F8A6E",  # sea-foam
    "#8B6F47",  # bronze
    "#D4A748",  # gold
    "#5B8B7C",  # teal
    "#A67B5B",  # tan
    "#6B7280",  # cool grey
    "#9B7CB6",  # lavender
    "#C68A6C",  # peach
    "#7AA66D",  # spring-green
]
MINORITY_COLOR = "#B14B3D"

# Best-effort LDD landuse code → English label mapping. Edit / extend here, or
# pass --labels labels.json to override per project. Codes not in this dict
# fall through to the raw code as their label.
LABELS: dict[str, str] = {
    # === paddy / wet rice ===
    "A100": "Paddy field",
    "A101": "Paddy rice",
    "A102": "Paddy rice (2nd crop)",
    "A103": "Abandoned paddy",
    # === field crops ===
    "A200": "Field crops",
    "A201": "Cassava",
    "A202": "Sugar cane",
    "A203": "Maize / Corn",
    "A204": "Pineapple",
    "A205": "Sorghum",
    "A206": "Cotton",
    "A207": "Soybean",
    "A208": "Mung bean",
    "A209": "Tobacco",
    # === perennial / industrial tree crops ===
    "A300": "Perennial crop",
    "A301": "Rubber",
    "A302": "Oil palm",
    "A303": "Coconut",
    "A304": "Coffee",
    "A305": "Tea",
    "A306": "Cashew",
    # === orchards ===
    "A400": "Orchard",
    "A401": "Mango",
    "A402": "Durian",
    "A403": "Longan",
    "A404": "Mangosteen",
    "A405": "Rambutan",
    "A406": "Lychee",
    "A407": "Citrus",
    "A408": "Banana",
    "A409": "Papaya",
    # === horticulture / aquaculture / pasture ===
    "A500": "Horticulture",
    "A501": "Vegetables",
    "A502": "Cut flowers",
    "A600": "Pasture",
    "A700": "Aquaculture",
    "A701": "Shrimp farm",
    "A702": "Fish farm",
    # === forest ===
    "F100": "Evergreen forest",
    "F200": "Deciduous forest",
    "F300": "Mangrove forest",
    "F400": "Beach forest",
    "F500": "Forest plantation",
    "F600": "Bamboo",
    # === built-up / water / misc ===
    "U100": "City / town",
    "U200": "Village",
    "U300": "Commercial",
    "U400": "Industrial",
    "U500": "Institutional",
    "W100": "River / canal",
    "W200": "Reservoir / lake",
    "W300": "Sea",
    "M100": "Wetland",
    "M200": "Marsh / swamp",
    "I100": "Industrial site",
    "M300": "Mine / pit",
    "X000": "Misc / unclassified",
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
    parser.add_argument("--preset", choices=sorted(PRESETS.keys()), default="rayong-crops-15",
                        help="Curated class set. 'rayong-crops-15' maps LU_DES_EN to the 14 crop classes the team trains on plus an 'Others' bucket. Pass --preset '' (empty) to disable presets and group by --class-col instead.")
    parser.add_argument("--class-col", default="LUL2_CODE", help="When --preset is empty, the column to group by. Default LUL2_CODE (~15-20 classes).")
    parser.add_argument("--label-col", default="LU_DES_EN", help="Column to derive a human-readable label per class (mode value). Default LU_DES_EN.")
    parser.add_argument("--drop-mixed", action="store_true", default=True, help="Drop mixed-class codes that contain '/' (LDD encodes 'A2/A3' for mixed plots). Ignored when --preset is set.")
    parser.add_argument("--keep-mixed", dest="drop_mixed", action="store_false", help="Keep mixed-class codes in the output.")
    parser.add_argument("--min-area-km2", type=float, default=0.0, help="Drop classes whose total area is below this many km² (default 0 = keep all).")
    parser.add_argument("--minority", action="append", default=list(DEFAULT_MINORITY_CLASSES),
                        help="Class codes to flag as minority (highlighted in red). Repeatable.")
    parser.add_argument("--out", type=Path, default=None, help="Output JSON path (default: <repo>/public/class-stats.json)")
    parser.add_argument("--skip-s2", action="store_true", help="Skip the per-Sentinel-2-tile breakdown (no mgrs dependency)")
    parser.add_argument("--labels", type=Path, default=None, help="JSON file with code->label overrides. Merged on top of the built-in dict.")
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

    # Preset path: stamp a target class per polygon by matching LU_DES_EN.
    if args.preset:
        des_col = args.label_col if args.label_col in lu_ll.columns else "LU_DES_EN"
        if des_col not in lu_ll.columns:
            raise ValueError(f"--preset requires the '{des_col}' column. available: {list(lu_ll.columns)}")
        mapping = PRESETS[args.preset]
        lu_ll["_preset_class"] = lu_ll[des_col].apply(lambda v: apply_preset(v, mapping))
        # Preserve the user-specified target order so the JSON renders in the
        # same order they listed (Rice → Cassava → ... → Reservoir → Others).
        cls_col = "_preset_class"
        preset_order = [t for t, _ in mapping] + ["Others"]
    else:
        cls_col = args.class_col
        if cls_col not in lu_ll.columns:
            raise ValueError(f"class column '{cls_col}' not in shapefile. available: {list(lu_ll.columns)}")
        lu_ll[cls_col] = lu_ll[cls_col].astype(str).fillna("__unk__")
        preset_order = None

        # Drop LDD mixed-class polygons ("A2/A3" etc) unless the user asked to keep them.
        if args.drop_mixed:
            before = len(lu_ll)
            lu_ll = lu_ll[~lu_ll[cls_col].str.contains("/")].copy()
            if len(lu_ll) < before:
                print(f"  dropped {before - len(lu_ll)} mixed-class polygons (use --keep-mixed to override)")

    # Merge user-supplied label overrides on top of the built-in LDD dict.
    labels = dict(LABELS)
    if args.labels is not None:
        labels.update(json.loads(Path(args.labels).read_text(encoding="utf-8")))

    # Auto-derive labels from --label-col (e.g. LU_DES_EN) by taking the most
    # common value within each class group. Falls back to the LABELS dict, then
    # to the raw code, so unknowns still render.
    derived_labels: dict[str, str] = {}
    if args.label_col and args.label_col in lu_ll.columns:
        for cid, sub in lu_ll.groupby(cls_col):
            non_null = sub[args.label_col].dropna()
            if len(non_null):
                mode = non_null.astype(str).mode()
                if len(mode):
                    derived_labels[str(cid)] = mode.iloc[0]

    def label_for(cid: str) -> str:
        return labels.get(cid) or derived_labels.get(cid) or cid

    # Aggregate area per class. Optionally drop tiny classes below the threshold.
    total_by_class = lu_ll.groupby(cls_col)["area_km2"].sum().sort_values(ascending=False)
    if args.min_area_km2 > 0:
        kept = total_by_class[total_by_class >= args.min_area_km2]
        dropped = len(total_by_class) - len(kept)
        if dropped > 0:
            print(f"  dropped {dropped} classes under {args.min_area_km2} km² (use --min-area-km2 0 to disable)")
        total_by_class = kept
        lu_ll = lu_ll[lu_ll[cls_col].isin(total_by_class.index)].copy()

    minority_ids = list(args.minority)
    # Preset mode keeps a deterministic user-facing order; raw mode sorts by area.
    if preset_order is not None:
        present = set(total_by_class.index.astype(str))
        ordered = [c for c in preset_order if c in present]
    else:
        ordered = [str(c) for c in total_by_class.index]
    lu_ll["_class"] = lu_ll[cls_col]

    class_defs = []
    for i, cid in enumerate(ordered):
        is_min = cid in minority_ids
        color = MINORITY_COLOR if is_min else PALETTE[i % len(PALETTE)]
        class_defs.append({
            "id": cid,
            "label": label_for(cid),
            "color": color,
            "minority": bool(is_min),
        })
    print(f"  {len(class_defs)} classes kept · {sum(1 for c in class_defs if c['minority'])} flagged minority")

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
