"use client";

import { useEffect, useRef, useState } from "react";
import { useSubtasks } from "@/lib/subtasks";
import type { Profile } from "@/lib/auth";
import { formatRelative } from "@/lib/relativeTime";

export function SubtasksList({
  taskId, profile, accentColor,
}: {
  taskId: string;
  profile: Profile;
  accentColor?: string;
}) {
  const { subtasks, loading, addSubtask, toggleSubtask, removeSubtask, renameSubtask } =
    useSubtasks(taskId, profile.id);
  const [input, setInput] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);
  const prevIdsRef = useRef<Set<string>>(new Set());

  // Highlight the newest subtask after an INSERT lands via realtime.
  useEffect(() => {
    const prev = prevIdsRef.current;
    const next = new Set(subtasks.map(s => s.id));
    const added = subtasks.find(s => !prev.has(s.id) && s.author_id === profile.id);
    if (added) {
      setJustAddedId(added.id);
      setShowToast(true);
      const t1 = setTimeout(() => setJustAddedId(null), 2200);
      const t2 = setTimeout(() => setShowToast(false), 3200);
      prevIdsRef.current = next;
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
    prevIdsRef.current = next;
  }, [subtasks, profile.id]);

  const total = subtasks.length;
  const doneCount = subtasks.filter(s => s.done).length;
  const pct = total > 0 ? (doneCount / total) * 100 : 0;
  const accent = accentColor ?? "rgb(var(--c-good))";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px] eyebrow text-muted2">
        <span className="inline-flex items-center gap-1.5">
          Subtasks
          <span
            className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-border text-[9px] cursor-help"
            title={"Subtasks are personal checklist items.\n• Anyone can tick a box.\n• Only the author can rename or remove their own subtasks.\n• Progress here doesn't affect the stage tile count above."}
          >?</span>
        </span>
        {total > 0 && <span className="tabular">{doneCount}/{total}</span>}
      </div>

      {total > 0 && (
        <div className="h-1 rounded-full bg-surface2 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: accent }} />
        </div>
      )}

      {loading && total === 0 && (
        <div className="text-[11px] text-muted2 italic">loading…</div>
      )}

      {!loading && total === 0 && (
        <div className="rounded-md border border-dashed border-border bg-surface2/30 px-3 py-2.5 text-[11px] text-muted leading-relaxed">
          No subtasks yet. Use them as a personal to-do under this stage — e.g.&nbsp;
          <span className="italic">&ldquo;download Jan + Feb scenes&rdquo;</span>,&nbsp;
          <span className="italic">&ldquo;re-mask 2024-03 cloud edge&rdquo;</span>.
          Anyone can tick. Only the author can edit or remove.
        </div>
      )}

      <ul className="space-y-1">
        {subtasks.map(s => {
          const isAuthor = s.author_id === profile.id;
          const editingThis = editId === s.id;
          const isNew = justAddedId === s.id;
          return (
            <li
              key={s.id}
              className={`group flex items-start gap-2 py-1 px-1 rounded-md transition-colors ${isNew ? "bg-accent/10 ring-1 ring-accent/40" : ""}`}
            >
              <input
                type="checkbox"
                checked={s.done}
                onChange={(e) => toggleSubtask(s.id, e.target.checked)}
                className="mt-1 w-4 h-4 cursor-pointer accent-good"
                aria-label={s.done ? "uncheck" : "check"}
              />
              <div className="flex-1 min-w-0">
                {editingThis ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => { renameSubtask(s.id, editValue); setEditId(null); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setEditId(null);
                    }}
                    className="w-full text-sm bg-surface2 border border-border rounded px-2 py-0.5 outline-none focus:border-accent text-ink"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (!isAuthor) return;
                      setEditId(s.id); setEditValue(s.title);
                    }}
                    className={`text-sm text-left w-full ${s.done ? "text-muted2 line-through" : "text-ink"} ${isAuthor ? "hover:underline decoration-dotted underline-offset-4 cursor-text" : "cursor-default"}`}
                    title={isAuthor ? "click to rename · you are the author" : "added by another teammate"}
                  >
                    {s.title}
                    {isNew && (
                      <span className="ml-2 inline-flex items-center gap-1 text-[10px] eyebrow text-accent">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent pulse-soft" />
                        new
                      </span>
                    )}
                  </button>
                )}
                <div className="text-[10px] text-muted2 tabular mt-0.5 flex items-center gap-2 flex-wrap">
                  {s.done && s.completed_at && <span>done · {formatRelative(s.completed_at)}</span>}
                  {isAuthor && !s.done && (
                    <span className="text-muted2/80">your subtask · click to rename</span>
                  )}
                </div>
              </div>
              {isAuthor && !editingThis && (
                <button
                  onClick={() => removeSubtask(s.id)}
                  className="text-[10px] text-muted2 hover:text-crit opacity-0 group-hover:opacity-100 transition-opacity px-1"
                  title="remove · you are the author"
                  aria-label="remove subtask"
                >×</button>
              )}
            </li>
          );
        })}
      </ul>

      <form onSubmit={(e) => { e.preventDefault(); if (input.trim()) { addSubtask(input); setInput(""); } }}>
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-4 inline-flex items-center justify-center text-muted2 text-sm">+</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="add a subtask · only you can edit or remove it"
            maxLength={200}
            className="flex-1 text-sm bg-transparent border-0 border-b border-transparent hover:border-border focus:border-accent outline-none px-1 py-1 text-ink placeholder:text-muted2"
          />
          {input.trim() && (
            <button
              type="submit"
              className="text-[11px] px-2 py-1 rounded bg-ink text-bg font-medium"
            >add</button>
          )}
        </div>
        {showToast && (
          <div
            role="status"
            className="mt-1.5 inline-flex items-center gap-2 px-2 py-1 rounded-md bg-good/10 text-good text-[11px]"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Added. Anyone can tick it — only you can rename or remove it.
          </div>
        )}
      </form>
    </div>
  );
}
