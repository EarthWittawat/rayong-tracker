-- Restrict deleting a board member row (and kicking from the system) to
-- admins. Splits the old "members write member" omnibus policy into
-- explicit insert / update / delete so DELETE can be gated independently.

drop policy if exists "members write member" on public.members;
create policy "members insert member"
  on public.members
  for insert
  with check (public.is_member());
create policy "members update member"
  on public.members
  for update
  using (public.is_member())
  with check (public.is_member());
create policy "members delete admin"
  on public.members
  for delete
  using (public.is_admin_self());

-- SECURITY DEFINER kick: admin removes a user's row from dashboard_members
-- so they lose access to the rest of the app on next session refresh.
-- Cannot self-kick; non-admins get a hard 'not authorised' raise.
create or replace function public.kick_member(p_user_id uuid)
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
  if p_user_id = auth.uid() then
    raise exception 'cannot kick yourself';
  end if;
  delete from public.dashboard_members where user_id = p_user_id;
  return true;
end;
$$;
grant execute on function public.kick_member(uuid) to authenticated;
