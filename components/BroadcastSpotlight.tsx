"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/auth";
import {
  notificationSubject,
  topicIcon,
  useNotifications,
  type NotificationRow,
} from "@/lib/notifications";

// One-shot spotlight modal that surfaces any unread broadcasts the moment
// the user lands on a page. Each broadcast id is also stamped into
// localStorage so a tab refresh mid-session does not re-pop the same modal
// before the markRead write reaches Supabase. Closing the modal marks every
// shown broadcast read on the server.
const LS_KEY = "broadcast-seen";

function readSeen(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch { return new Set(); }
}

function writeSeen(set: Set<string>) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(LS_KEY, JSON.stringify(Array.from(set).slice(-200))); }
  catch { /* quota — ignore */ }
}

export function BroadcastSpotlight() {
  const session = useSession();
  const userId = session.user?.id;
  const { items, markRead } = useNotifications(userId);

  const [seen, setSeen] = useState<Set<string>>(() => readSeen());
  const [dismissed, setDismissed] = useState(false);

  // Filter: unread broadcasts the client has not already shown in this
  // browser. Memo keeps the JSX stable across re-renders.
  const pending = useMemo(() => {
    if (!userId) return [] as NotificationRow[];
    return items.filter(n => n.kind === "broadcast" && !n.read_at && !seen.has(n.id));
  }, [items, seen, userId]);

  // Once the user dismisses the modal in this session, do not re-open it
  // until a brand-new unread broadcast lands.
  useEffect(() => { if (pending.length === 0) setDismissed(false); }, [pending.length]);

  if (!userId || dismissed || pending.length === 0) return null;

  function close() {
    const next = new Set(seen);
    for (const n of pending) next.add(n.id);
    setSeen(next);
    writeSeen(next);
    setDismissed(true);
    for (const n of pending) markRead(n.id);
  }

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/45 p-4">
      <div className="w-[520px] max-w-full max-h-[80vh] flex flex-col rounded-xl bg-surface border border-border shadow-cardHover">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted2 font-semibold">New</div>
            <div className="text-sm font-semibold text-ink">
              {pending.length === 1 ? "1 broadcast" : `${pending.length} broadcasts`} for you
            </div>
          </div>
          <button onClick={close} className="text-muted2 hover:text-ink text-base leading-none" aria-label="close">×</button>
        </div>

        <ul className="flex-1 overflow-y-auto divide-y divide-border">
          {pending.map(n => {
            const topic = typeof n.payload.topic === "string" ? n.payload.topic : "general";
            const author = n.payload.author_name ?? "Someone";
            const subject = notificationSubject(n);
            const body = typeof n.payload.full === "string" && n.payload.full
              ? n.payload.full
              : (n.payload.snippet ?? "");
            const compareUrl = typeof n.payload.compare_url === "string" ? n.payload.compare_url : null;

            return (
              <li key={n.id} className="px-5 py-4 space-y-1.5">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted2 font-semibold">
                  <span className="text-base leading-none">{topicIcon(topic)}</span>
                  <span>{String(topic)}</span>
                  <span className="text-muted2 normal-case tracking-normal">· from {author}</span>
                </div>
                <div className="text-sm font-semibold text-ink">{subject.replace(/^.+? /, "")}</div>
                {body && (
                  <div className="text-xs text-muted whitespace-pre-wrap leading-relaxed">{body}</div>
                )}
                {compareUrl && (
                  <a
                    href={compareUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-good hover:underline"
                  >
                    view diff on GitHub
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17l10-10M17 7H7v10" /></svg>
                  </a>
                )}
              </li>
            );
          })}
        </ul>

        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
          <button
            onClick={close}
            className="text-xs px-3 py-1.5 rounded-md bg-ink text-bg hover:brightness-110"
          >Got it</button>
        </div>
      </div>
    </div>
  );
}
