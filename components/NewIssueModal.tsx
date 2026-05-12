"use client";

import { useState } from "react";
import { createIssue, DEFAULT_LABELS, useIssueIndex } from "@/lib/issues";
import { MentionInput } from "./MentionInput";
import { LabelChip } from "./LabelChip";
import type { Profile } from "@/lib/auth";

export function NewIssueModal({
  open, onClose, profile, profiles, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  profile: Profile;
  profiles: Profile[];
  onCreated: (issueNumber: number) => void;
}) {
  const issueIndex = useIssueIndex();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [assigneeId, setAssigneeId] = useState<string | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTitle(""); setBody(""); setLabels([]); setAssigneeId(""); setError(null);
  }

  function toggleLabel(name: string) {
    setLabels(prev => prev.includes(name) ? prev.filter(l => l !== name) : [...prev, name]);
  }

  async function submit() {
    if (busy) return;
    const t = title.trim();
    if (!t) { setError("Title is required."); return; }
    setBusy(true); setError(null);
    try {
      const issue = await createIssue({
        title: t,
        body: body.trim(),
        labels,
        assignee_id: assigneeId || null,
        profile,
      });
      if (!issue) throw new Error("Could not create issue.");
      reset();
      onCreated(issue.number);
    } catch (e) {
      setError(e instanceof Error ? e.message : "create failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1400] flex items-start justify-center px-3 pt-[8vh] sm:pt-[12vh] bg-ink/40 backdrop-blur-sm"
      onClick={() => { reset(); onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="New issue"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-surface border border-border rounded-xl2 shadow-cardHover overflow-hidden"
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-[10px] eyebrow text-muted2">New issue</div>
            <h2 className="text-base font-semibold text-ink mt-0.5">Open a new issue</h2>
          </div>
          <button onClick={() => { reset(); onClose(); }} className="text-muted2 hover:text-ink text-xl leading-none" aria-label="close">×</button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-[10px] eyebrow text-muted2 block mb-1.5">Title</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short, descriptive title"
              className="w-full text-sm bg-surface2 border border-border rounded-md px-3 py-2 text-ink outline-none focus:border-accent placeholder:text-muted2"
              maxLength={200}
            />
          </div>

          <div>
            <label className="text-[10px] eyebrow text-muted2 block mb-1.5">Body</label>
            <MentionInput
              value={body}
              onChange={setBody}
              profiles={profiles}
              issues={issueIndex}
              placeholder="Describe the issue. @ to mention · # to link another issue."
              rows={6}
            />
          </div>

          <div>
            <label className="text-[10px] eyebrow text-muted2 block mb-1.5">Labels</label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {DEFAULT_LABELS.map(name => {
                const on = labels.includes(name);
                return (
                  <button
                    key={name}
                    onClick={() => toggleLabel(name)}
                    className={`transition-opacity ${on ? "opacity-100" : "opacity-50 hover:opacity-100"}`}
                    aria-pressed={on}
                  >
                    <LabelChip name={name} size="md" />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] eyebrow text-muted2 block mb-1.5">Assignee (optional)</label>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="w-full text-sm bg-surface2 border border-border rounded-md px-3 py-2 text-ink outline-none focus:border-accent"
              >
                <option value="">— unassigned —</option>
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>
                ))}
              </select>
            </div>
          </div>

          {error && <p className="text-xs text-crit">{error}</p>}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2 bg-surface2/30">
          <button
            onClick={() => { reset(); onClose(); }}
            className="text-xs px-3 py-1.5 rounded-md border border-border text-muted hover:text-ink hover:bg-surface2"
          >Cancel</button>
          <button
            onClick={submit}
            disabled={busy || !title.trim()}
            className="text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:brightness-110 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy ? "submitting…" : "Submit issue"}
          </button>
        </div>
      </div>
    </div>
  );
}
