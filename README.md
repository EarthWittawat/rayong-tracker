# Rayong Crop Tracker

Real-time collaboration board for a five-person Earth Observation team building a Sentinel-2 → super-resolution → generative augmentation → feature engineering → Random Forest crop-classification pipeline over Rayong province, Thailand.

The web app is the *operations side* of the project. The Jupyter notebook in `notebooks/pipeline.ipynb` is the *engineering side*. Both share the same five-stage taxonomy:

| Stage  | What it does                                                                 |
| ------ | ---------------------------------------------------------------------------- |
| Data   | CDSE OpenEO · Sentinel-2 L2A monthly medians with SCL cloud masking          |
| SR     | OpenSR latent-diffusion super-resolution, 10 m → 2.5 m on B02/B03/B04/B08    |
| GenAI  | LoRA-adapted SEN2SR + DiffusionSat for minority-class synthesis              |
| Feat   | LDD landuse rasterised on the SR grid, temporal stats + indices + GLCM/LBP   |
| RF     | Per-pixel Random Forest cascade (stage-1 + minority-focused stage-2)         |

---

## Highlights

- **Kanban board** — five Trello-style columns (one per pipeline stage), one card per (member, stage) task. Cards expand inline for `+ / −` controls, quick-pick increments, status pills, and comment counts.
- **Detailed member list view** — alternate "list" mode with the full StageRow editor, comments thread, file attachments, and per-stage notes.
- **Live presence + activity feed** — Supabase Realtime presence channel shows who is online, plus a rolling 30-event broadcast feed of edits / renames / additions / removals across the team.
- **Satellite map of the AOI** — Leaflet + Esri World Imagery, with a draw-rectangle tool that exports a GeoJSON / Python-ready bbox, a click-to-read lat/lng + MGRS panel, and an optional Sentinel-2 100 km MGRS tile overlay. The four Rayong quadrants are clickable to focus the corresponding crew member.
- **Class-distribution insights** — reads `public/class-stats.json` (produced by §10 of the notebook) and renders per-quadrant + per-S2-tile class shares, Shannon entropy, Gini, and a minority-class flag so the team can spot training-set imbalance at a glance.
- **Pipeline guide** — a stepper that explains each of the five stages: what happens, why it matters, what "done" means, inputs / outputs, and links to the upstream tooling.
- **Live team telemetry footer** — online-now count, 24-hour and 7-day edit counts, completion percentage, top contributor of the last 24 hours, and the lagging stage with current leader.
- **Subtasks per task** — Trello-style checklists; anyone can tick, only the author can delete.
- **Comments + @mentions + attachments** — threaded comments with email fan-out (Resend) and Supabase Storage attachments.
- **Daily digest cron** — Vercel Cron pings an internal endpoint once a day to mail pending notifications.
- **Light + dark themes** — CSS-variable palette, NASA-inspired navigation slab + red mission stripe.

---

## Stack

| Layer       | Choice                                                                  |
| ----------- | ----------------------------------------------------------------------- |
| Frontend    | Next.js 14 App Router · React 18 · TypeScript · Tailwind 3              |
| Map         | Leaflet · leaflet-draw · `mgrs` for tile / coord conversion             |
| Backend     | Supabase (Postgres 15 + Realtime + Auth + Storage + Edge Functions)     |
| Email       | Resend (free tier · 3 000 mail/month)                                   |
| Hosting     | Vercel (Hobby) + Vercel Cron for the daily digest                       |
| Auth        | Google OAuth via Supabase                                               |
| Notebook    | Conda env (`notebooks/environment.yml`) · Python 3.12 · PyTorch CUDA    |

---

## Repository layout

```
app/
  layout.tsx                  root layout, Leaflet CSS, dark-mode init script
  page.tsx                    main board composition + auth gate
  globals.css                 token palette + nav slab + Leaflet overrides
  api/cron/digest/route.ts    Vercel Cron endpoint — daily digest mailer
components/
  LoginGate.tsx               starfield Google sign-in hero
  IdentityModal.tsx           first-time + edit-profile modal + notif prefs
  PresenceBar.tsx             online avatar stack
  ActivityFeed.tsx            rolling activity panel (in-memory broadcast)
  OverviewStrip.tsx           overall + per-stage progress strip
  PipelineGuide.tsx           five-step explainer with linked-out citations
  RayongMap.tsx               dynamic wrapper around MapClient (SSR-safe)
  MapClient.tsx               Leaflet satellite map + draw + readout
  ClassInsights.tsx           per-area class distribution + imbalance metrics
  MemberCard.tsx              per-person collapsible card (list view)
  StageRow.tsx                stage editor with subtasks + comments drawer
  BoardView.tsx               Kanban board view + BoardCard
  SubtasksList.tsx            user-owned checklist on each task
  CommentThread.tsx           threaded comments + attachment drawer
  MentionInput.tsx            textarea with @-autocomplete from profiles
  AttachmentPreview.tsx       inline chip + modal preview (image/PDF/audio/video)
  ThemeToggle.tsx             light / dark switcher (persisted in localStorage)
lib/
  supabase.ts                 client factory + stage / member types
  auth.ts                     useSession() + useAllProfiles() + realtime.setAuth
  useStore.ts                 board state hook + presence + activity broadcast
  rayong.ts                   LDD-derived outline + quadrant geometry
  progress.ts                 weighted + stage-average percent helpers
  comments.ts                 useTaskComments() + count hook
  subtasks.ts                 useSubtasks() hook with realtime sync
  classStats.ts               type defs + fetcher for public/class-stats.json
  relativeTime.ts             "5m ago" formatter
  storage.ts                  signed URLs + uploads for attachments
  mentions.ts                 @mention parser + autocomplete trigger
supabase/
  schema.sql                  tables, RLS, realtime, storage, prefs
  migrations/                 (created on first `supabase db push`)
  functions/send-mail/        Edge Function — fan-out mention + reply email
notebooks/
  pipeline.ipynb              end-to-end ML pipeline
  _build_notebook.py          deterministic notebook builder
  environment.yml             conda env spec (Python 3.12 + CUDA 12.1)
  README.md                   notebook-specific run instructions
public/
  leaflet-draw/images/        bundled draw-toolbar sprite assets
  class-stats.json            (optional) snapshot for ClassInsights
vercel.json                   cron schedule for the digest mailer
```

---

## Architecture in one diagram

```
                ┌─────────────────────────────────────────┐
                │            Vercel (Next.js)             │
                │  ─────────────────────────────────────  │
                │   Static board UI · Edge SSR            │
                │   /api/cron/digest  ← Vercel Cron       │
                └────────────┬─────────────┬──────────────┘
                             │             │
                  WebSocket  │             │  REST + JWT
                             ▼             ▼
                ┌─────────────────────────────────────────┐
                │              Supabase                   │
                │  ─────────────────────────────────────  │
                │  Postgres        Realtime    Auth       │
                │  (RLS on every   (presence + (Google     │
                │   table)         postgres_   OAuth)     │
                │                  changes)               │
                │                                         │
                │  Storage (signed-URL attachments)        │
                │  Edge Function: send-mail (Resend)       │
                └─────────────────────────────────────────┘
                             ▲
                             │  pipeline.ipynb writes
                             │  public/class-stats.json
                             │  and (optionally) Supabase
                             │  rows via the REST endpoint.
                ┌─────────────────────────────────────────┐
                │   Python notebook · Conda env           │
                │  Sentinel-2 L2A → SR → GenAI → RF       │
                └─────────────────────────────────────────┘
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
task_subscribers, notifications  : digest mailer plumbing
```

All edits are **optimistic** locally (UI updates immediately) and **debounced** at 220 ms before hitting Postgres. Subscriptions: `members`, `tasks`, `profiles`, `comments`, `attachments`, `subtasks` are all on the `supabase_realtime` publication, so every browser sees every change without polling.

Self-removal is blocked at the UI layer (the "remove member" button is replaced by a small "you" lock chip on your own row) and in the handler (defensive early return) so the signed-in user's row can never be dropped accidentally.

---

## Pipeline overview

The five stages mirror notebook sections one-for-one. See **PipelineGuide** in the app for the full prose breakdown.

1. **Data** · CDSE openEO pulls Sentinel-2 L2A scenes for the AOI, masks SCL classes 3 / 8 / 9 / 10 (cloud-shadow, mid + high cloud, cirrus), and aggregates a monthly median per band. Output: one GeoTIFF per month under `cache/s2_monthly/<aoi>/`.
2. **SR** · `opensr_model.SRLatentDiffusion` upsamples 10 m → 2.5 m on the 4-band RGB-NIR composite. 20 m bands are bilinearly upsampled afterwards (the SR model is not trained on them). Outputs: 4× super-resolved GeoTIFFs in `cache/s2_sr/<aoi>/`.
3. **GenAI** · LoRA adapters fine-tune the SR diffusion UNet per minority class on real SR patches; DiffusionSat is run zero-shot for comparison. FID against held-out real samples is the sanity check.
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

Required env vars (web):

| Variable                         | Where to get it                                                |
| -------------------------------- | -------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`       | Supabase · Project Settings → API → Project URL                |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | Supabase · Project Settings → API → anon public key            |

Without these the app degrades to localStorage-only mode, useful for previewing the UI without a backend.

---

## Deploy in 10 minutes

### 1 · Supabase project

1. Create a free project at <https://supabase.com>.
2. Open **SQL Editor**, paste the contents of `supabase/schema.sql`, and run. Idempotent — re-runnable after schema changes.

   Or via the CLI:

   ```bash
   $ts = Get-Date -Format "yyyyMMddHHmmss"          # PowerShell
   New-Item -ItemType Directory -Force supabase\migrations | Out-Null
   Copy-Item supabase\schema.sql "supabase\migrations\${ts}_init.sql"
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
3. Copy the **Project URL** and **anon public key** from Project Settings → API. These become `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

### 2 · Google OAuth

1. **Google Cloud Console → APIs & Services → Credentials → Create Credentials → OAuth client ID**. App type: *Web application*.
2. Add an **Authorized redirect URI**:
   ```
   https://<your-supabase-project>.supabase.co/auth/v1/callback
   ```
3. Copy the **Client ID** and **Client secret**.
4. In Supabase: **Authentication → Providers → Google** → enable → paste credentials → save.
5. In Supabase: **Authentication → URL Configuration** → set **Site URL** to your Vercel URL and add `http://localhost:3000` to **Additional redirect URLs** for local dev.

### 3 · Email + attachments

1. **Resend** — sign up at <https://resend.com>, verify a sender domain (or use `onboarding@resend.dev` for testing). Create an API key starting with `re_…`.
2. In Supabase **Project Settings → Edge Functions → Secrets**, set:
   - `RESEND_API_KEY`
   - `MAIL_FROM` — `"Rayong Tracker <board@yourdomain.com>"`
   - `APP_URL` — your Vercel URL
3. Deploy the Edge Function:
   ```bash
   npx supabase functions deploy send-mail
   ```

The `attachments` Storage bucket is created by `schema.sql`; confirm in **Storage → attachments** that it is private and has the three policies attached.

### 4 · Vercel hosting

1. Push the repo to GitHub.
2. On <https://vercel.com>, **Add new → Project** and import the repo.
3. Set Project → Settings → Environment Variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only — never exposed in the bundle)
   - `RESEND_API_KEY`, `MAIL_FROM`, `APP_URL`
   - `CRON_SECRET` (any long random string — Vercel sends it back as `Authorization: Bearer …` on cron invocations)
4. **Deploy**. The first build takes about a minute.

### 5 · Daily digest cron

`vercel.json` ships with `0 1 * * *` UTC pointing at `/api/cron/digest`. The endpoint requires `CRON_SECRET`; Vercel attaches it automatically. To smoke-test:

```bash
curl "https://<your-app>/api/cron/digest?secret=<CRON_SECRET>"
```

---

## Auth & security

The board is gated behind Google sign-in via Supabase Auth.

- **Open mode (default)** · any Google account can sign in, then read / edit / delete board state. Row-level security on `members` / `tasks` is `using (true) with check (true)` (signed-in only); `profiles` is write-locked to `auth.uid()` so nobody can rewrite somebody else's display name.
- **Email allowlist** · create `public.allowed_users(email text primary key)` and change the policies on `members` / `tasks` to `using (auth.email() in (select email from public.allowed_users))`. Strangers can authenticate but cannot read anything.
- **Domain gate** · `using (auth.email() like '%@yourdomain.com')` for an org-wide board.

Supabase Realtime respects the same RLS policies — if a row is hidden by RLS, the realtime channel will not broadcast it either.

Self-removal is also blocked at two layers: the UI hides the "remove member" button on your own row and `handleRemove` returns early when the target id equals `session.profile.id`.

---

## Notebook

Set up the conda environment:

```bash
cd notebooks
conda env create -f environment.yml
conda activate rayong-tracker
python -m ipykernel install --user --name rayong-tracker --display-name "Python (rayong-tracker)"
```

The env pins Python 3.12 (required by `opensr-model`), `numpy<2` (until the geospatial wheels finish their numpy 2 ABI work), and `torch==2.3.1+cu121` (cu118 / cpu variants documented in the file).

Run cells top-to-bottom. The heavy stages (Data fetch, SR per month, RF training) cache to disk under `CFG.cache_root` and short-circuit on subsequent runs, so a kernel restart re-hydrates `S2`, `SR`, and `lu` in seconds. See the "Kernel-restart cheatsheet" at the top of the notebook for the minimum cell sequence.

When the LDD landuse `lu` GeoDataFrame is loaded, run §10 to export `public/class-stats.json` — commit the JSON to refresh the ClassInsights panel on the deployed site.

---

## Performance notes

- First Load JS sits around **130 KB gzipped** for the entire board. Map + draw control are loaded dynamically only when the board view mounts (`ssr: false`).
- Supabase Realtime uses a single WebSocket; no polling on any view.
- All optimistic local updates are de-duplicated by id before going to Postgres, and writes are batched at 220 ms per row, so rapid `+ / −` clicking never floods the database.
- Vercel edge caches static chunks aggressively — typical first contentful paint < 200 ms from APAC.

---

## Troubleshooting

| Symptom                                              | Fix                                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| "Online now" stuck at 0                              | hard refresh; `useSession` now calls `realtime.setAuth()` after sign-in           |
| Friend can sign in but doesn't appear in presence    | enable Realtime authorization policies on `realtime.messages` (see below)        |
| Map toolbar buttons show no icons                    | redeploy — sprite assets live in `public/leaflet-draw/images/`                   |
| Map clicks not registering                           | the Rayong outline + S2 tile markers are `interactive: false`; verify a redeploy |
| `relation "members" is already member of publication` while running schema.sql | already handled in the latest schema (idempotent `DO` block)                     |
| `OSError: [WinError 127] … shm.dll / fbgemm.dll`    | install the latest Visual C++ Redistributable + reboot; pin torch 2.3.1 + cu121  |
| `numpy 1.x cannot be run in NumPy 2.x`               | `pip install "numpy<2"` (already pinned in environment.yml)                      |
| `regex._regex` circular-import error                 | `pip install --force-reinstall --no-cache-dir regex`                             |

Example Realtime authorization policy:

```sql
create policy "board_presence read"
  on "realtime"."messages"
  for select
  to authenticated
  using (realtime.topic() = 'board-presence');

create policy "board_presence write"
  on "realtime"."messages"
  for insert
  to authenticated
  with check (realtime.topic() = 'board-presence');
```

---

## Why this stack

- **Next.js 14 + Vercel** — zero-config deploys, edge-cached static, free Hobby tier. The whole board is a single client-side composition; SSR is used only for the API cron route.
- **Supabase** — Postgres with Realtime over WebSockets out of the box, generous free tier (500 MB DB, 2 GB egress/month). Far less ceremony than rolling our own Realtime layer on top of a separate database.
- **Tailwind + CSS-variable palette** — keeps the bundle small, enables an instant light / dark switch with the same component tree.
- **Leaflet + Esri imagery** — light footprint (≈40 KB gzipped) and no API key required. Adequate for province-scale work, leaves room to swap in MapTiler vector tiles later if needed.
- **Conda for the notebook side** — geospatial wheels on Windows are still a minefield outside conda-forge; the env file pins the whole chain (GDAL → rasterio → geopandas → torch + cu121) deterministically.

---

## License

Internal research project. Treat shapefile + imagery attributions accordingly:

- Sentinel-2 imagery © European Union, Copernicus Sentinel data.
- Esri World Imagery — © Esri, Maxar, Earthstar Geographics, USDA, USGS, AeroGRID, IGN, and the GIS user community.
- LDD landuse — Thai Land Development Department (กรมพัฒนาที่ดิน).
