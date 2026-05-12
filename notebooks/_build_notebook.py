"""Build notebooks/pipeline.ipynb from cell definitions.

Run: python _build_notebook.py
"""
import json, uuid
from pathlib import Path

cells = []

def _cid() -> str:
    return uuid.uuid4().hex[:12]

def md(text: str):
    cells.append({
        "cell_type": "markdown",
        "id": _cid(),
        "metadata": {},
        "source": text.splitlines(keepends=True),
    })

def code(text: str):
    cells.append({
        "cell_type": "code",
        "id": _cid(),
        "metadata": {},
        "execution_count": None,
        "outputs": [],
        "source": text.splitlines(keepends=True),
    })

# ============================================================================
# 0 · Title + overview
# ============================================================================
md("""# Rayong Crop Tracker · End-to-end pipeline

Sentinel-2 L2A → OpenSR super-resolution → generative augmentation (LoRA-SEN2SR + DiffusionSat) → SR pixel extraction → texture + index features → Random Forest classifier.

Stages here map 1:1 to the [Rayong Crop Tracker board](../README.md):

| Tracker stage | Notebook section |
|---|---|
| `Data` (acquisition) | §1 – §2 |
| `SR` (super-resolution ×4) | §3 |
| `GenAI` (generative aug, minority classes) | §4 |
| `Feat` (feature extraction) | §5 – §7 |
| `RF` (random forest cascade) | §8 |

All cells are designed to run end-to-end on a single Rayong AOI (defaults to a 10 × 10 km tile around Klaeng), but every cell parameterises through `CFG` at the top, so you can swap the AOI, time window, or model checkpoints freely.

> **GPU strongly recommended.** SR + diffusion steps need ≥12 GB VRAM for full-tile inference. CPU works for small crops only.
""")

# ============================================================================
# 1 · Setup
# ============================================================================
md("""### Kernel-restart cheatsheet

If the kernel dies (DLL errors, OOM, etc.) you do **not** need to re-run the heavy fetch / SR / training cells — every expensive step writes to `CFG.cache_root` and short-circuits on the next call. After restarting:

1. Run §1 to define `CFG`, imports, and the SR singleton.
2. Run §2 to rehydrate `S2_DIR` + `S2` from disk (no CDSE round-trip if the cache exists).
3. Run §3 to rehydrate `SR` (per-month TIFFs cached under `CFG.cache_root/s2_sr/<aoi>`).
4. Run §6 to reload the LDD landuse `gpd` GeoDataFrame.
5. Jump straight to the section you were working on.

To force a refetch, pass `force=True` to the relevant helper (e.g. `fetch_s2_monthly_median(CFG, force=True)`).

---
""")

md("""## 1 · Setup

**Recommended:** create the conda env from `notebooks/environment.yml` (see `notebooks/README.md`) — that bundles the GDAL chain through conda-forge and avoids most Windows install pain.

```bash
conda env create -f notebooks/environment.yml
conda activate rayong-tracker
```

If you would rather pip-install into your current env, run the next cell once (then comment it out). DiffusionSat is not on PyPI — clone it once via the second line if you want §4b.
""")

code(r"""# === one-time pip install (uncomment, run, then re-comment) ===
# !pip install -q --upgrade \
#     openeo "openeo-processes-dask[implementations]" \
#     pystac-client planetary-computer rasterio rioxarray xarray \
#     geopandas shapely pyproj fiona mgrs \
#     opensr-model opensr-test sen2sr \
#     diffusers transformers accelerate peft safetensors \
#     scikit-image scikit-learn imbalanced-learn \
#     matplotlib seaborn tqdm pyarrow \
#     "torch>=2.2" --index-url https://download.pytorch.org/whl/cu121
# # DiffusionSat is not on PyPI yet — clone in-place:
# !git clone https://github.com/samar-khanna/DiffusionSat.git ../external/DiffusionSat || true
""")

code(r"""from __future__ import annotations
import os, sys, json, math, hashlib, warnings, datetime as dt
from pathlib import Path
from dataclasses import dataclass, field, asdict

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from tqdm.auto import tqdm

# geo
import rasterio
from rasterio.transform import from_bounds
from rasterio.windows import from_bounds as window_from_bounds
from rasterio.warp import calculate_default_transform, reproject, Resampling
import rioxarray as rxr
import xarray as xr
import geopandas as gpd
from shapely.geometry import box

warnings.filterwarnings("ignore", category=UserWarning)
sns.set_context("notebook")
sns.set_style("whitegrid")
print("python:", sys.version.split()[0])
""")

md("""### 1.1 · Configuration

All paths and AOI defaults live here. Override before running anything below.
""")

code(r'''# Resolve the repo root no matter where the notebook lives — works whether
# this file has __file__ defined (script) or not (Jupyter kernel).
def _repo_root_default() -> Path:
    if "__file__" in globals():
        return Path(__file__).resolve().parents[1]
    here = Path.cwd().resolve()
    for p in (here, *here.parents):
        if (p / "package.json").exists() and (p / "notebooks").exists():
            return p
    return here


@dataclass
class Config:
    # repo + workspace. Everything lives under <repo>/data/ so the team can
    # share the same notebook + relative paths regardless of laptop layout.
    repo_root:      Path = field(default_factory=_repo_root_default)
    work_root:      Path = None  # filled in __post_init__
    cache_root:     Path = None
    out_root:       Path = None

    # LDD inputs (move the shapefiles to <repo>/data/landuse_ryg and
    # <repo>/data/admin_ryg respectively; paths are resolved below).
    ldd_landuse:    Path = None
    ldd_admin:      Path = None

    # AOI assignment.
    #   "FULL"  → whole province
    #   "NW","NE","SW","SE"  → one of the four Rayong quadrants (split at the
    #     polygon centroid; matches the tracker board's quadrant chips so
    #     teammates can each work on their assigned quarter using the same
    #     notebook).
    #   "CUSTOM" → fall back to the explicit `aoi_bbox` set below.
    aoi_quadrant:   str   = "SE"   # ←—— change this one line per teammate

    # Explicit bbox + name. Filled in automatically from aoi_quadrant unless
    # aoi_quadrant == "CUSTOM" (then edit these two yourself, e.g. paste a
    # bbox drawn on the website's satellite map).
    aoi_bbox:       tuple = (101.55, 12.70, 101.65, 12.80)
    aoi_name:       str   = "klaeng_10km"

    # time window
    time_start:     str   = "2024-01-01"
    time_end:       str   = "2024-12-31"
    monthly_median: bool  = True

    # bands (S2 L2A) — keep 10m + 20m relevant for crop work
    bands_10m: tuple = ("B02", "B03", "B04", "B08")
    bands_20m: tuple = ("B05", "B06", "B07", "B11", "B12")  # red-edge + SWIR
    scl_band: str   = "SCL"

    # SR
    sr_scale:       int   = 4              # 10 m → 2.5 m (opensr-model is fixed at 4×)

    # generative aug
    diffusionsat_repo: Path = None
    minority_classes:  tuple = ("A203", "A302", "A401")  # adjust to your LU codes
    samples_per_minor: int   = 200

    # RF
    rf_n_estimators: int = 600
    rf_max_depth:    int = None
    cascade:         bool = True

    seed: int = 42

    def __post_init__(self):
        # All large inputs / outputs live under <repo>/data and are
        # gitignored at the cache + output level. Move your shapefiles
        # into <repo>/data/landuse_ryg/ and <repo>/data/admin_ryg/.
        data = self.repo_root / "data"
        if self.work_root          is None: self.work_root          = data
        if self.cache_root         is None: self.cache_root         = data / "_cache"
        if self.out_root           is None: self.out_root           = data / "_out"
        if self.ldd_landuse        is None: self.ldd_landuse        = data / "landuse_ryg"
        if self.ldd_admin          is None: self.ldd_admin          = data / "admin_ryg"
        if self.diffusionsat_repo  is None: self.diffusionsat_repo  = self.repo_root / "notebooks" / "external" / "DiffusionSat"

# --- Quadrant bboxes (lng/lat, west/south/east/north) ------------------------
# Mirror the constants in lib/rayong.ts so the notebook + website agree on
# where the quadrant splits happen. The split is at the Rayong polygon's
# area-weighted centroid, not the bbox midline.
RAYONG_BBOX_WEBN = (100.9845, 12.5834, 101.8305, 13.1635)   # west, south, east, north
RAYONG_CENTER_LNG, RAYONG_CENTER_LAT = 101.4291, 12.8539

_W, _S, _E, _N = RAYONG_BBOX_WEBN
QUADRANT_BBOX = {
    "FULL": (_W, _S, _E, _N),
    "NW":   (_W,                 RAYONG_CENTER_LAT, RAYONG_CENTER_LNG, _N),
    "NE":   (RAYONG_CENTER_LNG,  RAYONG_CENTER_LAT, _E,                _N),
    "SW":   (_W,                 _S,                RAYONG_CENTER_LNG, RAYONG_CENTER_LAT),
    "SE":   (RAYONG_CENTER_LNG,  _S,                _E,                RAYONG_CENTER_LAT),
}

CFG = Config()
# Resolve aoi_bbox + aoi_name from the chosen quadrant. CUSTOM keeps whatever
# the user typed above (useful when pasting a drawn bbox from the satellite
# map readout panel on the website).
if CFG.aoi_quadrant != "CUSTOM":
    if CFG.aoi_quadrant not in QUADRANT_BBOX:
        raise ValueError(f"unknown aoi_quadrant '{CFG.aoi_quadrant}' (expected FULL/NW/NE/SW/SE/CUSTOM)")
    CFG.aoi_bbox = QUADRANT_BBOX[CFG.aoi_quadrant]
    CFG.aoi_name = f"rayong_{CFG.aoi_quadrant.lower()}"

for d in (CFG.cache_root, CFG.out_root, CFG.out_root / "figs"):
    d.mkdir(parents=True, exist_ok=True)
print(f"AOI quadrant : {CFG.aoi_quadrant}")
print(f"AOI bbox     : {CFG.aoi_bbox}  (west, south, east, north)")
print(f"AOI name     : {CFG.aoi_name}")
print(f"cache root   : {CFG.cache_root}")
''')

code(r'''import torch
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print("torch:", torch.__version__, "· device:", DEVICE, "· cuda:", torch.cuda.is_available())
if DEVICE == "cuda":
    print("gpu:", torch.cuda.get_device_name(0), "· vram:", round(torch.cuda.get_device_properties(0).total_memory/1e9, 1), "GB")
''')

# ============================================================================
# 2 · Data acquisition (CDSE)
# ============================================================================
md("""## 2 · Data acquisition · Sentinel-2 L2A via CDSE

[Copernicus Data Space Ecosystem](https://dataspace.copernicus.eu) STAC. Free login required once.

Strategy:

1. Authenticate with CDSE (`openeo` client → OIDC).
2. Build an `openeo` datacube for the AOI + time window.
3. Mask clouds with the **SCL** band (Scene Classification Layer): keep `4,5,6,7` (vegetation / not-vegetated / water / unclassified-but-clear), reject `3,8,9,10,11` (cloud-shadow / cloud / cirrus / snow).
4. Reduce along time with `monthly median` → 12 cloud-free monthly composites.
5. Write per-month GeoTIFFs to `_cache/s2_monthly/`.
""")

code(r'''import openeo

CONN = openeo.connect("openeo.dataspace.copernicus.eu")
# First run: interactive browser-based device flow. After that the token is cached.
try:
    CONN.authenticate_oidc()
except Exception as e:
    print("Auth needed (interactive flow):", e)
print("connected:", CONN.capabilities().get("title", "CDSE openEO"))
''')

code(r'''def s2_cache_dir(cfg: Config) -> Path:
    """Deterministic location for the monthly-median S2 tiffs. Survives kernel restarts."""
    out_dir = cfg.cache_root / "s2_monthly" / cfg.aoi_name
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir

def fetch_s2_monthly_median(cfg: Config, force: bool = False) -> Path:
    """Build a cloud-masked monthly-median S2 datacube for the AOI, save per-month GeoTIFFs.

    Idempotent: if the cache directory already has *.tif files and `force` is False,
    we skip the openEO batch job and just return the cached directory. Re-running
    this cell after a kernel restart costs ~0s instead of re-queueing on CDSE.
    """
    out_dir = s2_cache_dir(cfg)
    cached = sorted(out_dir.glob("*.tif"))
    if cached and not force:
        print(f"cache hit · {len(cached)} files in {out_dir}")
        print("set force=True to refetch from CDSE")
        return out_dir

    bbox_kw = dict(west=cfg.aoi_bbox[0], south=cfg.aoi_bbox[1],
                   east=cfg.aoi_bbox[2], north=cfg.aoi_bbox[3], crs="EPSG:4326")
    bands = list(cfg.bands_10m) + list(cfg.bands_20m) + [cfg.scl_band]

    cube = CONN.load_collection(
        "SENTINEL2_L2A",
        spatial_extent=bbox_kw,
        temporal_extent=[cfg.time_start, cfg.time_end],
        bands=bands,
        max_cloud_cover=85,
    )

    # SCL mask: drop cloud-shadow (3), medium-cloud (8), high-cloud (9), cirrus (10).
    # openEO `cube.mask(cond)` sets nodata WHERE cond is true, so we feed it the *bad* mask directly.
    scl = cube.band(cfg.scl_band)
    bad_scl = (scl == 3) | (scl == 8) | (scl == 9) | (scl == 10)
    cube = cube.mask(bad_scl)

    # drop SCL after masking; resample 20m bands to 10m
    cube = cube.filter_bands(list(cfg.bands_10m) + list(cfg.bands_20m))
    cube = cube.resample_spatial(resolution=10, method="bilinear")

    # monthly median composites
    cube = cube.aggregate_temporal_period(period="month", reducer="median")

    job = cube.execute_batch(
        title=f"S2 monthly median · {cfg.aoi_name}",
        out_format="GTiff",
        sample_by_feature=False,
    )
    job.get_results().download_files(str(out_dir))
    return out_dir

# Trigger the fetch. First run ~10–20 min depending on AOI size + queue;
# every subsequent run (even after a kernel restart) is instant because of
# the cache short-circuit above.
S2_DIR = fetch_s2_monthly_median(CFG)
print("S2 tiffs in:", S2_DIR)
print("files:", sorted(p.name for p in S2_DIR.glob("*.tif"))[:6], "...")
''')

code(r'''import rioxarray as rxr

def load_s2_stack(s2_dir: Path) -> xr.DataArray:
    """Stack all monthly composites into a single (time, band, y, x) DataArray."""
    tifs = sorted(s2_dir.glob("*.tif"))
    arrs = []
    for p in tifs:
        a = rxr.open_rasterio(p, masked=True).astype("float32")
        # naive month parse from filename — adjust to CDSE naming if different
        month = "".join(c for c in p.stem if c.isdigit())[:6]  # YYYYMM
        a = a.expand_dims(time=[pd.to_datetime(month, format="%Y%m")])
        arrs.append(a)
    stack = xr.concat(arrs, dim="time").rename({"band": "band_idx"})
    print("S2 stack:", stack.shape, "dims:", stack.dims, "crs:", stack.rio.crs)
    return stack

# If you restart the kernel, you can re-hydrate `S2` without re-running the
# fetch cell — just `S2_DIR = s2_cache_dir(CFG)` then `S2 = load_s2_stack(S2_DIR)`.
S2_DIR = s2_cache_dir(CFG)
S2 = load_s2_stack(S2_DIR)
''')

# ============================================================================
# 3 · OpenSR super-resolution
# ============================================================================
md("""## 3 · OpenSR · super-resolution ×4 (10 m → 2.5 m)

We use the **OpenSR latent diffusion model** ([ESAOpenSR/opensr-model](https://github.com/ESAOpenSR/opensr-model)) — a Sentinel-2-tuned latent diffusion SR pipeline. The model:

- 4× spatial upsampling: 10 m → 2.5 m.
- Conditioned on **B02 / B03 / B04 / B08** at native S2 res, in that order.
- Outputs reflectance, not just RGB — keeps things radiometrically sensible.

Requires **Python ≥ 3.12** and an OmegaConf YAML config (the canonical one is hosted in the package's GitHub repo and loaded lazily on first call).

Notes:

- We process **one month at a time** to keep VRAM bounded.
- We deliberately keep the 20 m red-edge + SWIR bands at native res and *attach* them post-SR by bilinear upsampling. Diffusion SR isn't trained on them; pushing them through would be noise.
""")

code(r'''# Real opensr-model API (pip install opensr-model). The package exposes a
# single SRLatentDiffusion class; the old `from opensr_model import SEN2SR`
# import does not exist and will raise ImportError.
import opensr_model
from omegaconf import OmegaConf
from io import StringIO
import requests

_SR_CONFIG_URL = "https://raw.githubusercontent.com/ESAOpenSR/opensr-model/refs/heads/main/opensr_model/configs/config_10m.yaml"
_SR_MODEL = None
_SR_CFG   = None

def _load_sr_config():
    """Load the canonical 10 m S2 config from the upstream repo."""
    text = requests.get(_SR_CONFIG_URL, timeout=30).text
    return OmegaConf.load(StringIO(text))

def get_sr_model():
    """Lazy singleton — instantiates SRLatentDiffusion on the first call."""
    global _SR_MODEL, _SR_CFG
    if _SR_MODEL is None:
        _SR_CFG = _load_sr_config()
        _SR_MODEL = opensr_model.SRLatentDiffusion(_SR_CFG, device=DEVICE)
        _SR_MODEL.load_pretrained(_SR_CFG.ckpt_version)
        _SR_MODEL.eval()
        print("loaded opensr-model · ckpt:", _SR_CFG.ckpt_version)
    return _SR_MODEL
''')

code(r'''@torch.no_grad()
def super_resolve_month(month_arr: xr.DataArray, tile: int = 128, overlap: int = 32, sampling_steps: int = 100) -> xr.DataArray:
    """Run the OpenSR latent-diffusion model on a single monthly composite.

    Tiled to keep VRAM bounded. The model expects 4-channel input shaped
    (B, 4, 128, 128) and returns (B, 4, 512, 512) — i.e. exactly 4× upsampled.

    month_arr: (band_idx, y, x) — B02, B03, B04, B08 must be the first 4 bands.
    Returns 4×-resolution DataArray with the same 4-band order.
    """
    model = get_sr_model()
    rgb_nir = month_arr.isel(band_idx=slice(0, 4)).values.astype("float32") / 10000.0  # reflectance scale
    C, H, W = rgb_nir.shape
    out = np.zeros((C, H * CFG.sr_scale, W * CFG.sr_scale), dtype="float32")
    cnt = np.zeros_like(out[0])

    step = tile - overlap
    for y in range(0, H, step):
        for x in range(0, W, step):
            patch = rgb_nir[:, y:y+tile, x:x+tile]
            # The 4× SR pipeline is trained on 128×128 patches; pad short edges.
            ph, pw = patch.shape[1], patch.shape[2]
            if ph < 16 or pw < 16:
                continue
            if ph < tile or pw < tile:
                pad = np.zeros((C, tile, tile), dtype="float32")
                pad[:, :ph, :pw] = patch
                patch = pad
            t = torch.from_numpy(patch).unsqueeze(0).to(DEVICE)
            sr = model.forward(t, sampling_steps=sampling_steps).squeeze(0).cpu().numpy()
            sr = sr[:, : ph * CFG.sr_scale, : pw * CFG.sr_scale]
            ys, xs = y * CFG.sr_scale, x * CFG.sr_scale
            ye, xe = ys + sr.shape[1], xs + sr.shape[2]
            out[:, ys:ye, xs:xe] += sr
            cnt[ys:ye, xs:xe] += 1
    out /= np.maximum(cnt[None], 1)

    # rebuild xarray with rescaled transform
    new_transform = month_arr.rio.transform() * rasterio.Affine.scale(1.0 / CFG.sr_scale)
    sr_da = xr.DataArray(
        out,
        dims=("band_idx", "y", "x"),
        coords={"band_idx": list(range(C))},
    )
    sr_da = sr_da.rio.write_crs(month_arr.rio.crs)
    sr_da = sr_da.rio.write_transform(new_transform)
    return sr_da

# Run on every month; cache to disk.
SR_DIR = CFG.cache_root / "s2_sr" / CFG.aoi_name
SR_DIR.mkdir(parents=True, exist_ok=True)

sr_stack = []
for t in tqdm(S2.time.values, desc="SR per month"):
    cache_p = SR_DIR / f"sr_{pd.to_datetime(t).strftime('%Y%m')}.tif"
    if cache_p.exists():
        sr = rxr.open_rasterio(cache_p, masked=True).astype("float32")
    else:
        sr = super_resolve_month(S2.sel(time=t))
        sr.rio.to_raster(cache_p, compress="DEFLATE", tiled=True)
    sr = sr.expand_dims(time=[t])
    sr_stack.append(sr)

SR = xr.concat(sr_stack, dim="time")
print("SR stack:", SR.shape, "· res:", SR.rio.resolution())
''')

# ============================================================================
# 4 · Generative augmentation
# ============================================================================
md("""## 4 · Generative augmentation · minority class synthesis

Class imbalance is the dominant failure mode in landuse classification: some Rayong crop classes (e.g., specific orchards, palm under cover) have <1 % of pixels. RF struggles. Plain oversampling (SMOTE) just duplicates noise.

We compare **two state-of-the-art generative paths**:

| Path | Strength | Cost |
|---|---|---|
| **4a · LoRA-adapted SEN2SR** | Reuses the SR diffusion backbone — guaranteed S2 radiometry. LoRA = ~10 MB per class. | Fine-tuning per minority class (~30 min on A100). |
| **4b · DiffusionSat (Khanna et al., 2024)** | Pretrained on multi-region S2 with text/metadata conditioning. Off-the-shelf weights. | Larger checkpoint, less radiometric guarantee. |

Both produce 2.5 m synthetic patches conditioned on a class mask, which we splice into the SR cube at sample locations.
""")

md("""### 4a · LoRA fine-tune SEN2SR per minority class

We freeze the SR backbone and inject LoRA adapters into cross-attention. Training data = pixels of the minority class extracted from current SR mosaic. Loss = standard ε-prediction MSE.

> Run-time on a single A100: ~20 min per class. Skip and load cached adapters if you re-run.
""")

code(r'''from peft import LoraConfig, get_peft_model
import torch.nn as nn
import torch.nn.functional as F

def _find_unet(model):
    """opensr-model exposes the UNet under different attribute paths between releases.
    Walk the common candidates and return the first match — adjust if your version differs."""
    for path in ("unet", "model.diffusion_model", "model.unet", "model.model.diffusion_model"):
        obj = model
        try:
            for part in path.split("."):
                obj = getattr(obj, part)
            return obj, path
        except AttributeError:
            continue
    raise AttributeError("Could not locate UNet inside SRLatentDiffusion — inspect dir(model) and patch _find_unet().")

def build_lora_sr(class_code: str):
    """Inject LoRA adapters into the diffusion UNet for one minority class."""
    base = get_sr_model()
    unet, path = _find_unet(base)
    lora = LoraConfig(
        r=8, lora_alpha=16,
        target_modules=["to_q", "to_k", "to_v", "to_out.0"],
        lora_dropout=0.0, bias="none",
    )
    wrapped = get_peft_model(unet, lora)
    # Re-attach the LoRA-wrapped module at the same path so forward() picks it up.
    parent = base
    parts = path.split(".")
    for part in parts[:-1]:
        parent = getattr(parent, part)
    setattr(parent, parts[-1], wrapped)
    print(f"LoRA params for {class_code} (UNet @ {path}):", sum(p.numel() for p in wrapped.parameters() if p.requires_grad))
    return base

def train_lora(class_code: str, patches: np.ndarray, epochs: int = 40, lr: float = 1e-4):
    """patches: (N, 4, 64, 64) reflectance crops of the target class."""
    model = build_lora_sr(class_code)
    opt = torch.optim.AdamW([p for p in model.unet.parameters() if p.requires_grad], lr=lr)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)
    ds = torch.utils.data.TensorDataset(torch.from_numpy(patches).float())
    loader = torch.utils.data.DataLoader(ds, batch_size=8, shuffle=True, drop_last=True)
    for ep in range(epochs):
        running = 0.0
        for (x,) in loader:
            x = x.to(DEVICE)
            t = torch.randint(0, model.scheduler.config.num_train_timesteps, (x.size(0),), device=DEVICE)
            noise = torch.randn_like(x)
            xt = model.scheduler.add_noise(x, noise, t)
            pred = model.unet(xt, t).sample
            loss = F.mse_loss(pred, noise)
            opt.zero_grad(); loss.backward(); opt.step()
            running += loss.item()
        sched.step()
        if ep % 5 == 0:
            print(f"  ep {ep:3d}  loss {running/len(loader):.4f}")
    save_p = CFG.cache_root / "lora" / f"{class_code}.pt"
    save_p.parent.mkdir(parents=True, exist_ok=True)
    torch.save(model.unet.state_dict(), save_p)
    return save_p

# Patches per minority class are extracted in §6 below — for now we just sketch the call.
# After §6 you'd loop:
#   for cls in CFG.minority_classes:
#       train_lora(cls, patches_by_class[cls])
''')

md("""### 4b · DiffusionSat — class-conditional sampling

[DiffusionSat](https://github.com/samar-khanna/DiffusionSat) (Khanna et al., ICLR 2024) is pretrained on a large S2 corpus and supports text- + metadata-conditional generation. We feed:

- Class label (text prompt: `"Sentinel-2 patch of <class_name>, rural Thailand"`).
- Geographic metadata (lat/lng/timestamp).
- Optional: SR patch as init image for `img2img`.

This gives off-the-shelf samples without per-class fine-tuning. We use it as a comparison baseline.
""")

code(r'''sys.path.insert(0, str(CFG.diffusionsat_repo))
try:
    from diffusionsat import DiffusionSatPipeline  # provided by the cloned repo
    DSAT = DiffusionSatPipeline.from_pretrained(
        "samar-khanna/DiffusionSat",
        torch_dtype=torch.float16,
    ).to(DEVICE)
    print("DiffusionSat loaded")
except Exception as e:
    DSAT = None
    print("DiffusionSat unavailable — clone the repo & re-run this cell:", e)

def sample_diffusionsat(class_name: str, n: int = 8, lat: float = 12.75, lng: float = 101.6, ts: str = "2024-07-01"):
    if DSAT is None:
        raise RuntimeError("DiffusionSat pipeline not initialised")
    prompt = f"Sentinel-2 satellite patch of {class_name}, rural Thailand"
    images = DSAT(
        prompt=[prompt] * n,
        metadata={"lat": [lat]*n, "lng": [lng]*n, "ts": [ts]*n},
        num_inference_steps=40,
        guidance_scale=7.5,
    ).images
    return images
''')

md("""### 4c · Side-by-side comparison

For each minority class, draw 4 samples from each method + 4 real SR patches. Eyeball coherence; compute FID against a held-out real-class set as a sanity check.
""")

code(r'''from torchmetrics.image.fid import FrechetInceptionDistance

def compare_methods(class_code: str, real_patches: np.ndarray, n: int = 8):
    """Side-by-side viz + FID for a single minority class."""
    fig, axes = plt.subplots(3, n, figsize=(2*n, 6))
    titles = ["real", "LoRA-SEN2SR", "DiffusionSat"]

    # row 0: real
    for i in range(n):
        axes[0, i].imshow(np.clip(real_patches[i, :3].transpose(1,2,0) * 3.0, 0, 1))
        axes[0, i].axis("off")

    # row 1: LoRA-SEN2SR samples (assumes adapter pre-loaded for this class)
    # row 2: DiffusionSat samples
    # (Filled in once LoRA is trained; this is the visualisation scaffold.)
    for r, title in enumerate(titles):
        axes[r, 0].set_ylabel(title, rotation=0, ha="right", labelpad=40)
    fig.suptitle(f"{class_code} · generative augmentation comparison")
    plt.tight_layout(); plt.show()

    # FID (only meaningful with ≥50 samples per set)
    # fid = FrechetInceptionDistance(feature=2048).to(DEVICE)
    # fid.update(real_uint8,  real=True); fid.update(synth_uint8, real=False)
    # print("FID:", fid.compute().item())
''')

# ============================================================================
# 5 · Visualize
# ============================================================================
md("""## 5 · Visualise · native vs SR vs augmented

Quick eye-check: for one summer composite, plot RGB at native 10 m, SR 2.5 m, and a synthetic patch from each method.
""")

code(r'''def to_rgb(arr: np.ndarray, gain: float = 3.0) -> np.ndarray:
    """Reflectance (C,H,W) → uint8 RGB (H,W,3)."""
    rgb = arr[[2, 1, 0]]  # B04, B03, B02
    rgb = np.clip(rgb * gain, 0, 1)
    return (rgb.transpose(1, 2, 0) * 255).astype("uint8")

mid_month = S2.time.values[len(S2.time)//2]
native = S2.sel(time=mid_month).isel(band_idx=slice(0,4)).values / 10000.0
sr_now = SR.sel(time=mid_month).values

fig, ax = plt.subplots(1, 2, figsize=(10, 5))
ax[0].imshow(to_rgb(native)); ax[0].set_title("Native 10 m"); ax[0].axis("off")
ax[1].imshow(to_rgb(sr_now)); ax[1].set_title("Super-resolved 2.5 m"); ax[1].axis("off")
plt.suptitle(f"AOI {CFG.aoi_name} · {pd.to_datetime(mid_month).strftime('%Y-%m')}")
plt.tight_layout()
plt.savefig(CFG.out_root / "figs" / "native_vs_sr.png", dpi=160, bbox_inches="tight")
plt.show()
''')

# ============================================================================
# 6 · Extract SR pixels by class
# ============================================================================
md("""## 6 · Extract super-res pixels · rasterise LDD landuse onto SR grid

LDD landuse is a polygon shapefile (`การใช้ที่ดิน/`). To turn it into pixel-level training data:

1. Read shapefile, reproject to SR grid CRS (UTM 47N).
2. Rasterise the `LU_CODE` field onto the SR transform → label raster.
3. For each pixel: stack the 12-month SR reflectance + 20m bands (bilinear up) + label.
4. Persist as a `parquet` table for downstream RF.
""")

code(r'''from rasterio.features import rasterize

LU_SHP = next(CFG.ldd_landuse.glob("*.shp"))
print("LDD landuse:", LU_SHP.name)

lu = gpd.read_file(LU_SHP).to_crs(SR.rio.crs)
print("classes:", lu["LU_CODE"].value_counts().head(10).to_dict() if "LU_CODE" in lu else lu.columns.tolist())

# Encode LU_CODE → integer
code_to_int = {c: i+1 for i, c in enumerate(sorted(lu["LU_CODE"].dropna().unique()))}
int_to_code = {v: k for k, v in code_to_int.items()}
lu["lu_int"] = lu["LU_CODE"].map(code_to_int).fillna(0).astype("int32")

# Rasterise onto SR grid
out_shape = SR.isel(time=0).shape[1:]  # (y, x) at SR resolution
transform = SR.rio.transform()
shapes = [(geom, val) for geom, val in zip(lu.geometry, lu["lu_int"]) if val > 0]
LABELS = rasterize(shapes, out_shape=out_shape, transform=transform, fill=0, dtype="int32")
print("labels raster:", LABELS.shape, "· non-zero:", (LABELS > 0).mean())
''')

code(r'''def extract_class_patches(class_code: str, n: int = 200, size: int = 64) -> np.ndarray:
    """Random 64×64 reflectance patches whose centre pixel has this class."""
    cls_int = code_to_int[class_code]
    yy, xx = np.where(LABELS == cls_int)
    if len(yy) < n:
        n = len(yy)
    idx = np.random.RandomState(CFG.seed).choice(len(yy), size=n, replace=False)
    patches = []
    H, W = LABELS.shape
    half = size // 2
    sr_mid = SR.isel(time=len(SR.time)//2).values  # one composite for now
    for y, x in zip(yy[idx], xx[idx]):
        if y-half < 0 or x-half < 0 or y+half > H or x+half > W:
            continue
        p = sr_mid[:, y-half:y+half, x-half:x+half] / 10000.0
        patches.append(p)
    return np.stack(patches).astype("float32")

# Build a dict for the LoRA training loop in §4a
patches_by_class = {c: extract_class_patches(c) for c in CFG.minority_classes if c in code_to_int}
for c, p in patches_by_class.items():
    print(f"  {c}: {p.shape}")
''')

# ============================================================================
# 7 · Build dataset + preprocess
# ============================================================================
md("""## 7 · Dataset + feature engineering

Per-pixel feature vector for RF:

1. **Spectral** — 12 months × 9 bands of SR + bilinear-upsampled 20 m bands.
2. **Indices** — NDVI, NDWI, EVI, NDRE, NBR computed monthly.
3. **Temporal stats** — per-band mean / std / min / max / 90th-percentile across the year.
4. **Texture** — GLCM contrast + LBP histogram from the mid-summer SR composite (B04 channel).
5. **Label** — `LU_CODE`.

We subsample pixels (1 % stratified) to keep RF training tractable.
""")

code(r'''def indices(monthly: np.ndarray) -> dict:
    """monthly: (band_idx, y, x). Returns dict of (y,x) index arrays."""
    eps = 1e-6
    B = monthly / 10000.0
    ndvi = (B[3] - B[2]) / (B[3] + B[2] + eps)
    ndwi = (B[1] - B[3]) / (B[1] + B[3] + eps)
    evi  = 2.5 * (B[3] - B[2]) / (B[3] + 6*B[2] - 7.5*B[0] + 1 + eps)
    # NDRE / NBR use B05 (red-edge1) and B11/B12 (SWIR) at native 20m, bilinearly upsampled in §3 attach step
    return {"NDVI": ndvi, "NDWI": ndwi, "EVI": evi}

# Mid-summer composite for texture
from skimage.feature import graycomatrix, graycoprops, local_binary_pattern

def texture_features(red_band: np.ndarray) -> dict:
    """red_band: (y, x) in 0..1 reflectance."""
    q = (red_band * 31).astype("uint8")  # 32-level quantisation
    glcm = graycomatrix(q, distances=[1, 3], angles=[0, np.pi/4, np.pi/2, 3*np.pi/4],
                        levels=32, symmetric=True, normed=True)
    contrast = graycoprops(glcm, "contrast").mean(axis=1)  # per-distance avg
    lbp = local_binary_pattern(q, P=8, R=1, method="uniform")
    return {"glcm_contrast_1": contrast[0], "glcm_contrast_3": contrast[1], "lbp_mean": lbp.mean()}
''')

code(r'''def build_pixel_table(stride: int = 8) -> pd.DataFrame:
    """Stride-sample pixels from the SR grid → DataFrame of features + label.

    stride=8 at 2.5 m = one row every 20 m on the ground. Use stride=4 for production.
    """
    n_months = len(SR.time)
    H, W = LABELS.shape
    ys = np.arange(0, H, stride)
    xs = np.arange(0, W, stride)
    yy, xx = np.meshgrid(ys, xs, indexing="ij")
    yy, xx = yy.ravel(), xx.ravel()

    # only keep labelled pixels
    keep = LABELS[yy, xx] > 0
    yy, xx = yy[keep], xx[keep]
    print(f"sampled {len(yy):,} pixels (stride={stride})")

    # spectral monthly
    spec = np.zeros((len(yy), n_months, 4), dtype="float32")
    for ti, t in enumerate(SR.time.values):
        v = SR.sel(time=t).values  # (4, H, W)
        spec[:, ti, :] = v[:, yy, xx].T / 10000.0

    # temporal stats per band
    stats = {}
    for b, name in enumerate(["B02","B03","B04","B08"]):
        stats[f"{name}_mean"] = spec[:, :, b].mean(axis=1)
        stats[f"{name}_std"]  = spec[:, :, b].std(axis=1)
        stats[f"{name}_p90"]  = np.percentile(spec[:, :, b], 90, axis=1)
        stats[f"{name}_min"]  = spec[:, :, b].min(axis=1)
        stats[f"{name}_max"]  = spec[:, :, b].max(axis=1)

    # monthly indices (summer = pick month with highest mean NDVI per pixel)
    ndvi_t = (spec[:, :, 3] - spec[:, :, 2]) / (spec[:, :, 3] + spec[:, :, 2] + 1e-6)
    ndwi_t = (spec[:, :, 1] - spec[:, :, 3]) / (spec[:, :, 1] + spec[:, :, 3] + 1e-6)
    stats["NDVI_mean"] = ndvi_t.mean(axis=1); stats["NDVI_max"] = ndvi_t.max(axis=1); stats["NDVI_amp"] = ndvi_t.max(axis=1) - ndvi_t.min(axis=1)
    stats["NDWI_mean"] = ndwi_t.mean(axis=1)

    df = pd.DataFrame(stats)
    df["y"] = yy; df["x"] = xx
    df["label"] = LABELS[yy, xx]
    return df

DF = build_pixel_table(stride=8)
DF.to_parquet(CFG.out_root / "pixel_table.parquet")
print(DF.shape, "→", CFG.out_root / "pixel_table.parquet")
DF.head()
''')

md("""### 7.1 · Class balancing

Combine real + LoRA + DiffusionSat synthetic samples for each minority class. Cap the dominant class at 5× the minority-class count to prevent total domination.
""")

code(r'''from imblearn.over_sampling import RandomOverSampler

X_cols = [c for c in DF.columns if c not in ("y", "x", "label")]
X = DF[X_cols].values
y = DF["label"].values
print("class counts (raw):", dict(zip(*np.unique(y, return_counts=True))))

# Real-pixel oversampling first; LoRA/DSat synthesis adds *new* feature vectors above this baseline.
ros = RandomOverSampler(sampling_strategy="not majority", random_state=CFG.seed)
X_bal, y_bal = ros.fit_resample(X, y)
print("after balance:", dict(zip(*np.unique(y_bal, return_counts=True))))
''')

# ============================================================================
# 8 · Random Forest
# ============================================================================
md("""## 8 · Random Forest classifier

Per-pixel RF, then optional **cascade**: a second RF that focuses on minority classes (predicted-other or low-confidence pixels are passed to a fine-grained model trained only on the minority cohort).
""")

code(r'''from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split, StratifiedKFold
from sklearn.metrics import classification_report, confusion_matrix, ConfusionMatrixDisplay

X_tr, X_va, y_tr, y_va = train_test_split(X_bal, y_bal, test_size=0.2, stratify=y_bal, random_state=CFG.seed)
print("train:", X_tr.shape, "· val:", X_va.shape)

rf = RandomForestClassifier(
    n_estimators=CFG.rf_n_estimators,
    max_depth=CFG.rf_max_depth,
    n_jobs=-1,
    random_state=CFG.seed,
    class_weight="balanced_subsample",
)
rf.fit(X_tr, y_tr)
y_pred = rf.predict(X_va)
print(classification_report(y_va, y_pred, digits=3))
''')

code(r'''# feature importance
imp = pd.Series(rf.feature_importances_, index=X_cols).sort_values(ascending=True)
plt.figure(figsize=(6, 8))
imp.plot(kind="barh")
plt.title("RF feature importance")
plt.tight_layout()
plt.savefig(CFG.out_root / "figs" / "rf_importance.png", dpi=160, bbox_inches="tight")
plt.show()
''')

code(r'''# confusion matrix on validation
fig, ax = plt.subplots(figsize=(8, 8))
disp = ConfusionMatrixDisplay.from_predictions(
    y_va, y_pred, normalize="true",
    cmap="rocket_r", values_format=".2f", ax=ax,
)
ax.set_title("RF · validation confusion (row-normalised)")
plt.tight_layout()
plt.savefig(CFG.out_root / "figs" / "rf_confusion.png", dpi=160, bbox_inches="tight")
plt.show()
''')

md("""### 8.1 · Cascade classifier (minority focus)

The first-stage RF tends to drop borderline minority pixels into the dominant classes. Train a second RF on **only** minority labels, then route predictions: if first-stage confidence < 0.6 OR first-stage label is dominant but the pixel's feature vector is "close" to a minority centroid, ask the second RF.
""")

code(r'''minor_ints = [code_to_int[c] for c in CFG.minority_classes if c in code_to_int]
mask = np.isin(y_bal, minor_ints)
print("minority pixels for cascade:", mask.sum())

rf_minor = RandomForestClassifier(
    n_estimators=400, n_jobs=-1, random_state=CFG.seed,
    class_weight="balanced_subsample",
)
if mask.sum() > 100:
    rf_minor.fit(X_bal[mask], y_bal[mask])

def cascade_predict(X, conf_thresh: float = 0.6):
    proba = rf.predict_proba(X)
    pred = rf.classes_[proba.argmax(axis=1)]
    conf = proba.max(axis=1)
    route = (conf < conf_thresh) | np.isin(pred, [c for c in rf.classes_ if c not in minor_ints])
    if mask.sum() > 100 and route.any():
        pred[route] = rf_minor.predict(X[route])
    return pred

y_pred_cas = cascade_predict(X_va)
print("\nCascade:")
print(classification_report(y_va, y_pred_cas, digits=3))
''')

code(r'''# Persist final pipeline artefacts.
import joblib
joblib.dump(rf,        CFG.out_root / "rf_stage1.joblib")
joblib.dump(rf_minor,  CFG.out_root / "rf_stage2_minor.joblib")
with open(CFG.out_root / "code_to_int.json", "w", encoding="utf-8") as f:
    json.dump({k: int(v) for k, v in code_to_int.items()}, f, ensure_ascii=False, indent=2)
print("models + label map saved to", CFG.out_root)
''')

md("""## 9 · What to feed back into the tracker board

The Rayong Crop Tracker board expects per-(member, stage) tile counts. From this notebook:

| Stage | `done` | `total` |
|---|---|---|
| `Data` | number of cloud-free monthly composites successfully fetched (max 12 per AOI) | 12 × (AOI count) |
| `SR` | SR tiles persisted in `_cache/s2_sr/` | same as Data |
| `GenAI` | LoRA adapters trained × minority classes | len(minority_classes) |
| `Feat` | rows in `pixel_table.parquet` (rounded to nearest thousand) | target row budget |
| `RF` | `1` once stage-1 model dumped + `1` for cascade | `2` |

The board's `tasks.done / tasks.total` field is intentionally generic — any monotone integer pair works. Post counts via the Supabase REST endpoint or just hand-edit in the UI after each notebook run.
""")

# ============================================================================
# 10 · Export class-distribution insights → public/class-stats.json
# ============================================================================
md("""## 10 · Export class-distribution insights to the web dashboard

Writes `public/class-stats.json` consumed by the tracker site's *Class distribution* panel. The export computes per-area class shares + imbalance metrics from the **LDD landuse shapefile** so the team can spot underrepresented classes before training.

Three breakdowns are produced:

| Kind | Areas | Use |
|---|---|---|
| `overall` | the whole province | headline numbers |
| `quadrant` | NW / NE / SW / SE (matches the tracker split) | see which quadrant is dominated by one crop |
| `s2_tile` | Sentinel-2 100km MGRS tiles intersecting Rayong | pick training tiles per minority class |

Metrics per area: **Shannon entropy** (higher = more balanced, max = log2 N), **Gini** (0 = balanced, 1 = one class), and **max/min ratio** of class areas.

Re-run this cell whenever the shapefile changes; commit the JSON to deploy.
""")

code(r'''import json, math
from collections import defaultdict
from datetime import datetime, timezone

# Constants mirror the web app's RayongMap (lib/rayong.ts).
RAYONG_CENTER = {"lng": 101.4291, "lat": 12.8539}

# Optional dependency for the per-S2-tile breakdown.
try:
    import mgrs as _mgrs_mod
    _mgrs = _mgrs_mod.MGRS()
except Exception:
    _mgrs = None
    print("note: `pip install mgrs` to enable the per-Sentinel-2-tile breakdown (skipping for now).")

# Reproject to UTM 47N for accurate planar areas, lat/lng for centroid binning.
lu_m  = lu.to_crs(32647).copy()
lu_ll = lu.to_crs(4326).copy()
lu_ll["area_km2"] = (lu_m.area / 1e6).values
_cen_m = lu_m.geometry.centroid
_cen_ll = _cen_m.to_crs(4326)
lu_ll["_cen_lng"] = _cen_ll.x.values
lu_ll["_cen_lat"] = _cen_ll.y.values

def _quadrant(lng: float, lat: float) -> str:
    east = lng >= RAYONG_CENTER["lng"]
    north = lat >= RAYONG_CENTER["lat"]
    return ("N" if north else "S") + ("E" if east else "W")

def _s2_tile(lng: float, lat: float):
    if _mgrs is None: return None
    try:
        s = _mgrs.toMGRS(lat, lng, MGRSPrecision=0)
        return s[:5] if isinstance(s, str) and len(s) >= 5 else None
    except Exception:
        return None

lu_ll["_quadrant"] = [_quadrant(x, y) for x, y in zip(lu_ll._cen_lng, lu_ll._cen_lat)]
lu_ll["_s2_tile"]  = [_s2_tile (x, y) for x, y in zip(lu_ll._cen_lng, lu_ll._cen_lat)]

# Class column: prefer the LDD level-2 grouping (~15-20 classes) over raw LU_CODE
# (~200+ leaf codes including mixed plots). Set CLASS_COL = "LU_CODE" if you
# want the full leaf set instead.
CLASS_COL = "LUL2_CODE" if "LUL2_CODE" in lu_ll.columns else ("LU_CODE" if "LU_CODE" in lu_ll.columns else lu_ll.columns[0])
lu_ll[CLASS_COL] = lu_ll[CLASS_COL].astype(str).fillna("__unk__")

# Drop mixed-class polygons like "A2/A3" so the headline classes stay clean.
lu_ll = lu_ll[~lu_ll[CLASS_COL].str.contains("/")].copy()

# Keep every distinct LU_CODE — no top-N folding, no 'other' bucket. The
# web ClassInsights panel can render the full list with one row per class.
total_by_class = lu_ll.groupby(CLASS_COL)["area_km2"].sum().sort_values(ascending=False)
ordered = [str(c) for c in total_by_class.index]
lu_ll["_class"] = lu_ll[CLASS_COL]
minority_ids = list(CFG.minority_classes)

# 18 distinct hues to cover the typical 12-16 LDD classes plus a few spares.
PALETTE = [
    "#3F7D58","#3F6E97","#C96442","#B68A2E","#7B5BA6","#9B5C7A",
    "#4F7A95","#7C7A52","#A85C9D","#5F8A6E","#8B6F47","#D4A748",
    "#5B8B7C","#A67B5B","#6B7280","#9B7CB6","#C68A6C","#7AA66D",
]
MINORITY_COLOR = "#B14B3D"

# Human-readable LDD landuse labels. Extend as you learn the codes.
LABELS = {
    "A100":"Paddy field","A101":"Paddy rice","A102":"Paddy rice (2nd crop)","A103":"Abandoned paddy",
    "A200":"Field crops","A201":"Cassava","A202":"Sugar cane","A203":"Maize / Corn","A204":"Pineapple",
    "A205":"Sorghum","A206":"Cotton","A207":"Soybean","A208":"Mung bean","A209":"Tobacco",
    "A300":"Perennial crop","A301":"Rubber","A302":"Oil palm","A303":"Coconut","A304":"Coffee","A305":"Tea","A306":"Cashew",
    "A400":"Orchard","A401":"Mango","A402":"Durian","A403":"Longan","A404":"Mangosteen",
    "A405":"Rambutan","A406":"Lychee","A407":"Citrus","A408":"Banana","A409":"Papaya",
    "A500":"Horticulture","A501":"Vegetables","A502":"Cut flowers",
    "A600":"Pasture","A700":"Aquaculture","A701":"Shrimp farm","A702":"Fish farm",
    "F100":"Evergreen forest","F200":"Deciduous forest","F300":"Mangrove forest",
    "F400":"Beach forest","F500":"Forest plantation","F600":"Bamboo",
    "U100":"City / town","U200":"Village","U300":"Commercial","U400":"Industrial","U500":"Institutional",
    "W100":"River / canal","W200":"Reservoir / lake","W300":"Sea",
    "M100":"Wetland","M200":"Marsh / swamp","M300":"Mine / pit",
    "I100":"Industrial site","X000":"Misc / unclassified",
}

class_defs = []
for i, cid in enumerate(ordered):
    is_min = cid in minority_ids
    color  = MINORITY_COLOR if is_min else PALETTE[i % len(PALETTE)]
    class_defs.append({
        "id": cid,
        "label": LABELS.get(cid, cid),
        "color": color,
        "minority": bool(is_min),
    })

def _area_block(df):
    grp = df.groupby("_class")["area_km2"].sum().reindex(ordered, fill_value=0.0)
    total = float(grp.sum())
    classes = []
    for cid in ordered:
        a = float(grp.loc[cid])
        classes.append({"id": cid, "area_km2": a, "share": (a / total) if total > 0 else 0.0})
    classes.sort(key=lambda c: -c["share"])
    return {"area_km2_total": total, "classes": classes}

def _shannon(shares):
    return -sum(s * math.log2(s) for s in shares if s > 0)

def _gini(shares):
    """Gini coefficient of a list of non-negative shares (already a distribution)."""
    xs = sorted(float(s) for s in shares if s > 0)
    n = len(xs)
    if n == 0: return 0.0
    cum = sum((i + 1) * s for i, s in enumerate(xs))
    return (2 * cum) / (n * sum(xs)) - (n + 1) / n

def _ratio(shares):
    nz = [s for s in shares if s > 0]
    return (max(nz) / min(nz)) if nz else 0.0

def _metrics(block):
    shares = [c["share"] for c in block["classes"]]
    return {
        "shannon": round(_shannon(shares), 4),
        "gini":    round(_gini(shares), 4),
        "max_min_ratio": round(_ratio(shares), 3),
    }

areas = []

ov = _area_block(lu_ll)
areas.append({"key": "overall", "label": "All Rayong", "kind": "overall", **ov, "metrics": _metrics(ov)})

QUAD_LABELS = {"NW": "Northwest", "NE": "Northeast", "SW": "Southwest", "SE": "Southeast"}
for q in ("NW", "NE", "SW", "SE"):
    sub = lu_ll[lu_ll["_quadrant"] == q]
    block = _area_block(sub)
    areas.append({"key": q, "label": QUAD_LABELS[q], "kind": "quadrant", **block, "metrics": _metrics(block)})

if _mgrs is not None:
    for tile, sub in sorted(lu_ll.groupby("_s2_tile")):
        if not tile: continue
        block = _area_block(sub)
        if block["area_km2_total"] < 1.0:  # skip sliver overlaps
            continue
        areas.append({"key": str(tile), "label": str(tile), "kind": "s2_tile", **block, "metrics": _metrics(block)})

LU_SHP_NAME = LU_SHP.name if "LU_SHP" in globals() else "LDD landuse"
payload = {
    "version": 1,
    "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "source": f"LDD landuse · {LU_SHP_NAME}",
    "classes": class_defs,
    "areas": areas,
}

# Write next to the web app (CFG.repo_root/public). If repo_root happens to
# point elsewhere (a fresh CFG default), the relative path from the notebook
# directory ../public will land in the right place.
candidate_roots = [CFG.repo_root, Path.cwd().parent, Path.cwd()]
out_path = None
for root in candidate_roots:
    if (root / "package.json").exists():
        out_path = root / "public" / "class-stats.json"
        break
if out_path is None:
    out_path = candidate_roots[0] / "public" / "class-stats.json"
out_path.parent.mkdir(parents=True, exist_ok=True)
out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"wrote {out_path}\\n  {len(class_defs)} classes · {len(areas)} areas (1 overall + 4 quadrant + {sum(1 for a in areas if a['kind']=='s2_tile')} S2 tiles)")
''')

# ============================================================================
# emit
# ============================================================================
nb = {
    "cells": cells,
    "metadata": {
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python", "version": "3.11"},
    },
    "nbformat": 4,
    "nbformat_minor": 5,
}

out_path = Path(__file__).resolve().parent / "pipeline.ipynb"
out_path.write_text(json.dumps(nb, indent=1, ensure_ascii=False), encoding="utf-8")
print(f"wrote {out_path} · {len(cells)} cells")
