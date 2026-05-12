"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  useIssueByNumber, useIssueComments, useIssueIndex,
  setIssueStatus, updateIssue, deleteIssue,
  DEFAULT_LABELS, type IssueComment,
} from "@/lib/issues";
import { LabelChip } from "./LabelChip";
import { MentionInput } from "./MentionInput";
import { renderRichHTML } from "@/lib/mentions";
import { formatRelative } from "@/lib/relativeTime";
import type { Profile } from "@/lib/auth";

export function IssueDetail({
  number, profile, profiles,
}: {
  number: number;
  profile: Profile;
  profiles: Profile[];
}) {
  const { issue, loading } = useIssueByNumber(number);
  const { comments, addComment, editComment, deleteComment } =
    useIssueComments(issue?.id ?? null);
  const issueIndexAll = useIssueIndex();
  // Strip the issue we're viewing from its own picker so #123 doesn't
  // suggest itself when commenting on issue #123.
  const issueIndex = useMemo(
    () => issueIndexAll.filter(i => i.number !== number),
    [issueIndexAll, number],
  );

  const profileById = useMemo(() => {
    const m: Record<string, Profile> = {};
    for (const p of profiles) m[p.id] = p;
    return m;
  }, [profiles]);

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [editTitle, setEditTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editBody, setEditBody] = useState(false);
  const [bodyDraft, setBodyDraft] = useState("");
  const [labelPickerOpen, setLabelPickerOpen] = useState(false);

  if (loading) {
    return <div className="text-center py-10 text-sm text-muted2">loading issue…</div>;
  }
  if (!issue) {
    return (
      <div className="text-center py-16 rounded-xl2 border-2 border-dashed border-border">
        <div className="text-3xl mb-2">🔍</div>
        <div className="text-sm text-ink font-medium">Issue #{number} not found</div>
        <Link href="/issues" className="mt-3 inline-block text-xs text-info hover:underline">← back to all issues</Link>
      </div>
    );
  }

  const author   = profileById[issue.author_id];
  const assignee = issue.assignee_id ? profileById[issue.assignee_id] : null;
  const isAuthor = profile.id === issue.author_id;
  const isOpen   = issue.status === "open";

  async function toggleStatus() {
    if (!issue) return;
    await setIssueStatus(issue.id, isOpen ? "closed" : "open", profile);
  }

  async function submitComment() {
    if (!issue || busy) return;
    const t = draft.trim();
    if (!t) return;
    setBusy(true);
    try {
      const c = await addComment(t, profile, profiles);
      if (c) setDraft("");
    } finally {
      setBusy(false);
    }
  }

  async function saveTitle() {
    if (!issue) return;
    const t = titleDraft.trim();
    if (t && t !== issue.title) await updateIssue(issue.id, { title: t });
    setEditTitle(false);
  }

  async function saveBody() {
    if (!issue) return;
    await updateIssue(issue.id, { body: bodyDraft });
    setEditBody(false);
  }

  async function toggleLabel(name: string) {
    if (!issue) return;
    const next = issue.labels.includes(name)
      ? issue.labels.filter(l => l !== name)
      : [...issue.labels, name];
    await updateIssue(issue.id, { labels: next });
  }

  async function setAssignee(id: string) {
    if (!issue) return;
    await updateIssue(issue.id, { assignee_id: id || null });
  }

  async function handleDelete() {
    if (!issue) return;
    if (!confirm(`Delete issue #${issue.number}? This cannot be undone.`)) return;
    await deleteIssue(issue.id);
    if (typeof window !== "undefined") window.location.href = "/issues";
  }

  const allLabels = Array.from(new Set([...DEFAULT_LABELS, ...issue.labels]));

  return (
    <section className="space-y-6">
      <div>
        <Link href="/issues" className="text-[11px] text-muted hover:text-ink inline-flex items-center gap-1">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
          all issues
        </Link>

        <div className="mt-2 flex items-start justify-between gap-3 flex-wrap">
          {editTitle ? (
            <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setEditTitle(false); }}
                className="flex-1 min-w-[200px] text-xl font-bold bg-surface2 border border-border rounded-md px-2 py-1 text-ink outline-none focus:border-accent"
              />
              <button onClick={saveTitle} className="text-xs px-2.5 py-1.5 rounded-md bg-accent text-white hover:brightness-110">Save</button>
              <button onClick={() => setEditTitle(false)} className="text-xs px-2.5 py-1.5 rounded-md border border-border text-muted hover:text-ink">Cancel</button>
            </div>
          ) : (
            <h1 className="text-2xl font-bold text-ink leading-tight break-words">
              {issue.title}
              <span className="text-muted2 font-normal tabular ml-2">#{issue.number}</span>
              {isAuthor && (
                <button
                  onClick={() => { setEditTitle(true); setTitleDraft(issue.title); }}
                  className="ml-2 text-[11px] text-muted hover:text-ink"
                  title="rename"
                >edit</button>
              )}
            </h1>
          )}

          <div className="flex items-center gap-2 shrink-0">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${isOpen ? "bg-good/15 text-good border border-good/40" : "bg-muted2/15 text-muted2 border border-muted2/40"}`}
            >
              {isOpen ? (
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="8" cy="8" r="7" /><circle cx="8" cy="8" r="2.5" fill="currentColor" /></svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="7" /><path d="M4.5 8.5 7 11l5-5" fill="none" stroke="white" strokeWidth="2" /></svg>
              )}
              {isOpen ? "Open" : "Closed"}
            </span>
            <button
              onClick={toggleStatus}
              className="text-xs px-3 py-1.5 rounded-md border border-border text-muted hover:text-ink hover:bg-surface2"
            >{isOpen ? "Close issue" : "Reopen"}</button>
            {isAuthor && (
              <button
                onClick={handleDelete}
                className="text-xs px-2 py-1.5 rounded-md text-crit hover:bg-crit/10"
                title="delete this issue"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
              </button>
            )}
          </div>
        </div>

        <div className="mt-2 text-[11px] text-muted2 tabular">
          {author && <><span className="text-ink/80">{author.emoji} {author.name}</span> opened {formatRelative(issue.created_at)}</>}
          <span className="mx-1">·</span>
          {comments.length} comment{comments.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3 space-y-4">
          <CommentBlock
            author={author}
            createdAt={issue.created_at}
            editedAt={null}
            body={issue.body || "_(no description)_"}
            profiles={profiles}
            editable={isAuthor && !editBody}
            onEdit={() => { setEditBody(true); setBodyDraft(issue.body); }}
          />
          {editBody && (
            <div className="rounded-xl2 border border-border bg-surface p-4 space-y-3">
              <MentionInput
                value={bodyDraft}
                onChange={setBodyDraft}
                profiles={profiles}
                issues={issueIndex}
                rows={6}
              />
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setEditBody(false)} className="text-xs px-3 py-1.5 rounded-md border border-border text-muted hover:text-ink">Cancel</button>
                <button onClick={saveBody} className="text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:brightness-110">Save</button>
              </div>
            </div>
          )}

          {comments.map(c => (
            <IssueCommentBlock
              key={c.id}
              comment={c}
              author={profileById[c.author_id]}
              profile={profile}
              profiles={profiles}
              issues={issueIndex}
              onEdit={(body) => editComment(c.id, body, profiles)}
              onDelete={async () => {
                if (!confirm("Delete this comment?")) return;
                await deleteComment(c.id);
              }}
            />
          ))}

          <div className="rounded-xl2 border border-border bg-surface p-4 space-y-3">
            <div className="text-[10px] eyebrow text-muted2">Reply</div>
            <MentionInput
              value={draft}
              onChange={setDraft}
              profiles={profiles}
              issues={issueIndex}
              placeholder="Write a comment. Use @ to mention, #123 to link an issue. Ctrl/⌘+Enter to send."
              onSubmit={submitComment}
              rows={3}
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={submitComment}
                disabled={busy || !draft.trim()}
                className="text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:brightness-110 disabled:opacity-50"
              >{busy ? "sending…" : "Comment"}</button>
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl2 border border-border bg-surface p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] eyebrow text-muted2">Labels</div>
              <button
                onClick={() => setLabelPickerOpen(o => !o)}
                className="text-[10px] text-muted hover:text-ink"
              >{labelPickerOpen ? "done" : "edit"}</button>
            </div>
            {issue.labels.length === 0 && !labelPickerOpen && (
              <div className="text-xs text-muted2 italic">none</div>
            )}
            <div className="flex items-center gap-1.5 flex-wrap">
              {issue.labels.map(l => (
                <LabelChip key={l} name={l} size="md" onRemove={labelPickerOpen ? () => toggleLabel(l) : undefined} />
              ))}
            </div>
            {labelPickerOpen && (
              <div className="pt-2 mt-2 border-t border-border flex items-center gap-1.5 flex-wrap">
                {allLabels.filter(l => !issue.labels.includes(l)).map(l => (
                  <button key={l} onClick={() => toggleLabel(l)} className="opacity-60 hover:opacity-100">
                    <LabelChip name={l} size="md" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl2 border border-border bg-surface p-4 space-y-2">
            <div className="text-[10px] eyebrow text-muted2">Assignee</div>
            <select
              value={issue.assignee_id ?? ""}
              onChange={(e) => setAssignee(e.target.value)}
              className="w-full text-sm bg-surface2 border border-border rounded-md px-2 py-1.5 text-ink outline-none focus:border-accent"
            >
              <option value="">— unassigned —</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>
              ))}
            </select>
            {assignee && (
              <div className="text-[11px] text-muted2">
                Working on this · <span className="text-ink/80">{assignee.emoji} {assignee.name}</span>
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

function CommentBlock({
  author, createdAt, editedAt, body, profiles, editable, onEdit,
}: {
  author?: Profile;
  createdAt: string;
  editedAt: string | null;
  body: string;
  profiles: Profile[];
  editable?: boolean;
  onEdit?: () => void;
}) {
  const html = useMemo(() => renderRichHTML(body, profiles), [body, profiles]);
  return (
    <div className="rounded-xl2 border border-border bg-surface">
      <div className="px-4 py-2 flex items-center justify-between gap-2 border-b border-border bg-surface2/40">
        <div className="text-xs text-muted">
          {author ? (
            <>
              <span className="font-medium" style={{ color: author.color }}>{author.emoji} {author.name}</span>
              <span className="text-muted2"> · commented {formatRelative(createdAt)}</span>
            </>
          ) : (
            <span className="text-muted2">unknown · {formatRelative(createdAt)}</span>
          )}
          {editedAt && <span className="text-muted2 ml-1">(edited)</span>}
        </div>
        {editable && onEdit && (
          <button onClick={onEdit} className="text-[10px] text-muted hover:text-ink">edit</button>
        )}
      </div>
      <div
        className="px-4 py-3 text-sm text-ink whitespace-pre-wrap break-words leading-relaxed"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function IssueCommentBlock({
  comment, author, profile, profiles, issues, onEdit, onDelete,
}: {
  comment: IssueComment;
  author?: Profile;
  profile: Profile;
  profiles: Profile[];
  issues?: { number: number; title: string; status?: "open" | "closed" }[];
  onEdit: (body: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [busy, setBusy] = useState(false);
  const isAuthor = profile.id === comment.author_id;

  async function save() {
    setBusy(true);
    try {
      await onEdit(draft);
      setEditing(false);
    } finally { setBusy(false); }
  }

  if (editing) {
    return (
      <div className="rounded-xl2 border border-border bg-surface p-4 space-y-3">
        <MentionInput value={draft} onChange={setDraft} profiles={profiles} issues={issues} rows={4} />
        <div className="flex items-center justify-end gap-2">
          <button onClick={() => { setEditing(false); setDraft(comment.body); }} className="text-xs px-3 py-1.5 rounded-md border border-border text-muted hover:text-ink">Cancel</button>
          <button onClick={save} disabled={busy} className="text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:brightness-110 disabled:opacity-50">{busy ? "saving…" : "Save"}</button>
        </div>
      </div>
    );
  }

  const html = renderRichHTML(comment.body, profiles);
  return (
    <div className="rounded-xl2 border border-border bg-surface">
      <div className="px-4 py-2 flex items-center justify-between gap-2 border-b border-border bg-surface2/40">
        <div className="text-xs text-muted">
          {author ? (
            <>
              <span className="font-medium" style={{ color: author.color }}>{author.emoji} {author.name}</span>
              <span className="text-muted2"> · {formatRelative(comment.created_at)}</span>
            </>
          ) : (
            <span className="text-muted2">unknown · {formatRelative(comment.created_at)}</span>
          )}
          {comment.edited_at && <span className="text-muted2 ml-1">(edited)</span>}
        </div>
        {isAuthor && (
          <div className="flex items-center gap-2">
            <button onClick={() => setEditing(true)} className="text-[10px] text-muted hover:text-ink">edit</button>
            <button onClick={onDelete} className="text-[10px] text-muted hover:text-crit">delete</button>
          </div>
        )}
      </div>
      <div
        className="px-4 py-3 text-sm text-ink whitespace-pre-wrap break-words leading-relaxed"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
