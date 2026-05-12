# Rayong Crop Tracker

Real-time collaboration board for a five-person Earth Observation team building a Sentinel-2 → super-resolution → generative augmentation → feature engineering → Random Forest crop-classification pipeline over Rayong province, Thailand.

The web app is the *operations side* of the project. The Jupyter notebook in `notebooks/pipeline.ipynb` is the *engineering side*. Both share the same five-stage taxonomy:

| Stage  | What it does                                                                 |
| ------ | ---------------------------------------------------------------------------- |
| Data   | CDSE OpenEO · Sentinel-2 L2A monthly medians with SCL cloud masking          |
| SR     | OpenSR latent-diffusion super-resolution, 10 m → 2.5 m on B02/B03/B04/B08    |
| GenAI  | Latent-LoRA fine-tuning of opensr-ldsrs2 per minority class (4-band)         |
| Feat   | LDD landuse rasterised on the SR grid, temporal stats + indices + GLCM/LBP   |
| RF     | Per-pixel Random Forest cascade (stage-1 + minority-focused stage-2)         |

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
- **Issues** — GitHub-style tracker at `/issues`. Anyone signed in can open issues, label them, assign teammates, comment with `@mentions`, and close / reopen. Backed by `issues` + `issue_comments` tables on Supabase with realtime sync.

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
issues         : GitHub-style issue tracker (number, title, body, labels, status)
issue_comments : threaded discussion per issue, with @mentions
task_subscribers, notifications  : digest mailer plumbing
```

Edits are **optimistic** locally (UI updates immediately) and **debounced** at 220 ms before hitting Postgres. All tables above (except the mailer plumbing) are on the `supabase_realtime` publication, so every browser sees every change over a single WebSocket.

Self-removal is blocked at the UI layer (the "remove member" control turns into a small "you" lock chip on your own row) and in the handler (defensive early return), so the signed-in user's row can never be dropped accidentally.

---

## Pipeline overview

The five stages mirror notebook sections one-for-one. See **PipelineGuide** in the app for the full prose breakdown.

1. **Data** · CDSE openEO pulls Sentinel-2 L2A scenes for the AOI, masks SCL classes 3 / 8 / 9 / 10 (cloud-shadow, mid + high cloud, cirrus), and aggregates a monthly median per band. Output: one GeoTIFF per month under `cache/s2_monthly/<aoi>/`.
2. **SR** · `opensr_model.SRLatentDiffusion` upsamples 10 m → 2.5 m on the 4-band RGB-NIR composite. 20 m bands are bilinearly upsampled afterwards (the SR model is not trained on them). Outputs: 4× super-resolved GeoTIFFs in `cache/s2_sr/<aoi>/`.
3. **GenAI** · Latent-space LoRA adapters fine-tune the opensr-ldsrs2 UNet per minority class on real SR patches. Training runs in the model's native latent space (VAE encode → DDPM noise → predict ε), so synthetic outputs are 4-band Sentinel-2 reflectance, not RGB. Per-class adapter is ~10 MB; ~200 synthetic patches are appended to the pixel table for §RF.
4. **Feat** · LDD landuse shapefile is rasterised onto the SR grid; per-pixel features = monthly band statistics + NDVI / NDWI / EVI + GLCM / LBP texture in a small window. Written to `pixel_table.parquet`.
5. **RF** · `sklearn.RandomForestClassifier` stage-1 + a minority-focused stage-2 cascade. Stage-2 catches pixels where stage-1 confidence < 0.6 or where stage-1 predicts a dominant class but the feature vector is close to a minority centroid.

§10 of the notebook exports `public/class-stats.json` (per-quadrant + per-S2-tile class shares + imbalance metrics). Commit the JSON to refresh the ClassInsights panel on the live site.

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
