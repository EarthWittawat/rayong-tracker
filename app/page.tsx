"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/useStore";
import { useSession, useAllProfiles } from "@/lib/auth";
import { OverviewStrip } from "@/components/OverviewStrip";
import { RayongMap } from "@/components/RayongMap";
import { MemberCard } from "@/components/MemberCard";
import { IdentityModal } from "@/components/IdentityModal";
import { PresenceBar } from "@/components/PresenceBar";
import { ActivityFeed } from "@/components/ActivityFeed";
import { LoginGate } from "@/components/LoginGate";
import { ThemeToggle } from "@/components/ThemeToggle";
import { computeProgress } from "@/lib/progress";
import { isLive } from "@/lib/supabase";
import type { Member } from "@/lib/supabase";

const PALETTE = ["#C96442", "#3F6E97", "#3F7D58", "#B68A2E", "#7B5BA6", "#9B5C7A", "#4F7A95", "#7C7A52"];
const EMOJI   = ["🌾", "🛰️", "🌱", "🌳", "✨", "🌻", "🍃", "🌿"];

type SortMode = "default" | "progress-desc" | "progress-asc" | "name";

export default function Page() {
  const supaConfigured = isLive();
  const session = useSession();
  const profiles = useAllProfiles(!!session.user);

  const [showIdentity, setShowIdentity] = useState(false);
  const {
    members, tasks, ready, live, saveStates, presence, activity, editing,
    updateTask, updateMember, addMember, removeMember,
  } = useStore(session.profile);

  const [focusId, setFocusId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("default");
  const [undo, setUndo] = useState<{ name: string; restore: () => Promise<void> } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const sortedMembers = useMemo(() => {
    if (sortMode === "default") return members;
    const withPct = members.map(m => ({
      m,
      pct: computeProgress(tasks.filter(t => t.member_id === m.id)).weightedPct,
    }));
    if (sortMode === "progress-desc") withPct.sort((a, b) => b.pct - a.pct);
    else if (sortMode === "progress-asc") withPct.sort((a, b) => a.pct - b.pct);
    else if (sortMode === "name") withPct.sort((a, b) => a.m.name.localeCompare(b.m.name));
    return withPct.map(x => x.m);
  }, [members, tasks, sortMode]);

  function handleAdd() {
    const id = `m_${Math.random().toString(36).slice(2, 8)}`;
    const newM: Member = {
      id,
      name: `Member ${members.length + 1}`,
      quadrant: "ALL",
      color: PALETTE[members.length % PALETTE.length],
      emoji: EMOJI[members.length % EMOJI.length],
    };
    addMember(newM);
  }

  async function handleRemove(m: Member) {
    const restore = await removeMember(m.id);
    if (restore) {
      setUndo({ name: m.name, restore });
      setTimeout(() => setUndo(prev => (prev?.restore === restore ? null : prev)), 8000);
    }
  }

  // 1. Auth still loading — splash.
  if (session.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">
        <span className="text-sm">loading…</span>
      </div>
    );
  }

  // 2. Force login gate when Supabase configured (per design choice — no demo mode).
  if (!session.user) {
    return <LoginGate configured={supaConfigured} onSignIn={session.signInWithGoogle} />;
  }

  // 3. Profile not yet available — likely a transient race; show splash.
  if (!session.profile) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">
        <span className="text-sm">setting up your profile…</span>
      </div>
    );
  }

  // 4. Data not ready — splash.
  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">
        <span className="text-sm">loading board…</span>
      </div>
    );
  }

  const profile = session.profile;

  return (
    <main className="min-h-screen pb-24">
      <header className="border-b border-border bg-bg/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-5 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-ink truncate">Rayong Crop Tracker</h1>
            <p className="text-xs text-muted">Data · SR · GenAI · Features · RF</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {live && (
              <PresenceBar
                users={presence}
                selfId={profile.id}
                onEditMe={() => setShowIdentity(true)}
              />
            )}
            <ThemeToggle />
            <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${live ? "border-good/30 text-good bg-good/5" : "border-warn/30 text-warn bg-warn/5"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-good" : "bg-warn"} pulse-soft`} />
              {live ? "live · synced" : "offline"}
            </span>
            <button onClick={handleAdd}
                    className="text-xs px-3 py-1.5 rounded-md bg-ink text-bg hover:bg-ink/90 transition-colors">
              + add member
            </button>
            <div className="relative">
              <button
                onClick={() => setMenuOpen(o => !o)}
                onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
                className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center text-sm border"
                style={{ background: `${profile.color}1A`, color: profile.color, borderColor: profile.color }}
                title={`Signed in as ${profile.name}`}
              >
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt={profile.name} className="w-full h-full object-cover" />
                ) : (
                  <span>{profile.emoji}</span>
                )}
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 mt-1 w-48 bg-surface border border-border rounded-md shadow-cardHover py-1 z-20"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <div className="px-3 py-2 border-b border-border">
                    <div className="text-sm font-medium text-ink truncate">{profile.name}</div>
                    <div className="text-[11px] text-muted2 truncate">{profile.email ?? ""}</div>
                  </div>
                  <button
                    onClick={() => { setShowIdentity(true); setMenuOpen(false); }}
                    className="w-full text-left text-xs px-3 py-1.5 hover:bg-surface2"
                  >Edit profile</button>
                  <button
                    onClick={() => { setMenuOpen(false); session.signOut(); }}
                    className="w-full text-left text-xs px-3 py-1.5 hover:bg-surface2 text-crit"
                  >Sign out</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-5 py-6 space-y-6">

        <OverviewStrip members={members} tasks={tasks} />

        <section className="rounded-xl2 bg-surface border border-border shadow-card overflow-hidden">
          <div className="p-5 pb-2 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted2">Rayong province · quadrant split</div>
              <p className="text-sm text-muted mt-0.5">Fill darkness reflects each member's progress. Click a quadrant to focus.</p>
            </div>
            {focusId && (
              <button onClick={() => setFocusId(null)} className="text-xs text-muted hover:text-ink underline-offset-2 hover:underline">clear focus</button>
            )}
          </div>
          <div className="p-5 pt-1">
            <RayongMap members={members} tasks={tasks} focusId={focusId} onFocus={setFocusId} />
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-ink">Members</h2>
            <div className="flex items-center gap-3 text-xs text-muted2">
              <label className="inline-flex items-center gap-1.5">
                sort
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                  className="bg-surface2 border border-border rounded px-1.5 py-0.5 text-ink outline-none"
                >
                  <option value="default">default</option>
                  <option value="progress-desc">progress · high→low</option>
                  <option value="progress-asc">progress · low→high</option>
                  <option value="name">name (A→Z)</option>
                </select>
              </label>
              <span className="hidden sm:inline">card focus + / − to bump · shift ×5 · n for note</span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sortedMembers.map(m => (
              <MemberCard
                key={m.id}
                member={m}
                tasks={tasks.filter(t => t.member_id === m.id)}
                focused={focusId === m.id}
                onFocus={() => setFocusId(prev => prev === m.id ? null : m.id)}
                onPatchTask={updateTask}
                onPatchMember={(patch) => updateMember(m.id, patch)}
                onRemove={() => handleRemove(m)}
                saveStates={saveStates}
                editing={editing}
                profile={profile}
                profiles={profiles}
              />
            ))}
            {sortedMembers.length === 0 && (
              <div className="col-span-full text-center py-8 text-muted2 text-sm">
                No members yet. Click <span className="text-ink font-medium">+ add member</span> to start.
              </div>
            )}
          </div>
        </section>

        <footer className="text-xs text-muted2 pt-2">
          <span>Edits sync in real-time across all signed-in members via Supabase.</span>
        </footer>
      </div>

      {undo && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 bg-ink text-bg text-sm px-4 py-2.5 rounded-lg shadow-cardHover flex items-center gap-3">
          <span>Removed <strong>{undo.name}</strong>.</span>
          <button
            onClick={async () => { const r = undo.restore; setUndo(null); await r(); }}
            className="px-2 py-0.5 rounded bg-bg/10 hover:bg-bg/20 text-bg underline-offset-2 hover:underline"
          >undo</button>
          <button
            onClick={() => setUndo(null)}
            aria-label="dismiss"
            className="text-bg/60 hover:text-bg"
          >✕</button>
        </div>
      )}

      {live && <ActivityFeed events={activity} />}

      <IdentityModal
        open={showIdentity || session.needsProfileSetup}
        profile={profile}
        firstTime={session.needsProfileSetup}
        onClose={() => setShowIdentity(false)}
        onSave={async (patch) => {
          await session.updateProfile(patch);
          setShowIdentity(false);
        }}
      />
    </main>
  );
}
