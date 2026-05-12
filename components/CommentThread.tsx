"use client";

import { useMemo, useRef, useState } from "react";
import { useTaskComments, type CommentRow } from "@/lib/comments";
import { MentionInput } from "./MentionInput";
import { AttachmentChip } from "./AttachmentPreview";
import { uploadAttachment, MAX_FILE_BYTES, humanSize, removeAttachment } from "@/lib/storage";
import { parseMentions, renderMentionsHTML } from "@/lib/mentions";
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
  const [body, setBody] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
                <div className="text-[11px] flex items-center gap-2">
                  <span className="font-medium" style={{ color: author?.color }}>{author?.name ?? "unknown"}</span>
                  <span className="text-muted2 tabular">{relTime(c.created_at)}</span>
                  {c.edited_at && <span className="text-muted2 text-[10px]">edited</span>}
                  {isMine && <CommentMenu c={c} onEdit={editComment} onDelete={deleteComment} profiles={profiles} />}
                </div>
                <div className="text-sm text-ink whitespace-pre-wrap break-words"
                     dangerouslySetInnerHTML={{ __html: renderCommentBody(c, profiles) }} />
                {atts.length > 0 && (
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
          placeholder="Comment… ⌘/Ctrl+Enter to send. Use @ to mention."
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
      </div>
    </div>
  );
}

function CommentMenu({
  c, onEdit, onDelete, profiles,
}: {
  c: CommentRow;
  onEdit: (id: string, body: string, profiles: Profile[]) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  profiles: Profile[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.body);

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <button onClick={async () => { await onEdit(c.id, draft, profiles); setEditing(false); }}
                className="text-[10px] text-info hover:underline">save</button>
        <button onClick={() => { setDraft(c.body); setEditing(false); }}
                className="text-[10px] text-muted hover:text-ink">cancel</button>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="absolute left-0 right-0 mt-1 z-10 bg-surface border border-border rounded-md p-2 text-xs"
          rows={3}
        />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted2">
      <button onClick={() => setEditing(true)} className="hover:text-ink">edit</button>
      <button onClick={() => { if (confirm("Delete this comment?")) onDelete(c.id); }}
              className="hover:text-crit">delete</button>
    </span>
  );
}

function renderCommentBody(c: CommentRow, profiles: Profile[]): string {
  const mentions = parseMentions(c.body, profiles);
  return renderMentionsHTML(c.body, mentions);
}
