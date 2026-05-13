"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/auth";
import {
  fmtAgo,
  notificationHref,
  notificationSubject,
  runScrollToHashComment,
  useNotifications,
  verbFor,
  type NotificationRow,
} from "@/lib/notifications";

export function NotificationBell() {
  const session = useSession();
  const router = useRouter();
  const userId = session.user?.id;
  const { items, unreadCount, markRead, markAllRead } = useNotifications(userId);

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!userId) return null;

  const recent = items.slice(0, 12);

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-white/20 nav-muted hover:nav-ink hover:bg-white/5"
        title={unreadCount > 0 ? `${unreadCount} unread` : "notifications"}
        aria-label="notifications"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10 21a2 2 0 004 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-good text-[9px] font-bold text-bg flex items-center justify-center tabular">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-[360px] rounded-lg border border-border bg-surface shadow-xl z-[1200] overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface2">
            <div className="text-xs font-semibold text-ink">Notifications</div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button onClick={() => markAllRead()} className="text-[10px] text-muted hover:text-ink">mark all read</button>
              )}
              <Link href="/notifications" className="text-[10px] text-muted hover:text-ink" onClick={() => setOpen(false)}>history →</Link>
            </div>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {recent.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted2">no notifications yet.</div>
            ) : (
              <ul className="divide-y divide-border">
                {recent.map(n => (
                  <NotificationRowItem
                    key={n.id}
                    n={n}
                    onOpen={() => {
                      markRead(n.id);
                      setOpen(false);
                      // Navigate via router so same-route clicks still update
                      // search + hash, then kick off the scroll retry to
                      // catch the case where useEffect deps don't change.
                      router.push(notificationHref(n));
                      setTimeout(runScrollToHashComment, 50);
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationRowItem({ n, onOpen }: { n: NotificationRow; onOpen: () => void }) {
  const href = notificationHref(n);
  const author = n.payload.author_name ?? "Someone";
  const verb = verbFor(n.kind);
  const snippet = (n.payload.snippet ?? "").slice(0, 140);
  const subject = notificationSubject(n);

  return (
    <li>
      {/* Anchor for middle-click / new-tab affordance, but click is handled
          by onOpen which routes + kicks off the scroll retry — Next.js
          Link's default navigation skips firing the hashchange-based
          scroll path when the route doesn't change. */}
      <a
        href={href}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
          e.preventDefault();
          onOpen();
        }}
        className={`block px-3 py-2.5 hover:bg-surface2 ${n.read_at ? "" : "bg-good/[0.04]"}`}
      >
        <div className="flex items-start gap-2">
          <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${n.read_at ? "bg-transparent" : "bg-good"}`} />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-ink">
              <span className="font-semibold">{author}</span>{" "}
              <span className="text-muted">{verb} on</span>{" "}
              <span className="font-medium">{subject}</span>
            </div>
            {snippet && (
              <div className="text-[11px] text-muted2 mt-0.5 truncate" title={snippet}>{snippet}</div>
            )}
            <div className="text-[10px] text-muted2 tabular mt-0.5">{fmtAgo(n.created_at)}</div>
          </div>
        </div>
      </a>
    </li>
  );
}
