"use client";

import { useMemo, useState } from "react";
import type { Profile } from "@/lib/auth";
import { useIssueIndex } from "@/lib/issues";
import { useMembersAndTasksLite } from "@/lib/whiteboard";

export type RefPick = {
  label: string;
  link: string;       // absolute URL, e.g. https://host/issues/3
  color: string;      // text colour for the inserted element
  kind?: "user" | "issue" | "task";
  userId?: string;    // present when kind === "user" — used to fire a notification
  userName?: string;  // mentioned user's display name (for the notification snippet)
};

const STAGE_LABELS: Record<string, string> = {
  data: "Data",
  sr:   "SR",
  gen:  "GenAI",
  feat: "Feat",
  rf:   "RF",
};

function originRoot(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

export function WhiteboardRefPicker({
  profiles, onPick,
}: {
  profiles: Profile[];
  onPick: (pick: RefPick) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"users" | "issues" | "tasks">("users");
  const [query, setQuery] = useState("");
  const issues = useIssueIndex();
  const { members, tasks } = useMembersAndTasksLite();

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return profiles
      .filter(p => !q || p.name.toLowerCase().includes(q))
      .slice(0, 20);
  }, [profiles, query]);

  const filteredIssues = useMemo(() => {
    const q = query.trim().toLowerCase();
    return issues
      .filter(i => !q || String(i.number).startsWith(q) || i.title.toLowerCase().includes(q))
      .slice(0, 20);
  }, [issues, query]);

  // Flatten tasks into {member, stage} pairs for picking.
  const memberById = useMemo(() => {
    const m = new Map<string, typeof members[number]>();
    for (const x of members) m.set(x.id, x);
    return m;
  }, [members]);

  const filteredTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks
      .map(t => ({ task: t, member: memberById.get(t.member_id) }))
      .filter(x => !!x.member)
      .filter(x => {
        if (!q) return true;
        const stage = STAGE_LABELS[x.task.stage] ?? x.task.stage;
        return x.member!.name.toLowerCase().includes(q) || stage.toLowerCase().includes(q);
      })
      .slice(0, 30);
  }, [tasks, memberById, query]);

  function pickUser(p: Profile) {
    onPick({
      label: `@${p.name}`,
      link:  `${originRoot()}/`,
      color: p.color,
      kind: "user",
      userId: p.id,
      userName: p.name,
    });
  }

  function pickIssue(i: { number: number; title: string }) {
    onPick({
      label: `#${i.number} ${i.title}`,
      link:  `${originRoot()}/issues/${i.number}`,
      color: "#1971C2",
      kind: "issue",
    });
  }

  function pickTask(member: NonNullable<typeof members[number]>, stage: string) {
    const stageLabel = STAGE_LABELS[stage] ?? stage;
    onPick({
      label: `${member.emoji} ${member.name} · ${stageLabel}`,
      link:  `${originRoot()}/#member-${member.id}`,
      color: member.color,
      kind: "task",
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute top-3 right-3 z-[401] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-surface/95 backdrop-blur text-ink hover:bg-surface2 shadow-card text-[11px] font-medium"
        title="Insert a labelled reference (user · issue · task)"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.71" />
        </svg>
        <span>Reference</span>
      </button>
    );
  }

  return (
    <div className="absolute top-3 right-3 z-[401] w-[18rem] rounded-md border border-border bg-surface/95 backdrop-blur shadow-cardHover">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border">
        <span className="text-[10px] eyebrow text-muted2">Insert reference</span>
        <button onClick={() => setOpen(false)} className="text-muted2 hover:text-ink text-base leading-none" aria-label="close">×</button>
      </div>

      <div className="flex items-center gap-0.5 px-2 pt-2 pb-1">
        {(["users", "issues", "tasks"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-[10px] tabular px-2 py-0.5 rounded ${tab === t ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}
            role="tab"
            aria-selected={tab === t}
          >
            {t === "users" ? `@ Users · ${profiles.length}`
              : t === "issues" ? `# Issues · ${issues.length}`
              : `! Tasks · ${tasks.length}`}
          </button>
        ))}
      </div>

      <div className="px-2 pb-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tab === "users" ? "search name…" : tab === "issues" ? "search title or #N…" : "search member or stage…"}
          className="w-full text-xs bg-surface2 border border-border rounded px-2 py-1 text-ink placeholder:text-muted2 outline-none focus:border-accent"
          autoFocus
        />
      </div>

      <div className="max-h-[40vh] overflow-y-auto pb-1.5">
        {tab === "users" && (
          filteredUsers.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-muted2 italic">no match</div>
          ) : filteredUsers.map(p => (
            <button
              key={p.id}
              onClick={() => pickUser(p)}
              className="w-full flex items-center gap-2 text-left px-2 py-1.5 text-xs hover:bg-surface2"
            >
              <span
                className="inline-flex items-center justify-center w-5 h-5 rounded-full shrink-0 text-[11px]"
                style={{ background: `${p.color}1A`, color: p.color, border: `1px solid ${p.color}55` }}
              >{p.emoji}</span>
              <span className="text-ink truncate">{p.name}</span>
              {p.email && <span className="text-muted2 text-[10px] truncate ml-auto">{p.email}</span>}
            </button>
          ))
        )}

        {tab === "issues" && (
          filteredIssues.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-muted2 italic">no issue matches</div>
          ) : filteredIssues.map(i => {
            const closed = i.status === "closed";
            return (
              <button
                key={i.number}
                onClick={() => pickIssue(i)}
                className="w-full flex items-center gap-2 text-left px-2 py-1.5 text-xs hover:bg-surface2"
                title={i.title}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${closed ? "bg-muted2" : "bg-good"}`} />
                <span className="tabular text-accent2 font-medium shrink-0">#{i.number}</span>
                <span className={`truncate ${closed ? "text-muted2 line-through" : "text-ink"}`}>{i.title}</span>
              </button>
            );
          })
        )}

        {tab === "tasks" && (
          filteredTasks.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-muted2 italic">no task matches</div>
          ) : filteredTasks.map(({ task, member }) => (
            <button
              key={task.id}
              onClick={() => pickTask(member!, task.stage)}
              className="w-full flex items-center gap-2 text-left px-2 py-1.5 text-xs hover:bg-surface2"
            >
              <span
                className="inline-flex items-center justify-center w-5 h-5 rounded-md shrink-0 text-[11px]"
                style={{ background: `${member!.color}1A`, color: member!.color }}
              >{member!.emoji}</span>
              <span className="text-ink truncate">{member!.name}</span>
              <span className="text-muted2 text-[10px] tabular shrink-0 ml-auto">{STAGE_LABELS[task.stage] ?? task.stage}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
