"use client";

import { useMemo } from "react";
import type { Member, Task, StageKey } from "@/lib/supabase";
import { STAGES } from "@/lib/supabase";
import { computeProgress } from "@/lib/progress";

type WithMeta = { m: Member; pct: number; lastActive: number };

function cellTone(pct: number): { bg: string; border: string; ink: string } {
  if (pct >= 100) return { bg: "rgb(var(--c-good) / 0.18)", border: "rgb(var(--c-good) / 0.55)", ink: "rgb(var(--c-good))" };
  if (pct >= 75)  return { bg: "rgb(var(--c-good) / 0.10)", border: "rgb(var(--c-good) / 0.30)", ink: "rgb(var(--c-good))" };
  if (pct >= 50)  return { bg: "rgb(var(--c-info) / 0.10)", border: "rgb(var(--c-info) / 0.30)", ink: "rgb(var(--c-info))" };
  if (pct >= 25)  return { bg: "rgb(var(--c-warn) / 0.10)", border: "rgb(var(--c-warn) / 0.30)", ink: "rgb(var(--c-warn))" };
  if (pct > 0)   return { bg: "rgb(var(--c-accent) / 0.08)", border: "rgb(var(--c-accent) / 0.30)", ink: "rgb(var(--c-accent))" };
  return { bg: "rgb(var(--c-surface2))", border: "rgb(var(--c-border))", ink: "rgb(var(--c-muted2))" };
}

export function MatrixView({
  members, tasks, onFocusMember,
}: {
  members: WithMeta[];
  tasks: Task[];
  onFocusMember: (id: string) => void;
}) {
  // Per-cell lookup
  const byCell = useMemo(() => {
    const m = new Map<string, Task>();
    for (const t of tasks) m.set(`${t.member_id}__${t.stage}`, t);
    return m;
  }, [tasks]);

  // Stage totals across visible members
  const stageTotals = useMemo(() => {
    const map = new Map<StageKey, { done: number; total: number }>();
    for (const s of STAGES) map.set(s.key, { done: 0, total: 0 });
    for (const { m } of members) {
      for (const s of STAGES) {
        const t = byCell.get(`${m.id}__${s.key}`);
        if (!t) continue;
        const agg = map.get(s.key)!;
        agg.done += t.done;
        agg.total += t.total;
      }
    }
    return map;
  }, [members, byCell]);

  if (members.length === 0) return null;

  return (
    <div className="rounded-xl2 border border-border bg-surface shadow-card overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted2 font-medium">Heatmap</div>
          <h3 className="text-sm font-semibold text-ink mt-0.5">Member × Stage matrix</h3>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] tabular text-muted2">
          <Legend label="0%"    tone={cellTone(0)} />
          <Legend label="<25%"  tone={cellTone(10)} />
          <Legend label="<50%"  tone={cellTone(40)} />
          <Legend label="<75%"  tone={cellTone(60)} />
          <Legend label="<100%" tone={cellTone(80)} />
          <Legend label="done"  tone={cellTone(100)} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 tabular">
          <thead>
            <tr>
              <th className="sticky left-0 z-[1] bg-surface text-left px-3 py-2 border-b border-border text-[10px] uppercase tracking-wider text-muted2 font-semibold">
                Member
              </th>
              {STAGES.map(s => (
                <th key={s.key}
                    className="px-2 py-2 border-b border-border text-[10px] uppercase tracking-wider text-muted2 font-semibold whitespace-nowrap"
                    title={s.hint}>
                  <div className="flex items-center justify-center gap-1.5">
                    <span>{s.short}</span>
                  </div>
                </th>
              ))}
              <th className="px-3 py-2 border-b border-border text-[10px] uppercase tracking-wider text-muted2 font-semibold text-right">
                Member %
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map(({ m }) => {
              const memberTasks = STAGES.map(s => byCell.get(`${m.id}__${s.key}`)).filter(Boolean) as Task[];
              const memberStats = computeProgress(memberTasks);
              return (
                <tr key={m.id} className="group hover:bg-surface2/30 transition-colors">
                  <td className="sticky left-0 z-[1] bg-surface group-hover:bg-surface2/30 px-3 py-1.5 border-b border-border whitespace-nowrap">
                    <button
                      onClick={() => onFocusMember(m.id)}
                      className="inline-flex items-center gap-2 max-w-[14rem] truncate text-left"
                      title={`Open ${m.name}`}
                    >
                      <span
                        className="w-6 h-6 rounded-md flex items-center justify-center text-xs shrink-0"
                        style={{ background: `${m.color}1A`, color: m.color }}
                      >
                        {m.emoji}
                      </span>
                      <span className="text-sm font-medium text-ink truncate">{m.name}</span>
                      <span className="text-[10px] text-muted2 shrink-0">{m.quadrant}</span>
                    </button>
                  </td>
                  {STAGES.map(s => {
                    const t = byCell.get(`${m.id}__${s.key}`);
                    if (!t) {
                      return (
                        <td key={s.key} className="border-b border-border px-1.5 py-1.5 text-center">
                          <span className="text-[10px] text-muted2">—</span>
                        </td>
                      );
                    }
                    const pct = t.total > 0 ? Math.min(100, (t.done / t.total) * 100) : 0;
                    const tone = cellTone(pct);
                    const isDone = pct >= 100;
                    return (
                      <td key={s.key} className="border-b border-border px-1 py-1.5 text-center">
                        <button
                          onClick={() => onFocusMember(m.id)}
                          className="block w-full min-w-[5.5rem] rounded-md border px-2 py-1.5 hover:brightness-110 hover:scale-[1.02] transition-all text-left"
                          style={{ background: tone.bg, borderColor: tone.border }}
                          title={`${m.name} · ${s.label}\n${t.done.toLocaleString()} / ${t.total.toLocaleString()} tiles · ${pct.toFixed(1)}%`}
                        >
                          <div className="flex items-baseline justify-between gap-1">
                            <span className="text-sm font-semibold tabular" style={{ color: tone.ink }}>
                              {pct.toFixed(0)}%
                            </span>
                            {isDone && (
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={tone.ink} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </div>
                          <div className="text-[9px] tabular text-muted2 truncate">
                            {t.done.toLocaleString()}/{t.total.toLocaleString()}
                          </div>
                          <div className="mt-1 h-0.5 rounded-full bg-bg/60 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone.ink }} />
                          </div>
                        </button>
                      </td>
                    );
                  })}
                  <td className="border-b border-border px-3 py-1.5 text-right">
                    <div className="inline-flex flex-col items-end gap-0.5">
                      <span className="text-sm font-semibold tabular" style={{ color: m.color }}>
                        {memberStats.weightedPct.toFixed(0)}%
                      </span>
                      <span className="text-[9px] text-muted2 tabular">
                        {memberStats.done.toLocaleString()}/{memberStats.total.toLocaleString()}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-surface2/40">
              <td className="sticky left-0 z-[1] bg-surface2/80 px-3 py-2 text-[10px] uppercase tracking-wider text-muted2 font-semibold">
                Stage total
              </td>
              {STAGES.map(s => {
                const a = stageTotals.get(s.key)!;
                const pct = a.total > 0 ? (a.done / a.total) * 100 : 0;
                const tone = cellTone(pct);
                return (
                  <td key={s.key} className="px-1 py-2 text-center">
                    <div className="inline-flex flex-col items-center gap-0.5">
                      <span className="text-sm font-semibold tabular" style={{ color: tone.ink }}>
                        {pct.toFixed(0)}%
                      </span>
                      <span className="text-[9px] text-muted2 tabular">
                        {a.done.toLocaleString()}/{a.total.toLocaleString()}
                      </span>
                    </div>
                  </td>
                );
              })}
              <td className="px-3 py-2 text-right">
                {(() => {
                  const all = STAGES.reduce((acc, s) => {
                    const a = stageTotals.get(s.key)!;
                    acc.done += a.done; acc.total += a.total; return acc;
                  }, { done: 0, total: 0 });
                  const pct = all.total > 0 ? (all.done / all.total) * 100 : 0;
                  return (
                    <div className="inline-flex flex-col items-end gap-0.5">
                      <span className="text-sm font-semibold tabular text-ink">{pct.toFixed(0)}%</span>
                      <span className="text-[9px] text-muted2 tabular">{all.done.toLocaleString()}/{all.total.toLocaleString()}</span>
                    </div>
                  );
                })()}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Legend({ label, tone }: { label: string; tone: { bg: string; border: string; ink: string } }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="w-3 h-3 rounded-sm border" style={{ background: tone.bg, borderColor: tone.border }} />
      {label}
    </span>
  );
}
