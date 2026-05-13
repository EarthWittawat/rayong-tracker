"use client";

import Link from "next/link";
import { useSession, useAllProfiles } from "@/lib/auth";
import { LoginGate } from "@/components/LoginGate";
import { AccessGate } from "@/components/AccessGate";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationBell } from "@/components/NotificationBell";
import { Whiteboard } from "@/components/Whiteboard";
import { isLive } from "@/lib/supabase";

export default function BoardPage() {
  const supaConfigured = isLive();
  const session = useSession();
  const profiles = useAllProfiles(!!session.user);

  if (session.loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted"><span className="text-sm">loading…</span></div>;
  }
  if (!session.user) {
    return <LoginGate configured={supaConfigured} onSignIn={session.signInWithGoogle} />;
  }
  if (session.member === false) {
    return <AccessGate email={session.user.email ?? "(unknown email)"} onRedeem={session.redeemInvite} onSignOut={session.signOut} />;
  }
  if (!session.profile) {
    return <div className="min-h-screen flex items-center justify-center text-muted"><span className="text-sm">setting up your profile…</span></div>;
  }

  return (
    <main className="min-h-screen flex flex-col">
      <header className="nasa-nav sticky top-0 z-[1100]">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/" className="text-sm font-bold nav-ink hover:underline truncate">SynthCrop Tracker</Link>
            <span className="nav-muted text-xs">/</span>
            <span className="text-sm nav-ink truncate">Whiteboard</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/" className="text-[11px] eyebrow px-2.5 py-1.5 rounded-md border border-white/20 nav-muted hover:nav-ink hover:bg-white/5">← board</Link>
            <NotificationBell />
            <ThemeToggle />
          </div>
        </div>
        <div className="h-[3px] w-full bg-[rgb(var(--c-accent))]" />
      </header>

      <div className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-3">
        <div className="flex items-end justify-between gap-3 flex-wrap pb-2 border-b border-border">
          <div>
            <h2 className="text-2xl font-bold text-ink">Whiteboard</h2>
            <p className="text-xs text-muted mt-1">Shared sketch space. Strokes sync to teammates after a short debounce.</p>
          </div>
        </div>
        <Whiteboard slug="main" profile={session.profile} profiles={profiles} />
      </div>
    </main>
  );
}
