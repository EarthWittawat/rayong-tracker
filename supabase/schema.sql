-- =========================================================
-- Rayong Crop Tracker · Supabase schema
-- Paste this entire file into the Supabase SQL editor and run.
-- =========================================================

-- ===== tables =====
create table if not exists public.members (
  id          text primary key,
  name        text not null,
  quadrant    text not null check (quadrant in ('NW','NE','SW','SE','ALL')),
  color       text not null default '#C96442',
  emoji       text not null default '🌾',
  created_at  timestamptz not null default now()
);

create table if not exists public.tasks (
  id          text primary key,
  member_id   text not null references public.members(id) on delete cascade,
  stage       text not null check (stage in ('data','sr','gen','feat','rf')),
  done        int  not null default 0,
  total       int  not null default 0,
  note        text,
  updated_at  timestamptz not null default now()
);

create index if not exists idx_tasks_member on public.tasks(member_id);
create index if not exists idx_tasks_stage  on public.tasks(stage);

-- ===== row-level security =====
-- Open edit policy: anyone with the anon key (i.e., anyone who loads the site)
-- can read/write. This matches the "anyone with the link can edit" choice.
-- If you ever want to lock it down, replace these with authenticated policies.

alter table public.members enable row level security;
alter table public.tasks   enable row level security;

drop policy if exists "open read members"  on public.members;
drop policy if exists "open write members" on public.members;
drop policy if exists "open read tasks"    on public.tasks;
drop policy if exists "open write tasks"   on public.tasks;

create policy "open read members"  on public.members for select using (true);
create policy "open write members" on public.members for all    using (true) with check (true);
create policy "open read tasks"    on public.tasks   for select using (true);
create policy "open write tasks"   on public.tasks   for all    using (true) with check (true);

-- ===== profiles =====
-- One row per Google-authenticated user. Stores display preferences and Google avatar URL.
-- Created on first sign-in by the client (upsert from useSession), keyed by auth.uid().

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  color       text not null default '#C96442',
  emoji       text not null default '🌾',
  avatar_url  text,
  email       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles read all"  on public.profiles;
drop policy if exists "profiles write own" on public.profiles;

create policy "profiles read all"  on public.profiles for select using (true);
create policy "profiles write own" on public.profiles for all
  using  (auth.uid() = id)
  with check (auth.uid() = id);

-- ===== email preference columns on profiles =====
alter table public.profiles add column if not exists notify_mentions  bool not null default true;
alter table public.profiles add column if not exists notify_replies   bool not null default true;
alter table public.profiles add column if not exists notify_digest    bool not null default false;
alter table public.profiles add column if not exists last_digest_at   timestamptz;

-- ===== comments =====
-- Threaded comments per task. Comment author is auth.uid() of the writer.

create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     text not null references public.tasks(id) on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  body        text not null,
  mentions    uuid[] not null default '{}',  -- profile.id of @mentioned users
  created_at  timestamptz not null default now(),
  edited_at   timestamptz
);

create index if not exists idx_comments_task    on public.comments(task_id);
create index if not exists idx_comments_author  on public.comments(author_id);

alter table public.comments enable row level security;
drop policy if exists "comments read all"   on public.comments;
drop policy if exists "comments write own"  on public.comments;
drop policy if exists "comments insert own" on public.comments;
drop policy if exists "comments update own" on public.comments;
drop policy if exists "comments delete own" on public.comments;

create policy "comments read all"    on public.comments for select using (true);
create policy "comments insert own"  on public.comments for insert with check (auth.uid() = author_id);
create policy "comments update own"  on public.comments for update using (auth.uid() = author_id) with check (auth.uid() = author_id);
create policy "comments delete own"  on public.comments for delete using (auth.uid() = author_id);

-- ===== attachments =====
-- Files attached to comments. Lives in Storage bucket `attachments`, path = "<task_id>/<comment_id>/<filename>".

create table if not exists public.attachments (
  id            uuid primary key default gen_random_uuid(),
  comment_id    uuid not null references public.comments(id) on delete cascade,
  uploader_id   uuid not null references public.profiles(id) on delete cascade,
  filename      text not null,
  mime          text not null,
  size_bytes    int  not null,
  storage_path  text not null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_attachments_comment on public.attachments(comment_id);

alter table public.attachments enable row level security;
drop policy if exists "attachments read all"   on public.attachments;
drop policy if exists "attachments insert own" on public.attachments;
drop policy if exists "attachments delete own" on public.attachments;

create policy "attachments read all"   on public.attachments for select using (true);
create policy "attachments insert own" on public.attachments for insert with check (auth.uid() = uploader_id);
create policy "attachments delete own" on public.attachments for delete using (auth.uid() = uploader_id);

-- ===== task subscriptions =====
-- Anyone who comments on a task becomes a subscriber (managed client-side via upsert).
-- New comments fan out emails to subscribers (excluding the commenter).

create table if not exists public.task_subscribers (
  task_id    text not null references public.tasks(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

alter table public.task_subscribers enable row level security;
drop policy if exists "subs read all"   on public.task_subscribers;
drop policy if exists "subs write own"  on public.task_subscribers;

create policy "subs read all"   on public.task_subscribers for select using (true);
create policy "subs write own"  on public.task_subscribers for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ===== notifications log =====
-- Server-side record of "user X has pending notification Y". Drives the daily digest.
-- Mark `emailed_at` when a delivery succeeds.

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  kind         text not null check (kind in ('mention','reply','progress')),
  task_id      text references public.tasks(id) on delete cascade,
  comment_id   uuid references public.comments(id) on delete cascade,
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  emailed_at   timestamptz
);

create index if not exists idx_notifications_user_unread on public.notifications(user_id) where emailed_at is null;

alter table public.notifications enable row level security;
drop policy if exists "notif read own"    on public.notifications;
drop policy if exists "notif insert all"  on public.notifications;
drop policy if exists "notif update own"  on public.notifications;

-- A user can read their own notifications. Inserts are allowed for any
-- authenticated user (client posts notifications addressed *to* someone else
-- on a mention). Update is restricted to the owner (used to mark read).
create policy "notif read own"    on public.notifications for select using (auth.uid() = user_id);
create policy "notif insert all"  on public.notifications for insert with check (auth.uid() is not null);
create policy "notif update own"  on public.notifications for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ===== storage bucket for attachments =====
-- Run once in the SQL editor *or* create the bucket in the dashboard.
-- The bucket is private; reads go through signed URLs minted by the client.

insert into storage.buckets (id, name, public)
  values ('attachments', 'attachments', false)
  on conflict (id) do nothing;

-- Storage RLS: any signed-in user can read; uploader (auth.uid()) can write/delete their own files.
drop policy if exists "attachments storage read"   on storage.objects;
drop policy if exists "attachments storage write"  on storage.objects;
drop policy if exists "attachments storage delete" on storage.objects;

create policy "attachments storage read" on storage.objects
  for select using (bucket_id = 'attachments' and auth.role() = 'authenticated');

create policy "attachments storage write" on storage.objects
  for insert with check (
    bucket_id = 'attachments' and auth.uid() is not null
  );

create policy "attachments storage delete" on storage.objects
  for delete using (
    bucket_id = 'attachments' and owner = auth.uid()
  );

-- ===== subtasks =====
-- Lightweight checklist items attached to a (member, stage) task. Anyone
-- signed in can add and tick subtasks (Trello-style collaboration); only the
-- author can delete their own subtask.

create table if not exists public.subtasks (
  id            uuid primary key default gen_random_uuid(),
  task_id       text not null references public.tasks(id) on delete cascade,
  author_id     uuid not null references public.profiles(id) on delete cascade,
  title         text not null check (length(title) > 0 and length(title) <= 200),
  done          bool not null default false,
  position      int  not null default 0,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  completed_by  uuid references public.profiles(id) on delete set null
);

create index if not exists idx_subtasks_task on public.subtasks(task_id);

alter table public.subtasks enable row level security;

drop policy if exists "subtasks read all"     on public.subtasks;
drop policy if exists "subtasks insert auth"  on public.subtasks;
drop policy if exists "subtasks update auth"  on public.subtasks;
drop policy if exists "subtasks delete own"   on public.subtasks;

create policy "subtasks read all"    on public.subtasks for select using (true);
create policy "subtasks insert auth" on public.subtasks for insert with check (auth.uid() = author_id);
create policy "subtasks update auth" on public.subtasks for update using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "subtasks delete own"  on public.subtasks for delete using (auth.uid() = author_id);

-- ===== realtime publication =====
-- Make sure tables broadcast changes via Supabase Realtime.
alter publication supabase_realtime add table public.members;
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.comments;
alter publication supabase_realtime add table public.attachments;
alter publication supabase_realtime add table public.subtasks;
