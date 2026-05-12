"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Member, Task } from "@/lib/supabase";
import { STAGES } from "@/lib/supabase";

export type PaletteAction = {
  id: string;
  title: string;
  hint?: string;
  group: "navigate" | "view" | "data" | "account";
  keywords?: string;
  shortcut?: string;
  run: () => void;
};

function score(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 1;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 500;
  if (t.includes(q)) return 100;
  // simple subsequence match
  let ti = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return 0;
    ti = found + 1;
  }
  return 10;
}

export function CommandPalette({
  open, setOpen, members, tasks, view, setView, onFocusMember, onAddMember,
  onSignOut, onEditProfile, onManageAccess, onToggleTheme,
  onExportCsv, onExportJson,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  members: Member[];
  tasks: Task[];
  view: "board" | "list" | "matrix";
  setView: (v: "board" | "list" | "matrix") => void;
  onFocusMember: (id: string) => void;
  onAddMember: () => void;
  onSignOut: () => void;
  onEditProfile: () => void;
  onManageAccess: () => void;
  onToggleTheme: () => void;
  onExportCsv: () => void;
  onExportJson: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // global Ctrl/Cmd+K toggle
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const isEditable =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && (t as HTMLElement).isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
        return;
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (!open && !isEditable && e.key === "?") {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const actions: PaletteAction[] = useMemo(() => {
    const navMembers: PaletteAction[] = members.map(m => {
      const memberTasks = tasks.filter(t => t.member_id === m.id);
      const done = memberTasks.reduce((s, t) => s + t.done, 0);
      const total = memberTasks.reduce((s, t) => s + t.total, 0);
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      return {
        id: `member:${m.id}`,
        title: `Open ${m.name}`,
        hint: `${m.quadrant} · ${pct}% · ${done.toLocaleString()}/${total.toLocaleString()}`,
        group: "navigate",
        keywords: `${m.name} ${m.quadrant} member`,
        run: () => onFocusMember(m.id),
      };
    });

    const stageJumps: PaletteAction[] = STAGES.map(s => ({
      id: `stage:${s.key}`,
      title: `Jump to stage · ${s.label}`,
      hint: s.hint,
      group: "navigate",
      keywords: `${s.short} ${s.label} stage column`,
      run: () => {
        setView("board");
        setTimeout(() => {
          const col = document.querySelector(`[data-stage="${s.key}"]`);
          col?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
        }, 50);
      },
    }));

    const viewActions: PaletteAction[] = [
      { id: "view:board",  title: "Switch view · Board",  group: "view", keywords: "kanban columns", shortcut: "1", run: () => setView("board") },
      { id: "view:list",   title: "Switch view · List",   group: "view", keywords: "detail rows",    shortcut: "2", run: () => setView("list") },
      { id: "view:matrix", title: "Switch view · Matrix", group: "view", keywords: "heatmap grid",   shortcut: "3", run: () => setView("matrix") },
      { id: "view:theme",  title: "Toggle theme · light/dark", group: "view", keywords: "dark mode", run: () => onToggleTheme() },
      { id: "view:scroll-work",     title: "Jump to · Work",     group: "view", keywords: "section", run: () => document.getElementById("work")?.scrollIntoView({ behavior: "smooth" }) },
      { id: "view:scroll-insights", title: "Jump to · Insights", group: "view", keywords: "section pipeline class", run: () => document.getElementById("insights")?.scrollIntoView({ behavior: "smooth" }) },
    ];

    const dataActions: PaletteAction[] = [
      { id: "data:csv",  title: "Export tasks · CSV",  group: "data", keywords: "download spreadsheet excel", run: onExportCsv },
      { id: "data:json", title: "Export tasks · JSON", group: "data", keywords: "download backup", run: onExportJson },
      { id: "data:add",  title: "Add manual member",   group: "data", keywords: "new teammate", run: onAddMember },
    ];

    const acctActions: PaletteAction[] = [
      { id: "acct:profile", title: "Edit profile",      group: "account", keywords: "name color emoji", run: onEditProfile },
      { id: "acct:access",  title: "Manage access",     group: "account", keywords: "invite member",    run: onManageAccess },
      { id: "acct:signout", title: "Sign out",          group: "account", run: onSignOut },
    ];

    return [...navMembers, ...stageJumps, ...viewActions, ...dataActions, ...acctActions];
  }, [members, tasks, setView, onFocusMember, onAddMember, onSignOut, onEditProfile, onManageAccess, onToggleTheme, onExportCsv, onExportJson]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return actions;
    const scored = actions
      .map(a => ({ a, s: Math.max(score(q, a.title), 0.6 * score(q, a.keywords ?? "")) }))
      .filter(x => x.s > 0)
      .sort((x, y) => y.s - x.s);
    return scored.map(x => x.a);
  }, [actions, query]);

  // group filtered for display while keeping a flat index map
  const grouped = useMemo(() => {
    const order: PaletteAction["group"][] = ["navigate", "view", "data", "account"];
    const groupLabel: Record<PaletteAction["group"], string> = {
      navigate: "Navigate",
      view: "View",
      data: "Data",
      account: "Account",
    };
    const out: { label: string; items: PaletteAction[] }[] = [];
    for (const g of order) {
      const items = filtered.filter(a => a.group === g);
      if (items.length === 0) continue;
      out.push({ label: groupLabel[g], items });
    }
    return out;
  }, [filtered]);

  useEffect(() => { setActiveIdx(0); }, [query, filtered.length]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`) as HTMLElement | null;
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  function runAt(idx: number) {
    const a = filtered[idx];
    if (!a) return;
    a.run();
    setOpen(false);
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx(i => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(i => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runAt(activeIdx);
    } else if (!e.metaKey && !e.ctrlKey && !e.altKey && /^[123]$/.test(e.key) && query === "") {
      const idx = parseInt(e.key, 10) - 1;
      const targets: ("board" | "list" | "matrix")[] = ["board", "list", "matrix"];
      if (idx >= 0 && idx < targets.length) {
        e.preventDefault();
        setView(targets[idx]);
        setOpen(false);
      }
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1400] flex items-start justify-center px-3 pt-[12vh] sm:pt-[18vh] bg-ink/40 backdrop-blur-sm"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-surface border border-border rounded-xl2 shadow-cardHover overflow-hidden"
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted2 shrink-0">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search members, views, exports… (Ctrl+K)"
            className="flex-1 bg-transparent border-0 outline-none focus:ring-0 text-sm text-ink placeholder:text-muted2"
            spellCheck={false}
            autoComplete="off"
          />
          <kbd className="hidden sm:inline-block text-[10px] tabular px-1.5 py-0.5 rounded border border-border bg-surface2 text-muted2">esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted2">No matches.</div>
          ) : (
            (() => {
              let runningIdx = 0;
              return grouped.map(g => (
                <div key={g.label} className="py-1">
                  <div className="px-3 py-1 eyebrow text-[9px] text-muted2">{g.label}</div>
                  {g.items.map(a => {
                    const idx = runningIdx++;
                    const active = idx === activeIdx;
                    return (
                      <button
                        key={a.id}
                        data-idx={idx}
                        onMouseEnter={() => setActiveIdx(idx)}
                        onClick={() => runAt(idx)}
                        className={`w-full text-left px-3 py-1.5 flex items-center gap-2 ${active ? "bg-accent/10" : "hover:bg-surface2/60"}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm truncate ${active ? "text-ink font-medium" : "text-ink"}`}>{a.title}</div>
                          {a.hint && <div className="text-[10px] text-muted2 truncate">{a.hint}</div>}
                        </div>
                        {a.shortcut && (
                          <kbd className="text-[10px] tabular px-1.5 py-0.5 rounded border border-border bg-surface2 text-muted2 shrink-0">
                            {a.shortcut}
                          </kbd>
                        )}
                      </button>
                    );
                  })}
                </div>
              ));
            })()
          )}
        </div>

        <div className="px-3 py-1.5 border-t border-border flex items-center justify-between text-[10px] tabular text-muted2">
          <span className="inline-flex items-center gap-1.5">
            <kbd className="px-1 py-0.5 rounded border border-border bg-surface2">↑</kbd>
            <kbd className="px-1 py-0.5 rounded border border-border bg-surface2">↓</kbd>
            navigate
          </span>
          <span className="inline-flex items-center gap-1.5">
            <kbd className="px-1 py-0.5 rounded border border-border bg-surface2">↵</kbd>
            run
          </span>
          <span className="inline-flex items-center gap-1.5">
            <kbd className="px-1 py-0.5 rounded border border-border bg-surface2">Ctrl</kbd>
            <kbd className="px-1 py-0.5 rounded border border-border bg-surface2">K</kbd>
            toggle
          </span>
        </div>
      </div>
    </div>
  );
}
