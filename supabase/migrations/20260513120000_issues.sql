-- =========================================================
-- Rayong Crop Tracker · Issues feature
-- GitHub-style issues + comments. Open to any authenticated profile.
-- =========================================================

-- ===== issues =====
create table if not exists public.issues (
  id          uuid primary key default gen_random_uuid(),
  number      bigserial unique not null,
  title       text not null check (char_length(title) between 1 and 200),
  body        text not null default '',
  status      text not null default 'open' check (status in ('open','closed')),
  labels      text[] not null default '{}',
  author_id   uuid not null references public.profiles(id) on delete restrict,
  assignee_id uuid references public.profiles(id) on delete set null,
  closed_at   timestamptz,
  closed_by   uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_issues_status  on public.issues(status);
create index if not exists idx_issues_created on public.issues(created_at desc);
create index if not exists idx_issues_author  on public.issues(author_id);

-- ===== issue_comments =====
create table if not exists public.issue_comments (
  id         uuid primary key default gen_random_uuid(),
  issue_id   uuid not null references public.issues(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete restrict,
  body       text not null,
  mentions   uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  edited_at  timestamptz
);

create index if not exists idx_issue_comments_issue on public.issue_comments(issue_id, created_at);

-- ===== updated_at trigger =====
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_issues_updated on public.issues;
create trigger trg_issues_updated before update on public.issues
  for each row execute procedure public.touch_updated_at();

-- ===== realtime =====
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'issues'
  ) then
    execute 'alter publication supabase_realtime add table public.issues';
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'issue_comments'
  ) then
    execute 'alter publication supabase_realtime add table public.issue_comments';
  end if;
end$$;

-- ===== RLS =====
alter table public.issues          enable row level security;
alter table public.issue_comments  enable row level security;

drop policy if exists issues_read   on public.issues;
drop policy if exists issues_insert on public.issues;
drop policy if exists issues_update on public.issues;
drop policy if exists issues_delete on public.issues;

create policy issues_read   on public.issues for select using (true);
create policy issues_insert on public.issues for insert
  with check (auth.uid() = author_id);
-- Any signed-in user can update issues (close/reopen, edit labels, edit body
-- only if they're the author — enforced in the client). Adjust if you want
-- author-only edits.
create policy issues_update on public.issues for update
  using (auth.uid() is not null) with check (auth.uid() is not null);
create policy issues_delete on public.issues for delete
  using (auth.uid() = author_id);

drop policy if exists ic_read   on public.issue_comments;
drop policy if exists ic_insert on public.issue_comments;
drop policy if exists ic_update on public.issue_comments;
drop policy if exists ic_delete on public.issue_comments;

create policy ic_read   on public.issue_comments for select using (true);
create policy ic_insert on public.issue_comments for insert
  with check (auth.uid() = author_id);
create policy ic_update on public.issue_comments for update
  using (auth.uid() = author_id) with check (auth.uid() = author_id);
create policy ic_delete on public.issue_comments for delete
  using (auth.uid() = author_id);
