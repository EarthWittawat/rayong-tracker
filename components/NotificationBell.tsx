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
  const { items, unreadCount, markRead, markAllRead, remove, clearRead } = useNotifications(userId);

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Mirror unread count into the document title so a backgrounded tab makes
  // new mentions obvious in the OS tab strip ("(3) SynthCrop …"). Restores
  // on unmount.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const base = document.title.replace(/^\(\d+\)\s*/, "");
    document.title = unreadCount > 0 ? `(${unreadCount}) ${base}` : base;
    return () => {
      document.title = document.title.replace(/^\(\d+\)\s*/, "");
    };
  }, [unreadCount]);

  // Bell "shake" when a new unread arrives while the page is currently
  // visible, OR when the user returns to a tab that gained unread while
  // it was hidden. shakeUntil holds the wall-clock when the shake ends so
  // re-entries always restart the animation cleanly.
  const [shakeUntil, setShakeUntil] = useState(0);
  const prevUnreadRef = useRef(unreadCount);
  const hiddenUnreadRef = useRef<number | null>(null);

  useEffect(() => {
    if (unreadCount > prevUnreadRef.current) {
      setShakeUntil(Date.now() + 2400);
    }
    prevUnreadRef.current = unreadCount;
  }, [unreadCount]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    function onVis() {
      if (document.visibilityState === "hidden") {
        hiddenUnreadRef.current = unreadCount;
        return;
      }
      // Returned to the tab. If unread count grew while away, shake the bell.
      if (hiddenUnreadRef.current !== null && unreadCount > hiddenUnreadRef.current) {
        setShakeUntil(Date.now() + 2400);
      }
      hiddenUnreadRef.current = null;
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [unreadCount]);

  const shaking = shakeUntil > Date.now();
  useEffect(() => {
    if (!shaking) return;
    const t = setTimeout(() => setShakeUntil(0), shakeUntil - Date.now());
    return () => clearTimeout(t);
  }, [shaking, shakeUntil]);

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
        className={`relative inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border transition-colors ${unreadCount > 0 ? "border-good/60 bg-good/15 nav-ink notify-glow" : "border-white/20 nav-muted hover:nav-ink hover:bg-white/5"} ${shaking ? "notify-shake" : ""}`}
        title={unreadCount > 0 ? `${unreadCount} unread` : "notifications"}
        aria-label="notifications"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10 21a2 2 0 004 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-good text-[9px] font-bold text-bg flex items-center justify-center tabular notify-badge-pulse">
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
              {items.some(n => n.read_at) && (
                <button onClick={() => clearRead()} className="text-[10px] text-muted hover:text-crit">clear read</button>
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
                    onRemove={() => remove(n.id)}
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

function NotificationRowItem({ n, onOpen, onRemove }: { n: NotificationRow; onOpen: () => void; onRemove: () => void }) {
  const href = notificationHref(n);
  const author = n.payload.author_name ?? "Someone";
  const verb = verbFor(n.kind);
  const snippet = (n.payload.snippet ?? "").slice(0, 140);
  const subject = notificationSubject(n);

  return (
    <li className="group relative">
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
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
        className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 text-muted2 hover:text-crit text-base leading-none w-5 h-5 flex items-center justify-center rounded transition-opacity"
        title="remove"
        aria-label="remove notification"
      >×</button>
    </li>
  );
}
