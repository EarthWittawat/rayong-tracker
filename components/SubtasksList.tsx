"use client";

import { useState } from "react";
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

  const total = subtasks.length;
  const doneCount = subtasks.filter(s => s.done).length;
  const pct = total > 0 ? (doneCount / total) * 100 : 0;
  const accent = accentColor ?? "rgb(var(--c-good))";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px] eyebrow text-muted2">
        <span>Subtasks</span>
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

      <ul className="space-y-1">
        {subtasks.map(s => {
          const isAuthor = s.author_id === profile.id;
          const editingThis = editId === s.id;
          return (
            <li key={s.id} className="group flex items-start gap-2 py-1">
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
                    title={isAuthor ? "click to rename (you are the author)" : ""}
                  >
                    {s.title}
                  </button>
                )}
                {s.done && s.completed_at && (
                  <div className="text-[10px] text-muted2 tabular mt-0.5">
                    done · {formatRelative(s.completed_at)}
                  </div>
                )}
              </div>
              {isAuthor && !editingThis && (
                <button
                  onClick={() => removeSubtask(s.id)}
                  className="text-[10px] text-muted2 hover:text-crit opacity-0 group-hover:opacity-100 transition-opacity px-1"
                  title="remove (you are the author)"
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
            placeholder="add a subtask"
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
      </form>
    </div>
  );
}
