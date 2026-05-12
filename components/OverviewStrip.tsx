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

  return (
    <section className="rounded-xl2 bg-surface border border-border shadow-card p-5">
      <div className="flex items-end justify-between mb-4 flex-wrap gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted2 flex items-center gap-1.5">
            Overall progress
            <span
              className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-border text-[9px] text-muted2 cursor-help"
              title="Weighted = total tiles done / total tiles. Stage-avg = mean of per-stage ratios. Stage-avg gives small stages equal weight to large ones."
            >?</span>
          </div>
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-4xl font-semibold tabular text-ink">{totals.overall.weightedPct.toFixed(1)}%</span>
            <span className="text-sm text-muted tabular">
              {totals.overall.done.toLocaleString()} / {totals.overall.total.toLocaleString()} tiles
            </span>
            <span className="text-xs text-muted2 tabular">stage-avg {totals.overall.avgStagesPct.toFixed(1)}%</span>
          </div>
        </div>
        <div className="text-xs text-muted2">
          {members.length} member{members.length === 1 ? "" : "s"} · {STAGES.length} stages
        </div>
      </div>

      <div className="h-2 w-full rounded-full bg-surface2 overflow-hidden mb-5">
        <div className="h-full rounded-full transition-all duration-500"
             style={{ width: `${totals.overall.weightedPct}%`, background: "#C96442" }} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {STAGES.map(s => {
          const v = totals.byStage.get(s.key)!;
          const pct = v.total > 0 ? (v.done / v.total) * 100 : 0;
          return (
            <div key={s.key} className="rounded-lg border border-border bg-surface2/40 px-3 py-3" title={s.hint}>
              <div className="text-[10px] uppercase tracking-wider text-muted2">{s.short}</div>
              <div className="text-xl font-semibold tabular text-ink mt-0.5">{pct.toFixed(0)}%</div>
              <div className="text-[11px] text-muted tabular mt-0.5">{v.done.toLocaleString()} / {v.total.toLocaleString()}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
