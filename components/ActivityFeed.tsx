"use client";

import { useEffect, useState } from "react";
import type { ActivityEvent } from "@/lib/useStore";
import { STAGES } from "@/lib/supabase";

function relTime(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function stageLabel(key?: string): string {
  if (!key) return "";
  return STAGES.find(s => s.key === key)?.short ?? key;
}

function describe(ev: ActivityEvent): string {
  switch (ev.kind) {
    case "task":
      if (ev.detail === "note") return `noted ${ev.memberName ?? "?"} · ${stageLabel(ev.stage)}`;
      if (typeof ev.from === "number" && typeof ev.to === "number" && ev.to !== ev.from) {
        const delta = ev.to - ev.from;
        const sign = delta > 0 ? "+" : "";
        return `${ev.memberName ?? "?"} · ${stageLabel(ev.stage)} ${ev.from}→${ev.to} (${sign}${delta})`;
      }
      return `${ev.memberName ?? "?"} · ${stageLabel(ev.stage)}`;
    case "rename":
      return `renamed ${ev.detail ?? "member"} → ${ev.memberName}`;
    case "add":
      return ev.detail === "restored" ? `restored ${ev.memberName}` : `added ${ev.memberName}`;
    case "remove":
      return `removed ${ev.memberName}`;
  }
}

export function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(i);
  }, []);

  const count = events.length;
  const recent = events.slice(0, 1)[0];
  const recentFlash = recent && now - recent.ts < 4000;

  return (
    <div className="fixed bottom-4 right-4 z-20 max-w-xs w-[20rem]">
      {open ? (
        <div className="bg-surface border border-border rounded-xl2 shadow-cardHover overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface2/50">
            <div className="text-xs font-semibold text-ink">Activity</div>
            <button onClick={() => setOpen(false)}
                    className="text-xs text-muted hover:text-ink">hide</button>
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-border">
            {events.length === 0 ? (
              <div className="px-3 py-6 text-xs text-muted2 text-center">No edits yet.</div>
            ) : events.map(ev => (
              <div key={ev.id} className="px-3 py-2 flex items-start gap-2">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-sm shrink-0"
                      style={{ background: `${ev.user.color}1A`, color: ev.user.color, border: `1px solid ${ev.user.color}40` }}>
                  {ev.user.emoji}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-ink truncate">
                    <span className="font-medium" style={{ color: ev.user.color }}>{ev.user.name}</span>
                    <span className="text-muted"> {describe(ev)}</span>
                  </div>
                  <div className="text-[10px] text-muted2 tabular">{relTime(ev.ts, now)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className={`w-full bg-surface border rounded-full shadow-card px-4 py-2 flex items-center justify-between gap-2 hover:shadow-cardHover transition-shadow ${recentFlash ? "border-border2" : "border-border"}`}
        >
          <span className="inline-flex items-center gap-2 text-xs">
            <span className={`w-1.5 h-1.5 rounded-full ${recentFlash ? "bg-accent pulse-soft" : "bg-muted2"}`} />
            <span className="text-ink font-medium">Activity</span>
            {count > 0 && <span className="text-muted2 tabular">{count}</span>}
          </span>
          {recent ? (
            <span className="text-[10px] text-muted2 truncate max-w-[10rem]" title={describe(recent)}>
              <span className="font-medium" style={{ color: recent.user.color }}>{recent.user.name}</span>
              <span> {relTime(recent.ts, now)}</span>
            </span>
          ) : (
            <span className="text-[10px] text-muted2">no edits</span>
          )}
        </button>
      )}
    </div>
  );
}
