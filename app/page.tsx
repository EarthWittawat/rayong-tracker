"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/useStore";
import { useSession, useAllProfiles } from "@/lib/auth";
import { OverviewStrip } from "@/components/OverviewStrip";
import { RayongMap } from "@/components/RayongMap";
import { MemberCard } from "@/components/MemberCard";
import { IdentityModal } from "@/components/IdentityModal";
import { PresenceBar } from "@/components/PresenceBar";
import { ActivityFeed } from "@/components/ActivityFeed";
import { LoginGate } from "@/components/LoginGate";
import { AccessGate } from "@/components/AccessGate";
import { AccessModal } from "@/components/AccessModal";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ClassInsights } from "@/components/ClassInsights";
import { BoardView } from "@/components/BoardView";
import { MatrixView } from "@/components/MatrixView";
import { CommandPalette } from "@/components/CommandPalette";
import { IssuesNavLink } from "@/components/IssuesNavLink";
import { exportTasksCsv, exportTasksJson } from "@/lib/exporters";
import { PipelineGuide } from "@/components/PipelineGuide";
import { computeProgress } from "@/lib/progress";
import { isLive, STAGES } from "@/lib/supabase";
import type { Member, StageKey } from "@/lib/supabase";
import { formatRelative } from "@/lib/relativeTime";

const PALETTE = ["#C96442", "#3F6E97", "#3F7D58", "#B68A2E", "#7B5BA6", "#9B5C7A", "#4F7A95", "#7C7A52"];
const EMOJI   = ["🌾", "🛰️", "🌱", "🌳", "✨", "🌻", "🍃", "🌿"];

type SortMode = "default" | "progress-desc" | "progress-asc" | "name" | "recent";

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
  const [showAccess, setShowAccess] = useState(false);

  // member-grid filters / view
  const [query, setQuery] = useState("");
  const [quadFilter, setQuadFilter] = useState<"all" | "NW" | "NE" | "SW" | "SE" | "ALL">("all");
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [allExpanded, setAllExpanded] = useState<boolean | undefined>(undefined);
  const [view, setView] = useState<"board" | "list" | "matrix">("board");
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Persist the view toggle.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = window.localStorage.getItem("rayong-view");
    if (v === "board" || v === "list" || v === "matrix") setView(v);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("rayong-view", view);
  }, [view]);

  const lastActiveByMember = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) {
      if (!t.updated_at) continue;
      const ts = Date.parse(t.updated_at);
      if (!Number.isFinite(ts)) continue;
      const prev = m.get(t.member_id) ?? 0;
      if (ts > prev) m.set(t.member_id, ts);
    }
    return m;
  }, [tasks]);

  const sortedMembers = useMemo(() => {
    const withMeta = members.map(m => ({
      m,
      pct: computeProgress(tasks.filter(t => t.member_id === m.id)).weightedPct,
      lastActive: lastActiveByMember.get(m.id) ?? 0,
    }));
    if (sortMode === "progress-desc") withMeta.sort((a, b) => b.pct - a.pct);
    else if (sortMode === "progress-asc") withMeta.sort((a, b) => a.pct - b.pct);
    else if (sortMode === "name") withMeta.sort((a, b) => a.m.name.localeCompare(b.m.name));
    else if (sortMode === "recent") withMeta.sort((a, b) => b.lastActive - a.lastActive);
    return withMeta;
  }, [members, tasks, sortMode, lastActiveByMember]);

  const filteredMembers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortedMembers.filter(({ m, pct }) => {
      if (q && !m.name.toLowerCase().includes(q)) return false;
      if (quadFilter !== "all" && m.quadrant !== quadFilter) return false;
      if (incompleteOnly && pct >= 100) return false;
      return true;
    });
  }, [sortedMembers, query, quadFilter, incompleteOnly]);

  // Live footer telemetry — derived only from current tasks + members so it
  // updates every realtime patch without any extra wiring.
  const footerStats = useMemo(() => {
    const now = Date.now();
    const DAY = 86_400_000;
    const WEEK = DAY * 7;

    let updated24h = 0;
    let updated7d = 0;
    const activeIds24h = new Set<string>();
    let doneCount = 0, todoCount = 0, inProgressCount = 0;
    let lastEdit = 0;
    const stageAgg = new Map<StageKey, { done: number; total: number }>();
    for (const s of STAGES) stageAgg.set(s.key, { done: 0, total: 0 });
    const updates24hByMember = new Map<string, number>();

    for (const t of tasks) {
      const ts = t.updated_at ? Date.parse(t.updated_at) : 0;
      if (ts > lastEdit) lastEdit = ts;
      if (ts > 0 && now - ts < DAY) {
        updated24h++;
        activeIds24h.add(t.member_id);
        updates24hByMember.set(t.member_id, (updates24hByMember.get(t.member_id) ?? 0) + 1);
      }
      if (ts > 0 && now - ts < WEEK) updated7d++;
      if (t.total <= 0 || t.done <= 0) todoCount++;
      else if (t.done >= t.total) doneCount++;
      else inProgressCount++;
      const a = stageAgg.get(t.stage); if (a) { a.done += t.done; a.total += t.total; }
    }

    let lagging: { key: StageKey; pct: number } | null = null;
    let leading: { key: StageKey; pct: number } | null = null;
    for (const [key, v] of stageAgg) {
      const pct = v.total > 0 ? (v.done / v.total) * 100 : 0;
      if (!lagging || pct < lagging.pct) lagging = { key, pct };
      if (!leading || pct > leading.pct) leading = { key, pct };
    }

    let topMemberId: string | null = null; let topMemberCount = 0;
    for (const [id, c] of updates24hByMember) {
      if (c > topMemberCount) { topMemberCount = c; topMemberId = id; }
    }
    const topMember = topMemberId ? members.find(m => m.id === topMemberId) ?? null : null;

    const totalTasks = tasks.length;
    const donePct = totalTasks > 0 ? (doneCount / totalTasks) * 100 : 0;

    return {
      updated24h,
      updated7d,
      activeMembers24h: activeIds24h.size,
      doneCount, todoCount, inProgressCount, totalTasks, donePct,
      lastEdit: lastEdit || null,
      lagging, leading,
      topMember, topMemberCount,
    };
  }, [tasks, members]);

  const stageLabel = (k: StageKey | undefined) => STAGES.find(s => s.key === k)?.short ?? "—";

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
    // Defensive: prevent self-removal even if the UI button is bypassed.
    if (session.profile && m.id === session.profile.id) return;
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

  if (session.member === false) {
    return (
      <AccessGate
        email={session.user.email ?? "(unknown email)"}
        onRedeem={session.redeemInvite}
        onSignOut={session.signOut}
      />
    );
  }

  if (!session.profile || session.member === null) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">
        <span className="text-sm">{session.member === null ? "checking access…" : "setting up your profile…"}</span>
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
    <main className="min-h-screen">
      <header className="nasa-nav sticky top-0 z-[1100]">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-2 sm:gap-4">
          <div className="min-w-0 flex items-center gap-2 sm:gap-3">
            <div
              className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center shrink-0 ring-2 ring-white/85"
              style={{ background: "linear-gradient(135deg, rgb(var(--c-info)) 0%, rgb(var(--c-accent)) 100%)" }}
              title="Mission patch"
            >
              <span className="text-[9px] sm:text-[10px] font-bold tracking-wider text-white">SC</span>
              <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-[rgb(var(--c-accent))] ring-2 ring-[rgb(var(--c-nav-bg))]" />
            </div>
            <div className="min-w-0 leading-tight">
              <div className="hidden sm:block eyebrow text-[10px] nav-muted truncate">Sentinel-2 · Rayong AOI</div>
              <h1 className="text-sm sm:text-base font-bold nav-ink truncate">SynthCrop Progress Tracker</h1>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {live && (
              <PresenceBar
                users={presence}
                selfId={profile.id}
                onEditMe={() => setShowIdentity(true)}
              />
            )}
            <span className={`hidden sm:inline-flex items-center gap-1.5 text-[10px] eyebrow px-2.5 py-1 rounded-sm border tabular ${live ? "border-good/60 text-good bg-good/10" : "border-warn/60 text-warn bg-warn/10"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-good" : "bg-warn"} pulse-soft`} />
              {live ? "online" : "offline"}
            </span>
            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden md:inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border border-border bg-surface text-muted hover:text-ink hover:bg-surface2 transition-colors"
              title="Command palette (Ctrl+K)"
              aria-label="Open command palette"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
              <span className="tabular">search</span>
              <kbd className="ml-1 text-[9px] tabular px-1 py-0.5 rounded border border-border bg-surface2">Ctrl K</kbd>
            </button>
            <ThemeToggle />
            <button
              onClick={handleAdd}
              className="hidden md:inline-flex items-center gap-1.5 text-[11px] eyebrow px-3 py-2 rounded-sm bg-[rgb(var(--c-accent))] text-white hover:brightness-110 transition-all"
              title="Add a manual member"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              <span>add member</span>
            </button>
            <div className="relative">
              <button
                onClick={() => setMenuOpen(o => !o)}
                onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
                className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center text-sm ring-2 ring-white/80 hover:ring-white transition-all"
                style={{ background: `${profile.color}33`, color: profile.color }}
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
                  className="absolute right-0 mt-1.5 w-52 bg-surface border border-border rounded-md shadow-cardHover py-1 z-[1200]"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <div className="px-3 py-2 border-b border-border">
                    <div className="text-sm font-semibold text-ink truncate">{profile.name}</div>
                    <div className="text-[11px] text-muted2 truncate">{profile.email ?? ""}</div>
                  </div>
                  <button
                    onClick={() => { setShowIdentity(true); setMenuOpen(false); }}
                    className="w-full text-left text-xs px-3 py-2 hover:bg-surface2 text-ink"
                  >Edit profile</button>
                  <button
                    onClick={() => { setShowAccess(true); setMenuOpen(false); }}
                    className="w-full text-left text-xs px-3 py-2 hover:bg-surface2 text-ink"
                  >Manage access</button>
                  <button
                    onClick={handleAdd}
                    className="w-full text-left text-xs px-3 py-2 hover:bg-surface2 text-ink md:hidden"
                  >+ add member</button>
                  <button
                    onClick={() => { setMenuOpen(false); setPaletteOpen(true); }}
                    className="w-full text-left text-xs px-3 py-2 hover:bg-surface2 text-ink inline-flex items-center justify-between"
                  >
                    <span>Command palette</span>
                    <kbd className="text-[9px] tabular px-1 py-0.5 rounded border border-border bg-surface2 text-muted2">Ctrl K</kbd>
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); exportTasksCsv(members, tasks); }}
                    className="w-full text-left text-xs px-3 py-2 hover:bg-surface2 text-ink"
                  >Export CSV</button>
                  <button
                    onClick={() => { setMenuOpen(false); exportTasksJson(members, tasks); }}
                    className="w-full text-left text-xs px-3 py-2 hover:bg-surface2 text-ink"
                  >Export JSON</button>
                  <button
                    onClick={() => { setMenuOpen(false); session.signOut(); }}
                    className="w-full text-left text-xs px-3 py-2 hover:bg-surface2 text-crit"
                  >Sign out</button>
                </div>
              )}
            </div>
          </div>
        </div>
        {/* red mission stripe */}
        <div className="h-[3px] w-full bg-[rgb(var(--c-accent))]" />
      </header>

      {/* in-page sub-nav: jumps to Work or Insights */}
      <nav className="sticky top-[57px] z-[1099] border-b border-border bg-bg/85 backdrop-blur-md">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-1 text-xs overflow-x-auto">
          <a href="#work" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-surface text-ink font-medium hover:bg-surface2 transition-colors whitespace-nowrap">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>
            Work
          </a>
          <a href="#insights" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-surface text-ink font-medium hover:bg-surface2 transition-colors whitespace-nowrap">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2zM22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" /></svg>
            Insights
          </a>
          <IssuesNavLink />
        </div>
      </nav>

      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-12">

        {/* ──────────────────────────── WORK ──────────────────────────── */}
        <div id="work" className="scroll-mt-32 space-y-6">
          <header className="flex items-end justify-between gap-3 flex-wrap pb-2 border-b border-border">
            <div>
              <h2 className="text-2xl font-bold text-ink">Work</h2>
              <p className="text-xs text-muted mt-1 max-w-xl">
                Progress, crew board, map.
              </p>
            </div>
            <a href="#insights" className="text-[11px] text-muted hover:text-ink inline-flex items-center gap-1">
              jump to Insights
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
            </a>
          </header>

          <OverviewStrip members={members} tasks={tasks} />

          <section className="space-y-4">
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-muted2 font-medium">Team</div>
              <h2 className="text-lg font-semibold text-ink mt-0.5">
                Crew <span className="text-muted2 font-normal tabular text-sm">· {filteredMembers.length}/{members.length}</span>
              </h2>
            </div>
            <div className="hidden lg:flex items-center gap-1 text-xs text-muted2">
              <kbd className="px-1 py-0.5 rounded bg-surface2 border border-border tabular text-[10px]">+/−</kbd> bump
              <span className="mx-1">·</span>
              <kbd className="px-1 py-0.5 rounded bg-surface2 border border-border tabular text-[10px]">⇧</kbd> ×5
              <span className="mx-1">·</span>
              <kbd className="px-1 py-0.5 rounded bg-surface2 border border-border tabular text-[10px]">c</kbd> comments
            </div>
          </div>

          {/* filter / view toolbar */}
          <div className="rounded-lg border border-border bg-surface p-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px] max-w-sm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                   className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted2 pointer-events-none">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
              </svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="search crew…"
                className="w-full pl-8 pr-2 py-1.5 text-xs rounded-md bg-surface2 border border-border text-ink placeholder:text-muted2 outline-none focus:border-accent"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted2 hover:text-ink"
                  aria-label="clear search"
                >×</button>
              )}
            </div>

            <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5 bg-surface2">
              {(["all","NW","NE","SW","SE","ALL"] as const).map(q => (
                <button
                  key={q}
                  onClick={() => setQuadFilter(q)}
                  className={`text-[11px] tabular px-2 py-1 rounded transition-colors ${quadFilter === q ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}
                  title={q === "all" ? "all quadrants" : q === "ALL" ? "cross-cutting (ALL)" : `quadrant ${q}`}
                >{q === "all" ? "·" : q}</button>
              ))}
            </div>

            <button
              onClick={() => setIncompleteOnly(v => !v)}
              className={`text-[11px] px-2.5 py-1.5 rounded-md border transition-colors ${incompleteOnly ? "bg-accent/15 border-accent text-accent" : "border-border text-muted hover:text-ink hover:bg-surface2"}`}
            >
              incomplete only
            </button>

            <div className="ml-auto flex items-center gap-2">
              <div className="inline-flex items-center rounded-md border border-border bg-surface2 p-0.5" role="tablist" aria-label="view mode">
                <button
                  onClick={() => setView("board")}
                  role="tab"
                  aria-selected={view === "board"}
                  className={`text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded transition-colors ${view === "board" ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}
                  title="Kanban board"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="5" height="16" rx="1" /><rect x="10" y="4" width="5" height="10" rx="1" /><rect x="17" y="4" width="4" height="13" rx="1" /></svg>
                  board
                </button>
                <button
                  onClick={() => setView("list")}
                  role="tab"
                  aria-selected={view === "list"}
                  className={`text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded transition-colors ${view === "list" ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}
                  title="Detail list"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
                  list
                </button>
                <button
                  onClick={() => setView("matrix")}
                  role="tab"
                  aria-selected={view === "matrix"}
                  className={`text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded transition-colors ${view === "matrix" ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}
                  title="Heatmap matrix"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="11" y="3" width="6" height="6" rx="1" /><rect x="3" y="11" width="6" height="6" rx="1" /><rect x="11" y="11" width="6" height="6" rx="1" /></svg>
                  matrix
                </button>
              </div>
              <label className="inline-flex items-center gap-2 text-[11px] text-muted2">
                sort
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                  className="bg-surface border border-border rounded-md px-2 py-1 text-ink outline-none hover:bg-surface2 cursor-pointer text-[11px]"
                >
                  <option value="default">default</option>
                  <option value="progress-desc">progress · high→low</option>
                  <option value="progress-asc">progress · low→high</option>
                  <option value="recent">most recently active</option>
                  <option value="name">name (A→Z)</option>
                </select>
              </label>
              {view === "list" && (
                <button
                  onClick={() => setAllExpanded(prev => prev === false ? true : false)}
                  className="text-[11px] px-2.5 py-1.5 rounded-md border border-border text-muted hover:text-ink hover:bg-surface2"
                  title={allExpanded === false ? "expand all" : "collapse all"}
                >{allExpanded === false ? "expand all" : "collapse all"}</button>
              )}
            </div>
          </div>

          {filteredMembers.length === 0 && members.length > 0 && (
            <div className="text-center py-10 rounded-xl2 border-2 border-dashed border-border">
              <div className="text-sm text-ink font-medium">No crew matches the filters</div>
              <button
                onClick={() => { setQuery(""); setQuadFilter("all"); setIncompleteOnly(false); }}
                className="mt-3 text-xs px-3 py-1.5 rounded-md border border-border text-muted hover:text-ink hover:bg-surface2"
              >reset filters</button>
            </div>
          )}

          {members.length === 0 && (
            <div className="text-center py-12 rounded-xl2 border-2 border-dashed border-border">
              <div className="text-3xl mb-2">🛰️</div>
              <div className="text-sm text-ink font-medium">No crew yet</div>
              <div className="text-xs text-muted2 mt-1 mb-4">Crew rows are added automatically when teammates sign in.</div>
              <button
                onClick={handleAdd}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-ink text-bg hover:opacity-90 transition-opacity"
              >+ add manual member</button>
            </div>
          )}

          {filteredMembers.length > 0 && view === "board" && (
            <BoardView
              members={filteredMembers}
              tasks={tasks}
              saveStates={saveStates}
              editing={editing}
              profile={profile}
              onPatchTask={updateTask}
              onFocusMember={(id) => { setView("list"); setFocusId(id); setAllExpanded(true); setTimeout(() => { document.getElementById(`member-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 50); }}
            />
          )}

          {filteredMembers.length > 0 && view === "matrix" && (
            <MatrixView
              members={filteredMembers}
              tasks={tasks}
              onFocusMember={(id) => { setView("list"); setFocusId(id); setAllExpanded(true); setTimeout(() => { document.getElementById(`member-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 50); }}
            />
          )}

          {filteredMembers.length > 0 && view === "list" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-5">
              {filteredMembers.map(({ m }) => (
                <div id={`member-${m.id}`} key={m.id} className="scroll-mt-24">
                  <MemberCard
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
                    lastActiveAt={lastActiveByMember.get(m.id)}
                    expanded={allExpanded}
                    isSelf={m.id === profile.id}
                  />
                </div>
              ))}
            </div>
          )}
        </section>

          <section className="rounded-xl2 bg-surface border border-border shadow-card overflow-hidden">
            <div className="px-6 pt-5 pb-3 flex items-start justify-between gap-3 flex-wrap border-b border-border">
              <div>
                <div className="text-[11px] uppercase tracking-[0.12em] text-muted2 font-medium">Province map</div>
                <h2 className="text-lg font-semibold text-ink mt-0.5">Rayong · Sentinel-2 AOI</h2>
                <p className="text-xs text-muted mt-1 max-w-xl">
                  Click for lat/lng + MGRS. Draw a rectangle to export a bbox.
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
        </div>
        {/* ──────────────────────── /WORK ──────────────────────── */}

        {/* ────────────────────── INSIGHTS ────────────────────── */}
        <div id="insights" className="scroll-mt-32 space-y-6">
          <header className="flex items-end justify-between gap-3 flex-wrap pb-2 border-b border-border">
            <div>
              <h2 className="text-2xl font-bold text-ink">Insights</h2>
              <p className="text-xs text-muted mt-1 max-w-xl">
                Pipeline explainer + class-distribution snapshot from the notebook.
              </p>
            </div>
            <a href="#work" className="text-[11px] text-muted hover:text-ink inline-flex items-center gap-1">
              back to Work
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: "rotate(180deg)" }}><polyline points="6 9 12 15 18 9" /></svg>
            </a>
          </header>

          <PipelineGuide tasks={tasks} />

          <ClassInsights />
        </div>
        {/* ──────────────────────── /INSIGHTS ──────────────────────── */}

      </div>

      <footer className="nasa-nav mt-12">
        <div className="h-[3px] w-full bg-[rgb(var(--c-accent))]" />
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-baseline justify-between flex-wrap gap-2 mb-4">
            <div>
              <div className="eyebrow text-[10px] nav-muted">Team telemetry</div>
              <div className="text-xs nav-muted">derived from current board state</div>
            </div>
            <div className="text-[10px] eyebrow tabular nav-muted">
              {footerStats.lastEdit ? `last edit ${formatRelative(footerStats.lastEdit)}` : "no edits yet"}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-[rgb(var(--c-nav-border))] rounded-md overflow-hidden">
            {(() => {
              const selfHere = presence.some(p => p.id === profile.id);
              const total = presence.length;
              const others = selfHere ? total - 1 : total;
              const names = presence.map(p => p.id === profile.id ? `${p.name} (you)` : p.name).join(", ") || "no one";
              const sub =
                total === 0 ? "no one online"
                : selfHere && others === 0 ? "just you"
                : selfHere ? `you + ${others} other${others === 1 ? "" : "s"}`
                : `${total} other${total === 1 ? "" : "s"}`;
              return <FootStat label="Online now" value={total} sub={sub} tone="info" title={names} />;
            })()}
            <FootStat label="Edits · 24h" value={footerStats.updated24h} sub={`${footerStats.activeMembers24h} active`} tone="accent" />
            <FootStat label="Edits · 7d" value={footerStats.updated7d} sub="rolling window" />
            <FootStat
              label="Cards done"
              value={`${footerStats.doneCount}/${footerStats.totalTasks}`}
              sub={`${footerStats.donePct.toFixed(0)}% complete`}
              tone="good"
            />
            <FootStat
              label="Top contributor"
              value={footerStats.topMember ? `${footerStats.topMember.emoji} ${footerStats.topMember.name}` : "—"}
              sub={footerStats.topMember ? `${footerStats.topMemberCount} edits · 24h` : "no edits yet"}
            />
            <FootStat
              label="Lagging stage"
              value={footerStats.lagging ? `${stageLabel(footerStats.lagging.key)} · ${footerStats.lagging.pct.toFixed(0)}%` : "—"}
              sub={footerStats.leading ? `lead: ${stageLabel(footerStats.leading.key)} · ${footerStats.leading.pct.toFixed(0)}%` : ""}
              tone="warn"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] eyebrow nav-muted tabular">
            <span>Sentinel-2 L2A</span>
            <span className="w-1 h-1 rounded-full bg-white/30" />
            <span>CDSE OpenEO</span>
            <span className="w-1 h-1 rounded-full bg-white/30" />
            <span>LDD landuse</span>
            <span className="w-1 h-1 rounded-full bg-white/30" />
            <span>OpenSR ×4</span>
            <span className="w-1 h-1 rounded-full bg-white/30" />
            <span>Esri · Maxar imagery</span>
            <span className="ml-auto">SynthCrop · v1.0</span>
          </div>
        </div>
      </footer>

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

      <AccessModal
        open={showAccess}
        onClose={() => setShowAccess(false)}
        currentUserId={profile.id}
      />

      <CommandPalette
        open={paletteOpen}
        setOpen={setPaletteOpen}
        members={members}
        tasks={tasks}
        view={view}
        setView={setView}
        onFocusMember={(id) => {
          setView("list");
          setFocusId(id);
          setAllExpanded(true);
          setTimeout(() => {
            document.getElementById(`member-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 50);
        }}
        onAddMember={handleAdd}
        onSignOut={session.signOut}
        onEditProfile={() => setShowIdentity(true)}
        onManageAccess={() => setShowAccess(true)}
        onToggleTheme={() => {
          if (typeof document === "undefined") return;
          const root = document.documentElement;
          const isDark = root.classList.contains("dark");
          const next = isDark ? "light" : "dark";
          root.classList.toggle("dark", next === "dark");
          try { window.localStorage.setItem("rayong-theme", next); } catch {}
        }}
        onExportCsv={() => exportTasksCsv(members, tasks)}
        onExportJson={() => exportTasksJson(members, tasks)}
      />
    </main>
  );
}

function FootStat({
  label, value, sub, tone, title,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "info" | "accent" | "good" | "warn";
  title?: string;
}) {
  const accent =
    tone === "info"   ? "rgb(var(--c-info))" :
    tone === "accent" ? "rgb(var(--c-accent))" :
    tone === "good"   ? "rgb(var(--c-good))" :
    tone === "warn"   ? "rgb(var(--c-warn))" : "rgb(var(--c-nav-ink))";
  return (
    <div className="bg-[rgb(var(--c-nav-bg))] px-4 py-3 flex flex-col gap-0.5" title={title}>
      <div className="eyebrow text-[9px] nav-muted">{label}</div>
      <div className="text-base font-semibold tabular truncate" style={{ color: accent }} title={title ?? String(value)}>{value}</div>
      {sub && <div className="text-[10px] nav-muted tabular truncate" title={sub}>{sub}</div>}
    </div>
  );
}
