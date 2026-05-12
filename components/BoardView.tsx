"use client";

import { useEffect, useMemo, useState } from "react";
import type { Member, Task, StageKey } from "@/lib/supabase";
import { STAGES } from "@/lib/supabase";
import type { SaveState, ActivityEvent } from "@/lib/useStore";
import type { Profile } from "@/lib/auth";
import { formatRelative } from "@/lib/relativeTime";
import { useTaskCommentCount } from "@/lib/comments";
import { SubtasksList } from "./SubtasksList";

type Status = "todo" | "in_progress" | "done";

function statusOf(task: Task): Status {
  if (task.total <= 0 || task.done <= 0) return "todo";
  if (task.done >= task.total) return "done";
  return "in_progress";
}

const STATUS_LABEL: Record<Status, string> = {
  todo: "to do",
  in_progress: "in progress",
  done: "done",
};

const STATUS_TONE: Record<Status, string> = {
  todo: "bg-surface2 text-muted border-border",
  in_progress: "bg-info/10 text-info border-info/30",
  done: "bg-good/10 text-good border-good/30",
};

export function BoardView({
  members, tasks, saveStates, editing, profile, onPatchTask, onFocusMember,
}: {
  members: { m: Member; pct: number; lastActive: number }[];
  tasks: Task[];
  saveStates: Record<string, SaveState>;
  editing: Record<string, { user: ActivityEvent["user"]; expiresAt: number }>;
  profile: Profile;
  onPatchTask: (id: string, patch: Partial<Task>) => void;
  onFocusMember: (id: string) => void;
}) {
  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 overflow-x-auto pb-3 snap-x snap-mandatory lg:snap-none">
      <div className="flex gap-4 min-w-max">
        {STAGES.map(s => {
          const colTasks = members
            .map(({ m }) => ({
              member: m,
              task: tasks.find(t => t.member_id === m.id && t.stage === s.key),
            }))
            .filter((x): x is { member: Member; task: Task } => !!x.task);

          const totals = colTasks.reduce((acc, { task }) => {
            acc.done += task.done; acc.total += task.total;
            const st = statusOf(task);
            acc[st] += 1;
            return acc;
          }, { done: 0, total: 0, todo: 0, in_progress: 0, done_count: 0 } as { done: number; total: number; todo: number; in_progress: number; done_count: number });
          // status counter uses `done_count` to avoid clashing with the cumulative tile sum above
          const doneCount = colTasks.filter(({ task }) => statusOf(task) === "done").length;
          const inProgressCount = colTasks.filter(({ task }) => statusOf(task) === "in_progress").length;
          const todoCount = colTasks.length - doneCount - inProgressCount;
          const colPct = totals.total > 0 ? (totals.done / totals.total) * 100 : 0;

          return (
            <div
              key={s.key}
              data-stage={s.key}
              className="snap-start w-[22rem] shrink-0 rounded-xl border border-border bg-surface2/30 flex flex-col"
            >
              <div className="px-3 pt-3 pb-2 border-b border-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] eyebrow text-muted2 tabular bg-surface px-1.5 py-0.5 rounded border border-border">{s.short}</span>
                    <span className="text-sm font-semibold text-ink">{s.label}</span>
                  </div>
                  <span className="text-xs tabular text-muted2">{colTasks.length}</span>
                </div>
                <p className="text-[11px] text-muted2 mt-1 truncate" title={s.hint}>{s.hint}</p>
                <div className="mt-2 h-1 rounded-full bg-surface overflow-hidden">
                  <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${colPct}%` }} />
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[10px] tabular text-muted2">
                  <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-muted2" />{todoCount}</span>
                  <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-info" />{inProgressCount}</span>
                  <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-good" />{doneCount}</span>
                  <span className="ml-auto">{totals.done.toLocaleString()}/{totals.total.toLocaleString()} tiles</span>
                </div>
              </div>

              <div className="p-2 space-y-2 max-h-[70vh] overflow-y-auto">
                {colTasks.length === 0 ? (
                  <div className="text-[11px] text-muted2 italic text-center py-6">no cards</div>
                ) : (
                  colTasks.map(({ member, task }) => (
                    <BoardCard
                      key={task.id}
                      member={member}
                      task={task}
                      save={saveStates[task.id]}
                      editingBy={editing[task.id]?.user}
                      profile={profile}
                      onChange={(patch) => onPatchTask(task.id, patch)}
                      onOpen={() => onFocusMember(member.id)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const STATUS_ICON: Record<Status, React.ReactNode> = {
  todo: <span className="w-2 h-2 rounded-full border border-current" />,
  in_progress: <span className="w-2 h-2 rounded-full bg-current pulse-soft" />,
  done: (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
};

function BoardCard({
  member, task, save, editingBy, profile, onChange, onOpen,
}: {
  member: Member;
  task: Task;
  save?: SaveState;
  editingBy?: ActivityEvent["user"];
  profile: Profile;
  onChange: (patch: Partial<Task>) => void;
  onOpen: () => void;
}) {
  const pct = task.total > 0 ? Math.min(100, (task.done / task.total) * 100) : 0;
  const status = statusOf(task);
  const [expanded, setExpanded] = useState(false);
  const [doneBuf, setDoneBuf] = useState(String(task.done));
  const [totalBuf, setTotalBuf] = useState(String(task.total));
  const commentCount = useTaskCommentCount(task.id);

  useEffect(() => { setDoneBuf(String(task.done)); }, [task.done]);
  useEffect(() => { setTotalBuf(String(task.total)); }, [task.total]);

  const step = task.total >= 200 ? 10 : task.total >= 50 ? 5 : 1;

  function commitDone(v: string) {
    const n = Math.max(0, Math.min(task.total, parseInt(v || "0", 10) || 0));
    onChange({ done: n });
    setDoneBuf(String(n));
  }
  function commitTotal(v: string) {
    const n = Math.max(task.done, parseInt(v || "0", 10) || 0);
    onChange({ total: n });
    setTotalBuf(String(n));
  }

  const lastUpdated = formatRelative(task.updated_at);
  const isStale = !!task.updated_at && Date.now() - Date.parse(task.updated_at) > 7 * 86_400_000 && status !== "done";
  const noteSnippet = (() => {
    const note = (task.note ?? "").trim();
    if (!note) return null;
    return note.length > 56 ? note.slice(0, 56) + "…" : note;
  })();

  const cardStyle: React.CSSProperties = {
    borderLeftColor: member.color,
    borderLeftWidth: "4px",
    ...(editingBy ? { boxShadow: `inset 0 0 0 1px ${editingBy.color}66, 0 1px 0 rgb(var(--c-shadow) / 0.04)` } : {}),
  };

  return (
    <div
      className={`group rounded-lg border border-border bg-surface shadow-card hover:shadow-cardHover hover:-translate-y-0.5 hover:border-border2 transition-all ${expanded ? "ring-1 ring-accent/30" : ""}`}
      style={cardStyle}
    >
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full text-left px-3 pt-3 pb-2.5"
        aria-expanded={expanded}
      >
        {/* header row */}
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0"
            style={{ background: `${member.color}1F`, color: member.color }}
          >
            {member.emoji}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-ink truncate">{member.name}</span>
              {isStale && (
                <span title="No updates in 7+ days" className="w-1.5 h-1.5 rounded-full bg-warn pulse-soft shrink-0" />
              )}
            </div>
            <div className="text-[10px] text-muted2 tabular truncate flex items-center gap-1">
              {task.done.toLocaleString()} <span className="text-muted2/70">/</span> {task.total.toLocaleString()}
              <span className="text-muted2/50">·</span>
              <span className="font-semibold text-ink/80">{pct.toFixed(0)}%</span>
            </div>
          </div>
          <span
            className={`inline-flex items-center gap-1 text-[10px] eyebrow px-1.5 py-0.5 rounded border ${STATUS_TONE[status]}`}
            title={STATUS_LABEL[status]}
          >
            {STATUS_ICON[status]}
            <span className="hidden xl:inline">{STATUS_LABEL[status]}</span>
          </span>
          <svg
            width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className="text-muted2 shrink-0 transition-transform duration-200"
            style={{ transform: expanded ? "rotate(180deg)" : "rotate(0)" }}
            aria-hidden
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>

        {/* progress bar */}
        <div className="mt-3 h-1.5 rounded-full bg-surface2 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${pct}%`,
              background: status === "done"
                ? "rgb(var(--c-good))"
                : `linear-gradient(90deg, ${member.color}, ${member.color}cc)`,
            }}
          />
        </div>

        {/* note snippet */}
        {noteSnippet && (
          <div className="mt-2 text-[11px] text-muted line-clamp-2 italic">"{noteSnippet}"</div>
        )}

        {/* metadata chips */}
        <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[10px] tabular text-muted2">
          {commentCount > 0 && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-surface2 text-ink" title={`${commentCount} comments`}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" /></svg>
              {commentCount}
            </span>
          )}
          {save === "saving" && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface2">
              <span className="w-1.5 h-1.5 rounded-full bg-muted2 pulse-soft" /> saving
            </span>
          )}
          {save === "saved" && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-good/10 text-good">
              <span className="w-1.5 h-1.5 rounded-full bg-good" /> saved
            </span>
          )}
          {save === "error" && (
            <span className="px-1.5 py-0.5 rounded bg-crit/10 text-crit">save failed</span>
          )}
          {lastUpdated && (
            <span className="ml-auto" title={task.updated_at ? new Date(task.updated_at).toLocaleString() : ""}>
              {lastUpdated}
            </span>
          )}
        </div>

        {editingBy && (
          <div
            className="mt-2 text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-medium"
            style={{ background: `${editingBy.color}1A`, color: editingBy.color, border: `1px solid ${editingBy.color}40` }}
          >
            <span>{editingBy.emoji}</span>
            {editingBy.name} editing
          </div>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3" onClick={(e) => e.stopPropagation()}>
          <div className="pt-1 border-t border-border" />

          {/* eyebrow + numeric controls */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="eyebrow text-[9px] text-muted2">Progress</div>
              {task.done > 0 && (
                <button
                  onClick={() => commitDone("0")}
                  className="text-[10px] text-muted2 hover:text-crit"
                  title="reset done to 0"
                >reset</button>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => commitDone(String(Math.max(0, task.done - step)))}
                className="w-9 h-9 rounded-md border border-border bg-surface hover:bg-surface2 text-ink text-lg leading-none flex items-center justify-center transition-colors"
                aria-label="decrement"
              >−</button>
              <div className="inline-flex items-center gap-1 px-2 h-9 rounded-md border border-border bg-surface">
                <input
                  type="number" inputMode="numeric"
                  className="w-12 text-right tabular text-sm bg-transparent border-0 outline-none focus:ring-0 px-0 text-ink font-medium"
                  value={doneBuf}
                  onChange={(e) => setDoneBuf(e.target.value)}
                  onBlur={(e) => commitDone(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  aria-label="tiles done"
                />
                <span className="text-[10px] text-muted2">of</span>
                <input
                  type="number" inputMode="numeric"
                  className="w-12 text-left tabular text-sm bg-transparent border-0 outline-none focus:ring-0 px-0 text-muted"
                  value={totalBuf}
                  onChange={(e) => setTotalBuf(e.target.value)}
                  onBlur={(e) => commitTotal(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  aria-label="tiles total"
                />
              </div>
              <button
                onClick={() => commitDone(String(Math.min(task.total, task.done + step)))}
                className="w-9 h-9 rounded-md border border-border bg-surface hover:bg-surface2 text-ink text-lg leading-none flex items-center justify-center transition-colors"
                aria-label="increment"
              >+</button>
              <button
                onClick={() => commitDone(String(task.total))}
                className="ml-auto text-[10px] h-9 px-2.5 rounded-md border border-border text-muted hover:text-ink hover:bg-surface2"
                title="mark complete"
              >set max</button>
            </div>

            <div className="mt-2 flex items-center gap-1 flex-wrap">
              {(task.total >= 200 ? [10, 50, 100] : task.total >= 50 ? [5, 10, 25] : [1, 5, 10]).map(n => (
                <button
                  key={n}
                  onClick={() => commitDone(String(Math.min(task.total, task.done + n)))}
                  className="text-[10px] h-7 px-2 rounded border border-border text-muted hover:text-ink hover:bg-surface2 tabular"
                >+{n}</button>
              ))}
              <button
                onClick={(e) => { e.stopPropagation(); onOpen(); }}
                className="ml-auto text-[10px] h-7 px-2 rounded border border-info/30 text-info hover:bg-info/5 inline-flex items-center gap-1"
                title="Open member card · comments + full controls"
              >
                full details
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17l10-10M17 7H7v10" /></svg>
              </button>
            </div>
          </div>

          <div className="pt-3 border-t border-border">
            <SubtasksList taskId={task.id} profile={profile} accentColor={member.color} />
          </div>
        </div>
      )}
    </div>
  );
}
