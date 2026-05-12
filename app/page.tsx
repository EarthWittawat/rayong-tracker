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

  if (session.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">
        <span className="text-sm">loading…</span>
      </div>
    );
  }

  if (!session.user) {
    return <LoginGate configured={supaConfigured} onSignIn={session.signInWithGoogle} />;
  }

  if (!session.profile) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">
        <span className="text-sm">setting up your profile…</span>
      </div>
    );
  }

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
      <header className="sticky top-0 z-[1100] border-b border-border bg-bg/85 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0 flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-xl shrink-0"
              style={{ background: "rgb(var(--c-accent) / 0.12)" }}
            >
              🌾
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-ink truncate leading-tight">Rayong Crop Tracker</h1>
              <p className="text-[11px] text-muted2 tabular truncate">Data · SR · GenAI · Features · RF</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {live && (
              <PresenceBar
                users={presence}
                selfId={profile.id}
                onEditMe={() => setShowIdentity(true)}
              />
            )}
            <span className={`hidden sm:inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border tabular ${live ? "border-good/30 text-good bg-good/5" : "border-warn/30 text-warn bg-warn/5"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-good" : "bg-warn"} pulse-soft`} />
              {live ? "live" : "offline"}
            </span>
            <ThemeToggle />
            <button
              onClick={handleAdd}
              className="hidden md:inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-md bg-ink text-bg hover:opacity-90 transition-opacity font-medium"
              title="Add a manual member"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              <span>add member</span>
            </button>
            <div className="relative">
              <button
                onClick={() => setMenuOpen(o => !o)}
                onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
                className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center text-sm border-2"
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
                  className="absolute right-0 mt-1.5 w-52 bg-surface border border-border rounded-lg shadow-cardHover py-1 z-[1200]"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <div className="px-3 py-2 border-b border-border">
                    <div className="text-sm font-medium text-ink truncate">{profile.name}</div>
                    <div className="text-[11px] text-muted2 truncate">{profile.email ?? ""}</div>
                  </div>
                  <button
                    onClick={() => { setShowIdentity(true); setMenuOpen(false); }}
                    className="w-full text-left text-xs px-3 py-2 hover:bg-surface2 text-ink"
                  >Edit profile</button>
                  <button
                    onClick={handleAdd}
                    className="w-full text-left text-xs px-3 py-2 hover:bg-surface2 text-ink md:hidden"
                  >+ add member</button>
                  <button
                    onClick={() => { setMenuOpen(false); session.signOut(); }}
                    className="w-full text-left text-xs px-3 py-2 hover:bg-surface2 text-crit"
                  >Sign out</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">

        <OverviewStrip members={members} tasks={tasks} />

        <section className="rounded-xl2 bg-surface border border-border shadow-card overflow-hidden">
          <div className="px-6 pt-5 pb-3 flex items-start justify-between gap-3 flex-wrap border-b border-border">
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-muted2 font-medium">Province map</div>
              <h2 className="text-lg font-semibold text-ink mt-0.5">Rayong · Sentinel-2 AOI</h2>
              <p className="text-xs text-muted mt-1 max-w-xl">
                Satellite imagery. Click anywhere to read lat/lng + MGRS for the notebook. Draw a rectangle to export a bounding box.
              </p>
            </div>
            {focusId && (
              <button onClick={() => setFocusId(null)} className="text-xs text-muted hover:text-ink px-2 py-1 rounded border border-border hover:bg-surface2 transition-colors">
                clear focus
              </button>
            )}
          </div>
          <div className="p-5">
            <RayongMap members={members} tasks={tasks} focusId={focusId} onFocus={setFocusId} />
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-muted2 font-medium">Team</div>
              <h2 className="text-lg font-semibold text-ink mt-0.5">
                Members <span className="text-muted2 font-normal tabular text-sm">· {members.length}</span>
              </h2>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <label className="inline-flex items-center gap-2 text-muted2">
                sort
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                  className="bg-surface border border-border rounded-md px-2 py-1 text-ink outline-none hover:bg-surface2 cursor-pointer"
                >
                  <option value="default">default</option>
                  <option value="progress-desc">progress · high→low</option>
                  <option value="progress-asc">progress · low→high</option>
                  <option value="name">name (A→Z)</option>
                </select>
              </label>
              <span className="hidden lg:inline text-muted2">
                <kbd className="px-1 py-0.5 rounded bg-surface2 border border-border tabular text-[10px]">+/−</kbd> bump · <kbd className="px-1 py-0.5 rounded bg-surface2 border border-border tabular text-[10px]">⇧</kbd> ×5 · <kbd className="px-1 py-0.5 rounded bg-surface2 border border-border tabular text-[10px]">c</kbd> comments
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
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
              <div className="col-span-full text-center py-12 rounded-xl2 border-2 border-dashed border-border">
                <div className="text-3xl mb-2">🌱</div>
                <div className="text-sm text-ink font-medium">No members yet</div>
                <div className="text-xs text-muted2 mt-1 mb-4">Members are added automatically when teammates sign in.</div>
                <button
                  onClick={handleAdd}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-ink text-bg hover:opacity-90 transition-opacity"
                >+ add manual member</button>
              </div>
            )}
          </div>
        </section>

        <footer className="text-xs text-muted2 pt-4 border-t border-border flex flex-wrap items-center gap-2">
          <span>Edits sync in real-time via Supabase.</span>
          <span className="text-border2">·</span>
          <span>Imagery © Esri, Maxar, Earthstar Geographics</span>
        </footer>
      </div>

      {undo && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[1300] bg-ink text-bg text-sm px-4 py-2.5 rounded-lg shadow-cardHover flex items-center gap-3">
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
