"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useSession } from "@/lib/auth";
import { LoginGate } from "@/components/LoginGate";
import { AccessGate } from "@/components/AccessGate";
import { ThemeToggle } from "@/components/ThemeToggle";
import { isLive } from "@/lib/supabase";
import {
  fmtAgo,
  notificationHref,
  notificationSubject,
  runScrollToHashComment,
  useNotifications,
  verbFor,
} from "@/lib/notifications";

type Filter = "all" | "unread" | "mention" | "reply";

export default function NotificationsPage() {
  const supaConfigured = isLive();
  const session = useSession();
  const userId = session.user?.id;
  const router = useRouter();
  const { items, loading, unreadCount, markRead, markAllRead } = useNotifications(userId);

  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    return items.filter(n => {
      if (filter === "unread") return !n.read_at;
      if (filter === "mention") return n.kind === "mention";
      if (filter === "reply") return n.kind === "reply";
      return true;
    });
  }, [items, filter]);

  if (session.loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted"><span className="text-sm">loading…</span></div>;
  }
  if (!session.user) {
    return <LoginGate configured={supaConfigured} onSignIn={session.signInWithGoogle} />;
  }
  if (session.member === false) {
    return <AccessGate email={session.user.email ?? "(unknown email)"} onRedeem={session.redeemInvite} onSignOut={session.signOut} />;
  }

  const tabs: { id: Filter; label: string; count?: number }[] = [
    { id: "all",     label: "All",      count: items.length },
    { id: "unread",  label: "Unread",   count: unreadCount },
    { id: "mention", label: "Mentions", count: items.filter(n => n.kind === "mention").length },
    { id: "reply",   label: "Replies",  count: items.filter(n => n.kind === "reply").length },
  ];

  return (
    <main className="min-h-screen flex flex-col">
      <header className="nasa-nav sticky top-0 z-[1100]">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/" className="text-sm font-bold nav-ink hover:underline truncate">SynthCrop Tracker</Link>
            <span className="nav-muted text-xs">/</span>
            <span className="text-sm nav-ink truncate">Notifications</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/" className="text-[11px] eyebrow px-2.5 py-1.5 rounded-md border border-white/20 nav-muted hover:nav-ink hover:bg-white/5">← board</Link>
            <ThemeToggle />
          </div>
        </div>
        <div className="h-[3px] w-full bg-[rgb(var(--c-accent))]" />
      </header>

      <div className="max-w-[900px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-4">

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setFilter(t.id)}
                className={`text-[11px] px-2.5 py-1.5 rounded-md border transition-colors ${filter === t.id ? "border-ink bg-ink text-bg" : "border-border bg-surface text-ink hover:bg-surface2"}`}
              >
                {t.label}
                {typeof t.count === "number" && (
                  <span className={`ml-1.5 text-[9px] tabular ${filter === t.id ? "text-bg/70" : "text-muted2"}`}>{t.count}</span>
                )}
              </button>
            ))}
          </div>
          {unreadCount > 0 && (
            <button
              onClick={() => markAllRead()}
              className="text-[11px] px-2.5 py-1.5 rounded-md border border-border bg-surface text-ink hover:bg-surface2"
            >mark all read</button>
          )}
        </div>

        {loading && <div className="text-xs text-muted2 py-4">loading…</div>}

        {!loading && filtered.length === 0 && (
          <div className="rounded-lg border border-border bg-surface p-8 text-center text-xs text-muted2">
            {filter === "unread" ? "no unread notifications." : "no notifications yet."}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <ul className="rounded-lg border border-border bg-surface divide-y divide-border overflow-hidden">
            {filtered.map(n => {
              const href = notificationHref(n);
              const author = n.payload.author_name ?? "Someone";
              const subject = notificationSubject(n);
              const snippet = (n.payload.snippet ?? "").slice(0, 240);

              return (
                <li key={n.id}>
                  <a
                    href={href}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
                      e.preventDefault();
                      markRead(n.id);
                      router.push(href);
                      setTimeout(runScrollToHashComment, 50);
                    }}
                    className={`block px-4 py-3 hover:bg-surface2 ${n.read_at ? "" : "bg-good/[0.04]"}`}
                  >
                    <div className="flex items-start gap-3">
                      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${n.read_at ? "bg-transparent border border-border" : "bg-good"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm text-ink">
                            <span className="font-semibold">{author}</span>{" "}
                            <span className="text-muted">{verbFor(n.kind)} on</span>{" "}
                            <span className="font-medium">{subject}</span>
                          </div>
                          <div className="text-[10px] text-muted2 tabular shrink-0">{fmtAgo(n.created_at)}</div>
                        </div>
                        {snippet && (
                          <div className="text-[12px] text-muted mt-1">{snippet}</div>
                        )}
                        <div className="text-[10px] text-muted2 mt-1 flex items-center gap-2">
                          <span className="uppercase tracking-wider font-semibold">{n.kind}</span>
                          {n.read_at && <span>· read {fmtAgo(n.read_at)}</span>}
                        </div>
                      </div>
                    </div>
                  </a>
                </li>
              );
            })}
          </ul>
        )}

      </div>
    </main>
  );
}
