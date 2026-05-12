"""Standalone DiffusionSat sampler for the SynthCrop pipeline.

Runs in its own conda env (see environment-diffusionsat.yml) because
DSAT's pinned diffusers / huggingface_hub versions clash with the main
notebook env. Output patches land under cache/synth/<class>/ in the same
.npy + RGB .png format that the main notebook's §6.1 viz cell reads, so
the visualisation step "just works" with whichever sampler ran last.

Usage:

    conda activate synthcrop-dsat
    git clone https://github.com/samar-khanna/DiffusionSat.git \\
        notebooks/external/DiffusionSat              # one-time
    python notebooks/diffusionsat_synth.py \\
        --classes Durian Langsat Rambutan \\
        --n 200 \\
        --aoi-bbox 101.55 12.70 101.65 12.80

Prompts use the simple template
    "Sentinel-2 satellite imagery of <class>, rural Thailand"
which is what DSAT was conditioned on during pre-training. The lat/lng
metadata is passed via `metadata={"lat": ..., "lng": ..., "ts": ...}` so
the model's location embedding has something to latch onto.
"""
from __future__ import annotations

import argparse
import importlib
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from tqdm import tqdm


REPO_ROOT = Path(__file__).resolve().parents[1]
DSAT_REPO = REPO_ROOT / "notebooks" / "external" / "DiffusionSat"
SYNTH_OUT = REPO_ROOT / "data" / "_cache" / "synth"


def _patch_legacy_imports() -> None:
    """DSAT targets diffusers<=0.18 + huggingface_hub<=0.16. Newer envs
    rename a couple of symbols — shim them so the import doesn't crash."""
    try:
        import huggingface_hub as hf
        if not hasattr(hf, "cached_download") and hasattr(hf, "hf_hub_download"):
            hf.cached_download = hf.hf_hub_download
    except Exception as e:  # noqa: BLE001
        print(f"note: huggingface_hub shim skipped ({e})", file=sys.stderr)

    try:
        if "diffusers.models.cross_attention" not in sys.modules:
            attn = importlib.import_module("diffusers.models.attention")
            sys.modules["diffusers.models.cross_attention"] = attn
            for old, new in [("CrossAttention", "Attention"),
                             ("CrossAttnProcessor", "AttnProcessor")]:
                if hasattr(attn, new) and not hasattr(attn, old):
                    setattr(attn, old, getattr(attn, new))
    except Exception as e:  # noqa: BLE001
        print(f"note: diffusers shim skipped ({e})", file=sys.stderr)


def _safe_class_dir(name: str) -> str:
    return name.replace(" ", "_").lower()


def _save_patch(class_name: str, idx: int, patch: np.ndarray) -> None:
    """patch: (4, H, W) float reflectance 0-1 (B02, B03, B04, B08)."""
    out_dir = SYNTH_OUT / _safe_class_dir(class_name)
    out_dir.mkdir(parents=True, exist_ok=True)
    np.save(out_dir / f"patch_{idx:03d}.npy", patch.astype("float32"))
    rgb = np.stack([patch[2], patch[1], patch[0]], axis=-1)
    rgb = np.clip(rgb / max(1e-6, np.percentile(rgb, 99)), 0.0, 1.0)
    Image.fromarray((rgb * 255).astype(np.uint8)).save(out_dir / f"patch_{idx:03d}.png")


def _pil_to_4band(img: Image.Image) -> np.ndarray:
    """DSAT pipeline returns a PIL RGB image. We don't have a true NIR
    sample, so we synthesise B08 from a luminance-weighted blend of the
    three channels. This is a pragmatic placeholder — it keeps the
    downstream feature extractor happy without claiming the synthetic NIR
    is physically meaningful."""
    arr = np.asarray(img).astype("float32") / 255.0    # (H, W, 3)
    R, G, B = arr[..., 0], arr[..., 1], arr[..., 2]
    fake_nir = np.clip(0.5 * G + 0.4 * R + 0.1 * B, 0.0, 1.0)
    # Channel order matches the main notebook: B02, B03, B04, B08.
    return np.stack([B, G, R, fake_nir], axis=0)


def load_pipeline() -> "DiffusionSatPipeline":  # type: ignore[name-defined]
    if not DSAT_REPO.exists():
        raise SystemExit(
            f"DiffusionSat repo not found at {DSAT_REPO}.\n"
            f"Clone it:  git clone https://github.com/samar-khanna/DiffusionSat.git {DSAT_REPO}"
        )
    sys.path.insert(0, str(DSAT_REPO))
    _patch_legacy_imports()
    from diffusionsat import DiffusionSatPipeline  # type: ignore

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    pipe = DiffusionSatPipeline.from_pretrained(
        "samar-khanna/DiffusionSat", torch_dtype=dtype,
    ).to(device)
    print(f"DiffusionSat loaded on {device} (dtype={dtype})")
    return pipe


def sample_class(
    pipe,
    class_name: str,
    n: int,
    lat: float,
    lng: float,
    ts: str,
    steps: int,
    guidance: float,
    seed: int,
) -> None:
    prompt = f"Sentinel-2 satellite imagery of {class_name}, rural Thailand"
    generator = torch.Generator(device=pipe.device).manual_seed(seed)
    print(f"[{class_name}] sampling {n} patches with DiffusionSat")
    for i in tqdm(range(n), desc=class_name):
        result = pipe(
            prompt=[prompt],
            metadata={"lat": [lat], "lng": [lng], "ts": [ts]},
            num_inference_steps=steps,
            guidance_scale=guidance,
            generator=generator,
        )
        img = result.images[0]
        _save_patch(class_name, i, _pil_to_4band(img))


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--classes", nargs="+", required=True,
                   help="Display names matching CFG.minority_classes in the main notebook.")
    p.add_argument("--n", type=int, default=200, help="Patches per class.")
    p.add_argument("--steps", type=int, default=40, help="Diffusion sampling steps.")
    p.add_argument("--guidance", type=float, default=7.5, help="Classifier-free guidance scale.")
    p.add_argument("--aoi-bbox", nargs=4, type=float,
                   metavar=("W", "S", "E", "N"),
                   default=(101.55, 12.70, 101.65, 12.80),
                   help="AOI bbox in lng/lat. lat/lng metadata uses the centroid.")
    p.add_argument("--date", default="2024-07-01",
                   help="Timestamp metadata passed to DSAT (YYYY-MM-DD).")
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args()

    try:
        datetime.fromisoformat(args.date)
    except ValueError as e:
        raise SystemExit(f"--date must be YYYY-MM-DD: {e}")

    w, s, e, n = args.aoi_bbox
    lat = (s + n) / 2
    lng = (w + e) / 2

    pipe = load_pipeline()
    SYNTH_OUT.mkdir(parents=True, exist_ok=True)
    for cls in args.classes:
        sample_class(pipe, cls, args.n, lat, lng, args.date,
                     args.steps, args.guidance, args.seed)
    print(f"\nDone. Patches under {SYNTH_OUT}")
    print("Re-run §6.1 in pipeline.ipynb to render RGB / NIR / NDVI grids.")


if __name__ == "__main__":
    main()
