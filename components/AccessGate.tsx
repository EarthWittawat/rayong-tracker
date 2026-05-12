"use client";

import { ThemeToggle } from "./ThemeToggle";

export function AccessGate({ email, onSignOut }: { email: string; onSignOut: () => void }) {
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
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="text-white">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
          </div>
        </div>

        <div className="eyebrow text-[10px] text-white/60 mb-2">Access pending</div>
        <h1 className="text-2xl font-bold text-white">You're signed in, but not on the team list yet</h1>
        <p className="text-sm text-white/70 mt-3 mb-2">
          Signed in as <code className="bg-black/30 px-1.5 py-0.5 rounded text-white/90">{email}</code>
        </p>
        <p className="text-xs text-white/55 max-w-sm mx-auto">
          Ask an existing teammate to add your email to the dashboard. Once added, refresh this page — your account will be linked automatically.
        </p>

        <div className="bg-[rgb(var(--c-nav-bg2))]/85 backdrop-blur-md border border-[rgb(var(--c-nav-border))] rounded-md p-4 mt-6 text-left">
          <div className="eyebrow text-[10px] text-white/55 mb-2">For an existing teammate</div>
          <p className="text-xs text-white/75 leading-relaxed">
            Open the avatar menu → <strong>Manage access</strong>, and paste the email above. Or run this in the Supabase SQL editor:
          </p>
          <pre className="text-[11px] bg-black/30 text-white/85 rounded p-2 mt-2 overflow-auto">
{`insert into public.allowed_users (email)
values ('${email.toLowerCase()}')
on conflict (email) do nothing;`}
          </pre>
        </div>

        <button
          onClick={onSignOut}
          className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-sm bg-white text-[rgb(var(--c-nav-bg))] hover:brightness-95 transition-all text-sm font-semibold"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" /></svg>
          Sign out
        </button>
      </div>
    </main>
  );
}
