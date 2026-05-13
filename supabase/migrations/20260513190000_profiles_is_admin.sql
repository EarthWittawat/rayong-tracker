-- Move admin gating from a NEXT_PUBLIC_ADMIN_EMAILS env var to a column on
-- public.profiles so flipping admin status no longer requires a redeploy.
-- Writes to is_admin go through promote_user() (SECURITY DEFINER) which
-- only existing admins can call; direct UPDATEs of is_admin are revoked
-- from anon + authenticated so a logged-in user cannot self-promote.

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

create index if not exists idx_profiles_is_admin
  on public.profiles(is_admin)
  where is_admin = true;

-- Block the column from being set via normal profile UPDATEs.
revoke update (is_admin) on public.profiles from anon, authenticated;

-- SECURITY DEFINER so the existing admin's own auth.uid() context is checked
-- inside the function, not against the caller's RLS row.
create or replace function public.promote_user(p_user_id uuid, p_value boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_admin boolean;
begin
  select is_admin into v_caller_admin from public.profiles where id = auth.uid();
  if not coalesce(v_caller_admin, false) then
    raise exception 'not authorised: caller is not an admin';
  end if;
  update public.profiles set is_admin = p_value where id = p_user_id;
  return true;
end;
$$;

grant execute on function public.promote_user(uuid, boolean) to authenticated;

-- Quick read helper for the client: lets the bell / quick-broadcast button
-- ask "am I an admin?" without pulling the full profile.
create or replace function public.is_admin_self() returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;
grant execute on function public.is_admin_self() to authenticated;
