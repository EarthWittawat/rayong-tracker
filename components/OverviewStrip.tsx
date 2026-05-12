"use client";

import { useMemo } from "react";
import type { Member, Task, StageKey } from "@/lib/supabase";
import { STAGES } from "@/lib/supabase";
import { computeProgress } from "@/lib/progress";

export function OverviewStrip({ members, tasks }: { members: Member[]; tasks: Task[] }) {
  const totals = useMemo(() => {
    const byStage = new Map<StageKey, { done: number; total: number }>();
    for (const s of STAGES) byStage.set(s.key, { done: 0, total: 0 });
    for (const t of tasks) {
      const e = byStage.get(t.stage)!;
      e.done += t.done; e.total += t.total;
    }
    return { byStage, overall: computeProgress(tasks) };
  }, [tasks]);

  const stageEntries = STAGES.map(s => {
    const v = totals.byStage.get(s.key)!;
    const pct = v.total > 0 ? (v.done / v.total) * 100 : 0;
    return { s, v, pct };
  });
  const leader = [...stageEntries].sort((a, b) => b.pct - a.pct)[0];

  return (
    <section className="rounded-xl2 bg-surface border border-border shadow-card overflow-hidden">
      <div className="px-6 pt-6 pb-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted2 font-medium flex items-center gap-1.5">
              Overall progress
              <span
                className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-border text-[9px] text-muted2 cursor-help"
                title="Weighted = total tiles done / total tiles. Stage-avg = mean of per-stage ratios. Stage-avg gives small stages equal weight to large ones."
              >?</span>
            </div>
            <div className="flex items-baseline gap-3 mt-2">
              <span className="text-5xl font-semibold tabular text-ink leading-none">
                {totals.overall.weightedPct.toFixed(1)}<span className="text-2xl text-muted2 font-normal">%</span>
              </span>
              <span className="text-sm text-muted tabular">
                {totals.overall.done.toLocaleString()} / {totals.overall.total.toLocaleString()} tiles
              </span>
            </div>
            <div className="text-[11px] text-muted2 tabular mt-1">
              stage-avg {totals.overall.avgStagesPct.toFixed(1)}%
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted2">
            <span>{members.length} member{members.length === 1 ? "" : "s"}</span>
            <span className="text-border2">·</span>
            <span>{STAGES.length} stages</span>
          </div>
        </div>

        <div className="mt-5 h-2.5 w-full rounded-full bg-surface2 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${totals.overall.weightedPct}%`, background: "linear-gradient(90deg, rgb(var(--c-accent)) 0%, rgb(var(--c-accent2)) 100%)" }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 border-t border-border bg-surface2/30">
        {stageEntries.map(({ s, v, pct }) => {
          const isLead = leader && leader.s.key === s.key && pct > 0;
          return (
            <div
              key={s.key}
              className="px-4 py-3 border-r border-border last:border-r-0 sm:border-r [&:nth-child(2n)]:border-r-0 sm:[&:nth-child(2n)]:border-r [&:nth-child(2)]:sm:border-r [&:nth-child(5)]:sm:border-r-0 border-b sm:border-b-0 last:border-b-0 [&:nth-last-child(-n+1)]:border-b-0"
              title={s.hint}
            >
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-[0.12em] text-muted2 font-semibold">{s.short}</div>
                {isLead && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent font-medium">lead</span>}
              </div>
              <div className="text-2xl font-semibold tabular text-ink mt-1 leading-none">{pct.toFixed(0)}%</div>
              <div className="text-[11px] text-muted2 tabular mt-1">{v.done.toLocaleString()} / {v.total.toLocaleString()}</div>
              <div className="mt-2 h-1 w-full rounded-full bg-surface2 overflow-hidden">
                <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
