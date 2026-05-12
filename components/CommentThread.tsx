"use client";

import { useMemo, useRef, useState } from "react";
import { useTaskComments, type CommentRow } from "@/lib/comments";
import { MentionInput } from "./MentionInput";
import { AttachmentChip } from "./AttachmentPreview";
import { uploadAttachment, MAX_FILE_BYTES, humanSize, removeAttachment } from "@/lib/storage";
import { parseMentions, renderRichHTML } from "@/lib/mentions";
import { useIssueIndex } from "@/lib/issues";
import type { Profile } from "@/lib/auth";

function relTime(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function CommentThread({
  taskId, profile, profiles,
}: {
  taskId: string;
  profile: Profile;
  profiles: Profile[];
}) {
  const { comments, attachments, loading, addComment, editComment, deleteComment } = useTaskComments(taskId);
  const issueIndex = useIssueIndex();
  const [body, setBody] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [notify, setNotify] = useState<{ names: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function startEdit(c: CommentRow) {
    setEditingId(c.id);
    setEditDraft(c.body);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditDraft("");
  }
  async function saveEdit(c: CommentRow) {
    if (editBusy) return;
    setEditBusy(true);
    try {
      await editComment(c.id, editDraft, profiles);
      cancelEdit();
    } finally {
      setEditBusy(false);
    }
  }
  async function handleDelete(c: CommentRow) {
    if (!confirm("Delete this comment?")) return;
    await deleteComment(c.id);
  }

  const profileById = useMemo(() => {
    const m: Record<string, Profile> = {};
    for (const p of profiles) m[p.id] = p;
    return m;
  }, [profiles]);

  const liveMentions = useMemo(
    () => parseMentions(body, profiles).map(x => x.name),
    [body, profiles],
  );

  function pickFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const next: File[] = [...pendingFiles];
    for (const f of Array.from(files)) {
      if (f.size > MAX_FILE_BYTES) {
        setError(`"${f.name}" is ${humanSize(f.size)} (limit 5 MB).`);
        continue;
      }
      if (next.length >= 4) {
        setError("Max 4 files per comment.");
        break;
      }
      next.push(f);
    }
    setPendingFiles(next);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submit() {
    if (busy) return;
    const trimmed = body.trim();
    if (!trimmed && pendingFiles.length === 0) return;
    // Capture mention names BEFORE clearing the input so the toast can
    // tell the author who was notified.
    const submittedMentions = parseMentions(trimmed, profiles).map(m => m.name);
    setBusy(true); setError(null);
    try {
      const newComment = await addComment(trimmed || "(attachment)", profile, profiles);
      if (!newComment) throw new Error("could not save comment");
      for (const f of pendingFiles) {
        try {
          await uploadAttachment(f, { taskId, commentId: newComment.id, uploaderId: profile.id });
        } catch (e) {
          setError(e instanceof Error ? e.message : "upload failed");
        }
      }
      setBody("");
      setPendingFiles([]);
      if (submittedMentions.length > 0) {
        setNotify({ names: submittedMentions });
        setTimeout(() => setNotify(null), 5000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "send failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {loading && <div className="text-[11px] text-muted2">loading…</div>}

      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {comments.length === 0 && !loading && (
          <div className="text-[11px] text-muted2 italic">No comments yet. Use @ to mention a teammate.</div>
        )}
        {comments.map(c => {
          const author = profileById[c.author_id];
          const atts = attachments[c.id] ?? [];
          const isMine = c.author_id === profile.id;
          return (
            <div key={c.id} className="flex gap-2">
              <div className="shrink-0">
                {author?.avatar_url ? (
                  <img src={author.avatar_url} alt={author.name}
                       className="w-7 h-7 rounded-full object-cover ring-1"
                       style={{ boxShadow: `inset 0 0 0 1px ${author.color}` }} />
                ) : (
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm"
                       style={{ background: `${author?.color ?? "#999"}1A`, color: author?.color ?? "#999", border: `1px solid ${author?.color ?? "#999"}` }}>
                    {author?.emoji ?? "?"}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] flex items-center gap-2 group/row">
                  <span className="font-medium" style={{ color: author?.color }}>{author?.name ?? "unknown"}</span>
                  <span className="text-muted2 tabular">{relTime(c.created_at)}</span>
                  {c.edited_at && <span className="text-muted2 text-[10px]">edited</span>}
                  {isMine && editingId !== c.id && (
                    <span className="ml-auto inline-flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => startEdit(c)}
                        title="Edit comment"
                        aria-label="Edit"
                        className="w-6 h-6 rounded hover:bg-surface2 text-muted hover:text-ink inline-flex items-center justify-center"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(c)}
                        title="Delete comment"
                        aria-label="Delete"
                        className="w-6 h-6 rounded hover:bg-crit/10 text-muted hover:text-crit inline-flex items-center justify-center"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                        </svg>
                      </button>
                    </span>
                  )}
                </div>

                {editingId === c.id ? (
                  <div className="mt-1.5 rounded-md border border-border bg-surface2/60 p-2">
                    <textarea
                      autoFocus
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                        else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEdit(c); }
                      }}
                      rows={2}
                      className="w-full text-sm bg-surface border border-border rounded p-2 text-ink outline-none focus:border-accent resize-y"
                      placeholder="Edit comment…"
                    />
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-[10px] text-muted2">
                        <kbd className="px-1 rounded bg-surface border border-border tabular text-[9px]">⌘/Ctrl+↵</kbd> save · <kbd className="px-1 rounded bg-surface border border-border tabular text-[9px]">Esc</kbd> cancel
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="text-[11px] px-2 py-1 rounded border border-border text-muted hover:text-ink hover:bg-surface2"
                        >Cancel</button>
                        <button
                          type="button"
                          onClick={() => saveEdit(c)}
                          disabled={editBusy || editDraft.trim() === c.body.trim() || !editDraft.trim()}
                          className="text-[11px] px-2 py-1 rounded bg-ink text-bg font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                        >{editBusy ? "saving…" : "Save"}</button>
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-ink whitespace-pre-wrap break-words"
                       dangerouslySetInnerHTML={{ __html: renderCommentBody(c, profiles) }} />
                )}

                {atts.length > 0 && editingId !== c.id && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {atts.map(a => (
                      <AttachmentChip
                        key={a.id}
                        att={a}
                        onRemove={a.uploader_id === profile.id ? () => removeAttachment(a) : undefined}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-border pt-2 space-y-2">
        <MentionInput
          value={body}
          onChange={setBody}
          onSubmit={submit}
          profiles={profiles}
          issues={issueIndex}
          placeholder="Comment… ⌘/Ctrl+Enter to send. @user to mention · #123 to link an issue."
          rows={2}
          disabled={busy}
        />
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {pendingFiles.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border bg-surface text-[11px]">
                <span>📎</span>
                <span className="text-ink truncate max-w-[12rem]">{f.name}</span>
                <span className="text-muted2 tabular">{humanSize(f.size)}</span>
                <button onClick={() => setPendingFiles(pendingFiles.filter((_, j) => j !== i))}
                        className="text-muted hover:text-crit" aria-label="remove">✕</button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[10px] text-muted2">
            <label className="inline-flex items-center gap-1 cursor-pointer hover:text-ink">
              <input ref={fileRef} type="file" multiple className="hidden"
                     onChange={(e) => pickFiles(e.target.files)} />
              📎 attach
            </label>
            <span>· max 5 MB · up to 4 files</span>
            {liveMentions.length > 0 && (
              <span className="text-info">· will notify: {liveMentions.join(", ")}</span>
            )}
          </div>
          <button
            onClick={submit}
            disabled={busy || (!body.trim() && pendingFiles.length === 0)}
            className="text-xs px-3 py-1 rounded-md bg-ink text-bg hover:bg-ink/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? "sending…" : "comment"}
          </button>
        </div>
        {error && <div className="text-[11px] text-crit">{error}</div>}
        {notify && (
          <div
            role="status"
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-good/10 text-good text-[11px] border border-good/30"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 6 12 13 2 6" /><rect x="2" y="6" width="20" height="14" rx="2" /></svg>
            Notified {notify.names.map(n => `@${n}`).join(", ")} · email queued for opt-in recipients
          </div>
        )}
      </div>
    </div>
  );
}

function renderCommentBody(c: CommentRow, profiles: Profile[]): string {
  // Autolinks @mentions + #NNN issue refs in one pass.
  return renderRichHTML(c.body, profiles);
}
