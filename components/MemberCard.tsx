"use client";

import { useState, useMemo } from "react";
import type { Member, Task } from "@/lib/supabase";
import { STAGES } from "@/lib/supabase";
import { computeProgress } from "@/lib/progress";
import { StageRow } from "./StageRow";
import type { SaveState, ActivityEvent } from "@/lib/useStore";
import type { Profile } from "@/lib/auth";

export function MemberCard({
  member, tasks, focused, onFocus, onPatchTask, onPatchMember, onRemove, saveStates, editing, profile, profiles,
}: {
  member: Member;
  tasks: Task[];
  focused: boolean;
  onFocus: () => void;
  onPatchTask: (id: string, patch: Partial<Task>) => void;
  onPatchMember: (patch: Partial<Member>) => void;
  onRemove: () => void;
  saveStates: Record<string, SaveState>;
  editing: Record<string, { user: ActivityEvent["user"]; expiresAt: number }>;
  profile: Profile;
  profiles: Profile[];
}) {
  const [open, setOpen] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const myTasks = useMemo(() => {
    const byStage = new Map(tasks.map(t => [t.stage, t]));
    return STAGES.map(s => ({ stage: s, task: byStage.get(s.key)! })).filter(x => x.task);
  }, [tasks]);

  const stats = useMemo(() => computeProgress(myTasks.map(x => x.task)), [myTasks]);
  const memberSave = saveStates[member.id];

  return (
    <div
      className={`bg-surface rounded-xl2 border transition-shadow ${focused ? "shadow-cardHover border-border2" : "shadow-card border-border"}`}
    >
      <div
        className="flex items-center gap-3 p-4 cursor-pointer group/header"
        onClick={() => { onFocus(); setOpen(o => !o); }}
      >
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
             style={{ background: `${member.color}1A`, color: member.color }}>
          {member.emoji}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {editingName ? (
              <input
                autoFocus
                defaultValue={member.name}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => { onPatchMember({ name: e.target.value || member.name }); setEditingName(false); }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingName(false); }}
                className="text-base font-semibold bg-surface2 border border-border rounded px-2 py-0.5 outline-none"
              />
            ) : (
              <button
                type="button"
                className="text-base font-semibold text-ink truncate inline-flex items-center gap-1 hover:underline decoration-dotted underline-offset-4"
                onClick={(e) => { e.stopPropagation(); setEditingName(true); }}
                title="rename"
              >
                {member.name}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                     className="opacity-0 group-hover/header:opacity-60 transition-opacity">
                  <path d="M12 20h9M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
              </button>
            )}
            <select
              value={member.quadrant}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onPatchMember({ quadrant: e.target.value as Member["quadrant"] })}
              className="text-xs bg-surface2 border border-border rounded px-1.5 py-0.5 text-muted outline-none"
              title="quadrant assignment"
            >
              <option value="NW">NW</option>
              <option value="NE">NE</option>
              <option value="SW">SW</option>
              <option value="SE">SE</option>
              <option value="ALL">ALL</option>
            </select>
            {memberSave === "saving" && (
              <span className="text-[10px] text-muted2 inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-muted2 pulse-soft" />saving</span>
            )}
            {memberSave === "saved" && (
              <span className="text-[10px] text-good inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-good" />saved</span>
            )}
            {memberSave === "error" && (
              <span className="text-[10px] text-crit">save failed</span>
            )}
          </div>
          <div className="h-1.5 mt-2 w-full rounded-full bg-surface2 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500"
                 style={{ width: `${stats.weightedPct}%`, background: member.color }} />
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="text-xl font-semibold tabular" style={{ color: member.color }}>{stats.weightedPct.toFixed(0)}%</div>
          <div className="text-[10px] uppercase tracking-wider text-muted2 tabular"
               title="tiles done / tiles total · stage-avg shown in parens">
            {stats.done.toLocaleString()} / {stats.total.toLocaleString()} <span className="text-muted2">({stats.avgStagesPct.toFixed(0)}% stage-avg)</span>
          </div>
        </div>

        <button
          onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
          className="w-7 h-7 rounded-md hover:bg-surface2 flex items-center justify-center text-muted"
          aria-label={open ? "collapse" : "expand"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               style={{ transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s" }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="border-t border-border px-3 py-2 space-y-1">
          {myTasks.map(({ stage, task }) => (
            <StageRow
              key={stage.key}
              task={task}
              label={stage.label}
              short={stage.short}
              hint={stage.hint}
              color={member.color}
              save={saveStates[task.id]}
              editingBy={editing[task.id]?.user}
              profile={profile}
              profiles={profiles}
              onChange={(patch) => onPatchTask(task.id, patch)}
            />
          ))}
          <div className="pt-2 px-3 pb-1 flex items-center justify-between text-xs text-muted2">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              color
              <input type="color" value={member.color}
                     onChange={(e) => onPatchMember({ color: e.target.value })}
                     className="w-6 h-6 rounded border border-border align-middle bg-transparent" />
            </label>
            {confirmRemove ? (
              <span className="inline-flex items-center gap-2">
                <span className="text-crit">Remove {member.name}?</span>
                <button
                  onClick={() => { setConfirmRemove(false); onRemove(); }}
                  className="px-2 py-0.5 rounded bg-crit text-bg hover:bg-crit/90"
                >yes, remove</button>
                <button
                  onClick={() => setConfirmRemove(false)}
                  className="px-2 py-0.5 rounded border border-border hover:bg-surface2"
                >cancel</button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmRemove(true)}
                className="text-crit hover:underline"
              >remove member</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
