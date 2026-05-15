-- =========================================================
-- Rayong Crop Tracker · multi-assignee issues
-- Replace the scalar issues.assignee_id with a join table so
-- an issue can have N assignees (or zero = team-wide).
-- =========================================================

create table if not exists public.issue_assignees (
  issue_id    uuid not null references public.issues(id)   on delete cascade,
  assignee_id uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (issue_id, assignee_id)
);

create index if not exists idx_issue_assignees_issue    on public.issue_assignees(issue_id);
create index if not exists idx_issue_assignees_assignee on public.issue_assignees(assignee_id);

-- Backfill the existing single-assignee rows.
insert into public.issue_assignees (issue_id, assignee_id)
  select id, assignee_id from public.issues
  where assignee_id is not null
  on conflict do nothing;

-- Drop the scalar column so the join table is the only source of truth.
alter table public.issues drop column if exists assignee_id;

-- Realtime publication so the client can subscribe to membership changes.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'issue_assignees'
  ) then
    execute 'alter publication supabase_realtime add table public.issue_assignees';
  end if;
end$$;

-- REPLICA IDENTITY FULL so DELETE events carry the assignee_id needed
-- for the per-issue filter on the client.
alter table public.issue_assignees replica identity full;

-- RLS: anyone signed-in can read, insert, delete. Mirrors issues_update
-- policy -- any team member can re-assign any issue, not just the author.
alter table public.issue_assignees enable row level security;

drop policy if exists ia_read   on public.issue_assignees;
drop policy if exists ia_insert on public.issue_assignees;
drop policy if exists ia_delete on public.issue_assignees;

create policy ia_read   on public.issue_assignees for select using (true);
create policy ia_insert on public.issue_assignees for insert with check (auth.uid() is not null);
create policy ia_delete on public.issue_assignees for delete using  (auth.uid() is not null);
