"use client";

import { useState } from "react";
import { ThemeToggle } from "./ThemeToggle";

export function AccessGate({
  email, onRedeem, onSignOut,
}: {
  email: string;
  onRedeem: (code: string) => Promise<{ ok: boolean; message: string }>;
  onSignOut: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    const res = await onRedeem(code);
    setBusy(false);
    setMsg({ tone: res.ok ? "ok" : "err", text: res.message });
  }

  return (
    <main className="nasa-stars min-h-screen flex items-center justify-center p-6 relative">
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
        <div className="relative mx-auto mb-6 w-24 h-24 flex items-center justify-center">
          <span className="absolute inset-0 rounded-full ring-1 ring-white/15" />
          <span className="absolute inset-2 rounded-full ring-1 ring-white/10" />
          <div
            className="relative w-16 h-16 rounded-full flex items-center justify-center ring-2 ring-white/85"
            style={{ background: "linear-gradient(135deg, rgb(var(--c-info)) 0%, rgb(var(--c-accent)) 100%)" }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="text-white">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
          </div>
        </div>

        <div className="eyebrow text-[10px] text-white/60 mb-2">Access pending</div>
        <h1 className="text-2xl font-bold text-white">Paste your invite code</h1>
        <p className="text-sm text-white/70 mt-3">
          Signed in as <code className="bg-black/30 px-1.5 py-0.5 rounded text-white/90">{email}</code>
        </p>
        <p className="text-xs text-white/55 max-w-sm mx-auto mt-2">
          A teammate generated a one-time code in <strong>Manage access</strong>. Paste it below to join the dashboard.
        </p>

        <form
          onSubmit={submit}
          className="bg-[rgb(var(--c-nav-bg2))]/85 backdrop-blur-md border border-[rgb(var(--c-nav-border))] rounded-md p-4 mt-6 text-left space-y-3"
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. SYNTH-A4F2-K9XQ"
            autoFocus
            spellCheck={false}
            autoCapitalize="characters"
            className="w-full text-sm bg-black/30 border border-white/15 rounded-sm px-3 py-2.5 text-white font-mono tracking-wider outline-none focus:border-[rgb(var(--c-accent))] placeholder:text-white/30"
          />
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-sm bg-white text-[rgb(var(--c-nav-bg))] hover:brightness-95 disabled:opacity-50 transition-all text-sm font-semibold"
          >
            {busy ? "redeeming…" : "Redeem code"}
          </button>
          {msg && (
            <p className={`text-xs ${msg.tone === "ok" ? "text-[rgb(var(--c-good))]" : "text-[rgb(var(--c-accent))]"}`}>
              {msg.text}
            </p>
          )}
        </form>

        <button
          onClick={onSignOut}
          className="mt-5 text-xs text-white/55 hover:text-white inline-flex items-center gap-1.5"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" /></svg>
          Sign out
        </button>
      </div>
    </main>
  );
}
