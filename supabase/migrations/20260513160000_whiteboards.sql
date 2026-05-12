-- =========================================================
-- Whiteboards · shared Excalidraw scenes.
-- One row per board; signed-in users can read + write any board.
-- =========================================================

create table if not exists public.whiteboards (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  name         text not null default 'Untitled board',
  elements     jsonb not null default '[]'::jsonb,
  app_state    jsonb not null default '{}'::jsonb,
  files        jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_whiteboards_updated on public.whiteboards(updated_at desc);

-- Seed the default 'main' board so /board has something to render
-- before anyone has drawn on it.
insert into public.whiteboards (slug, name)
values ('main', 'Main board')
on conflict (slug) do nothing;

-- updated_at bump.
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists trg_whiteboards_updated on public.whiteboards;
create trigger trg_whiteboards_updated before update on public.whiteboards
  for each row execute procedure public.touch_updated_at();

-- Realtime + filtered subscriptions need full old row.
alter table public.whiteboards replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname='supabase_realtime' and schemaname='public' and tablename='whiteboards'
  ) then
    execute 'alter publication supabase_realtime add table public.whiteboards';
  end if;
end$$;

alter table public.whiteboards enable row level security;
drop policy if exists wb_read   on public.whiteboards;
drop policy if exists wb_insert on public.whiteboards;
drop policy if exists wb_update on public.whiteboards;
drop policy if exists wb_delete on public.whiteboards;

create policy wb_read   on public.whiteboards for select using (auth.uid() is not null);
create policy wb_insert on public.whiteboards for insert
  with check (auth.uid() is not null);
create policy wb_update on public.whiteboards for update
  using  (auth.uid() is not null)
  with check (auth.uid() is not null);
create policy wb_delete on public.whiteboards for delete
  using (auth.uid() is not null);
