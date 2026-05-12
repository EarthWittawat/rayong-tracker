"use client";

import { useState } from "react";
import { ThemeToggle } from "./ThemeToggle";

export function LoginGate({
  configured, onSignIn,
}: {
  configured: boolean;
  onSignIn: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setError(null);
    setBusy(true);
    try {
      await onSignIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "sign-in failed");
      setBusy(false);
    }
  }

  return (
    <main className="nasa-stars min-h-screen flex items-center justify-center p-6 relative">
      {/* subtle radial glow + red stripe */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(800px 600px at 50% -10%, rgb(var(--c-info) / 0.35) 0%, transparent 60%), radial-gradient(600px 600px at 50% 110%, rgb(var(--c-accent) / 0.18) 0%, transparent 60%)",
        }}
      />
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-[rgb(var(--c-accent))]" />
      <div className="absolute top-4 right-4"><ThemeToggle /></div>

      <div className="relative w-full max-w-md text-center text-[rgb(var(--c-nav-ink))]">
        {/* satellite glyph */}
        <div className="relative mx-auto mb-6 w-24 h-24 flex items-center justify-center">
          {/* orbit ring */}
          <span className="absolute inset-0 rounded-full ring-1 ring-white/15" />
          <span className="absolute inset-2 rounded-full ring-1 ring-white/10" />
          {/* satellite body */}
          <div
            className="relative w-16 h-16 rounded-full flex items-center justify-center ring-2 ring-white/85"
            style={{ background: "linear-gradient(135deg, rgb(var(--c-info)) 0%, rgb(var(--c-accent)) 100%)" }}
          >
            <span className="text-sm font-bold tracking-widest text-white">SC</span>
          </div>
          {/* tiny orbital pulse dot */}
          <span className="absolute top-1 right-3 w-1.5 h-1.5 rounded-full bg-white/80 pulse-soft" />
        </div>

        <h1 className="text-3xl font-bold text-white">SynthCrop Progress Tracker</h1>
        <p className="text-sm text-white/70 mt-2 mb-8 max-w-sm mx-auto">
          Real-time team board for the Sentinel-2 crop-mapping pipeline. Sign in with Google to join the board.
        </p>

        <div className="bg-[rgb(var(--c-nav-bg2))]/85 backdrop-blur-md border border-[rgb(var(--c-nav-border))] rounded-md p-5 text-left">
          {configured ? (
            <button
              onClick={handleClick}
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-3 px-4 py-3 rounded-sm bg-white text-[rgb(var(--c-nav-bg))] hover:brightness-95 disabled:opacity-50 transition-all font-semibold"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4" />
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853" />
                <path d="M3.964 10.706A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 000 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05" />
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z" fill="#EA4335" />
              </svg>
              <span className="text-sm">{busy ? "redirecting…" : "Continue with Google"}</span>
            </button>
          ) : (
            <div className="text-xs text-[rgb(var(--c-accent))] border border-[rgb(var(--c-accent))]/40 bg-[rgb(var(--c-accent))]/10 rounded-md px-3 py-2">
              <strong>Supabase is not configured.</strong> Set <code className="bg-black/30 px-1 rounded text-white/90">NEXT_PUBLIC_SUPABASE_URL</code> and <code className="bg-black/30 px-1 rounded text-white/90">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in <code className="bg-black/30 px-1 rounded text-white/90">.env.local</code>, then enable the Google provider in the Supabase dashboard.
            </div>
          )}

          {error && <p className="text-xs text-[rgb(var(--c-accent))] mt-3">{error}</p>}

          <p className="text-[10px] text-white/50 mt-4 leading-relaxed">
            By signing in you let the board show your Google display name + avatar to teammates. No email is sent anywhere.
          </p>
        </div>

        <div className="mt-6 flex items-center justify-center gap-3 text-[10px] eyebrow text-white/45 tabular">
          <span>Sentinel-2 L2A</span>
          <span className="w-1 h-1 rounded-full bg-white/30" />
          <span>SR ×4</span>
          <span className="w-1 h-1 rounded-full bg-white/30" />
          <span>Random Forest</span>
        </div>
      </div>
    </main>
  );
}
