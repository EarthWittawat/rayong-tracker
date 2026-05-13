"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "@/lib/auth";
import { LoginGate } from "@/components/LoginGate";
import { AccessGate } from "@/components/AccessGate";
import { ThemeToggle } from "@/components/ThemeToggle";
import { DatasetStatusCard } from "@/components/DatasetStatusCard";
import { DatasetUploader } from "@/components/DatasetUploader";
import { isLive } from "@/lib/supabase";

type DriveFile = {
  id: string;
  name: string;
  size?: string;
  mimeType: string;
  createdTime: string;
};

type Summary = {
  ok: boolean;
  count: number;
  totalBytes: number;
  files: DriveFile[];
  error?: string;
};

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function DatasetPage() {
  const supaConfigured = isLive();
  const session = useSession();

  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    setFiles(null);
    setLoadErr(null);
    fetch("/api/dataset/status")
      .then(r => r.json())
      .then((j: Summary) => {
        if (cancelled) return;
        if (!j.ok) { setLoadErr(j.error ?? "unknown error"); setFiles([]); return; }
        setFiles(j.files);
      })
      .catch(e => { if (!cancelled) { setLoadErr(String(e)); setFiles([]); } });
    return () => { cancelled = true; };
  }, [refreshTick]);

  const visible = useMemo(() => {
    if (!files) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return files;
    return files.filter(f => f.name.toLowerCase().includes(q));
  }, [files, filter]);

  if (session.loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted"><span className="text-sm">loading…</span></div>;
  }
  if (!session.user) {
    return <LoginGate configured={supaConfigured} onSignIn={session.signInWithGoogle} />;
  }
  if (session.member === false) {
    return <AccessGate email={session.user.email ?? "(unknown email)"} onRedeem={session.redeemInvite} onSignOut={session.signOut} />;
  }

  return (
    <main className="min-h-screen flex flex-col">
      <header className="nasa-nav sticky top-0 z-[1100]">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/" className="text-sm font-bold nav-ink hover:underline truncate">SynthCrop Tracker</Link>
            <span className="nav-muted text-xs">/</span>
            <span className="text-sm nav-ink truncate">Dataset</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/" className="text-[11px] eyebrow px-2.5 py-1.5 rounded-md border border-white/20 nav-muted hover:nav-ink hover:bg-white/5">← board</Link>
            <ThemeToggle />
          </div>
        </div>
        <div className="h-[3px] w-full bg-[rgb(var(--c-accent))]" />
      </header>

      <div className="max-w-[1200px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        <DatasetStatusCard />

        <DatasetUploader onUploaded={() => setRefreshTick(t => t + 1)} />

        <section className="rounded-lg border border-border bg-surface p-5 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted2 font-semibold">Files</div>
              <div className="text-xs text-muted">{visible.length}{filter ? ` of ${files?.length ?? 0}` : ""} entries</div>
            </div>
            <div className="flex items-center gap-2">
              <input
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder="filter by name…"
                className="text-xs px-2 py-1.5 rounded-md border border-border bg-surface2 text-ink placeholder:text-muted2 w-48"
              />
              <button
                onClick={() => setRefreshTick(t => t + 1)}
                className="text-[11px] px-2.5 py-1.5 rounded-md border border-border bg-surface2 text-ink hover:bg-surface"
              >refresh</button>
            </div>
          </div>

          {loadErr && (
            <div className="rounded-md border border-crit/40 bg-crit/10 text-crit text-xs px-3 py-2">{loadErr}</div>
          )}
          {!files && !loadErr && (
            <div className="text-xs text-muted2">loading…</div>
          )}
          {files && visible.length === 0 && !loadErr && (
            <div className="text-xs text-muted2">no files match.</div>
          )}
          {files && visible.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-muted2">
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-3 font-semibold">Name</th>
                    <th className="text-left py-2 pr-3 font-semibold">Type</th>
                    <th className="text-right py-2 pr-3 font-semibold">Size</th>
                    <th className="text-left py-2 pr-3 font-semibold">Created</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(f => (
                    <tr key={f.id} className="border-b border-border/60 hover:bg-surface2">
                      <td className="py-1.5 pr-3 text-ink truncate max-w-[320px]">{f.name}</td>
                      <td className="py-1.5 pr-3 text-muted">{f.mimeType.split("/").pop() || f.mimeType}</td>
                      <td className="py-1.5 pr-3 text-right text-muted tabular">{fmtBytes(Number(f.size ?? 0))}</td>
                      <td className="py-1.5 pr-3 text-muted2 tabular">{fmtDate(f.createdTime)}</td>
                      <td className="py-1.5">
                        <a
                          href={`https://drive.google.com/file/d/${f.id}/view`}
                          target="_blank" rel="noreferrer"
                          className="text-[11px] text-good hover:underline"
                        >open ↗</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

      </div>
    </main>
  );
}
