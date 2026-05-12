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
    <main className="min-h-screen flex items-center justify-center p-6 relative">
      <div className="absolute top-4 right-4"><ThemeToggle /></div>
      <div className="w-full max-w-sm bg-surface border border-border rounded-xl2 shadow-card p-6 text-center">
        <div className="w-12 h-12 rounded-xl mx-auto mb-3 bg-surface2 flex items-center justify-center text-2xl">🌾</div>
        <h1 className="text-lg font-semibold text-ink">Rayong Crop Tracker</h1>
        <p className="text-xs text-muted mt-1 mb-6">
          Sign in with Google to join the board. Your progress + profile persist across devices.
        </p>

        {configured ? (
          <button
            onClick={handleClick}
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md border border-border bg-surface hover:bg-surface2 disabled:opacity-50 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4" />
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853" />
              <path d="M3.964 10.706A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 000 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05" />
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z" fill="#EA4335" />
            </svg>
            <span className="text-sm font-medium text-ink">{busy ? "redirecting…" : "Continue with Google"}</span>
          </button>
        ) : (
          <div className="text-xs text-crit border border-crit/30 bg-crit/5 rounded-md px-3 py-2 text-left">
            <strong>Supabase is not configured.</strong> Set <code className="bg-surface2 px-1 rounded">NEXT_PUBLIC_SUPABASE_URL</code> and <code className="bg-surface2 px-1 rounded">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in <code className="bg-surface2 px-1 rounded">.env.local</code>, then enable the Google provider in the Supabase dashboard.
          </div>
        )}

        {error && (
          <p className="text-xs text-crit mt-3">{error}</p>
        )}

        <p className="text-[10px] text-muted2 mt-6">
          By signing in you let the board show your Google display name + avatar to teammates. No email is sent anywhere.
        </p>
      </div>
    </main>
  );
}
