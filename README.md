# Rayong Crop Tracker

A small, fast, live-syncing progress tracker for a 5-person Sentinel-2 → SR → GenAI → Features → RF pipeline over Rayong province.

- **Stack:** Next.js 14 (App Router) + Tailwind + Supabase (Postgres + Realtime).
- **Deploy:** Vercel (free Hobby tier) + Supabase (free tier).
- **Auth model:** anyone with the link can edit. Real-time syncs across all browsers.
- **Demo mode:** if no Supabase env vars are set, it falls back to localStorage so anyone can preview without a backend.
- **Collab board:** picks a per-browser identity (name + color + emoji, kept in localStorage), shows who's online via Supabase Realtime Presence, attributes edits with a live "X editing" chip on each row, and keeps a rolling activity feed (last 30 events, in-memory broadcast).

---

## 10-minute deploy

### 1 · Supabase (≈3 min)

1. Create a free project at <https://supabase.com>.
2. Open **SQL Editor**, paste the contents of `supabase/schema.sql`, and run. This creates `members`, `tasks`, **and** `profiles` tables plus RLS policies.
3. Open **Project Settings → API** and copy:
   - **Project URL** → this is `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public key** → this is `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 2 · Google OAuth (≈4 min)

The board is gated behind Google sign-in so each teammate's profile (display name, color, avatar) is remembered across devices.

1. Go to **Google Cloud Console → APIs & Services → Credentials → Create Credentials → OAuth client ID**. App type: *Web application*. 
2. Add an **Authorized redirect URI**:
   - `https://<your-supabase-project>.supabase.co/auth/v1/callback`
   - You can find the exact value in your Supabase project under **Authentication → Providers → Google**.
3. Copy the **Client ID** and **Client secret** Google generates.
4. In Supabase: **Authentication → Providers → Google** → toggle **Enable** → paste Client ID + Secret → save.
5. In Supabase: **Authentication → URL Configuration** → set **Site URL** to your Vercel URL (e.g. `https://your-app.vercel.app`). Add `http://localhost:3000` to **Additional redirect URLs** if you'll dev locally.

### 3 · Email + attachments (≈4 min)

Comment notifications, daily digest, and file uploads share three pieces of infrastructure.

**a. Storage bucket** — `supabase/schema.sql` creates the `attachments` bucket and its RLS policies automatically. If you ran the SQL it's already there. Confirm in **Storage → attachments** that the bucket is **private** and shows the three policies (`storage read` / `storage write` / `storage delete`).

**b. Resend (transactional email)** — free tier 3 000 emails / month.

1. Sign up at <https://resend.com>, verify a sender domain (or use `onboarding@resend.dev` for testing).
2. Create an API key. Copy the value starting with `re_…`.
3. In Supabase **Project Settings → Edge Functions → Secrets**, set:
   - `RESEND_API_KEY` = your Resend key
   - `MAIL_FROM`      = `"Rayong Tracker <board@yourdomain.com>"` (or `onboarding@resend.dev`)
   - `APP_URL`        = your Vercel URL (used in email links)
4. Deploy the Edge Function:

   ```bash
   supabase functions deploy send-mail
   ```

   The client invokes it automatically after each comment insert.

**c. Daily digest cron** — a Vercel Cron pings `/api/cron/digest` once a day (`vercel.json` is preconfigured for `0 1 * * *` UTC).

1. Set the same `RESEND_API_KEY`, `MAIL_FROM`, `APP_URL` on Vercel (Project → Settings → Environment Variables).
2. Also set `SUPABASE_SERVICE_ROLE_KEY` (Vercel only — never expose in the bundle) and `CRON_SECRET` (any long random string). Vercel sends the `CRON_SECRET` automatically as `Authorization: Bearer …` for cron invocations.
3. Re-deploy. You can hit the endpoint manually with `curl 'https://<app>/api/cron/digest?secret=<CRON_SECRET>'` to test.

### 4 · GitHub + Vercel (≈5 min)

1. Push this folder to a new GitHub repo.
2. Go to <https://vercel.com>, click **Add new → Project**, import the repo.
3. In the import screen, add the two environment variables from step 1.3.
4. Click **Deploy**. Wait ~60 s. Vercel gives you a `your-app.vercel.app` URL.
5. Open the Vercel URL → click **Continue with Google** → first-time users pick a color + emoji, then they're in.

### 5 · Share

Send the Vercel URL to teammates. Anyone with a Google account can sign in and edit (open-link mode). Each profile persists in the `profiles` table keyed by Google `auth.uid()`, so signing in from another browser/device just restores everything.

---

## Local development

```bash
cp .env.local.example .env.local      # fill in your Supabase keys
npm install
npm run dev                           # http://localhost:3000
```

---

## File map

```
app/
  layout.tsx                  root layout (loads Tailwind globals)
  page.tsx                    main page composition + auth gate
  globals.css                 Tailwind base + scrollbar + ring + mention pill
  api/cron/digest/route.ts    Vercel Cron endpoint — daily digest mailer
components/
  LoginGate.tsx               "Continue with Google" screen
  IdentityModal.tsx           first-time + edit-profile modal + notif prefs
  PresenceBar.tsx             online avatar stack (Google pictures)
  ActivityFeed.tsx            rolling activity panel (in-memory broadcast)
  CommentThread.tsx           threaded comments + attach drawer per task
  MentionInput.tsx            textarea with @-autocomplete from profiles
  AttachmentPreview.tsx       inline chip + modal preview (image/PDF/text/audio/video)
  OverviewStrip.tsx           top totals card
  RayongMap.tsx               SVG outline + quadrant fills
  MemberCard.tsx              per-person collapsible card
  StageRow.tsx                editable counter + comment drawer + live-edit chip
lib/
  supabase.ts                 client + stage/member type definitions
  auth.ts                     useSession() + useAllProfiles()
  identity.ts                 compatibility shim (re-exports from auth.ts)
  rayong.ts                   LDD-derived outline of Rayong + quadrant geometry
  progress.ts                 weighted + stage-average percent helpers
  useStore.ts                 live data hook + presence + activity broadcast
  comments.ts                 useTaskComments() + useTaskCommentCount()
  storage.ts                  upload/download + signed URLs for attachments
  mentions.ts                 @mention parse + autocomplete trigger
supabase/
  schema.sql                  tables, RLS, realtime, storage bucket, prefs
  functions/send-mail/        Edge Function — fan-out mention + reply email
notebooks/
  pipeline.ipynb              end-to-end ML pipeline (data → SR → GenAI → feat → RF)
vercel.json                   cron schedule for the digest mailer
```

---

## Province outline source

`lib/rayong.ts` ships the LDD `ขอบเขตการปกครอง / ระยอง_Pro.shp` mainland polygon, reprojected from UTM 47N (WGS84) to lng/lat and Douglas-Peucker simplified to ~160 vertices. Offshore islands are omitted to keep the bundle small.

To swap in a different boundary (e.g., updated LDD year):

1. In QGIS, dissolve all features to a single polygon and reproject to EPSG:4326. Simplify (Vector → Geometry Tools → Simplify, tolerance ~0.003°) so the SVG renders fast.
2. Replace the `RAYONG_OUTLINE` constant, then refresh `RAYONG_BBOX` and `RAYONG_CENTER` (centroid is preferable to bbox midpoint — it anchors the quadrant split to the polygon body).

---

## How the data model works

- **`members`** — one row per teammate. `quadrant` is `NW | NE | SW | SE | ALL`. The 5th member typically gets `ALL` (cross-cutting role, e.g., generative-aug owner).
- **`tasks`** — one row per (member, stage). 5 members × 5 stages = 25 rows. Each row has `done` and `total` (tile counts) plus an optional `note`. `done / total` drives every percentage on the page.

Edits are **optimistic** (UI updates immediately) and **debounced** (220 ms) before hitting Supabase, so rapid +/- clicking won't flood the database.

---

## Performance notes

- Static page is ~30 KB gzipped JS + a single inline SVG (no map-tile fetch).
- Supabase Realtime is one WebSocket; no polling.
- First contentful paint < 200 ms from Vercel's edge in Asia-Pacific.
- Server components are not used because the whole page is interactive — but the bundle stays small (Next 14 tree-shakes hard, Tailwind purges aggressively).

---

## Auth & security model

This board ships with **Google sign-in (open)**: anyone with a Google account can sign in and edit. The Vercel URL alone is not enough — you need to authenticate first, so a leaked URL doesn't immediately leak the data.

Trade-offs (open Google mode):

- Anyone who finds the URL **and** has a Google account can read, edit, or delete every row. RLS still uses `using (true) with check (true)` on `members` / `tasks` — the gate is "must be signed in", not "must be on a list".
- `profiles` rows are write-locked to their own `auth.uid()`, so nobody can rewrite someone else's display name or color.
- Identity in presence and activity is the Google name + avatar URL (proxied through `profiles`). Spoofing requires creating a Google account with that exact display name.

To tighten further:

1. **Email allowlist** — create `public.allowed_users(email text primary key)`, then change the policies on `members` and `tasks` from `using (true)` to `using (auth.email() in (select email from public.allowed_users))`. Seed the table with your 5 teammate emails. Strangers' Google accounts can authenticate but can't read or write a thing.
2. **Single-domain gate** — `using (auth.email() like '%@yourdomain.com')`.
3. **Anonymous sign-in fallback** — call `supabase.auth.signInAnonymously()` from `LoginGate` to let visitors browse without Google; useful if you ever want a read-only public view.

Realtime continues to work in all of the above because Supabase Realtime respects the RLS policy of the table it broadcasts.

## Why this stack, briefly

- **Vercel + Next.js:** zero-config deploys, free Hobby tier, edge-cached static. Native fit.
- **Supabase:** free Postgres with built-in Realtime over WebSockets. Far easier than Firebase for relational data. Generous free tier (500 MB DB, 2 GB bandwidth/mo) — more than enough for 5 people clicking buttons.
- **Tailwind:** keeps the bundle small and the styling consistent without a UI library.
- **No map library:** an inline SVG of the outline is ~1 KB; Leaflet/Mapbox would add 100+ KB and slow first paint for no gain at province scale.
