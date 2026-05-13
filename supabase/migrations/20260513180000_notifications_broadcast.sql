-- Allow `broadcast` as a notifications.kind value so admins can fan out a
-- team-wide announcement. The bell + history page render broadcasts with
-- their own visual treatment; this just relaxes the CHECK constraint.

alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('mention', 'reply', 'progress', 'broadcast'));
