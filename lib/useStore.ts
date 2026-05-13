"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { getSupabase, isLive, type Member, type Task, type StageKey, STAGES } from "./supabase";
import type { Identity } from "./identity";

const LS_KEY = "rayong-tracker-v1";

function loadLS(): { members: Member[]; tasks: Task[] } {
  if (typeof window === "undefined") return { members: [], tasks: [] };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.members) && Array.isArray(parsed.tasks)) return parsed;
    }
  } catch {}
  return { members: [], tasks: [] };
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
        setMembers((m as Member[]) || []);
        setTasks((t as Task[]) || []);
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

  // ensure a members row exists for the logged-in user, and keep its
  // name/color/emoji in sync with the profile.
  useEffect(() => {
    if (!ready || !live || !identity) return;
    const sb = getSupabase();
    if (!sb) return;

    const selfId = identity.id;
    let cancelled = false;

    (async () => {
      const { data } = await sb.from("members").select("*").eq("id", selfId).maybeSingle();
      if (cancelled) return;
      const existing = data as Member | null;
      if (!existing) {
        const newMember: Member = {
          id: selfId,
          name: identity.name,
          quadrant: "ALL",
          color: identity.color,
          emoji: identity.emoji,
        };
        const newTasks: Task[] = STAGES.map(s => ({
          id: `t_${selfId}_${s.key}`,
          member_id: selfId,
          stage: s.key as StageKey,
          done: 0,
          total: 100,
          note: null,
        }));
        await sb.from("members").upsert([newMember]);
        await sb.from("tasks").upsert(newTasks, { onConflict: "id" });
      } else if (
        existing.name !== identity.name ||
        existing.color !== identity.color ||
        existing.emoji !== identity.emoji
      ) {
        await sb.from("members")
          .update({ name: identity.name, color: identity.color, emoji: identity.emoji })
          .eq("id", selfId);
      }
    })();

    return () => { cancelled = true; };
  }, [ready, live, identity?.id, identity?.name, identity?.color, identity?.emoji]);

  // presence + broadcast channel.
  //
  // Lifetime keyed on (live, identity.id). The old version also re-fired
  // this effect on every name / color / emoji change, which tore down and
  // recreated the channel — and on slow networks the new channel had not
  // finished SUBSCRIBED before we tried to track again, so the second
  // client ended up tracking into a stale connection and other peers
  // never saw it. A separate "update tracked meta" effect below handles
  // identity edits without disturbing the subscription.
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !live || !identity) {
      broadcastChanRef.current = null;
      return;
    }
    const myId = identity.id;
    const chan = sb.channel("board-presence", {
      config: {
        presence: { key: myId },
        broadcast: { self: false },
      },
    });

    function rebuildPresence() {
      const state = chan.presenceState() as Record<string, Array<{ name: string; color: string; emoji: string; avatar_url?: string | null; joinedAt: number }>>;
      const list: PresenceUser[] = [];
      let sawSelf = false;
      for (const [id, metas] of Object.entries(state)) {
        const meta = metas[0];
        if (!meta) continue;
        if (id === myId) sawSelf = true;
        list.push({ id, name: meta.name, color: meta.color, emoji: meta.emoji, avatar_url: meta.avatar_url ?? null, joinedAt: meta.joinedAt });
      }
      // Always include self even if `chan.track()` hasn't echoed back yet —
      // otherwise the footer's "Online now" can sit at 0 right after sign-in.
      if (!sawSelf) {
        list.push({
          id: myId,
          name: identity!.name,
          color: identity!.color,
          emoji: identity!.emoji,
          avatar_url: (identity as { avatar_url?: string | null }).avatar_url ?? null,
          joinedAt: Date.now(),
        });
      }
      list.sort((a, b) => a.joinedAt - b.joinedAt);
      if (typeof window !== "undefined" && (window as { __PRESENCE_DEBUG?: boolean }).__PRESENCE_DEBUG) {
        console.log("[presence] state size", Object.keys(state).length, "list", list.map(p => `${p.name}:${p.id.slice(0, 6)}`));
      }
      setPresence(list);
    }

    // Seed the local presence list with self immediately. The "sync" event
    // will overwrite this with the real channel state once it arrives, but
    // if Realtime is slow / blocked the user at least sees themself online
    // — and rebuildPresence's self-fallback keeps the row stable thereafter.
    setPresence([{
      id: myId,
      name: identity.name,
      color: identity.color,
      emoji: identity.emoji,
      avatar_url: (identity as { avatar_url?: string | null }).avatar_url ?? null,
      joinedAt: Date.now(),
    }]);

    chan
      .on("presence", { event: "sync" }, rebuildPresence)
      .on("presence", { event: "join" }, rebuildPresence)
      .on("presence", { event: "leave" }, rebuildPresence)
      .on("broadcast", { event: "activity" }, ({ payload }: { payload: ActivityEvent }) => {
        if (payload.user.id === myId) return;
        pushActivity(payload);
      })
      .subscribe(async (status) => {
        if (typeof window !== "undefined" && (window as { __PRESENCE_DEBUG?: boolean }).__PRESENCE_DEBUG) {
          console.log("[presence] subscribe status:", status);
        }
        if (status === "SUBSCRIBED") {
          const trackResult = await chan.track({
            name: identity!.name,
            color: identity!.color,
            emoji: identity!.emoji,
            avatar_url: (identity as { avatar_url?: string | null }).avatar_url ?? null,
            joinedAt: Date.now(),
          });
          if (typeof window !== "undefined" && (window as { __PRESENCE_DEBUG?: boolean }).__PRESENCE_DEBUG) {
            console.log("[presence] track result:", trackResult);
          }
          // Force a rebuild AFTER track() so the local seed gets overwritten
          // with the canonical channel state — covers the case where the
          // "sync" event already fired before our subscribe handler ran.
          rebuildPresence();
        }
      });

    broadcastChanRef.current = chan;
    return () => {
      chan.untrack();
      sb.removeChannel(chan);
      broadcastChanRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, identity?.id]);

  // Re-track without resubscribing when the user's display meta changes.
  useEffect(() => {
    const chan = broadcastChanRef.current;
    if (!chan || !identity) return;
    chan.track({
      name: identity.name,
      color: identity.color,
      emoji: identity.emoji,
      avatar_url: (identity as { avatar_url?: string | null }).avatar_url ?? null,
      joinedAt: Date.now(),
    }).catch(() => { /* channel may not be SUBSCRIBED yet — the subscribe callback will track */ });
  }, [identity?.name, identity?.color, identity?.emoji]);

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
