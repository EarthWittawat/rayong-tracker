"use client";

import { useEffect, useState, useCallback } from "react";
import { getSupabase } from "@/lib/supabase";
import { formatRelative } from "@/lib/relativeTime";

type InviteCode = {
  id: string;
  code: string;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
  max_uses: number;
  uses: number;
  revoked: boolean;
  note: string | null;
};

function newCode(): string {
  // 8-char base32-ish + group dashes → SYNTH-XXXX-XXXX, ~40 bits of entropy.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const random = (n: number) =>
    Array.from(crypto.getRandomValues(new Uint8Array(n)))
      .map(b => alphabet[b % alphabet.length])
      .join("");
  return `SYNTH-${random(4)}-${random(4)}`;
}

export function AccessModal({
  open, onClose, currentUserId,
}: {
  open: boolean;
  onClose: () => void;
  currentUserId: string;
}) {
  const [rows, setRows] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [justCopied, setJustCopied] = useState<string | null>(null);
  const [maxUses, setMaxUses] = useState(1);
  const [note, setNote] = useState("");
  const [expires, setExpires] = useState<"" | "1d" | "7d" | "30d">("");

  const refresh = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    setLoading(true);
    const { data, error } = await sb
      .from("invite_codes")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setErr(error.message);
    else setRows((data as InviteCode[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { if (open) { setErr(null); refresh(); } }, [open, refresh]);

  if (!open) return null;

  async function generate() {
    const sb = getSupabase();
    if (!sb) return;
    setErr(null);
    setBusy(true);
    let expiresAt: string | null = null;
    if (expires === "1d")  expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    if (expires === "7d")  expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    if (expires === "30d") expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();

    const code = newCode();
    const { data, error } = await sb.from("invite_codes").insert({
      code,
      created_by: currentUserId,
      max_uses: Math.max(1, maxUses),
      expires_at: expiresAt,
      note: note.trim() || null,
    }).select("*").single();
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setRows(prev => [data as InviteCode, ...prev]);
    setNote("");
    await copy(code, "code created");
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setJustCopied(label);
      setTimeout(() => setJustCopied(null), 1500);
    } catch {
      setJustCopied("copy failed");
    }
  }

  async function revoke(row: InviteCode) {
    const sb = getSupabase();
    if (!sb) return;
    const { error } = await sb
      .from("invite_codes")
      .update({ revoked: !row.revoked })
      .eq("id", row.id);
    if (error) setErr(error.message);
    else refresh();
  }

  async function remove(row: InviteCode) {
    if (!confirm(`Delete invite code ${row.code}?`)) return;
    const sb = getSupabase();
    if (!sb) return;
    const { error } = await sb.from("invite_codes").delete().eq("id", row.id);
    if (error) setErr(error.message);
    else setRows(prev => prev.filter(r => r.id !== row.id));
  }

  function statusOf(r: InviteCode): { label: string; tone: string } {
    if (r.revoked) return { label: "revoked", tone: "bg-crit/10 text-crit border-crit/30" };
    if (r.expires_at && Date.parse(r.expires_at) < Date.now()) return { label: "expired", tone: "bg-warn/10 text-warn border-warn/30" };
    if (r.uses >= r.max_uses) return { label: "used up", tone: "bg-muted2/10 text-muted2 border-border" };
    return { label: "active", tone: "bg-good/10 text-good border-good/30" };
  }

  return (
    <div
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-xl2 shadow-cardHover border border-border w-full max-w-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="eyebrow text-[10px] text-muted2">Access control</div>
            <h2 className="text-lg font-semibold text-ink mt-0.5">Manage invite codes</h2>
            <p className="text-xs text-muted mt-1 max-w-md">
              Generate single-use (or multi-use) codes and share them with teammates. They paste the code on the access-pending screen to join.
            </p>
          </div>
          <button onClick={onClose} aria-label="close" className="text-muted2 hover:text-ink text-xl leading-none">×</button>
        </div>

        <div className="rounded-md border border-border bg-surface2/40 p-3 space-y-2">
          <div className="eyebrow text-[10px] text-muted2">Generate a code</div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[11px] text-muted2 inline-flex items-center gap-1">
              uses
              <input
                type="number"
                min={1}
                max={50}
                value={maxUses}
                onChange={(e) => setMaxUses(parseInt(e.target.value || "1", 10))}
                className="w-16 text-xs bg-surface border border-border rounded px-2 py-1 text-ink tabular outline-none"
              />
            </label>
            <label className="text-[11px] text-muted2 inline-flex items-center gap-1">
              expires
              <select
                value={expires}
                onChange={(e) => setExpires(e.target.value as "" | "1d" | "7d" | "30d")}
                className="text-xs bg-surface border border-border rounded px-2 py-1 text-ink outline-none cursor-pointer"
              >
                <option value="">never</option>
                <option value="1d">24 hours</option>
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
              </select>
            </label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="optional note (who is this for?)"
              className="flex-1 min-w-[160px] text-xs bg-surface border border-border rounded px-2 py-1 text-ink placeholder:text-muted2 outline-none focus:border-accent"
              maxLength={140}
            />
            <button
              onClick={generate}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded-md bg-accent text-white font-semibold disabled:opacity-50"
            >{busy ? "creating…" : "+ generate"}</button>
          </div>
          <p className="text-[10px] text-muted2">
            On create, the new code is copied to your clipboard automatically. Send it via your preferred channel.
          </p>
        </div>

        {err && <p className="mt-2 text-xs text-crit">{err}</p>}
        {justCopied && <p className="mt-2 text-xs text-good">{justCopied} · copied to clipboard</p>}

        <div className="mt-4">
          <div className="eyebrow text-[10px] text-muted2 mb-2">
            {loading ? "loading…" : `${rows.length} code${rows.length === 1 ? "" : "s"}`}
          </div>
          <ul className="space-y-1 max-h-72 overflow-auto">
            {rows.map(r => {
              const st = statusOf(r);
              const mine = r.created_by === currentUserId;
              return (
                <li key={r.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-border bg-surface2/40">
                  <code className="text-xs text-ink font-mono tracking-wider">{r.code}</code>
                  <span className={`text-[10px] eyebrow px-1.5 py-0.5 rounded border ${st.tone}`}>{st.label}</span>
                  <span className="text-[10px] text-muted2 tabular">
                    {r.uses}/{r.max_uses}
                    {r.expires_at && ` · exp ${formatRelative(r.expires_at)}`}
                  </span>
                  {r.note && <span className="text-[10px] text-muted truncate max-w-[10rem]" title={r.note}>{r.note}</span>}
                  <span className="ml-auto flex items-center gap-1">
                    <button
                      onClick={() => copy(r.code, r.code)}
                      className="text-[10px] px-2 py-0.5 rounded border border-border text-muted hover:text-ink hover:bg-surface2"
                    >copy</button>
                    {mine && (
                      <>
                        <button
                          onClick={() => revoke(r)}
                          className="text-[10px] px-2 py-0.5 rounded border border-border text-muted hover:text-ink hover:bg-surface2"
                          title={r.revoked ? "un-revoke" : "revoke"}
                        >{r.revoked ? "restore" : "revoke"}</button>
                        <button
                          onClick={() => remove(r)}
                          className="text-[10px] px-1.5 py-0.5 text-crit hover:underline"
                          title="delete"
                        >×</button>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
            {!loading && rows.length === 0 && (
              <li className="text-xs text-muted2 italic py-3 text-center">No codes yet. Generate one above.</li>
            )}
          </ul>
        </div>

        <p className="text-[10px] text-muted2 mt-4">
          You can only revoke / delete codes you created. Once a teammate redeems a code, their access stays even if the code is later revoked — remove their row from <code className="bg-surface2 px-1 rounded">dashboard_members</code> in the Supabase SQL editor to fully evict.
        </p>
      </div>
    </div>
  );
}
