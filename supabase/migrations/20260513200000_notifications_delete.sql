-- Allow users to delete their own notification rows. Without this, the
-- only way for a recipient to clean up the bell list is to mark items
-- read; long-running accounts accumulate junk indefinitely.

drop policy if exists "notif delete own" on public.notifications;
create policy "notif delete own"
  on public.notifications
  for delete
  using (auth.uid() = user_id);
