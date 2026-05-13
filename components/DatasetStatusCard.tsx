"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Summary = {
  ok: boolean;
  count: number;
  totalBytes: number;
  byMime: Record<string, { count: number; bytes: number }>;
  byClass: Record<string, { count: number; bytes: number }>;
  latest?: { name: string; createdTime: string };
  error?: string;
};

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function DatasetStatusCard({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dataset/status")
      .then(r => r.json())
      .then((j: Summary) => { if (!cancelled) setData(j); })
      .catch(e => { if (!cancelled) setData({ ok: false, count: 0, totalBytes: 0, byMime: {}, byClass: {}, error: String(e) }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4 text-xs text-muted2">
        loading dataset status…
      </div>
    );
  }
  if (!data || !data.ok) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4 text-xs">
        <div className="font-semibold text-crit mb-1">Dataset status unavailable</div>
        <div className="text-muted2">{data?.error ?? "unknown error"}</div>
        <div className="text-muted2 mt-2 text-[11px]">check <code className="px-1 py-0.5 rounded bg-surface2 border border-border">GOOGLE_SERVICE_ACCOUNT_JSON</code> env and folder share permissions.</div>
      </div>
    );
  }

  const classOrder = ["durian", "langsat", "rambutan", "mangosteen", "other"];
  const classes = classOrder.filter(c => data.byClass[c]).map(c => [c, data.byClass[c]] as const);

  if (compact) {
    return (
      <Link href="/dataset" className="block rounded-lg border border-border bg-surface p-4 hover:bg-surface2 transition-colors">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted2 font-semibold">Dataset</div>
            <div className="text-2xl font-bold text-ink tabular">{data.count}</div>
            <div className="text-[11px] text-muted">{fmtBytes(data.totalBytes)} total</div>
          </div>
          <div className="text-right">
            {data.latest && (
              <>
                <div className="text-[10px] uppercase tracking-wider text-muted2 font-semibold">Latest</div>
                <div className="text-[11px] text-ink truncate max-w-[160px]">{data.latest.name}</div>
                <div className="text-[10px] text-muted2 tabular">{fmtAge(data.latest.createdTime)}</div>
              </>
            )}
          </div>
        </div>
      </Link>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted2 font-semibold">Dataset folder</div>
          <div className="text-3xl font-bold text-ink tabular">{data.count} <span className="text-base font-medium text-muted">files</span></div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted2 font-semibold">Total size</div>
          <div className="text-2xl font-bold text-ink tabular">{fmtBytes(data.totalBytes)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {classes.map(([cls, v]) => (
          <div key={cls} className="rounded-md border border-border bg-surface2 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted2 font-semibold capitalize">{cls}</div>
            <div className="text-lg font-bold text-ink tabular">{v.count}</div>
            <div className="text-[10px] text-muted2 tabular">{fmtBytes(v.bytes)}</div>
          </div>
        ))}
      </div>

      {Object.keys(data.byMime).length > 0 && (
        <div className="text-[11px] text-muted2 space-x-2">
          <span className="font-semibold text-muted">By type:</span>
          {Object.entries(data.byMime).slice(0, 6).map(([m, v]) => (
            <span key={m} className="inline-block">{m.split("/").pop() || m}: <span className="tabular text-ink">{v.count}</span></span>
          ))}
        </div>
      )}

      {data.latest && (
        <div className="text-[11px] text-muted2">
          Last upload: <span className="text-ink">{data.latest.name}</span> · <span className="tabular">{fmtAge(data.latest.createdTime)}</span>
        </div>
      )}
    </div>
  );
}
