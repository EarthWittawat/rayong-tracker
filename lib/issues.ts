"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "./supabase";
import type { Profile } from "./auth";
import { parseMentions } from "./mentions";

export type IssueStatus = "open" | "closed";

export type Issue = {
  id: string;
  number: number;
  title: string;
  body: string;
  status: IssueStatus;
  labels: string[];
  author_id: string;
  assignee_id: string | null;
  closed_at: string | null;
  closed_by: string | null;
  created_at: string;
  updated_at: string;
};

export type IssueComment = {
  id: string;
  issue_id: string;
  author_id: string;
  body: string;
  mentions: string[];
  created_at: string;
  edited_at: string | null;
};

export const LABEL_PALETTE: Record<string, string> = {
  bug:           "#C92A2A",
  enhancement:   "#0B7285",
  question:      "#5C7CFA",
  pipeline:      "#3F7D58",
  data:          "#1864AB",
  sr:            "#5F3DC4",
  genai:         "#9C36B5",
  rf:            "#B68A2E",
  webapp:        "#1098AD",
  docs:          "#495057",
  blocked:       "#E03131",
};

export const DEFAULT_LABELS: string[] = Object.keys(LABEL_PALETTE);

export function labelColor(name: string): string {
  return LABEL_PALETTE[name.toLowerCase()] ?? "#6B7280";
}

// ────────────────────────── list ──────────────────────────
// Realtime requirement: tables filtered on non-PK columns
// (issues by status / number, issue_comments by issue_id) need
// REPLICA IDENTITY FULL so UPDATE / DELETE events carry the filtered
// columns. See supabase/migrations/20260513140000_realtime_full_identity.sql.

export function useIssueList(filter: IssueStatus | "all" = "open") {
  const [items, setItems] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) { setLoading(false); return; }
    let alive = true;
    (async () => {
      setLoading(true);
      const q = sb.from("issues").select("*").order("number", { ascending: false });
      const { data } = filter === "all" ? await q : await q.eq("status", filter);
      if (!alive) return;
      setItems((data as Issue[]) ?? []);
      setLoading(false);
    })();
    const ch = sb.channel("issues-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "issues" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const oldId = (payload.old as Issue).id;
            setItems(prev => prev.filter(i => i.id !== oldId));
          } else {
            const row = payload.new as Issue;
            setItems(prev => {
              const matchesFilter = filter === "all" || row.status === filter;
              const idx = prev.findIndex(i => i.id === row.id);
              if (idx === -1) return matchesFilter ? [row, ...prev] : prev;
              if (!matchesFilter) return prev.filter(i => i.id !== row.id);
              const copy = prev.slice();
              copy[idx] = row;
              return copy;
            });
          }
        }).subscribe();
    return () => { alive = false; sb.removeChannel(ch); };
  }, [filter]);

  return { items, loading };
}

export function useIssueCounts() {
  const [counts, setCounts] = useState<{ open: number; closed: number }>({ open: 0, closed: 0 });
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let alive = true;
    async function refresh() {
      const [{ count: o }, { count: c }] = await Promise.all([
        sb!.from("issues").select("id", { count: "exact", head: true }).eq("status", "open"),
        sb!.from("issues").select("id", { count: "exact", head: true }).eq("status", "closed"),
      ]);
      if (alive) setCounts({ open: o ?? 0, closed: c ?? 0 });
    }
    refresh();
    const ch = sb.channel("issues-counts")
      .on("postgres_changes", { event: "*", schema: "public", table: "issues" }, () => { refresh(); })
      .subscribe();
    return () => { alive = false; sb.removeChannel(ch); };
  }, []);
  return counts;
}

export async function createIssue(input: {
  title: string;
  body: string;
  labels: string[];
  assignee_id: string | null;
  profile: Profile;
}): Promise<Issue | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.from("issues").insert({
    title: input.title.trim(),
    body: input.body,
    labels: input.labels,
    assignee_id: input.assignee_id,
    author_id: input.profile.id,
  }).select("*").single();
  if (error) { console.warn("createIssue failed:", error.message); return null; }
  return data as Issue;
}

export async function updateIssue(id: string, patch: Partial<Pick<Issue, "title" | "body" | "labels" | "assignee_id">>) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("issues").update(patch).eq("id", id);
}

export async function setIssueStatus(id: string, status: IssueStatus, profile: Profile) {
  const sb = getSupabase();
  if (!sb) return;
  if (status === "closed") {
    await sb.from("issues").update({ status, closed_at: new Date().toISOString(), closed_by: profile.id }).eq("id", id);
  } else {
    await sb.from("issues").update({ status, closed_at: null, closed_by: null }).eq("id", id);
  }
}

export async function deleteIssue(id: string) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("issues").delete().eq("id", id);
}

// ────────────────────────── single issue ──────────────────────────

export function useIssueByNumber(number: number | null) {
  const [issue, setIssue] = useState<Issue | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (number == null) { setIssue(null); setLoading(false); return; }
    const sb = getSupabase();
    if (!sb) { setLoading(false); return; }
    let alive = true;
    (async () => {
      setLoading(true);
      const { data } = await sb.from("issues").select("*").eq("number", number).maybeSingle();
      if (!alive) return;
      setIssue((data as Issue) ?? null);
      setLoading(false);
    })();
    const ch = sb.channel(`issue-${number}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "issues", filter: `number=eq.${number}` },
        (payload) => {
          if (payload.eventType === "DELETE") setIssue(null);
          else setIssue(payload.new as Issue);
        }).subscribe();
    return () => { alive = false; sb.removeChannel(ch); };
  }, [number]);

  return { issue, loading };
}

// ────────────────────────── comments ──────────────────────────

export function useIssueComments(issueId: string | null) {
  const [comments, setComments] = useState<IssueComment[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!issueId) { setComments([]); return; }
    const sb = getSupabase();
    if (!sb) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const { data } = await sb.from("issue_comments")
        .select("*")
        .eq("issue_id", issueId)
        .order("created_at", { ascending: true });
      if (!alive) return;
      setComments((data as IssueComment[]) ?? []);
      setLoading(false);
    })();
    const ch = sb.channel(`issue-comments-${issueId}`)
      .on("postgres_changes",
          { event: "*", schema: "public", table: "issue_comments", filter: `issue_id=eq.${issueId}` },
          (payload) => {
            if (payload.eventType === "DELETE") {
              setComments(prev => prev.filter(c => c.id !== (payload.old as IssueComment).id));
            } else if (payload.eventType === "INSERT") {
              const row = payload.new as IssueComment;
              setComments(prev => prev.some(c => c.id === row.id) ? prev : [...prev, row]);
            } else {
              const row = payload.new as IssueComment;
              setComments(prev => prev.map(c => c.id === row.id ? row : c));
            }
          })
      .subscribe();
    return () => { alive = false; sb.removeChannel(ch); };
  }, [issueId]);

  const addComment = useCallback(async (body: string, profile: Profile, profiles: Profile[]) => {
    if (!issueId) return null;
    const sb = getSupabase();
    if (!sb) return null;
    const mentions = parseMentions(body, profiles).map(m => m.id);
    const { data, error } = await sb.from("issue_comments")
      .insert({ issue_id: issueId, author_id: profile.id, body, mentions })
      .select("*").single();
    if (error) { console.warn("issue addComment failed:", error.message); return null; }
    return data as IssueComment;
  }, [issueId]);

  const editComment = useCallback(async (id: string, body: string, profiles: Profile[]) => {
    const sb = getSupabase();
    if (!sb) return;
    const mentions = parseMentions(body, profiles).map(m => m.id);
    await sb.from("issue_comments").update({ body, mentions, edited_at: new Date().toISOString() }).eq("id", id);
  }, []);

  const deleteComment = useCallback(async (id: string) => {
    const sb = getSupabase();
    if (!sb) return;
    await sb.from("issue_comments").delete().eq("id", id);
  }, []);

  return { comments, loading, addComment, editComment, deleteComment };
}

export function useIssueCommentCount(issueId: string): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let alive = true;
    async function refresh() {
      const { count } = await sb!.from("issue_comments")
        .select("id", { count: "exact", head: true })
        .eq("issue_id", issueId);
      if (alive) setN(count ?? 0);
    }
    refresh();
    const ch = sb.channel(`issue-cc-${issueId}`)
      .on("postgres_changes",
          { event: "*", schema: "public", table: "issue_comments", filter: `issue_id=eq.${issueId}` },
          () => { refresh(); })
      .subscribe();
    return () => { alive = false; sb.removeChannel(ch); };
  }, [issueId]);
  return n;
}

// ────────────────────────── helpers ──────────────────────────

export function useProfileMap(profiles: Profile[]) {
  return useMemo(() => {
    const m = new Map<string, Profile>();
    for (const p of profiles) m.set(p.id, p);
    return m;
  }, [profiles]);
}

// Lightweight index: {number, title, status} for every issue, kept in
// realtime sync. Used by MentionInput's #picker dropdown.
export type IssueLite = { number: number; title: string; status: IssueStatus };

export function useIssueIndex(): IssueLite[] {
  const [items, setItems] = useState<IssueLite[]>([]);
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) {
      console.warn("[useIssueIndex] Supabase client unavailable — #picker will be empty");
      return;
    }
    let alive = true;
    async function refresh() {
      const { data, error } = await sb!
        .from("issues")
        .select("number,title,status")
        .order("number", { ascending: false });
      if (!alive) return;
      if (error) {
        console.warn("[useIssueIndex] fetch failed:", error.message,
          "— did you apply supabase/migrations/20260513120000_issues.sql?");
        setItems([]);
        return;
      }
      setItems((data as IssueLite[]) ?? []);
    }
    refresh();
    const ch = sb.channel("issues-index")
      .on("postgres_changes", { event: "*", schema: "public", table: "issues" }, () => { refresh(); })
      .subscribe();
    return () => { alive = false; sb.removeChannel(ch); };
  }, []);
  return items;
}
