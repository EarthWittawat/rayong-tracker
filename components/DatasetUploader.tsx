"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import {
  CHUNK_BYTES,
  SMALL_THRESHOLD,
  fmtBytes,
  fmtEta,
  fmtRate,
  uploadOne,
} from "@/lib/datasetUpload";

const MAX_CONCURRENT = 2;

type JobStatus = "queued" | "uploading" | "done" | "failed" | "cancelled";

type Job = {
  id: string;
  file: File;
  status: JobStatus;
  bytesSent: number;
  error?: string;
  startedAt?: number;
  rateBps?: number;
  abort: AbortController;
};

function mkId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function DatasetUploader({ onUploaded }: { onUploaded?: () => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [authMsg, setAuthMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const jobsRef = useRef<Job[]>([]);
  jobsRef.current = jobs;

  const updateJob = useCallback((id: string, patch: Partial<Job>) => {
    setJobs(prev => prev.map(j => (j.id === id ? { ...j, ...patch } : j)));
  }, []);

  const runJob = useCallback(async (job: Job, token: string) => {
    updateJob(job.id, { status: "uploading", startedAt: Date.now(), bytesSent: 0 });
    try {
      let lastTick = Date.now();
      let lastBytes = 0;
      await uploadOne(job.file, token, (bytesSent) => {
        const now = Date.now();
        const elapsed = (now - lastTick) / 1000;
        const rate = elapsed > 0 ? (bytesSent - lastBytes) / elapsed : 0;
        if (elapsed > 0.5) {
          lastTick = now;
          lastBytes = bytesSent;
          updateJob(job.id, { bytesSent, rateBps: rate });
        } else {
          updateJob(job.id, { bytesSent });
        }
      }, job.abort.signal);
      updateJob(job.id, { status: "done", bytesSent: job.file.size, rateBps: undefined });
      onUploaded?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const cancelled = msg === "cancelled" || job.abort.signal.aborted;
      updateJob(job.id, {
        status: cancelled ? "cancelled" : "failed",
        error: cancelled ? undefined : msg,
        rateBps: undefined,
      });
    }
  }, [onUploaded, updateJob]);

  // Scheduler: keep MAX_CONCURRENT jobs running, pull from queue as slots free up.
  useEffect(() => {
    const active = jobs.filter(j => j.status === "uploading").length;
    if (active >= MAX_CONCURRENT) return;
    const next = jobs.find(j => j.status === "queued");
    if (!next) return;

    let cancelled = false;
    (async () => {
      const sb = getSupabase();
      if (!sb) {
        setAuthMsg("auth not configured");
        updateJob(next.id, { status: "failed", error: "auth not configured" });
        return;
      }
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setAuthMsg("no active session — sign in again");
        updateJob(next.id, { status: "failed", error: "no session" });
        return;
      }
      if (cancelled) return;
      await runJob(next, token);
    })();
    return () => { cancelled = true; };
  }, [jobs, runJob, updateJob]);

  const enqueue = useCallback((files: File[]) => {
    if (files.length === 0) return;
    const fresh: Job[] = files.map(f => ({
      id: mkId(),
      file: f,
      status: "queued",
      bytesSent: 0,
      abort: new AbortController(),
    }));
    setJobs(prev => [...prev, ...fresh]);
  }, []);

  const onPick = useCallback((evt: React.ChangeEvent<HTMLInputElement>) => {
    const list = evt.target.files;
    if (!list || list.length === 0) return;
    enqueue(Array.from(list));
    evt.target.value = "";
  }, [enqueue]);

  const onDrop = useCallback((evt: React.DragEvent<HTMLDivElement>) => {
    evt.preventDefault();
    setDragOver(false);
    const list = evt.dataTransfer.files;
    if (!list || list.length === 0) return;
    enqueue(Array.from(list));
  }, [enqueue]);

  const cancelJob = useCallback((id: string) => {
    const j = jobsRef.current.find(x => x.id === id);
    j?.abort.abort();
  }, []);

  const retryJob = useCallback((id: string) => {
    setJobs(prev => prev.map(j =>
      j.id === id
        ? { ...j, status: "queued", error: undefined, bytesSent: 0, abort: new AbortController() }
        : j,
    ));
  }, []);

  const clearDone = useCallback(() => {
    setJobs(prev => prev.filter(j => j.status !== "done" && j.status !== "cancelled"));
  }, []);

  const totalBytes = jobs.reduce((s, j) => s + j.file.size, 0);
  const sentBytes  = jobs.reduce((s, j) => s + j.bytesSent, 0);
  const activeRate = jobs.reduce((s, j) => s + (j.status === "uploading" ? (j.rateBps ?? 0) : 0), 0);

  return (
    <section className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted2 font-semibold">Upload</div>
          <div className="text-xs text-muted">Drop files. Big files chunk-upload directly to the dataset folder; resume picks up where you left off if the page reloads.</div>
        </div>
        {jobs.length > 0 && (
          <div className="text-[11px] text-muted2 tabular">
            {fmtBytes(sentBytes)} / {fmtBytes(totalBytes)}
            {activeRate > 0 && <span className="ml-2 text-ink">{fmtRate(activeRate)}</span>}
          </div>
        )}
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`rounded-md border-2 border-dashed transition-colors cursor-pointer px-4 py-8 text-center ${dragOver ? "border-good bg-good/10" : "border-border bg-surface2 hover:border-muted"}`}
      >
        <input ref={inputRef} type="file" multiple className="hidden" onChange={onPick} />
        <div className="text-sm text-ink font-medium">click or drop files</div>
        <div className="text-[11px] text-muted2 mt-1">
          ≤ {fmtBytes(SMALL_THRESHOLD)} one-shot · larger files chunked in {fmtBytes(CHUNK_BYTES)} pieces, max {MAX_CONCURRENT} parallel
        </div>
        {authMsg && <div className="text-[11px] text-crit mt-2">{authMsg}</div>}
      </div>

      {jobs.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-muted2 font-semibold">Queue ({jobs.length})</div>
            <button onClick={clearDone} className="text-[11px] text-muted hover:text-ink">clear finished</button>
          </div>
          <ul className="space-y-1.5">
            {jobs.map(job => {
              const pct = job.file.size === 0 ? 0 : Math.min(100, (job.bytesSent / job.file.size) * 100);
              const eta = job.rateBps && job.rateBps > 0
                ? fmtEta((job.file.size - job.bytesSent) / job.rateBps)
                : "—";
              return (
                <li key={job.id} className="rounded-md border border-border bg-surface2 px-3 py-2">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-ink truncate" title={job.file.name}>{job.file.name}</div>
                      <div className="text-[10px] text-muted2 tabular">
                        {fmtBytes(job.bytesSent)} / {fmtBytes(job.file.size)}
                        {job.status === "uploading" && job.rateBps && job.rateBps > 0 && (
                          <span className="ml-2">{fmtRate(job.rateBps)} · ETA {eta}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusChip status={job.status} />
                      {(job.status === "queued" || job.status === "uploading") && (
                        <button onClick={() => cancelJob(job.id)} className="text-[10px] text-muted hover:text-crit">cancel</button>
                      )}
                      {(job.status === "failed" || job.status === "cancelled") && (
                        <button onClick={() => retryJob(job.id)} className="text-[10px] text-muted hover:text-good">retry</button>
                      )}
                    </div>
                  </div>
                  <div className="mt-1.5 h-1 rounded-full bg-bg overflow-hidden">
                    <div
                      className={`h-full transition-all ${job.status === "done" ? "bg-good" : job.status === "failed" ? "bg-crit" : "bg-ink"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {job.error && (
                    <div className="text-[10px] text-crit mt-1 truncate" title={job.error}>{job.error}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function StatusChip({ status }: { status: JobStatus }) {
  const cls = status === "done" ? "bg-good/15 text-good border-good/40"
    : status === "uploading" ? "bg-ink/10 text-ink border-border"
    : status === "failed" ? "bg-crit/15 text-crit border-crit/40"
    : status === "cancelled" ? "bg-surface text-muted2 border-border"
    : "bg-surface text-muted2 border-border";
  return (
    <span className={`text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-full border ${cls}`}>
      {status}
    </span>
  );
}
