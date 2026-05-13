// Notifications hook.
//
// Reads recent rows from `public.notifications` for the current user, then
// subscribes to inserts so the bell badge updates as new @mentions land. The
// `send-mail` Edge Function already inserts a row per recipient on every task
// comment or issue comment — we just consume them in the UI here.

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase";

export type NotificationKind = "mention" | "reply" | "progress" | "broadcast";

export type BroadcastTopic = "notebook" | "webapp" | "release" | "general";

export const BROADCAST_TOPICS: { id: BroadcastTopic; label: string; icon: string }[] = [
  { id: "notebook", label: "Notebook", icon: "📓" },
  { id: "webapp",   label: "Webapp",   icon: "💻" },
  { id: "release",  label: "Release",  icon: "🚀" },
  { id: "general",  label: "General",  icon: "📣" },
];

export function topicIcon(topic: string | undefined | null): string {
  const hit = BROADCAST_TOPICS.find(t => t.id === topic);
  return hit?.icon ?? "📣";
}

export type NotificationRow = {
  id: string;
  user_id: string;
  kind: NotificationKind;
  task_id: string | null;
  comment_id: string | null;
  issue_id: string | null;
  issue_comment_id: string | null;
  payload: {
    author_id?: string;
    author_name?: string;
    snippet?: string;
    issue_number?: number;
    issue_title?: string;
    [k: string]: unknown;
  };
  created_at: string;
  read_at: string | null;
  emailed_at: string | null;
};

const PAGE_SIZE = 50;

export function useNotifications(userId: string | undefined) {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Initial load.
  useEffect(() => {
    if (!userId) { setItems([]); setLoading(false); return; }
    let cancelled = false;
    const sb = getSupabase();
    if (!sb) { setLoading(false); return; }
    setLoading(true);
    sb.from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { console.warn("[notifications] load failed", error.message); setItems([]); }
        else setItems((data ?? []) as NotificationRow[]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [userId]);

  // Subscribe to new rows for this user. The `send-mail` function inserts
  // with the service-role key, which bypasses RLS — but the channel filter
  // here is a server-side filter on user_id so we only see our own rows.
  useEffect(() => {
    if (!userId) return;
    const sb = getSupabase();
    if (!sb) return;
    const ch = sb
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as NotificationRow;
          setItems(prev => {
            if (prev.some(p => p.id === row.id)) return prev;
            return [row, ...prev].slice(0, PAGE_SIZE);
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as NotificationRow;
          setItems(prev => prev.map(p => (p.id === row.id ? row : p)));
        },
      )
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [userId]);

  const markRead = useCallback(async (id: string) => {
    const sb = getSupabase();
    if (!sb) return;
    setItems(prev => prev.map(p => (p.id === id ? { ...p, read_at: p.read_at ?? new Date().toISOString() } : p)));
    await sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null);
  }, []);

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    const sb = getSupabase();
    if (!sb) return;
    const now = new Date().toISOString();
    setItems(prev => prev.map(p => (p.read_at ? p : { ...p, read_at: now })));
    await sb.from("notifications")
      .update({ read_at: now })
      .eq("user_id", userId)
      .is("read_at", null);
  }, [userId]);

  const unreadCount = items.reduce((n, p) => n + (p.read_at ? 0 : 1), 0);

  return { items, loading, unreadCount, markRead, markAllRead };
}

export function notificationHref(n: NotificationRow): string {
  // Broadcasts carry no link target — clicking just marks them read.
  if (n.kind === "broadcast") return "/notifications";
  // Issue comment: deep-link to the comment so the IssueDetail page scrolls
  // and highlights it on mount.
  if (n.issue_id && n.payload.issue_number) {
    const base = `/issues/${n.payload.issue_number}`;
    return n.issue_comment_id ? `${base}#c-${n.issue_comment_id}` : base;
  }
  // Whiteboard mention: no comments, just open the board.
  if (typeof n.payload.whiteboard_slug === "string" && n.payload.whiteboard_slug) {
    return "/board";
  }
  // Task comment: tasks have no dedicated route, but we pass the task id as
  // a query param (so the home board can auto-open that task's drawer) and
  // the comment id as a hash (so the browser + our scroll watcher land on
  // the right row inside the drawer once it renders).
  if (n.task_id) {
    return n.comment_id ? `/?task=${n.task_id}#c-${n.comment_id}` : `/?task=${n.task_id}`;
  }
  return "/";
}

// Fire one scroll-retry attempt: find #c-<id> in the DOM (retrying for a few
// seconds because comments load async), scroll it into view, and apply the
// spotlight class so the reader can see where they landed. Safe to call
// repeatedly; cancels nothing, just kicks off a fresh retry loop.
export function runScrollToHashComment(): void {
  if (typeof window === "undefined") return;
  let retries = 0;
  const MAX_RETRIES = 30;          // ~4.5 s window
  const INTERVAL_MS = 150;

  function tryScroll() {
    const m = window.location.hash.match(/^#c-(.+)$/);
    if (!m) return;
    const el = document.getElementById(`c-${m[1]}`);
    if (!el) {
      if (retries++ < MAX_RETRIES) setTimeout(tryScroll, INTERVAL_MS);
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("comment-spotlight");
    // Force reflow so the animation restarts even if the class is re-added
    // on a second click while still highlighted.
    void el.offsetWidth;
    el.classList.add("comment-spotlight");
    setTimeout(() => el.classList.remove("comment-spotlight"), 3000);
  }
  setTimeout(tryScroll, 80);
}

// Mount once per page that renders comments. Re-runs the scroll retry on
// every hashchange so clicking a second notification while still on the
// same page picks up the new target.
export function scrollToHashComment(): () => void {
  if (typeof window === "undefined") return () => undefined;
  runScrollToHashComment();
  function onHashChange() { runScrollToHashComment(); }
  window.addEventListener("hashchange", onHashChange);
  return () => window.removeEventListener("hashchange", onHashChange);
}

export function notificationSubject(n: NotificationRow): string {
  if (n.kind === "broadcast") {
    const topic = typeof n.payload.topic === "string" ? n.payload.topic : "general";
    const title = typeof n.payload.title === "string" && n.payload.title ? n.payload.title : "announcement";
    return `${topicIcon(topic)} ${title}`;
  }
  if (n.payload.issue_title) return `#${n.payload.issue_number} ${n.payload.issue_title}`;
  if (typeof n.payload.whiteboard_slug === "string" && n.payload.whiteboard_slug) {
    return `the whiteboard`;
  }
  return "a task";
}

export function verbFor(kind: NotificationKind): string {
  if (kind === "mention") return "mentioned you";
  if (kind === "reply") return "replied";
  if (kind === "broadcast") return "sent a broadcast";
  return "updated progress";
}

export function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
