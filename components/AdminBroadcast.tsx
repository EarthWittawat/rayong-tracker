"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { Profile } from "@/lib/auth";

// Admin-only broadcast composer. Inserts a `kind = 'broadcast'` notification
// row for every profile in `profiles`, with the title + body in the payload.
// Recipients see the broadcast in their bell with a 📣 prefix (handled by
// NotificationBell + the history page).
export function AdminBroadcast({
  profile, profiles, onClose,
}: {
  profile: Profile;
  profiles: Profile[];
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [includeSelf, setIncludeSelf] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function send() {
    const titleTrim = title.trim();
    const bodyTrim = body.trim();
    if (!bodyTrim) { setResult("body required"); return; }

    const sb = getSupabase();
    if (!sb) { setResult("not configured"); return; }

    const targets = profiles.filter(p => includeSelf || p.id !== profile.id);
    if (targets.length === 0) { setResult("no recipients"); return; }

    setBusy(true);
    setResult(null);

    const rows = targets.map(p => ({
      user_id: p.id,
      kind: "broadcast",
      payload: {
        author_id: profile.id,
        author_name: profile.name,
        title: titleTrim || null,
        snippet: bodyTrim.slice(0, 240),
        full: bodyTrim,
      },
    }));
    const { error } = await sb.from("notifications").insert(rows);
    setBusy(false);
    if (error) { setResult(`failed: ${error.message}`); return; }
    setResult(`sent to ${targets.length} ${targets.length === 1 ? "person" : "people"}`);
    setBody("");
    setTitle("");
  }

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        className="w-[440px] max-w-full rounded-lg bg-surface border border-border shadow-cardHover"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted2 font-semibold">Admin</div>
            <div className="text-sm font-semibold text-ink">📣 Send broadcast</div>
          </div>
          <button onClick={onClose} className="text-muted2 hover:text-ink text-base leading-none">×</button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted2 font-semibold">Title (optional)</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Weekly sync moved to Thursday"
              maxLength={120}
              className="mt-1 w-full text-sm px-2.5 py-1.5 rounded-md border border-border bg-surface2 text-ink placeholder:text-muted2"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted2 font-semibold">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What everyone needs to know."
              rows={5}
              maxLength={1200}
              className="mt-1 w-full text-sm px-2.5 py-2 rounded-md border border-border bg-surface2 text-ink placeholder:text-muted2 resize-y"
            />
            <div className="mt-1 text-[10px] text-muted2 tabular text-right">{body.length} / 1200</div>
          </div>

          <label className="flex items-center gap-2 text-xs text-ink cursor-pointer">
            <input
              type="checkbox"
              checked={includeSelf}
              onChange={(e) => setIncludeSelf(e.target.checked)}
            />
            <span>Also notify me</span>
          </label>

          {result && (
            <div className={`text-[11px] px-2.5 py-1.5 rounded-md ${result.startsWith("failed") || result.startsWith("body") || result.startsWith("no") || result.startsWith("not")
              ? "bg-crit/10 text-crit border border-crit/40"
              : "bg-good/10 text-good border border-good/40"}`}>
              {result}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="text-xs px-3 py-1.5 rounded-md border border-border text-muted hover:text-ink"
            >Close</button>
            <button
              onClick={send}
              disabled={busy || !body.trim()}
              className="text-xs px-3 py-1.5 rounded-md bg-ink text-bg hover:brightness-110 disabled:opacity-50"
            >{busy ? "sending…" : `Send to ${profiles.length - (includeSelf ? 0 : 1)} people`}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
