-- =========================================================
-- Realtime: REPLICA IDENTITY FULL on tables filtered by a non-PK column.
--
-- Supabase Realtime forwards postgres_changes events whose row matches
-- the subscriber's `filter`. With REPLICA IDENTITY DEFAULT, the
-- `payload.old` on UPDATE / DELETE only carries the primary key, so any
-- filter on another column (`task_id`, `comment_id`, `issue_id`,
-- `status`, `number`) fails to match → the event is silently dropped →
-- the React subscription never sees the change → the UI stays stale.
--
-- FULL replica identity logs every column for UPDATE / DELETE events,
-- so the filter engine can match against the old values too. Cost: a
-- little extra WAL volume per write, negligible at this app's scale.
--
-- Symptom this fixes: closing an issue, deleting a comment, removing a
-- subtask, etc. didn't propagate to other clients until they refreshed.
-- =========================================================

alter table public.subtasks       replica identity full;
alter table public.comments       replica identity full;
alter table public.attachments    replica identity full;
alter table public.issue_comments replica identity full;
alter table public.issues         replica identity full;
