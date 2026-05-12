-- =========================================================
-- Add issue refs to notifications so the send-mail Edge Function can
-- log issue-comment mentions / replies alongside the existing
-- task-comment ones.
-- =========================================================

alter table public.notifications
  add column if not exists issue_id          uuid references public.issues(id)          on delete cascade,
  add column if not exists issue_comment_id  uuid references public.issue_comments(id)  on delete cascade;

create index if not exists idx_notifications_issue on public.notifications(issue_id)
  where issue_id is not null;
