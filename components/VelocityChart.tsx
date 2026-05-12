"use client";

import { useMemo } from "react";
import type { Task, StageKey } from "@/lib/supabase";
import { STAGES } from "@/lib/supabase";

const DAY = 86_400_000;

type Bucket = { day: number; total: number; byStage: Record<StageKey, number> };

function emptyByStage(): Record<StageKey, number> {
  const o = {} as Record<StageKey, number>;
  for (const s of STAGES) o[s.key] = 0;
  return o;
}

function ymd(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function VelocityChart({ tasks, days = 14 }: { tasks: Task[]; days?: number }) {
  const { buckets, peak, total } = useMemo(() => {
    const now = Date.now();
    const start = now - days * DAY;
    // Normalize today's bucket to start-of-local-day
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const bucketStart = todayStart.getTime() - (days - 1) * DAY;

    const list: Bucket[] = [];
    for (let i = 0; i < days; i++) {
      list.push({ day: bucketStart + i * DAY, total: 0, byStage: emptyByStage() });
    }

    let total = 0;
    for (const t of tasks) {
      if (!t.updated_at) continue;
      const ts = Date.parse(t.updated_at);
      if (!Number.isFinite(ts) || ts < bucketStart || ts > now + DAY) continue;
      const idx = Math.floor((ts - bucketStart) / DAY);
      if (idx < 0 || idx >= list.length) continue;
      list[idx].total += 1;
      list[idx].byStage[t.stage] += 1;
      total += 1;
      void start;
    }
    let peak = 1;
    for (const b of list) if (b.total > peak) peak = b.total;
    return { buckets: list, peak, total };
  }, [tasks, days]);

  // Recent slope: last 7d sum vs prior 7d sum
  const { recent7, prior7, delta } = useMemo(() => {
    const n = buckets.length;
    if (n < 14) return { recent7: 0, prior7: 0, delta: 0 };
    let r = 0, p = 0;
    for (let i = n - 7; i < n; i++) r += buckets[i].total;
    for (let i = n - 14; i < n - 7; i++) p += buckets[i].total;
    return { recent7: r, prior7: p, delta: r - p };
  }, [buckets]);

  const W = 720;
  const H = 110;
  const padX = 28;
  const padY = 14;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;
  const stepX = buckets.length > 1 ? innerW / (buckets.length - 1) : 0;

  // Stacked bars rather than just a line — denser viz
  const barW = Math.max(4, stepX * 0.6);

  // Smoothed line over totals
  const linePoints = buckets.map((b, i) => {
    const x = padX + i * stepX;
    const y = padY + innerH - (b.total / peak) * innerH;
    return [x, y] as const;
  });

  function linePath(pts: ReadonlyArray<readonly [number, number]>): string {
    if (pts.length === 0) return "";
    let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const [px, py] = pts[i - 1];
      const [x, y] = pts[i];
      const cx = (px + x) / 2;
      d += ` C ${cx.toFixed(1)} ${py.toFixed(1)}, ${cx.toFixed(1)} ${y.toFixed(1)}, ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return d;
  }

  const STAGE_COLOR: Record<StageKey, string> = {
    data: "rgb(var(--c-info))",
    sr:   "rgb(var(--c-accent2))",
    gen:  "rgb(var(--c-accent))",
    feat: "rgb(var(--c-warn))",
    rf:   "rgb(var(--c-good))",
  };

  return (
    <section className="rounded-xl2 bg-surface border border-border shadow-card overflow-hidden">
      <div className="px-5 pt-5 pb-3 border-b border-border">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted2 font-medium">Velocity</div>
            <h3 className="text-lg font-semibold text-ink mt-0.5">Last {days} days · edits per day</h3>
            <p className="text-xs text-muted mt-1 max-w-xl">
              Each bar is one edit on a task (any stage). Line is the trend. Higher = faster work.
            </p>
          </div>
          <div className="flex items-center gap-3 text-[10px] eyebrow tabular">
            <div className="text-right">
              <div className="text-muted2">{days}d edits</div>
              <div className="text-base font-semibold text-ink tabular">{total}</div>
            </div>
            <div className="text-right">
              <div className="text-muted2">7d trend</div>
              <div className={`text-base font-semibold tabular ${delta > 0 ? "text-good" : delta < 0 ? "text-crit" : "text-ink"}`}>
                {delta > 0 ? "+" : ""}{delta}
                <span className="text-[10px] text-muted2 ml-1">vs prior</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-muted2">peak/day</div>
              <div className="text-base font-semibold text-ink tabular">{peak}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="p-5 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H + 22}`} width="100%" preserveAspectRatio="none" className="block">
          {/* y gridlines */}
          {[0.25, 0.5, 0.75, 1.0].map((f, i) => (
            <line
              key={i}
              x1={padX} x2={W - padX}
              y1={padY + innerH - innerH * f} y2={padY + innerH - innerH * f}
              stroke="rgb(var(--c-border))" strokeDasharray="2 4" strokeWidth="1"
            />
          ))}
          {/* baseline */}
          <line x1={padX} x2={W - padX} y1={padY + innerH} y2={padY + innerH} stroke="rgb(var(--c-border2))" strokeWidth="1" />

          {/* stacked bars by stage */}
          {buckets.map((b, i) => {
            const cx = padX + i * stepX - barW / 2;
            let yCursor = padY + innerH;
            return (
              <g key={i}>
                {STAGES.map(s => {
                  const v = b.byStage[s.key];
                  if (v <= 0) return null;
                  const h = (v / peak) * innerH;
                  yCursor -= h;
                  return (
                    <rect
                      key={s.key}
                      x={cx} y={yCursor}
                      width={barW} height={h}
                      fill={STAGE_COLOR[s.key]}
                      opacity={0.55}
                      rx={1.5}
                    >
                      <title>{`${ymd(b.day)} · ${s.short} · ${v} edit${v === 1 ? "" : "s"}`}</title>
                    </rect>
                  );
                })}
              </g>
            );
          })}

          {/* trend line */}
          <path
            d={linePath(linePoints)}
            fill="none"
            stroke="rgb(var(--c-ink))"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.85}
          />
          {/* point dots */}
          {linePoints.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={2.5} fill="rgb(var(--c-bg))" stroke="rgb(var(--c-ink))" strokeWidth="1.5">
              <title>{`${ymd(buckets[i].day)} · ${buckets[i].total} total`}</title>
            </circle>
          ))}

          {/* x labels: first, mid, last */}
          {[0, Math.floor(buckets.length / 2), buckets.length - 1].map(i => (
            <text key={i} x={padX + i * stepX} y={H + 14}
                  textAnchor="middle"
                  className="fill-current text-muted2"
                  style={{ fontSize: 10 }}>
              {ymd(buckets[i].day)}
            </text>
          ))}
        </svg>

        {/* legend */}
        <div className="mt-3 flex items-center gap-3 flex-wrap text-[10px] tabular text-muted2">
          {STAGES.map(s => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: STAGE_COLOR[s.key], opacity: 0.55 }} />
              {s.short}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 ml-2">
            <span className="w-3 h-px bg-ink" />
            trend
          </span>
          <span className="ml-auto">
            recent 7d {recent7} · prior 7d {prior7}
          </span>
        </div>
      </div>
    </section>
  );
}
