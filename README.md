# Rayong Crop Tracker · super-resolution-driven clustering of mixed-class agricultural polygons

Earth-observation research project on minority-crop mapping in Rayong province, Thailand. The central research question is whether **single-image super-resolution of Sentinel-2 imagery enables unsupervised clustering to separate the component crops of the mixed-class polygons in the LDD (Land Development Department) cadastral landuse layer**, recovering pure per-component pixel labels.

The single deliverable is the Jupyter notebook `notebooks/cluster_minority.ipynb`. OpenSR (latent-diffusion super-resolution) and the Sentinel-2 fetch are upstream workflow steps, not research contributions in their own right. The notebook treats the 10 m and 2.5 m rasters as inputs and compares clustering outcomes between them.

---

## Research question

**Hypothesis.** Sentinel-2 at native 10 m resolution cannot resolve the component crops in mixed-class agricultural parcels: a 10 m pixel inside an LDD polygon labelled `A403/A419` (Durian + Mangosteen) is a sub-pixel spectral mixture of the two crops. Super-resolving the same parcel to 2.5 m breaks the sub-pixel mixture into pixels that are more likely to be component-pure. If true, unsupervised `K = 2` KMeans on the pool `(pure A + pure B + mixed A/B)` should split the mixed pixels into sub-clusters that match the parcel's listed components — and should do so more cleanly at 2.5 m than at 10 m.

**Test.** For every minority-only mixed `LU_CODE = A/B` in the AOI, fit `K = 2` KMeans on the pool independently at the 10 m grid (LR) and at the 2.5 m super-resolved grid (SR). Compare three statistics between the two grids:

- **Balanced pure-component purity** — how often KMeans recovers the pure-A and pure-B labels.
- **Mixed-pixel split ratio** — fraction of mixed pixels each cluster claims.
- **UMAP geometry** — whether pure A, pure B, and mixed A/B occupy distinct sub-regions of the embedding.

A positive `SR - LR` delta on the balanced purity is direct evidence that super-resolution carries spectrally meaningful sub-10 m detail.

**Scope.** The minority-class roster (Durian, Rambutan, Coconut, Mango, Longan, Jackfruit, Mangosteen, Langsat) has roughly 7 700 pure-component polygons and 1 100 mixed-component polygons across Rayong. Generative synthesis (latent-LoRA augmentation) is explicitly out of scope for this experiment; we cluster real pixels at both resolutions, nothing else.

```
Sentinel-2 L2A (CDSE openEO)
   │
   ├── 10 m monthly medians ───────────────────────────┐
   │                                                   │
   └── 4× super-resolution (OpenSR latent diffusion)   │
       → 2.5 m super-resolved stack ───────────────────┤
                                                       │
                                                       ▼
                              per-pixel feature engineering
                              12-D: 4 bands × {mean, std},
                              NDVI / NDWI / EVI summaries
                              independently at each grid
                                                       │
                                                       ▼
                              per-pair K=2 KMeans on
                              (pure A + pure B + mixed A/B)
                              independently at LR and SR
                                                       │
                                                       ▼
                              purity + split-ratio + UMAP
                              comparison, plus spatial render
                                                       │
                                                       ▼
                              decomposed mixed-pixel parquet
```

---

## Notebook walkthrough — `notebooks/cluster_minority.ipynb`

| § | Section | What it does |
| --- | --- | --- |
| 1 | Shapefile · mixed-component catalogue | Inspects the LDD shapefile; lists every minority-only `LU_CODE`, pure and mixed, with pixel counts. |
| 2 | Sentinel-2 rasters · LR (10 m) and SR (2.5 m) | Fetches L2A monthly medians via CDSE openEO for any quadrant missing local cache (cloud-masked using SCL classes 3 / 8 / 9 / 10), then exposes loader functions for both grids. |
| 3 | Per-pixel features | Stride-samples each grid per quadrant, computes the 12-D feature schema across the three-month window, concatenates into `PIX_LR` and `PIX_SR` with `quadrant` and `grid` columns. |
| 4 | KMeans on pure-minority pixels · LR vs SR | Baseline `K = 8` KMeans on the pure pool. Reports ARI and NMI for LR and SR side-by-side; prints the cluster × class contingency. |
| 4.1 | Pairwise Fisher separability | Pairwise Fisher distance between pure-class centroids, plotted as a heatmap for LR and SR with the `SR - LR` delta tabulated. |
| 5 | UMAP · pure-minority embedding | 2-D UMAP of the standardised feature space, LR and SR side-by-side, coloured by true class. |
| 5.1 | Vegetation-index distributions | Violin plots of `NDVI_mean`, `NDVI_amp`, `NDWI_mean`, `EVI_mean` per pure class, LR and SR. |
| 6 | Mixed-polygon decomposition (centroid baseline) | For every mixed `LU_CODE`, the closest pure-class centroid per pixel; used as a sanity baseline for the SR feature space. |
| 6.1 | Mixed-code → pure-centroid distance | Heatmap of mean Euclidean distance from every mixed-code pixel cloud to each pure centroid; asterisks mark listed components. |
| 6.2 | **Per-pair K=2 KMeans · LR vs SR** | Headline experiment. Per pair: K=2 KMeans on (pure A + pure B + mixed A/B), independently at LR and SR. Reports `LR_balanced_purity`, `SR_balanced_purity`, `delta_SR_minus_LR`, and the mixed-pixel split. |
| 6.3 | Per-pair UMAP · LR vs SR | Per-pair UMAP grid; points coloured by KMeans cluster and shaped by origin (pure A / pure B / mixed A/B). |
| 6.4 | Gaussian-mixture soft posterior | 2-component GMM initialised at the pure centroids; reports per-pixel `P(A)` and `P(B)` on a chosen mixed pair. |
| 6.5 | Spatial render | Picks the largest target-pair polygon across the four quadrants, renders the SR per-pixel KMeans assignment back on its bounding box. Spatial coherence diagnostic. |
| 7 | Export decomposed mixed pixels | Persists every eligible mixed pixel with its inferred component, the originating pair, and the quadrant tag to `data/_out/cluster_minority/rayong_<aoi-tag>_mixed_kmeans.parquet`. |

### Outputs

| Path | Contents |
| --- | --- |
| `data/_cache/s2_monthly/rayong_<q>/openEO_YYYY-MM-01Z.tif` | Cloud-masked 10 m monthly medians per quadrant; written by §2 if missing. |
| `data/_cache/s2_sr/rayong_<q>/sr_YYYYMM.tif` | Pre-computed 2.5 m super-resolved stacks per quadrant; read by §2. |
| `data/_out/cluster_minority/rayong_<aoi-tag>_mixed_kmeans.parquet` | Per-pixel KMeans-decomposed mixed pool. |

### Tunable parameters

| Parameter | Default | Purpose |
| --- | --- | --- |
| `QUADRANTS` | `["nw", "ne", "sw", "se"]` | AOIs included in the combined pixel table. |
| `LR_MONTHS` | `["2024-10", "2024-11", "2024-12"]` | Three-month window for the feature schema. |
| `STRIDE_SR` | `2` | SR-grid sub-sampling stride. |
| `STRIDE_LR` | `1` | LR-grid stride (LR is already 16× sparser than SR). |
| `MAX_PIX_PER_CLASS` | `1_000_000` | Per-`(quadrant, LU_CODE)` pixel cap. |
| `MIN_PURE_PER_COMP` | `200` | Minimum pure-component pixels for a pair to be admitted to §6.2. |
| `MIN_MIXED_PIXELS` | `100` | Minimum mixed pixels for a pair to be admitted to §6.2. |
| `PAIR_PURE_CAP` | `10_000` | Per-component pixel cap inside the per-pair KMeans pool. |

---

## Upstream workflow steps

The notebook treats the following as inputs and does not contribute to them as research artefacts. They are required to produce the rasters the notebook consumes.

| Step | Where | Notes |
| --- | --- | --- |
| Sentinel-2 L2A monthly medians (10 m) | Fetched in `cluster_minority.ipynb` §2 via CDSE openEO when the local cache is missing | Cloud mask: SCL 3 / 8 / 9 / 10. Bands: B02 / B03 / B04 / B08. |
| 4× super-resolution (2.5 m) | `opensr_model.SRLatentDiffusion` latent-diffusion model | Run once per quadrant via the helper script / notebook of your choice; the clustering notebook only reads the cached `data/_cache/s2_sr/rayong_<q>/sr_YYYYMM.tif` outputs. |

---

## Quickstart

```bash
git clone <repository-url> rayong-tracker
cd rayong-tracker
conda env create -f notebooks/environment.yml
conda activate synthcrop
python -m ipykernel install --user --name synthcrop --display-name "Python (synthcrop)"
jupyter lab notebooks/cluster_minority.ipynb
```

The notebook will prompt for OIDC authentication against the Copernicus Data Space Ecosystem on first run if any quadrant is missing its 10 m cache. A free CDSE account is sufficient.

Pinned versions: Python 3.12 (opensr-model requirement), `numpy<2`, `torch==2.3.1+cu121`, `transformers<4.47`.

---

## Repository layout

```
notebooks/
  cluster_minority.ipynb   Main clustering experiment (LR vs SR, K=2 per pair).
  environment.yml          Pinned conda environment.

data/
  landuse_ryg/             LDD shapefile (LU_RYG_2567.*).
  _cache/s2_monthly/       openEO 10 m monthly medians per quadrant.
  _cache/s2_sr/            Super-resolved 2.5 m stacks per quadrant.
  _out/cluster_minority/   Decomposed mixed-pixel parquet outputs.
```

The repository also contains a Next.js team-coordination web app at the top level (`app/`, `components/`, `lib/`, `supabase/`, `public/`). It is operational tooling and not part of the research workflow.

---

## License

Internal research project. Attribution required for upstream data and imagery:

- Sentinel-2 imagery © European Union, Copernicus Sentinel data.
- LDD landuse — Thai Land Development Department (กรมพัฒนาที่ดิน).
