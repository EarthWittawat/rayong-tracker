-- Add `notifications` to the realtime publication so the in-app bell can
-- subscribe to INSERT / UPDATE events for the signed-in user. Without this,
-- the channel filter `user_id=eq.<uid>` returns nothing and new mentions
-- only appear after a page reload.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end $$;
