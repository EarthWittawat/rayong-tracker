"use client";

import { useEffect, useState, useCallback } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabase, isLive } from "./supabase";

export type Profile = {
  id: string;
  name: string;
  color: string;
  emoji: string;
  avatar_url: string | null;
  email: string | null;
  is_admin?: boolean;
  created_at?: string;
  updated_at?: string;
};

const PALETTE = ["#C96442", "#3F6E97", "#3F7D58", "#B68A2E", "#7B5BA6", "#9B5C7A", "#4F7A95", "#7C7A52", "#A85C9D", "#5F8A6E"];
const EMOJI = [
  // botanical / satellite (original set, kept first so existing profiles
  // stay on the same default emoji after a deterministic-hash bucket shift
  // would only walk inside this group).
  "🌾", "🛰️", "🌱", "🌳", "🌻", "🍃", "🌿", "🌺", "🌼", "🌵", "🦋", "✨",
  // critters
  "🐧", "🐤", "🦊", "🐼", "🦉", "🐢", "🐙", "🐝", "🦔", "🦄", "🐯", "🦦",
  // food + drink
  "🍵", "🍙", "🍣", "🍓", "🍑", "🥑", "☕", "🥐",
  // sky / weather
  "🚀", "🌙", "⭐", "⚡", "🌊", "🌈",
  // tools / lab
  "🧪", "🔭", "🗺️", "🎨",
];

export const PALETTE_COLORS = PALETTE;
export const EMOJI_CHOICES = EMOJI;

function pickColorEmojiForId(id: string): { color: string; emoji: string } {
  // Deterministic hash so same user gets same defaults across logins.
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return {
    color: PALETTE[h % PALETTE.length],
    emoji: EMOJI[(h >> 8) % EMOJI.length],
  };
}

function googleNameFrom(user: User): string {
  const m = user.user_metadata || {};
  return (m.full_name as string) || (m.name as string) || (user.email?.split("@")[0]) || "Anonymous";
}

function googleAvatarFrom(user: User): string | null {
  const m = user.user_metadata || {};
  return (m.avatar_url as string) || (m.picture as string) || null;
}

export type SessionState = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  /**
   * True when the signed-in user is on the `dashboard_members` roster.
   * Null means the check hasn't completed yet; false means signed in but
   * not yet a member → render the access-pending gate.
   */
  member: boolean | null;
};

export type AuthActions = {
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (patch: Partial<Omit<Profile, "id" | "created_at" | "updated_at">>) => Promise<void>;
  redeemInvite: (code: string) => Promise<{ ok: boolean; message: string }>;
  refreshMembership: () => Promise<void>;
};

export function useSession(): SessionState & AuthActions & { needsProfileSetup: boolean } {
  const [state, setState] = useState<SessionState>({ loading: true, session: null, user: null, profile: null, member: null });
  const [needsProfileSetup, setNeedsProfileSetup] = useState(false);

  const checkMember = useCallback(async (userId: string | null | undefined): Promise<boolean> => {
    const sb = getSupabase();
    if (!sb || !userId) return false;
    try {
      const { count, error } = await sb
        .from("dashboard_members")
        .select("user_id", { count: "exact", head: true })
        .eq("user_id", userId);
      if (error) {
        console.warn("dashboard_members check error:", error.message);
        return false;
      }
      return (count ?? 0) > 0;
    } catch (e) {
      console.warn("dashboard_members check threw:", e);
      return false;
    }
  }, []);

  const fetchProfile = useCallback(async (user: User): Promise<Profile | null> => {
    const sb = getSupabase();
    if (!sb) return null;
    const { data, error } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (error) {
      console.warn("profile fetch error:", error.message);
      return null;
    }
    return (data as Profile) || null;
  }, []);

  const ensureProfile = useCallback(async (user: User): Promise<{ profile: Profile; isNew: boolean }> => {
    const existing = await fetchProfile(user);
    if (existing) return { profile: existing, isNew: false };
    const sb = getSupabase()!;
    const { color, emoji } = pickColorEmojiForId(user.id);
    const draft: Omit<Profile, "created_at" | "updated_at"> = {
      id: user.id,
      name: googleNameFrom(user),
      color,
      emoji,
      avatar_url: googleAvatarFrom(user),
      email: user.email ?? null,
    };
    const { data, error } = await sb
      .from("profiles")
      .insert(draft)
      .select("*")
      .single();
    if (error) {
      console.warn("profile insert error:", error.message);
      return { profile: draft as Profile, isNew: true };
    }
    return { profile: data as Profile, isNew: true };
  }, [fetchProfile]);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !isLive()) {
      setState({ loading: false, session: null, user: null, profile: null, member: null });
      return;
    }

    let cancelled = false;

    async function load(session: Session | null) {
      if (cancelled) return;
      try {
        if (session?.access_token) {
          sb!.realtime.setAuth(session.access_token);
        } else {
          sb!.realtime.setAuth(null as unknown as string);
        }
      } catch (e) {
        console.warn("realtime.setAuth failed:", e);
      }

      if (!session?.user) {
        setState({ loading: false, session: null, user: null, profile: null, member: null });
        setNeedsProfileSetup(false);
        return;
      }
      const { profile, isNew } = await ensureProfile(session.user);
      if (cancelled) return;
      const member = await checkMember(session.user.id);
      if (cancelled) return;
      setState({ loading: false, session, user: session.user, profile, member });
      setNeedsProfileSetup(isNew);
    }

    sb.auth.getSession().then(({ data }) => load(data.session));

    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      load(session);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [ensureProfile, checkMember]);

  const signInWithGoogle = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) throw new Error("Supabase not configured");
    const redirectTo = typeof window !== "undefined" ? window.location.origin : undefined;
    await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, queryParams: { prompt: "select_account" } },
    });
  }, []);

  const signOut = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    await sb.auth.signOut();
  }, []);

  const updateProfile = useCallback(async (patch: Partial<Omit<Profile, "id" | "created_at" | "updated_at">>) => {
    const sb = getSupabase();
    if (!sb || !state.user) return;
    const next = { ...patch, updated_at: new Date().toISOString() };
    const { data, error } = await sb
      .from("profiles")
      .update(next)
      .eq("id", state.user.id)
      .select("*")
      .single();
    if (!error && data) {
      setState(prev => ({ ...prev, profile: data as Profile }));
      setNeedsProfileSetup(false);
    } else if (error) {
      console.warn("profile update error:", error.message);
    }
  }, [state.user]);

  const refreshMembership = useCallback(async () => {
    if (!state.user) return;
    const member = await checkMember(state.user.id);
    setState(prev => ({ ...prev, member }));
  }, [state.user, checkMember]);

  const redeemInvite = useCallback(async (code: string): Promise<{ ok: boolean; message: string }> => {
    const sb = getSupabase();
    if (!sb) return { ok: false, message: "Supabase not configured." };
    const trimmed = code.trim();
    if (!trimmed) return { ok: false, message: "Enter an invite code." };
    const { data, error } = await sb.rpc("redeem_invite", { p_code: trimmed });
    if (error) return { ok: false, message: error.message };
    const row = Array.isArray(data) ? data[0] : data;
    const ok = !!row?.ok;
    const message = row?.message ?? (ok ? "Welcome." : "Invite check failed.");
    if (ok) await refreshMembership();
    return { ok, message };
  }, [refreshMembership]);

  return { ...state, needsProfileSetup, signInWithGoogle, signOut, updateProfile, redeemInvite, refreshMembership };
}

// Subscribe to the full profile list — used for @mention autocomplete and
// rendering author chips on historical comments.
export function useAllProfiles(enabled: boolean): Profile[] {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  useEffect(() => {
    if (!enabled) { setProfiles([]); return; }
    const sb = getSupabase();
    if (!sb) return;
    let alive = true;
    sb.from("profiles").select("*").then(({ data }) => {
      if (!alive) return;
      setProfiles((data as Profile[]) ?? []);
    });
    const ch = sb.channel("profiles-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, (payload) => {
        if (payload.eventType === "DELETE") {
          const oldId = (payload.old as Profile).id;
          setProfiles(prev => prev.filter(p => p.id !== oldId));
        } else {
          const next = payload.new as Profile;
          setProfiles(prev => {
            const i = prev.findIndex(p => p.id === next.id);
            if (i === -1) return [...prev, next];
            const copy = prev.slice();
            copy[i] = next;
            return copy;
          });
        }
      })
      .subscribe();
    return () => { alive = false; sb.removeChannel(ch); };
  }, [enabled]);
  return profiles;
}
