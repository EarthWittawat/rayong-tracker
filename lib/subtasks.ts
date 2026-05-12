"use client";

import { useEffect, useState, useCallback } from "react";
import { getSupabase, isLive } from "./supabase";

export type Subtask = {
  id: string;
  task_id: string;
  author_id: string;
  title: string;
  done: boolean;
  position: number;
  created_at: string;
  completed_at: string | null;
  completed_by: string | null;
};

export function useSubtasks(taskId: string, currentUserId: string | null) {
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !isLive()) { setSubtasks([]); setLoading(false); return; }

    let alive = true;
    setLoading(true);
    sb.from("subtasks")
      .select("*")
      .eq("task_id", taskId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (!alive) return;
        setSubtasks((data as Subtask[]) ?? []);
        setLoading(false);
      });

    const ch = sb.channel(`subtasks-${taskId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "subtasks", filter: `task_id=eq.${taskId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setSubtasks(prev => {
              const next = payload.new as Subtask;
              if (prev.some(s => s.id === next.id)) return prev;
              return [...prev, next];
            });
          } else if (payload.eventType === "UPDATE") {
            const next = payload.new as Subtask;
            setSubtasks(prev => prev.map(s => s.id === next.id ? next : s));
          } else if (payload.eventType === "DELETE") {
            const oldId = (payload.old as Subtask).id;
            setSubtasks(prev => prev.filter(s => s.id !== oldId));
          }
        })
      .subscribe();

    return () => { alive = false; sb.removeChannel(ch); };
  }, [taskId]);

  const addSubtask = useCallback(async (title: string) => {
    const sb = getSupabase();
    if (!sb || !currentUserId) return;
    const trimmed = title.trim();
    if (!trimmed) return;
    const position = subtasks.length > 0 ? Math.max(...subtasks.map(s => s.position)) + 1 : 0;
    const { data, error } = await sb
      .from("subtasks")
      .insert({ task_id: taskId, author_id: currentUserId, title: trimmed.slice(0, 200), position })
      .select("*")
      .single();
    if (!error && data) {
      setSubtasks(prev => prev.some(s => s.id === (data as Subtask).id) ? prev : [...prev, data as Subtask]);
    }
  }, [taskId, subtasks, currentUserId]);

  const toggleSubtask = useCallback(async (id: string, done: boolean) => {
    const sb = getSupabase();
    if (!sb) return;
    const patch = done
      ? { done: true, completed_at: new Date().toISOString(), completed_by: currentUserId ?? null }
      : { done: false, completed_at: null, completed_by: null };
    setSubtasks(prev => prev.map(s => s.id === id ? { ...s, ...patch } as Subtask : s));
    await sb.from("subtasks").update(patch).eq("id", id);
  }, [currentUserId]);

  const removeSubtask = useCallback(async (id: string) => {
    const sb = getSupabase();
    if (!sb) return;
    setSubtasks(prev => prev.filter(s => s.id !== id));
    await sb.from("subtasks").delete().eq("id", id);
  }, []);

  const renameSubtask = useCallback(async (id: string, title: string) => {
    const sb = getSupabase();
    if (!sb) return;
    const trimmed = title.trim();
    if (!trimmed) return;
    setSubtasks(prev => prev.map(s => s.id === id ? { ...s, title: trimmed } : s));
    await sb.from("subtasks").update({ title: trimmed.slice(0, 200) }).eq("id", id);
  }, []);

  return { subtasks, loading, addSubtask, toggleSubtask, removeSubtask, renameSubtask };
}
