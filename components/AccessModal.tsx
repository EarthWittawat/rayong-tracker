"use client";

import { useEffect, useState, useCallback } from "react";
import { getSupabase } from "@/lib/supabase";
import { formatRelative } from "@/lib/relativeTime";

type AllowedRow = {
  email: string;
  added_by: string | null;
  added_at: string;
  note: string | null;
};

export function AccessModal({ open, onClose, currentEmail }: { open: boolean; onClose: () => void; currentEmail: string | null }) {
  const [rows, setRows] = useState<AllowedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    setLoading(true);
    const { data, error } = await sb.from("allowed_users").select("*").order("added_at", { ascending: true });
    if (error) setErr(error.message);
    else setRows((data as AllowedRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { if (open) { setErr(null); setMsg(null); refresh(); } }, [open, refresh]);

  if (!open) return null;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setMsg(null);
    const email = input.trim().toLowerCase();
    if (!email || !email.includes("@")) { setErr("Enter a valid email."); return; }
    const sb = getSupabase();
    if (!sb) return;
    setBusy(true);
    const { error } = await sb.from("allowed_users").insert({ email });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setMsg(`Invited ${email}. Tell them to refresh the page after signing in.`);
    setInput("");
    refresh();
  }

  async function remove(email: string) {
    if (!confirm(`Revoke access for ${email}? They will lose access on next page load.`)) return;
    const sb = getSupabase();
    if (!sb) return;
    const { error } = await sb.from("allowed_users").delete().eq("email", email);
    if (error) { setErr(error.message); return; }
    refresh();
  }

  return (
    <div
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div className="bg-surface rounded-xl2 shadow-cardHover border border-border w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="eyebrow text-[10px] text-muted2">Access control</div>
            <h2 className="text-lg font-semibold text-ink mt-0.5">Manage team access</h2>
            <p className="text-xs text-muted mt-1">
              Only emails listed here can read or edit the board. Removing an email revokes their access immediately.
            </p>
          </div>
          <button onClick={onClose} aria-label="close" className="text-muted2 hover:text-ink text-xl leading-none">×</button>
        </div>

        <form onSubmit={add} className="mt-3 flex items-center gap-2">
          <input
            type="email"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="teammate@gmail.com"
            className="flex-1 text-sm bg-surface2 border border-border rounded-md px-3 py-2 text-ink outline-none focus:border-accent placeholder:text-muted2"
            autoComplete="email"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="text-xs px-3 py-2 rounded-md bg-accent text-white font-semibold disabled:opacity-50"
          >
            {busy ? "adding…" : "invite"}
          </button>
        </form>
        {err && <p className="mt-2 text-xs text-crit">{err}</p>}
        {msg && <p className="mt-2 text-xs text-good">{msg}</p>}

        <div className="mt-4">
          <div className="eyebrow text-[10px] text-muted2 mb-2">
            {loading ? "loading…" : `${rows.length} email${rows.length === 1 ? "" : "s"} with access`}
          </div>
          <ul className="space-y-1 max-h-72 overflow-auto">
            {rows.map(r => {
              const isMe = currentEmail && r.email.toLowerCase() === currentEmail.toLowerCase();
              return (
                <li key={r.email} className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-border bg-surface2/40">
                  <code className="flex-1 text-xs text-ink truncate" title={r.email}>{r.email}</code>
                  {isMe && <span className="text-[10px] eyebrow px-1.5 py-0.5 rounded-full bg-info/15 text-info">you</span>}
                  <span className="text-[10px] tabular text-muted2" title={new Date(r.added_at).toLocaleString()}>
                    {formatRelative(r.added_at) ?? ""}
                  </span>
                  <button
                    onClick={() => remove(r.email)}
                    disabled={!!isMe}
                    className="text-[10px] text-crit hover:underline disabled:opacity-30 disabled:hover:no-underline"
                    title={isMe ? "you can't revoke your own access from here" : "revoke"}
                  >revoke</button>
                </li>
              );
            })}
            {!loading && rows.length === 0 && (
              <li className="text-xs text-muted2 italic py-3 text-center">Nobody on the list yet — add yourself first via the SQL editor.</li>
            )}
          </ul>
        </div>

        <p className="text-[10px] text-muted2 mt-4">
          Anyone signed in can <em>read</em> the list, but only listed members can add or revoke. Self-removal is blocked here; do it from the Supabase SQL editor if needed.
        </p>
      </div>
    </div>
  );
}
