"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useIssueList, useIssueCounts, useIssueCommentCount, type Issue, type IssueStatus } from "@/lib/issues";
import { LabelChip } from "./LabelChip";
import { NewIssueModal } from "./NewIssueModal";
import { formatRelative } from "@/lib/relativeTime";
import type { Profile } from "@/lib/auth";

export function IssuesPanel({ profile, profiles }: { profile: Profile; profiles: Profile[] }) {
  const [filter, setFilter] = useState<IssueStatus | "all">("open");
  const [query, setQuery] = useState("");
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [authorFilter, setAuthorFilter] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const counts = useIssueCounts();
  const { items, loading } = useIssueList(filter);

  const profileById = useMemo(() => {
    const m: Record<string, Profile> = {};
    for (const p of profiles) m[p.id] = p;
    return m;
  }, [profiles]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(i => {
      if (q && !i.title.toLowerCase().includes(q) && !i.body.toLowerCase().includes(q)) return false;
      if (labelFilter && !i.labels.includes(labelFilter)) return false;
      if (authorFilter && i.author_id !== authorFilter) return false;
      return true;
    });
  }, [items, query, labelFilter, authorFilter]);

  const allLabels = useMemo(() => {
    const s = new Set<string>();
    for (const i of items) for (const l of i.labels) s.add(l);
    return Array.from(s).sort();
  }, [items]);

  return (
    <section className="space-y-4">
      <header className="flex items-end justify-between gap-3 flex-wrap pb-2 border-b border-border">
        <div>
          <h2 className="text-2xl font-bold text-ink">Issues</h2>
          <p className="text-xs text-muted mt-1">Discuss bugs, ideas, blockers. Anyone signed in can open or comment.</p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="text-[11px] eyebrow inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-accent text-white hover:brightness-110 transition-all"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          New issue
        </button>
      </header>

      <div className="rounded-lg border border-border bg-surface p-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-md border border-border bg-surface2 p-0.5" role="tablist" aria-label="filter status">
          {([
            { k: "open",   label: `Open · ${counts.open}` },
            { k: "closed", label: `Closed · ${counts.closed}` },
            { k: "all",    label: "All" },
          ] as const).map(t => (
            <button
              key={t.k}
              onClick={() => setFilter(t.k)}
              role="tab"
              aria-selected={filter === t.k}
              className={`text-[11px] tabular px-2.5 py-1 rounded transition-colors ${filter === t.k ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}
            >{t.label}</button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted2 pointer-events-none">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search title + body…"
            className="w-full pl-8 pr-2 py-1.5 text-xs rounded-md bg-surface2 border border-border text-ink placeholder:text-muted2 outline-none focus:border-accent"
          />
        </div>

        {allLabels.length > 0 && (
          <select
            value={labelFilter ?? ""}
            onChange={(e) => setLabelFilter(e.target.value || null)}
            className="text-xs bg-surface2 border border-border rounded-md px-2 py-1.5 text-ink outline-none focus:border-accent"
          >
            <option value="">all labels</option>
            {allLabels.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        )}

        <select
          value={authorFilter ?? ""}
          onChange={(e) => setAuthorFilter(e.target.value || null)}
          className="text-xs bg-surface2 border border-border rounded-md px-2 py-1.5 text-ink outline-none focus:border-accent"
        >
          <option value="">any author</option>
          {profiles.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-10 text-sm text-muted2">loading issues…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 rounded-xl2 border-2 border-dashed border-border">
          <div className="text-3xl mb-2">🗒️</div>
          <div className="text-sm text-ink font-medium">No matching issues</div>
          <div className="text-xs text-muted2 mt-1 mb-4">Try another filter or open a new issue.</div>
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-ink text-bg hover:opacity-90"
          >+ new issue</button>
        </div>
      ) : (
        <div className="rounded-xl2 border border-border bg-surface overflow-hidden divide-y divide-border">
          {filtered.map(i => (
            <IssueRow
              key={i.id}
              issue={i}
              author={profileById[i.author_id]}
              assignee={i.assignee_id ? profileById[i.assignee_id] : undefined}
            />
          ))}
        </div>
      )}

      <NewIssueModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        profile={profile}
        profiles={profiles}
        onCreated={() => setModalOpen(false)}
      />
    </section>
  );
}

function IssueRow({ issue, author, assignee }: { issue: Issue; author?: Profile; assignee?: Profile }) {
  const cc = useIssueCommentCount(issue.id);
  return (
    <Link
      href={`/issues/${issue.number}`}
      className="block px-4 py-3 hover:bg-surface2/60 transition-colors"
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full shrink-0"
          style={{ color: issue.status === "open" ? "rgb(var(--c-good))" : "rgb(var(--c-muted2))" }}
          title={issue.status}
        >
          {issue.status === "open" ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="8" cy="8" r="2.5" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="7" /><path d="M4.5 8.5 7 11l5-5" fill="none" stroke="white" strokeWidth="2" /></svg>
          )}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <span className="text-sm font-semibold text-ink">{issue.title}</span>
              {issue.labels.length > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 align-middle flex-wrap">
                  {issue.labels.map(l => <LabelChip key={l} name={l} />)}
                </span>
              )}
              <div className="text-[11px] text-muted2 tabular mt-1">
                #{issue.number} opened {formatRelative(issue.created_at)}
                {author && <> by <span className="text-ink/80">{author.emoji} {author.name}</span></>}
                {issue.status === "closed" && issue.closed_at && <> · closed {formatRelative(issue.closed_at)}</>}
              </div>
            </div>
            <div className="flex items-center gap-2 text-[11px] tabular text-muted2 shrink-0">
              {assignee && (
                <span
                  title={`assigned to ${assignee.name}`}
                  className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs"
                  style={{ background: `${assignee.color}1F`, color: assignee.color, border: `1px solid ${assignee.color}55` }}
                >
                  {assignee.emoji}
                </span>
              )}
              {cc > 0 && (
                <span className="inline-flex items-center gap-1">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" /></svg>
                  {cc}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
