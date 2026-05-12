"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase";
import type { Profile } from "./auth";
import type { AttachmentRow } from "./storage";
import { parseMentions } from "./mentions";

export type CommentRow = {
  id: string;
  task_id: string;
  author_id: string;
  body: string;
  mentions: string[];
  created_at: string;
  edited_at: string | null;
};

export type CommentWithAttachments = CommentRow & {
  attachments: AttachmentRow[];
};

export function useTaskComments(taskId: string | null) {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [attachments, setAttachments] = useState<Record<string, AttachmentRow[]>>({});
  const [loading, setLoading] = useState(false);

  // Fetch on task switch
  useEffect(() => {
    if (!taskId) {
      setComments([]); setAttachments({}); return;
    }
    const sb = getSupabase();
    if (!sb) return;
    let alive = true;
    setLoading(true);
    (async () => {
      const { data: cs } = await sb
        .from("comments")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at", { ascending: true });
      if (!alive) return;
      const list = (cs as CommentRow[]) ?? [];
      setComments(list);
      if (list.length > 0) {
        const { data: atts } = await sb
          .from("attachments")
          .select("*")
          .in("comment_id", list.map(c => c.id));
        if (!alive) return;
        const grouped: Record<string, AttachmentRow[]> = {};
        for (const a of (atts as AttachmentRow[]) ?? []) {
          (grouped[a.comment_id] ??= []).push(a);
        }
        setAttachments(grouped);
      } else {
        setAttachments({});
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [taskId]);

  // Realtime subscription for this task
  useEffect(() => {
    if (!taskId) return;
    const sb = getSupabase();
    if (!sb) return;
    const ch = sb.channel(`comments-${taskId}`)
      .on("postgres_changes",
          { event: "*", schema: "public", table: "comments", filter: `task_id=eq.${taskId}` },
          (payload) => {
            if (payload.eventType === "DELETE") {
              setComments(prev => prev.filter(c => c.id !== (payload.old as CommentRow).id));
            } else if (payload.eventType === "INSERT") {
              const row = payload.new as CommentRow;
              setComments(prev => prev.some(c => c.id === row.id) ? prev : [...prev, row]);
            } else {
              const row = payload.new as CommentRow;
              setComments(prev => prev.map(c => c.id === row.id ? row : c));
            }
          })
      .on("postgres_changes",
          { event: "*", schema: "public", table: "attachments" },
          (payload) => {
            if (payload.eventType === "INSERT") {
              const a = payload.new as AttachmentRow;
              setAttachments(prev => {
                if ((prev[a.comment_id] ?? []).some(x => x.id === a.id)) return prev;
                return { ...prev, [a.comment_id]: [...(prev[a.comment_id] ?? []), a] };
              });
            } else if (payload.eventType === "DELETE") {
              const a = payload.old as AttachmentRow;
              setAttachments(prev => ({
                ...prev,
                [a.comment_id]: (prev[a.comment_id] ?? []).filter(x => x.id !== a.id),
              }));
            }
          })
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [taskId]);

  const addComment = useCallback(async (body: string, profile: Profile, profiles: Profile[]): Promise<CommentRow | null> => {
    if (!taskId) return null;
    const sb = getSupabase();
    if (!sb) return null;
    const mentions = parseMentions(body, profiles).map(m => m.id);
    const { data, error } = await sb
      .from("comments")
      .insert({ task_id: taskId, author_id: profile.id, body, mentions })
      .select("*")
      .single();
    if (error || !data) {
      console.warn("addComment failed:", error?.message);
      return null;
    }
    // Subscribe author to this task so future replies notify them.
    await sb.from("task_subscribers").upsert({ task_id: taskId, user_id: profile.id });
    // Fire email notify (don't await — UI shouldn't block).
    sb.functions.invoke("send-mail", { body: { comment_id: data.id } })
      .catch(err => console.warn("send-mail invoke failed:", err?.message ?? err));
    return data as CommentRow;
  }, [taskId]);

  const editComment = useCallback(async (id: string, body: string, profiles: Profile[]) => {
    const sb = getSupabase();
    if (!sb) return;
    const mentions = parseMentions(body, profiles).map(m => m.id);
    await sb.from("comments")
      .update({ body, mentions, edited_at: new Date().toISOString() })
      .eq("id", id);
  }, []);

  const deleteComment = useCallback(async (id: string) => {
    const sb = getSupabase();
    if (!sb) return;
    await sb.from("comments").delete().eq("id", id);
  }, []);

  return { comments, attachments, loading, addComment, editComment, deleteComment };
}

// Standalone count fetch for badge on closed StageRow.
export function useTaskCommentCount(taskId: string): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let alive = true;
    (async () => {
      const { count } = await sb
        .from("comments")
        .select("id", { count: "exact", head: true })
        .eq("task_id", taskId);
      if (alive) setN(count ?? 0);
    })();
    const ch = sb.channel(`commentcount-${taskId}`)
      .on("postgres_changes",
          { event: "*", schema: "public", table: "comments", filter: `task_id=eq.${taskId}` },
          () => {
            sb.from("comments").select("id", { count: "exact", head: true }).eq("task_id", taskId)
              .then(({ count }) => { if (alive) setN(count ?? 0); });
          })
      .subscribe();
    return () => { alive = false; sb.removeChannel(ch); };
  }, [taskId]);
  return n;
}
