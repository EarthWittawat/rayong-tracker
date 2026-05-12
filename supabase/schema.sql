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

-- (Open policies replaced below by an email-allowlist gate. See the
-- 'allowed_users + is_allowed()' section near the end of this file.)
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

-- ============================================================================
-- ===== access control =====
-- Invite-code gate. Anyone with a Google account can authenticate, but the
-- board is hidden behind a member roster. Existing members generate
-- single-use (or N-use) invite codes; a visitor pastes the code on the
-- access-pending screen and gets added to `dashboard_members`.
-- ============================================================================

-- Tear down the old email-allowlist machinery if it was created earlier.
drop policy if exists "allowed read auth"        on public.allowed_users;
drop policy if exists "allowed insert allowed"   on public.allowed_users;
drop policy if exists "allowed delete allowed"   on public.allowed_users;
drop function if exists public.is_allowed();
drop table if exists public.allowed_users;

-- Roster of users who have access to the board. Only written via the
-- redeem_invite RPC (SECURITY DEFINER) so an unprivileged client can't
-- insert themselves directly.
create table if not exists public.dashboard_members (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  joined_via  uuid,
  joined_at   timestamptz not null default now(),
  note        text
);

create table if not exists public.invite_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  max_uses    int  not null default 1,
  uses        int  not null default 0,
  revoked     bool not null default false,
  note        text
);
create index if not exists idx_invite_codes_creator on public.invite_codes(created_by);

alter table public.dashboard_members enable row level security;
alter table public.invite_codes      enable row level security;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.dashboard_members where user_id = auth.uid());
$$;
grant execute on function public.is_member() to anon, authenticated;

-- Single entry point for joining. SECURITY DEFINER so an authenticated but
-- non-member user can write to dashboard_members + invite_codes (bypassing
-- their own row-level policies) — but only via the controlled validation
-- logic below.
create or replace function public.redeem_invite(p_code text)
returns table(ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_code public.invite_codes%rowtype;
  v_now  timestamptz := now();
begin
  if v_uid is null then
    return query select false, 'Not signed in.'; return;
  end if;
  if exists (select 1 from public.dashboard_members where user_id = v_uid) then
    return query select true, 'Already a member.'; return;
  end if;

  select * into v_code from public.invite_codes where lower(code) = lower(trim(p_code));
  if not found then
    return query select false, 'Invite code not found.'; return;
  end if;
  if v_code.revoked then
    return query select false, 'Invite code revoked.'; return;
  end if;
  if v_code.expires_at is not null and v_code.expires_at < v_now then
    return query select false, 'Invite code expired.'; return;
  end if;
  if v_code.uses >= v_code.max_uses then
    return query select false, 'Invite code already used.'; return;
  end if;

  insert into public.dashboard_members (user_id, joined_via) values (v_uid, v_code.id);
  update public.invite_codes set uses = uses + 1 where id = v_code.id;
  return query select true, 'Welcome to the dashboard.';
end;
$$;
grant execute on function public.redeem_invite(text) to authenticated;

-- dashboard_members: any signed-in user can see who has access (cheap
-- transparency); writes only happen through the RPC above.
drop policy if exists "members read auth"     on public.dashboard_members;
drop policy if exists "members no direct ins" on public.dashboard_members;
drop policy if exists "members no direct upd" on public.dashboard_members;
drop policy if exists "members no direct del" on public.dashboard_members;
create policy "members read auth" on public.dashboard_members for select using (auth.uid() is not null);
-- intentionally no insert/update/delete policies → RPC is the only path.

-- invite_codes: existing members can list them; only the creator can
-- modify or revoke their own; only members can create new codes.
drop policy if exists "invite read member"   on public.invite_codes;
drop policy if exists "invite insert member" on public.invite_codes;
drop policy if exists "invite update owner"  on public.invite_codes;
drop policy if exists "invite delete owner"  on public.invite_codes;
create policy "invite read member"   on public.invite_codes for select using (public.is_member());
create policy "invite insert member" on public.invite_codes for insert with check (public.is_member() and created_by = auth.uid());
create policy "invite update owner"  on public.invite_codes for update using (public.is_member() and created_by = auth.uid())
                                                            with check (public.is_member() and created_by = auth.uid());
create policy "invite delete owner"  on public.invite_codes for delete using (public.is_member() and created_by = auth.uid());

-- ----- gate the data tables on is_member() ---------------------------------
drop policy if exists "open read members"     on public.members;
drop policy if exists "open write members"    on public.members;
drop policy if exists "members read allowed"  on public.members;
drop policy if exists "members write allowed" on public.members;
drop policy if exists "open read tasks"       on public.tasks;
drop policy if exists "open write tasks"      on public.tasks;
drop policy if exists "tasks read allowed"    on public.tasks;
drop policy if exists "tasks write allowed"   on public.tasks;
drop policy if exists "profiles read all"     on public.profiles;
drop policy if exists "profiles read allowed" on public.profiles;
drop policy if exists "comments read all"     on public.comments;
drop policy if exists "comments read allowed" on public.comments;
drop policy if exists "subtasks read all"     on public.subtasks;
drop policy if exists "subtasks read allowed" on public.subtasks;
drop policy if exists "attachments read all"  on public.attachments;
drop policy if exists "attachments read allowed" on public.attachments;
drop policy if exists "subs read all"         on public.task_subscribers;
drop policy if exists "subs read allowed"     on public.task_subscribers;

create policy "members read member"  on public.members for select using (public.is_member());
create policy "members write member" on public.members for all using (public.is_member()) with check (public.is_member());

create policy "tasks read member"  on public.tasks for select using (public.is_member());
create policy "tasks write member" on public.tasks for all using (public.is_member()) with check (public.is_member());

-- Self-profile stays readable so first-time sign-in can ensureProfile + the
-- access-gate screen can still load the user's own display info.
create policy "profiles read self_or_member" on public.profiles
  for select using (auth.uid() = id or public.is_member());

create policy "comments read member"    on public.comments    for select using (public.is_member());
create policy "subtasks read member"    on public.subtasks    for select using (public.is_member());
create policy "attachments read member" on public.attachments for select using (public.is_member());
create policy "subs read member"        on public.task_subscribers for select using (public.is_member());

-- Bootstrap: after signing in once, add yourself to the roster so you can
-- generate invite codes for everyone else. Run ONCE in the Supabase SQL
-- editor (replace the email or pass the user_id directly):
--
--   insert into public.dashboard_members (user_id, note)
--   select id, 'bootstrap admin' from auth.users
--   where email = 'YOUR_EMAIL_HERE'
--   on conflict (user_id) do nothing;

-- ===== realtime publication =====
-- `alter publication add table` has no IF NOT EXISTS, so wrap each addition
-- in a conditional do-block. Lets the migration be re-applied safely on a
-- project that already has some of these tables in supabase_realtime.
do $$
declare
  t text;
begin
  foreach t in array array['members','tasks','profiles','comments','attachments','subtasks'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename  = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
