"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession, useAllProfiles } from "@/lib/auth";
import { LoginGate } from "@/components/LoginGate";
import { AccessGate } from "@/components/AccessGate";
import { ThemeToggle } from "@/components/ThemeToggle";
import { IssueDetail } from "@/components/IssueDetail";
import { isLive } from "@/lib/supabase";

export default function IssueDetailRoute() {
  const supaConfigured = isLive();
  const session = useSession();
  const profiles = useAllProfiles(!!session.user);
  const params = useParams();
  const raw = params?.number;
  const numStr = Array.isArray(raw) ? raw[0] : raw;
  const number = numStr ? parseInt(numStr, 10) : NaN;

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
  if (!Number.isFinite(number) || number <= 0) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">
        <div className="text-center space-y-2">
          <div className="text-sm">Invalid issue number.</div>
          <Link href="/issues" className="text-xs text-info hover:underline">← back to issues</Link>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen">
      <header className="nasa-nav sticky top-0 z-[1100]">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/" className="text-sm font-bold nav-ink hover:underline truncate">SynthCrop Tracker</Link>
            <span className="nav-muted text-xs">/</span>
            <Link href="/issues" className="text-sm nav-ink hover:underline truncate">Issues</Link>
            <span className="nav-muted text-xs">/</span>
            <span className="text-sm nav-muted tabular">#{number}</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/issues" className="text-[11px] eyebrow px-2.5 py-1.5 rounded-md border border-white/20 nav-muted hover:nav-ink hover:bg-white/5">← all</Link>
            <ThemeToggle />
          </div>
        </div>
        <div className="h-[3px] w-full bg-[rgb(var(--c-accent))]" />
      </header>

      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <IssueDetail number={number} profile={session.profile} profiles={profiles} />
      </div>
    </main>
  );
}
