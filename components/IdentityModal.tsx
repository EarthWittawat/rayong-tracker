"use client";

import { useEffect, useState } from "react";
import { PALETTE_COLORS, EMOJI_CHOICES, type Profile } from "@/lib/auth";

type EditableFields = Pick<Profile, "name" | "color" | "emoji"> & {
  notify_mentions?: boolean;
  notify_replies?: boolean;
  notify_digest?: boolean;
};

export function IdentityModal({
  open, profile, firstTime, onClose, onSave,
}: {
  open: boolean;
  profile: Profile;
  firstTime?: boolean;
  onClose: () => void;
  onSave: (patch: EditableFields) => Promise<void> | void;
}) {
  const profileExt = profile as Profile & {
    notify_mentions?: boolean;
    notify_replies?: boolean;
    notify_digest?: boolean;
  };
  const [draft, setDraft] = useState<EditableFields>({
    name: profile.name,
    color: profile.color,
    emoji: profile.emoji,
    notify_mentions: profileExt.notify_mentions ?? true,
    notify_replies:  profileExt.notify_replies  ?? true,
    notify_digest:   profileExt.notify_digest   ?? false,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft({
      name: profile.name,
      color: profile.color,
      emoji: profile.emoji,
      notify_mentions: profileExt.notify_mentions ?? true,
      notify_replies:  profileExt.notify_replies  ?? true,
      notify_digest:   profileExt.notify_digest   ?? false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profile.id, profile.name, profile.color, profile.emoji, profileExt.notify_mentions, profileExt.notify_replies, profileExt.notify_digest]);

  if (!open) return null;

  const canSave = draft.name.trim().length > 0 && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({ ...draft, name: draft.name.trim() });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4"
      onClick={firstTime ? undefined : onClose}
    >
      <div className="bg-surface rounded-xl2 shadow-cardHover border border-border w-full max-w-sm p-5"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-ink">
            {firstTime ? "Welcome — pick a color" : "Edit your profile"}
          </h2>
          {!firstTime && (
            <button onClick={onClose} aria-label="close"
                    className="w-7 h-7 rounded-md hover:bg-surface2 flex items-center justify-center text-muted">✕</button>
          )}
        </div>
        {firstTime && (
          <p className="text-xs text-muted mb-3">
            Signed in as <span className="text-ink font-medium">{profile.email ?? profile.name}</span>.
            Pick a color + emoji so teammates can spot you.
          </p>
        )}

        <div className="flex items-center gap-3 mb-4">
          {profile.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt={profile.name}
              className="w-14 h-14 rounded-xl object-cover shrink-0 ring-2"
              style={{ boxShadow: `inset 0 0 0 2px ${draft.color}` }}
            />
          ) : (
            <div className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl shrink-0"
                 style={{ background: `${draft.color}1A`, color: draft.color }}>
              {draft.emoji}
            </div>
          )}
          <input
            autoFocus
            value={draft.name}
            onChange={(e) => setDraft(d => ({ ...d, name: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter" && canSave) handleSave(); }}
            placeholder="Display name"
            className="flex-1 bg-surface2 border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-border2"
            maxLength={48}
          />
        </div>

        <div className="text-[11px] uppercase tracking-wider text-muted2 mb-1.5">Color</div>
        <div className="grid grid-cols-10 gap-1.5 mb-4">
          {PALETTE_COLORS.map(c => (
            <button key={c} onClick={() => setDraft(d => ({ ...d, color: c }))}
                    className={`w-6 h-6 rounded-full border transition-transform ${draft.color === c ? "border-ink scale-110" : "border-border hover:scale-105"}`}
                    style={{ background: c }} aria-label={c} />
          ))}
        </div>

        <div className="text-[11px] uppercase tracking-wider text-muted2 mb-1.5">Emoji (shown when no avatar)</div>
        <div className="grid grid-cols-6 gap-1 mb-4">
          {EMOJI_CHOICES.map(e => (
            <button key={e} onClick={() => setDraft(d => ({ ...d, emoji: e }))}
                    className={`h-9 rounded-md text-lg transition-colors ${draft.emoji === e ? "bg-surface2 ring-1 ring-border2" : "hover:bg-surface2"}`}>
              {e}
            </button>
          ))}
        </div>

        <div className="text-[11px] uppercase tracking-wider text-muted2 mb-1.5">Email notifications</div>
        <div className="space-y-1.5 mb-5">
          <label className="flex items-center gap-2 text-xs text-ink cursor-pointer">
            <input type="checkbox" checked={!!draft.notify_mentions}
                   onChange={(e) => setDraft(d => ({ ...d, notify_mentions: e.target.checked }))} />
            <span>When someone <strong>@mentions</strong> me</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-ink cursor-pointer">
            <input type="checkbox" checked={!!draft.notify_replies}
                   onChange={(e) => setDraft(d => ({ ...d, notify_replies: e.target.checked }))} />
            <span>New comments on tasks I've commented on</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-ink cursor-pointer">
            <input type="checkbox" checked={!!draft.notify_digest}
                   onChange={(e) => setDraft(d => ({ ...d, notify_digest: e.target.checked }))} />
            <span>Daily digest (1 email/day)</span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2">
          {!firstTime && (
            <button onClick={onClose}
                    className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-surface2 text-muted">cancel</button>
          )}
          <button onClick={handleSave} disabled={!canSave}
                  className="text-xs px-3 py-1.5 rounded-md bg-ink text-bg hover:bg-ink/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {saving ? "saving…" : firstTime ? "join board" : "save"}
          </button>
        </div>
      </div>
    </div>
  );
}
