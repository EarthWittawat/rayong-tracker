# Rayong Crop Tracker

Real-time collaboration board for a five-person Earth Observation team building a Sentinel-2 → super-resolution → generative augmentation → feature engineering → Random Forest crop-classification pipeline over Rayong province, Thailand.

The web app is the *operations side* of the project. The Jupyter notebook in `notebooks/pipeline.ipynb` is the *engineering side*. Both share the same five-stage taxonomy:

| Stage  | What it does                                                                 |
| ------ | ---------------------------------------------------------------------------- |
| Data   | CDSE openEO · Sentinel-2 L2A monthly medians with SCL cloud masking          |
| SR     | OpenSR latent-diffusion 4× super-resolution, 10 m → 2.5 m on B02/B03/B04/B08, per-quadrant cache |
| GenAI  | Latent-LoRA fine-tune of opensr-ldsrs2 per minority class (7 classes), 512-px windows pooled across 4 quadrants |
| Feat   | LDD landuse rasterised on the SR grid, slim 12-feature table (NDVI / NDWI / EVI + band stats), per-class pixel cap |
| RF     | Per-pixel Random Forest cascade (stage-1 + minority-focused stage-2), DF + synth_rows resume-cacheable |

---

## Highlights

- **Kanban board** with one column per pipeline stage and one card per (member, stage) task. Cards expand inline for `+ / −`, quick-pick increments, status pills, comment counts, and subtasks.
- **List view** with the full member card editor: comments thread, file attachments, per-stage notes.
- **Presence + activity feed** over Supabase Realtime — teammate avatars, "X editing" chips, rolling 30-event broadcast feed.
- **Satellite map** (Leaflet + Esri World Imagery) with draw-rectangle → GeoJSON / Python bbox export, click-to-read lat/lng + MGRS, optional Sentinel-2 100 km MGRS tile overlay.
- **Class-distribution insights** — reads `public/class-stats.json` (produced by `notebooks/export_class_stats.py` or §10 of the notebook) and renders per-quadrant + per-S2-tile class shares, Shannon entropy, Gini, and minority-class flags.
- **Pipeline guide** — in-app stepper that documents every stage: what / why / done / inputs / outputs / tools.
- **Team telemetry footer** — 24 h + 7 d edit counts, completion %, top contributor, lagging stage.
- **Subtasks** — per-task checklists; anyone can tick, only the author can delete.
- **Comments + @mentions + Supabase Storage attachments** with email fan-out via Resend and a daily-digest Vercel Cron.
- **Light + dark themes** with a CSS-variable palette and a force-dark navigation slab.
- **Issues** — in-app issue tracker at `/issues`. Anyone signed in can open issues, label them, assign teammates, comment with `@mentions` + `#123` cross-links, and close / reopen. Backed by `issues` + `issue_comments` tables on Supabase with realtime sync.

---

## Stack

| Layer       | Choice                                                                  |
| ----------- | ----------------------------------------------------------------------- |
| Frontend    | Next.js 14 App Router · React 18 · TypeScript · Tailwind 3              |
| Map         | Leaflet · leaflet-draw · `mgrs` for tile / coord conversion             |
| Backend     | Supabase (Postgres 15 + Realtime + Auth + Storage + Edge Functions)     |
| Email       | Resend (free tier, 3 000 mail/month)                                    |
| Hosting     | Vercel (Hobby) + Vercel Cron for the daily digest                       |
| Auth        | Google OAuth via Supabase                                               |
| Notebook    | Conda env (`notebooks/environment.yml`) · Python 3.12 · PyTorch CUDA    |

---

## Repository layout

```
app/         Next.js App Router pages, layout, cron route, global CSS.
components/  React components: BoardView, MemberCard, MapClient,
             ClassInsights, PipelineGuide, SubtasksList, etc.
lib/         Hooks + Supabase client + utilities (useStore, auth,
             comments, subtasks, classStats, relativeTime, rayong).
supabase/    schema.sql · migrations · Edge Function (send-mail).
notebooks/   pipeline.ipynb · environment.yml · _build_notebook.py.
public/      Static assets (leaflet-draw sprite, class-stats.json).
vercel.json  Cron schedule for the digest mailer.
```

---

## Data model

```
members        : one row per teammate (auto-created on first sign-in)
tasks          : one row per (member, stage); done / total / note
profiles       : one row per Google account (display, color, emoji, prefs)
subtasks       : user-authored checklist items under each task
comments       : threaded discussion per task, with @mentions
attachments    : files attached to comments (Supabase Storage)
issues         : in-app issue tracker (number, title, body, labels, status)
issue_comments : threaded discussion per issue, with @mentions
task_subscribers, notifications  : digest mailer plumbing
```

Edits are **optimistic** locally (UI updates immediately) and **debounced** at 220 ms before hitting Postgres. All tables above (except the mailer plumbing) are on the `supabase_realtime` publication, so every browser sees every change over a single WebSocket.

Tables filtered by a non-primary-key column on the client (`comments.task_id`, `attachments.comment_id`, `subtasks.task_id`, `issue_comments.issue_id`, `issues.status` / `issues.number`) need `REPLICA IDENTITY FULL` so `UPDATE` / `DELETE` events carry the filtered column. Otherwise the filter on the subscriber side can't match and the event is silently dropped — UI shows stale state until refresh. Apply `supabase/migrations/20260513140000_realtime_full_identity.sql` once to enable.

Self-removal is blocked at the UI layer (the "remove member" control turns into a small "you" lock chip on your own row) and in the handler (defensive early return), so the signed-in user's row can never be dropped accidentally.

---

## Pipeline overview

Five stages mirror notebook sections one-for-one. See **PipelineGuide** in the app for the full prose breakdown.

1. **Data** · CDSE openEO pulls Sentinel-2 L2A scenes for the AOI, masks SCL classes 3 / 8 / 9 / 10 (cloud-shadow, mid + high cloud, cirrus), and aggregates a monthly median per band. Outputs one GeoTIFF per month under `data/_cache/s2_monthly/rayong_<quadrant>/`. Rayong is split at the centroid into NW / NE / SW / SE quadrants; the `§5 driver` cell iterates all four to cover the whole province without ever holding everything in RAM at once.
2. **SR** · `opensr_model.SRLatentDiffusion` 4× super-resolves 10 m → 2.5 m on the 4-band RGB-NIR composite, 128-LR → 512-SR tiles with 32-px overlap. Per-quadrant cache lives at `data/_cache/s2_sr/rayong_<quadrant>/sr_YYYYMM.tif`; cached tifs are reused as-is so re-runs are near-instant. A standalone `notebooks/regen_quadrant.ipynb` rebuilds a single quadrant's S2 + SR when one cache is dirty (duplicate / truncated / wrong bbox).
3. **GenAI** · Latent-space LoRA adapters (rank 32, α 64) fine-tune the opensr-ldsrs2 UNet per minority class on real SR patches. Training runs in the model's native latent space (VAE encode → DDPM noise → predict ε), so synthetic outputs are 4-band Sentinel-2 reflectance, not RGB. Seven minority classes (Mango / Rambutan / Langsat / Longan / Mangosteen / Coconut / Jackfruit) — windows pooled across all 4 quadrants up to `samples_per_minor = 600` per class, mask-weighted MSE focuses the adapter on class pixels. Sampler: DDIM `η = 0.1`, 200 steps. Inline RGB + NDVI snapshots every 10 epochs let you eyeball convergence. Per-class adapter ≈ 10 MB; 200 synthetic patches per class are appended to the pixel table for §RF and cached to `data/_cache/synth_rows.pkl` so a kernel restart can skip §6.
4. **Feat** · LDD landuse shapefile rasterised onto the SR grid; per-pixel features are the slim 12-column SR-only set (4 bands × {mean, std}, NDVI mean / amp, NDWI mean, EVI mean). Per-class pixel cap (default 100 000 per AOI) keeps dominant classes (Para rubber, Oil palm) from swamping the table. Output cached at `data/_out/pixel_table_full.parquet` so the RF step can lazy-reload after a kernel restart.
5. **RF** · `sklearn.RandomForestClassifier` stage-1 on the full table + a minority-focused stage-2 cascade. Cell auto-reloads cached `DF` and `synth_rows` from disk when not in globals and splices synth rows into `DF` before fitting. Stage-2 catches samples flagged as minority.

§10 of the notebook exports `public/class-stats.json` (per-quadrant + per-S2-tile class shares + imbalance metrics) via the `notebooks/export_class_stats.py` standalone (preset `rayong-crops-15` mapping LU_DES_EN → 15-class taxonomy including a unified water class). Commit the JSON to refresh the ClassInsights panel on the live site.

---

## Local development

```bash
cp .env.local.example .env.local        # fill in your Supabase keys
npm install
npm run dev                             # http://localhost:3000
```

Required env vars:

| Variable                         | Source                                                          |
| -------------------------------- | --------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`       | Supabase · Project Settings → API → Project URL                 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | Supabase · Project Settings → API → anon public key             |

Without these, the app degrades to localStorage-only mode — useful for previewing the UI without a backend.

Notebook env:

```bash
cd notebooks
conda env create -f environment.yml
conda activate synthcrop
python -m ipykernel install --user --name synthcrop --display-name "Python (synthcrop)"
```

Pinned: Python 3.12 (opensr-model requirement), `numpy<2`, `torch==2.3.1+cu121`, `transformers<4.47` (matches the torch 2.3 envelope).

---

## License

Internal research project. Attribution required for upstream data + imagery:

- Sentinel-2 imagery © European Union, Copernicus Sentinel data.
- Esri World Imagery — © Esri, Maxar, Earthstar Geographics, USDA, USGS, AeroGRID, IGN, and the GIS user community.
- LDD landuse — Thai Land Development Department (กรมพัฒนาที่ดิน).
