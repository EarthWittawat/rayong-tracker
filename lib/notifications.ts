// Notifications hook.
//
// Reads recent rows from `public.notifications` for the current user, then
// subscribes to inserts so the bell badge updates as new @mentions land. The
// `send-mail` Edge Function already inserts a row per recipient on every task
// comment or issue comment — we just consume them in the UI here.

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase";

export type NotificationKind = "mention" | "reply" | "progress";

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
  if (n.issue_id && n.payload.issue_number) {
    return `/issues/${n.payload.issue_number}`;
  }
  // Tasks have no dedicated route; the comment lives on the home board.
  return "/";
}

export function verbFor(kind: NotificationKind): string {
  if (kind === "mention") return "mentioned you";
  if (kind === "reply") return "replied";
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
