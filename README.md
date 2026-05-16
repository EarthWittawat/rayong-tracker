# Rayong Crop Tracker

Earth-observation research project on minority-crop mapping in Rayong province, Thailand. The central research question is whether **single-image super-resolution of Sentinel-2 imagery enables unsupervised spectral unmixing of the mixed-class polygons in the LDD (Land Development Department) cadastral landuse layer**, recovering pure per-component pixel labels that can be folded back into a downstream Random Forest classifier.

The primary deliverable is the Jupyter notebook `notebooks/cluster_minority.ipynb`, which carries the end-to-end clustering experiment. A companion Next.js web application is included for team coordination and is documented at the end of this file.

---

## Research goal

**Hypothesis.** Sentinel-2 at native 10 m resolution cannot resolve the component crops in mixed-class agricultural parcels: a 10 m pixel inside an LDD polygon labelled `A403/A419` (Durian + Mangosteen) is a sub-pixel spectral mixture of the two crops. Super-resolving the same parcel to 2.5 m breaks the sub-pixel mixture into pixels that are more likely to be component-pure, so unsupervised clustering on the super-resolved pixels of a mixed parcel should split them into two sub-clusters that match the parcel's listed components.

**Test.** For every minority-only mixed `LU_CODE = A/B` in the AOI, fit `K = 2` KMeans on the pool `(pure A + pure B + mixed A/B)` independently at the 10 m grid and at the 2.5 m super-resolved grid. Compare the per-pair purity (how often KMeans recovers the pure-component label) and mixed-pixel split ratio between the two grids. A positive `SR - LR` delta on the balanced purity is direct evidence that super-resolution carries spectrally meaningful detail at the sub-10 m scale.

**Operational outcome.** The minority-class roster (Durian, Rambutan, Coconut, Mango, Longan, Jackfruit, Mangosteen, Langsat) has roughly 7 700 pure-component polygons and 1 100 mixed-component polygons across Rayong. Confirmed sub-polygon decomposition turns the mixed pool into additional per-pixel training data for the minority classifier without relying on generative synthesis.

```
Sentinel-2 L2A (CDSE openEO)
   │
   ├── 10 m monthly medians  ─────────┐
   │                                  │
   └── 4× super-resolution (OpenSR    │
       latent diffusion) → 2.5 m  ────┤
                                      │
                                      ▼
                       per-pixel feature engineering
                        (12-D: 4 bands × {mean, std},
                         NDVI / NDWI / EVI summaries)
                                      │
                                      ▼
                   per-pair K=2 KMeans on
                   (pure A + pure B + mixed A/B)
                   independently at LR and SR
                                      │
                                      ▼
              purity + split-ratio comparison
              + UMAP visualisation per pair
                                      │
                                      ▼
              decomposed mixed-pixel pool
              ─► minority RF training data
```

---

## Notebook walkthrough — `notebooks/cluster_minority.ipynb`

The notebook is self-contained: it pulls the 10 m raster, loads the cached super-resolved stack, runs the clustering experiment, and persists the decomposed mixed-pixel pool. The four quadrants (NW / NE / SW / SE) are processed in a single driver loop.

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
| 6.2 | **Per-pair K=2 KMeans · LR vs SR** | The headline experiment. Per pair: K=2 KMeans on (pure A + pure B + mixed A/B), independently at LR and SR. Reports `LR_balanced_purity`, `SR_balanced_purity`, `delta_SR_minus_LR`, and the mixed-pixel split. |
| 6.3 | Per-pair UMAP · LR vs SR | Per-pair UMAP grid; points coloured by KMeans cluster and shaped by origin (pure A / pure B / mixed A/B). |
| 6.4 | Gaussian-mixture soft posterior | 2-component GMM initialised at the pure centroids; reports per-pixel `P(A)` and `P(B)` on a chosen mixed pair (for downstream weighted training). |
| 6.5 | Spatial render | Picks the largest target-pair polygon across the four quadrants, renders the SR per-pixel KMeans assignment back on its bounding box. Spatial coherence diagnostic. |
| 7 | Export decomposed mixed pixels | Persists every eligible mixed pixel with its inferred component, the originating pair, and the quadrant tag to `data/_out/cluster_minority/rayong_<aoi-tag>_mixed_kmeans.parquet`. |

### Outputs

| Path | Contents |
| --- | --- |
| `data/_cache/s2_monthly/rayong_<q>/openEO_YYYY-MM-01Z.tif` | Cloud-masked 10 m monthly medians per quadrant; written by §2 if missing. |
| `data/_cache/s2_sr/rayong_<q>/sr_YYYYMM.tif` | Pre-computed 2.5 m super-resolved stacks per quadrant; read by §2. |
| `data/_out/cluster_minority/rayong_<aoi-tag>_mixed_kmeans.parquet` | Per-pixel KMeans-decomposed mixed pool, ready for the RF stage. |

### Tunable parameters

The §2 configuration cell exposes:

| Parameter | Default | Purpose |
| --- | --- | --- |
| `QUADRANTS` | `["nw", "ne", "sw", "se"]` | AOIs included in the combined pixel table. |
| `LR_MONTHS` | `["2024-10", "2024-11", "2024-12"]` | Three-month window for the feature schema. |
| `STRIDE_SR` | `2` | SR-grid sub-sampling stride. |
| `STRIDE_LR` | `1` | LR-grid stride (LR is already 16× sparser than SR, so no extra stride). |
| `MAX_PIX_PER_CLASS` | `1_000_000` | Per-`(quadrant, LU_CODE)` pixel cap. |
| `MIN_PURE_PER_COMP` | `200` | Minimum pure-component pixels for a pair to be admitted to §6.2. |
| `MIN_MIXED_PIXELS` | `100` | Minimum mixed pixels for a pair to be admitted to §6.2. |
| `PAIR_PURE_CAP` | `10_000` | Per-component pixel cap inside the per-pair KMeans pool. |

---

## Quickstart

```bash
# clone + create the notebook environment
git clone <repository-url> rayong-tracker
cd rayong-tracker
conda env create -f notebooks/environment.yml
conda activate synthcrop
python -m ipykernel install --user --name synthcrop --display-name "Python (synthcrop)"
```

The notebook authenticates to CDSE openEO on first run; you will be prompted to complete an OIDC device-code flow in your browser. A Copernicus Data Space Ecosystem account is required.

Cached super-resolved tiles for the four quadrants live under `data/_cache/s2_sr/rayong_<q>/`. If you do not have those, run `notebooks/pipeline.ipynb` (the full SR pipeline) for each quadrant first, or run the super-resolution stage of the companion app's documentation.

Pinned versions: Python 3.12 (opensr-model requirement), `numpy<2`, `torch==2.3.1+cu121`, `transformers<4.47`.

---

## Repository layout

```
notebooks/
  cluster_minority.ipynb     Main clustering experiment (LR vs SR, K=2 per pair).
  pipeline.ipynb             End-to-end ingest → SR → features → RF (companion).
  regen_quadrant.ipynb       Standalone rebuild of one quadrant's S2 + SR cache.
  environment.yml            Pinned conda environment.

data/
  landuse_ryg/               LDD shapefile (LU_RYG_2567.*).
  _cache/s2_monthly/         openEO 10 m monthly medians per quadrant.
  _cache/s2_sr/              Super-resolved 2.5 m stacks per quadrant.
  _out/cluster_minority/     Decomposed mixed-pixel parquet outputs.

app/ components/ lib/ supabase/ public/
  Companion Next.js application (see below).
```

---

## Companion web application

A Next.js / TypeScript / Tailwind application backed by Supabase tracks the five-person team's pipeline progress. It is operational tooling, not part of the research workflow:

- Kanban board with one column per pipeline stage (Data / SR / GenAI / Feat / RF) and one card per (member, stage).
- Satellite map (Leaflet + Esri World Imagery) with rectangle-draw → GeoJSON / Python bbox export and an optional Sentinel-2 100 km MGRS tile overlay.
- Class-distribution panel reading `public/class-stats.json`, with per-quadrant and per-S2-tile class shares plus imbalance metrics.
- In-app issue tracker with labels, assignees, and threaded `@mention` comments.

### Stack

| Layer       | Choice                                                                  |
| ----------- | ----------------------------------------------------------------------- |
| Frontend    | Next.js 14 App Router · React 18 · TypeScript · Tailwind 3              |
| Map         | Leaflet · leaflet-draw · `mgrs` for tile / coord conversion             |
| Backend     | Supabase (Postgres 15 + Auth + Storage + Edge Functions)                |
| Email       | Resend (free tier)                                                      |
| Hosting     | Vercel (Hobby) + Vercel Cron for the daily digest                       |
| Auth        | Google OAuth via Supabase                                               |
| Notebook    | Conda env (`notebooks/environment.yml`) · Python 3.12 · PyTorch CUDA    |

### Web app development

```bash
cp .env.local.example .env.local        # fill in Supabase keys
npm install
npm run dev                             # http://localhost:3000
```

Required environment variables: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Without these, the app falls back to localStorage-only mode for UI previews.

---

## License

Internal research project. Attribution required for upstream data and imagery:

- Sentinel-2 imagery © European Union, Copernicus Sentinel data.
- Esri World Imagery — © Esri, Maxar, Earthstar Geographics, USDA, USGS, AeroGRID, IGN, and the GIS user community.
- LDD landuse — Thai Land Development Department (กรมพัฒนาที่ดิน).
