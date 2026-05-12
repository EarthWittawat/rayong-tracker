"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { getSupabase, isLive, type Member, type Task, type StageKey, STAGES } from "./supabase";
import type { Identity } from "./identity";

const LS_KEY = "rayong-tracker-v1";

const DEFAULT_MEMBERS: Member[] = [
  { id: "m_je",     name: "Je",     quadrant: "NW",  color: "#C96442", emoji: "🌾" },
  { id: "m_alice",  name: "Alice",  quadrant: "NE",  color: "#3F6E97", emoji: "🛰️" },
  { id: "m_bob",    name: "Bob",    quadrant: "SW",  color: "#3F7D58", emoji: "🌱" },
  { id: "m_carol",  name: "Carol",  quadrant: "SE",  color: "#B68A2E", emoji: "🌳" },
  { id: "m_dan",    name: "Dan",    quadrant: "ALL", color: "#7B5BA6", emoji: "✨" },
];

function defaultTasks(members: Member[]): Task[] {
  const out: Task[] = [];
  for (const m of members) {
    for (const s of STAGES) {
      out.push({
        id: `t_${m.id}_${s.key}`,
        member_id: m.id,
        stage: s.key,
        done: 0,
        total: m.quadrant === "ALL" ? 100 : 120,
        note: null,
      });
    }
  }
  return out;
}

function loadLS(): { members: Member[]; tasks: Task[] } {
  if (typeof window === "undefined") return { members: DEFAULT_MEMBERS, tasks: defaultTasks(DEFAULT_MEMBERS) };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.members?.length && parsed.tasks?.length) return parsed;
    }
  } catch {}
  return { members: DEFAULT_MEMBERS, tasks: defaultTasks(DEFAULT_MEMBERS) };
}

function saveLS(state: { members: Member[]; tasks: Task[] }) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch {}
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex(x => x.id === item.id);
  if (i === -1) return [...list, item];
  const copy = list.slice();
  copy[i] = item;
  return copy;
}

export type SaveState = "idle" | "saving" | "saved" | "error";

export type PresenceUser = {
  id: string;
  name: string;
  color: string;
  emoji: string;
  avatar_url?: string | null;
  joinedAt: number;
};

export type ActivityEvent = {
  id: string;
  ts: number;
  user: { id: string; name: string; color: string; emoji: string; avatar_url?: string | null };
  kind: "task" | "rename" | "add" | "remove";
  taskId?: string;
  memberId?: string;
  memberName?: string;
  stage?: string;
  from?: number;
  to?: number;
  detail?: string;
};

const FEED_MAX = 30;

export function useStore(identity: Identity | null) {
  const [members, setMembers] = useState<Member[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [ready, setReady] = useState(false);
  const [live, setLive] = useState(false);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  // taskId → { user, expiresAt }. Live "X editing" hints.
  const [editing, setEditing] = useState<Record<string, { user: ActivityEvent["user"]; expiresAt: number }>>({});

  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const savedTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const broadcastChanRef = useRef<ReturnType<NonNullable<ReturnType<typeof getSupabase>>["channel"]> | null>(null);

  function markSave(id: string, state: SaveState) {
    setSaveStates(prev => ({ ...prev, [id]: state }));
    clearTimeout(savedTimerRef.current[id]);
    if (state === "saved") {
      savedTimerRef.current[id] = setTimeout(() => {
        setSaveStates(prev => {
          if (prev[id] !== "saved") return prev;
          const { [id]: _, ...rest } = prev;
          return rest;
        });
      }, 1200);
    }
  }

  function pushActivity(ev: ActivityEvent) {
    setActivity(prev => [ev, ...prev].slice(0, FEED_MAX));
    if (ev.taskId) {
      setEditing(prev => ({ ...prev, [ev.taskId!]: { user: ev.user, expiresAt: Date.now() + 2200 } }));
    }
  }

  // expire editing hints
  useEffect(() => {
    const i = setInterval(() => {
      setEditing(prev => {
        const now = Date.now();
        let changed = false;
        const next: typeof prev = {};
        for (const k of Object.keys(prev)) {
          if (prev[k].expiresAt > now) next[k] = prev[k];
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 500);
    return () => clearInterval(i);
  }, []);

  // initial load + realtime data subscriptions
  useEffect(() => {
    let mounted = true;

    async function init() {
      const sb = getSupabase();
      if (sb && isLive()) {
        const [{ data: m }, { data: t }] = await Promise.all([
          sb.from("members").select("*").order("created_at", { ascending: true }),
          sb.from("tasks").select("*"),
        ]);
        if (!mounted) return;
        if (m && m.length > 0) {
          setMembers(m as Member[]);
          setTasks((t as Task[]) || []);
        } else {
          await sb.from("members").insert(DEFAULT_MEMBERS);
          await sb.from("tasks").insert(defaultTasks(DEFAULT_MEMBERS));
          setMembers(DEFAULT_MEMBERS);
          setTasks(defaultTasks(DEFAULT_MEMBERS));
        }
        setLive(true);
        setReady(true);

        const ch1 = sb.channel("members-rt")
          .on("postgres_changes", { event: "*", schema: "public", table: "members" },
            (payload) => {
              if (payload.eventType === "DELETE") {
                const oldId = (payload.old as Member).id;
                setMembers(prev => prev.filter(x => x.id !== oldId));
              } else {
                setMembers(prev => upsertById(prev, payload.new as Member));
              }
            })
          .subscribe();
        const ch2 = sb.channel("tasks-rt")
          .on("postgres_changes", { event: "*", schema: "public", table: "tasks" },
            (payload) => {
              if (payload.eventType === "DELETE") {
                const oldId = (payload.old as Task).id;
                setTasks(prev => prev.filter(x => x.id !== oldId));
              } else {
                setTasks(prev => upsertById(prev, payload.new as Task));
              }
            })
          .subscribe();
        return () => { sb.removeChannel(ch1); sb.removeChannel(ch2); };
      } else {
        const s = loadLS();
        setMembers(s.members);
        setTasks(s.tasks);
        setLive(false);
        setReady(true);
      }
    }
    init();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!ready || live) return;
    saveLS({ members, tasks });
  }, [members, tasks, ready, live]);

  // presence + broadcast channel (depends on identity)
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !live || !identity) {
      broadcastChanRef.current = null;
      return;
    }
    const chan = sb.channel("board-presence", {
      config: {
        presence: { key: identity.id },
        broadcast: { self: false },
      },
    });

    chan
      .on("presence", { event: "sync" }, () => {
        const state = chan.presenceState() as Record<string, Array<{ name: string; color: string; emoji: string; avatar_url?: string | null; joinedAt: number }>>;
        const list: PresenceUser[] = [];
        for (const [id, metas] of Object.entries(state)) {
          const meta = metas[0];
          if (!meta) continue;
          list.push({ id, name: meta.name, color: meta.color, emoji: meta.emoji, avatar_url: meta.avatar_url ?? null, joinedAt: meta.joinedAt });
        }
        list.sort((a, b) => a.joinedAt - b.joinedAt);
        setPresence(list);
      })
      .on("broadcast", { event: "activity" }, ({ payload }: { payload: ActivityEvent }) => {
        // Ignore echoes from self (broadcast.self: false should already handle, but be defensive).
        if (payload.user.id === identity.id) return;
        pushActivity(payload);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await chan.track({
            name: identity.name,
            color: identity.color,
            emoji: identity.emoji,
            avatar_url: (identity as { avatar_url?: string | null }).avatar_url ?? null,
            joinedAt: Date.now(),
          });
        }
      });

    broadcastChanRef.current = chan;
    return () => {
      chan.untrack();
      sb.removeChannel(chan);
      broadcastChanRef.current = null;
    };
  }, [live, identity?.id, identity?.name, identity?.color, identity?.emoji]);

  function emitActivity(partial: Omit<ActivityEvent, "id" | "ts" | "user">) {
    if (!identity) return;
    const ev: ActivityEvent = {
      id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ts: Date.now(),
      user: {
        id: identity.id,
        name: identity.name,
        color: identity.color,
        emoji: identity.emoji,
        avatar_url: (identity as { avatar_url?: string | null }).avatar_url ?? null,
      },
      ...partial,
    };
    pushActivity(ev); // include in own feed locally
    const chan = broadcastChanRef.current;
    if (chan) chan.send({ type: "broadcast", event: "activity", payload: ev });
  }

  const updateTask = useCallback((id: string, patch: Partial<Task>) => {
    let before: Task | undefined;
    setTasks(prev => {
      before = prev.find(t => t.id === id);
      return prev.map(t => t.id === id ? { ...t, ...patch } : t);
    });
    if (live) {
      markSave(id, "saving");
      clearTimeout(debounceRef.current[id]);
      debounceRef.current[id] = setTimeout(async () => {
        const sb = getSupabase()!;
        const { error } = await sb.from("tasks").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
        markSave(id, error ? "error" : "saved");
      }, 220);
    }
    // emit activity for stage edits
    if (before && ("done" in patch || "total" in patch)) {
      const member = members.find(m => m.id === before!.member_id);
      emitActivity({
        kind: "task",
        taskId: id,
        memberId: before.member_id,
        memberName: member?.name,
        stage: before.stage,
        from: before.done,
        to: patch.done ?? before.done,
      });
    } else if (before && "note" in patch) {
      const member = members.find(m => m.id === before!.member_id);
      emitActivity({
        kind: "task",
        taskId: id,
        memberId: before.member_id,
        memberName: member?.name,
        stage: before.stage,
        detail: "note",
      });
    }
  }, [live, members, identity]);

  const updateMember = useCallback(async (id: string, patch: Partial<Member>) => {
    let before: Member | undefined;
    setMembers(prev => {
      before = prev.find(m => m.id === id);
      return prev.map(m => m.id === id ? { ...m, ...patch } : m);
    });
    if (live) {
      markSave(id, "saving");
      const sb = getSupabase()!;
      const { error } = await sb.from("members").update(patch).eq("id", id);
      markSave(id, error ? "error" : "saved");
    }
    if (before && "name" in patch && patch.name && patch.name !== before.name) {
      emitActivity({ kind: "rename", memberId: id, memberName: patch.name, detail: before.name });
    }
  }, [live, identity]);

  const addMember = useCallback(async (m: Member) => {
    const newTasks = STAGES.map(s => ({
      id: `t_${m.id}_${s.key}`,
      member_id: m.id, stage: s.key as StageKey,
      done: 0, total: m.quadrant === "ALL" ? 100 : 120, note: null,
    }));
    setMembers(prev => upsertById(prev, m));
    setTasks(prev => {
      let next = prev;
      for (const t of newTasks) next = upsertById(next, t);
      return next;
    });
    if (live) {
      const sb = getSupabase()!;
      await sb.from("members").insert([m]);
      await sb.from("tasks").insert(newTasks);
    }
    emitActivity({ kind: "add", memberId: m.id, memberName: m.name });
  }, [live, identity]);

  const removeMember = useCallback(async (id: string): Promise<(() => Promise<void>) | null> => {
    const memberSnap = members.find(x => x.id === id);
    const taskSnap = tasks.filter(t => t.member_id === id);
    if (!memberSnap) return null;
    setMembers(prev => prev.filter(m => m.id !== id));
    setTasks(prev => prev.filter(t => t.member_id !== id));
    if (live) {
      const sb = getSupabase()!;
      await sb.from("tasks").delete().eq("member_id", id);
      await sb.from("members").delete().eq("id", id);
    }
    emitActivity({ kind: "remove", memberId: id, memberName: memberSnap.name });
    return async () => {
      setMembers(prev => upsertById(prev, memberSnap));
      setTasks(prev => {
        let next = prev;
        for (const t of taskSnap) next = upsertById(next, t);
        return next;
      });
      if (live) {
        const sb = getSupabase()!;
        await sb.from("members").insert([memberSnap]);
        if (taskSnap.length) await sb.from("tasks").insert(taskSnap);
      }
      emitActivity({ kind: "add", memberId: memberSnap.id, memberName: memberSnap.name, detail: "restored" });
    };
  }, [live, members, tasks, identity]);

  return {
    members, tasks, ready, live, saveStates,
    presence, activity, editing,
    updateTask, updateMember, addMember, removeMember,
  };
}
