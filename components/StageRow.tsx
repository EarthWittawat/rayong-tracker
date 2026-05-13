"use client";

import { useState, useEffect } from "react";
import type { Task } from "@/lib/supabase";
import type { SaveState, ActivityEvent } from "@/lib/useStore";
import type { Profile } from "@/lib/auth";
import { useTaskCommentCount } from "@/lib/comments";
import { CommentThread } from "./CommentThread";
import { SubtasksList } from "./SubtasksList";

export function StageRow({
  task, label, short, hint, color, save, editingBy, profile, profiles, onChange,
}: {
  task: Task;
  label: string;
  short: string;
  hint: string;
  color: string;
  save?: SaveState;
  editingBy?: ActivityEvent["user"];
  profile: Profile;
  profiles: Profile[];
  onChange: (patch: Partial<Task>) => void;
}) {
  const pct = task.total > 0 ? Math.min(100, (task.done / task.total) * 100) : 0;
  const done = task.done;
  const total = task.total;

  const [doneBuf, setDoneBuf] = useState(String(done));
  const [totalBuf, setTotalBuf] = useState(String(total));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const commentCount = useTaskCommentCount(task.id);

  useEffect(() => { setDoneBuf(String(done)); }, [done]);
  useEffect(() => { setTotalBuf(String(total)); }, [total]);

  // Notification deep-link: when the URL points at this task (e.g.
  // /?task=<id>#c-<commentId>), auto-open the drawer so the targeted
  // comment is in the DOM and scrollToHashComment can land on it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function check() {
      const params = new URLSearchParams(window.location.search);
      if (params.get("task") === task.id) setDrawerOpen(true);
    }
    check();
    window.addEventListener("popstate", check);
    window.addEventListener("hashchange", check);
    return () => {
      window.removeEventListener("popstate", check);
      window.removeEventListener("hashchange", check);
    };
  }, [task.id]);

  function commitDone(v: string) {
    const n = Math.max(0, Math.min(total, parseInt(v || "0", 10) || 0));
    onChange({ done: n });
    setDoneBuf(String(n));
  }
  function commitTotal(v: string) {
    const n = Math.max(done, parseInt(v || "0", 10) || 0);
    onChange({ total: n });
    setTotalBuf(String(n));
  }

  const step = total >= 200 ? 10 : total >= 50 ? 5 : 1;

  function onKeyDown(e: React.KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    const mult = e.shiftKey ? 5 : 1;
    if (e.key === "+" || e.key === "=" || e.key === "ArrowUp") {
      e.preventDefault();
      commitDone(String(Math.min(total, done + step * mult)));
    } else if (e.key === "-" || e.key === "_" || e.key === "ArrowDown") {
      e.preventDefault();
      commitDone(String(Math.max(0, done - step * mult)));
    } else if (e.key === "c" || e.key === "C" || e.key === "n" || e.key === "N") {
      e.preventDefault();
      setDrawerOpen(o => !o);
    }
  }

  const note = (task.note ?? "").trim();
  const noteSnippet = note ? (note.length > 80 ? note.slice(0, 80) + "…" : note) : "";

  const quickIncs = total >= 200 ? [10, 50, 100] : total >= 50 ? [5, 10, 25] : [1, 5, 10];

  return (
    <div
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={`group p-4 rounded-lg outline-none transition-colors border ${editingBy ? "ring-1" : "border-transparent hover:border-border focus-within:border-border focus:border-border hover:bg-surface2/40"}`}
      style={editingBy ? { boxShadow: `inset 0 0 0 1px ${editingBy.color}80`, background: `${editingBy.color}0d` } : undefined}
    >
      {/* header: badge + label + status */}
      <div className="flex items-start gap-3">
        <div
          className="w-11 h-11 rounded-lg flex items-center justify-center text-xs font-semibold tabular shrink-0"
          style={{ background: `${color}1A`, color }}
        >
          {short}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-semibold text-ink truncate">{label}</span>
            {editingBy && (
              <span
                className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-medium"
                style={{ background: `${editingBy.color}1A`, color: editingBy.color, border: `1px solid ${editingBy.color}40` }}
              >
                <span>{editingBy.emoji}</span>
                {editingBy.name} editing
              </span>
            )}
            {save === "saving" && (
              <span className="text-[10px] text-muted2 inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-muted2 pulse-soft" /> saving
              </span>
            )}
            {save === "saved" && (
              <span className="text-[10px] text-good inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-good" /> saved
              </span>
            )}
            {save === "error" && (
              <span className="text-[10px] text-crit">save failed</span>
            )}
          </div>
          <p className="text-xs text-muted mt-0.5 truncate">{hint}</p>
        </div>

        <div className="text-right shrink-0">
          <div className="text-2xl font-semibold tabular leading-none" style={{ color }}>
            {pct.toFixed(0)}%
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted2 mt-1 tabular">
            {done.toLocaleString()} of {total.toLocaleString()}
          </div>
        </div>
      </div>

      {/* progress bar */}
      <div className="mt-3 h-2 w-full rounded-full bg-surface2 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>

      {/* controls row */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <button
          aria-label={`decrement ${short}`}
          onClick={() => commitDone(String(Math.max(0, done - step)))}
          className="w-11 h-11 rounded-md border border-border bg-surface hover:bg-surface2 active:bg-surface2 text-ink text-lg font-medium leading-none flex items-center justify-center transition-colors"
        >
          −
        </button>

        <div className="inline-flex items-center gap-1 px-3 h-11 rounded-md border border-border bg-surface">
          <input
            type="number" inputMode="numeric"
            className="w-16 text-right tabular text-base bg-transparent border-0 outline-none focus:ring-0 px-0 text-ink font-medium"
            value={doneBuf}
            onChange={(e) => setDoneBuf(e.target.value)}
            onBlur={(e) => commitDone(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            title="tiles done"
          />
          <span className="text-muted text-sm px-0.5">of</span>
          <input
            type="number" inputMode="numeric"
            className="w-16 text-left tabular text-base bg-transparent border-0 outline-none focus:ring-0 px-0 text-muted"
            value={totalBuf}
            onChange={(e) => setTotalBuf(e.target.value)}
            onBlur={(e) => commitTotal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            title="tiles total"
          />
        </div>

        <button
          aria-label={`increment ${short}`}
          onClick={() => commitDone(String(Math.min(total, done + step)))}
          className="w-11 h-11 rounded-md border border-border bg-surface hover:bg-surface2 active:bg-surface2 text-ink text-lg font-medium leading-none flex items-center justify-center transition-colors"
        >
          +
        </button>

        {/* quick-pick chips */}
        <div className="flex items-center gap-1 ml-1 flex-wrap">
          {quickIncs.map(n => (
            <button
              key={`p${n}`}
              onClick={() => commitDone(String(Math.min(total, done + n)))}
              className="text-xs h-7 px-2 rounded-md border border-border text-muted hover:text-ink hover:bg-surface2 tabular transition-colors"
              title={`add ${n}`}
            >+{n}</button>
          ))}
          <button
            onClick={() => commitDone(String(total))}
            className="text-xs h-7 px-2 rounded-md border border-border text-muted hover:text-ink hover:bg-surface2 tabular transition-colors"
            title="mark stage complete"
          >set max</button>
          <button
            onClick={() => commitDone("0")}
            className="text-xs h-7 px-2 rounded-md border border-border text-muted hover:text-ink hover:bg-surface2 tabular transition-colors"
            title="reset done"
          >reset</button>
        </div>

        <button
          aria-label={`comments for ${short}`}
          onClick={() => setDrawerOpen(o => !o)}
          className={`ml-auto relative inline-flex items-center gap-1.5 h-11 px-3 rounded-md border transition-colors ${commentCount > 0 ? "border-border2 bg-surface2 text-ink" : "border-border bg-surface text-muted hover:text-ink hover:bg-surface2"}`}
          title={`comments (c)${commentCount ? ` · ${commentCount}` : ""}`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={commentCount > 0 ? color : "currentColor"} strokeWidth="2">
            <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
          </svg>
          <span className="text-xs font-medium tabular">{commentCount > 0 ? commentCount : "comments"}</span>
        </button>
      </div>

      {/* note preview snippet */}
      {noteSnippet && (
        <button
          onClick={() => setDrawerOpen(true)}
          className="mt-2 w-full text-left flex items-start gap-2 px-3 py-2 rounded-md bg-surface2/60 hover:bg-surface2 border border-transparent hover:border-border transition-colors"
        >
          <span className="text-xs mt-0.5">📝</span>
          <span className="text-xs text-muted line-clamp-2">{noteSnippet}</span>
        </button>
      )}

      {drawerOpen && (
        <div className="mt-3 ml-1 pl-3 border-l-2 space-y-4" style={{ borderColor: `${color}40` }}>
          <SubtasksList taskId={task.id} profile={profile} accentColor={color} />
          <div className="border-t border-border pt-3">
            <div className="text-[10px] eyebrow text-muted2 mb-2">Comments</div>
            <CommentThread taskId={task.id} profile={profile} profiles={profiles} />
          </div>
        </div>
      )}
    </div>
  );
}
