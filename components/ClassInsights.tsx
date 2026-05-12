"use client";

import { useEffect, useMemo, useState } from "react";
import { loadClassStats, type ClassStats, type AreaStat, type ClassDef } from "@/lib/classStats";

function pickGini(g: number): { label: string; tone: "good" | "warn" | "crit" } {
  if (g < 0.4) return { label: "balanced", tone: "good" };
  if (g < 0.6) return { label: "skewed", tone: "warn" };
  return { label: "very skewed", tone: "crit" };
}

export function ClassInsights() {
  const [data, setData] = useState<ClassStats | null | "loading">("loading");
  const [tab, setTab] = useState<"quadrant" | "s2_tile">("quadrant");
  const [selKey, setSelKey] = useState<string>("overall");

  useEffect(() => {
    loadClassStats().then(setData);
  }, []);

  const overall = useMemo(() => (data && data !== "loading" ? data.areas.find(a => a.kind === "overall") ?? null : null), [data]);
  const quadrants = useMemo(() => (data && data !== "loading" ? data.areas.filter(a => a.kind === "quadrant") : []), [data]);
  const tiles = useMemo(() => (data && data !== "loading" ? data.areas.filter(a => a.kind === "s2_tile") : []), [data]);
  const classMap = useMemo(() => {
    if (!data || data === "loading") return new Map<string, ClassDef>();
    return new Map(data.classes.map(c => [c.id, c]));
  }, [data]);

  if (data === "loading") {
    return (
      <SectionWrap>
        <div className="p-6 text-sm text-muted2">loading class distribution…</div>
      </SectionWrap>
    );
  }

  if (!data) {
    return (
      <SectionWrap>
        <EmptyState />
      </SectionWrap>
    );
  }

  const list = tab === "quadrant" ? quadrants : tiles;
  const sel = data.areas.find(a => a.key === selKey) ?? overall ?? data.areas[0];

  return (
    <SectionWrap>
      <div className="px-6 pt-5 pb-4 border-b border-border">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted2 font-medium">Class distribution</div>
            <h2 className="text-lg font-semibold text-ink mt-0.5">Landuse balance per area</h2>
            <p className="text-xs text-muted mt-1 max-w-2xl">
              Per-area LDD class share. Gini ≈ 0 balanced, ≈ 1 one class dominates.
            </p>
          </div>
          <div className="text-[10px] text-muted2 tabular text-right">
            <div>generated {new Date(data.generated_at).toLocaleDateString()}</div>
            <div>{data.classes.length} classes · {data.source}</div>
          </div>
        </div>

        {overall && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="province area" value={`${overall.area_km2_total.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²`} />
            <Stat label="Shannon (bits)" value={overall.metrics.shannon.toFixed(2)} hint="higher = more balanced" />
            <Stat label="Gini" value={overall.metrics.gini.toFixed(2)} hint="lower = more balanced" tone={pickGini(overall.metrics.gini).tone} />
            <Stat label="max / min ratio" value={overall.metrics.max_min_ratio.toFixed(1) + "×"} hint="top class vs smallest non-zero" />
          </div>
        )}
      </div>

      {/* tab switcher */}
      <div className="px-6 pt-4 pb-2 flex items-center gap-1 border-b border-border">
        <TabButton active={tab === "quadrant"} onClick={() => { setTab("quadrant"); setSelKey(quadrants[0]?.key ?? "overall"); }}>
          By quadrant <span className="ml-1 text-[10px] tabular text-muted2">{quadrants.length}</span>
        </TabButton>
        <TabButton active={tab === "s2_tile"} onClick={() => { setTab("s2_tile"); setSelKey(tiles[0]?.key ?? "overall"); }}>
          By S2 tile <span className="ml-1 text-[10px] tabular text-muted2">{tiles.length}</span>
        </TabButton>
      </div>

      {/* area cards grid */}
      <div className="px-6 py-4">
        {list.length === 0 ? (
          <div className="text-sm text-muted2 italic">no {tab === "quadrant" ? "quadrant" : "S2 tile"} data in snapshot</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {list.map(a => {
              const isSel = a.key === selKey;
              const g = pickGini(a.metrics.gini);
              return (
                <button
                  key={a.key}
                  onClick={() => setSelKey(a.key)}
                  className={`text-left rounded-lg border p-3 transition-all ${isSel ? "border-accent bg-accent/5 shadow-card" : "border-border bg-surface hover:bg-surface2"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-ink tabular">{a.label}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      g.tone === "good" ? "bg-good/10 text-good" :
                      g.tone === "warn" ? "bg-warn/10 text-warn" : "bg-crit/10 text-crit"
                    }`}>{g.label}</span>
                  </div>
                  <div className="text-[10px] text-muted2 mt-0.5 tabular">{a.area_km2_total.toFixed(0)} km²</div>
                  <MiniStack classes={a.classes} classMap={classMap} />
                  <div className="mt-2 grid grid-cols-2 gap-1 text-[10px] tabular">
                    <span className="text-muted2">Gini <span className="text-ink font-medium">{a.metrics.gini.toFixed(2)}</span></span>
                    <span className="text-muted2">H <span className="text-ink font-medium">{a.metrics.shannon.toFixed(2)}</span></span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* selected area detail */}
      {sel && (
        <div className="px-6 pb-5 pt-1">
          <div className="rounded-lg border border-border bg-surface2/40 p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted2">selected</div>
                <div className="text-base font-semibold text-ink">{sel.label}</div>
              </div>
              <div className="text-xs text-muted tabular">
                {sel.classes.length} classes · {sel.area_km2_total.toFixed(0)} km²
              </div>
            </div>
            <div className="space-y-2">
              {sel.classes.map(c => {
                const cls = classMap.get(c.id);
                const label = cls?.label ?? c.id;
                const color = cls?.color ?? "#9A968D";
                const isMinority = cls?.minority;
                return (
                  <div key={c.id} className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />
                    <div className="w-24 sm:w-40 shrink-0 text-xs text-ink truncate flex items-center gap-1.5" title={label}>
                      {label}
                      {isMinority && <span className="text-[9px] px-1 rounded bg-warn/20 text-warn font-medium hidden sm:inline">minority</span>}
                    </div>
                    <div className="flex-1 h-2 rounded-full bg-surface overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${c.share * 100}%`, background: color }} />
                    </div>
                    <div className="w-12 sm:w-16 text-right text-xs tabular text-ink font-medium">{(c.share * 100).toFixed(1)}%</div>
                    <div className="hidden sm:block w-20 text-right text-[10px] tabular text-muted2">{c.area_km2.toFixed(1)} km²</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* stacked-bar comparison across areas */}
          {list.length > 1 && (
            <div className="mt-5">
              <div className="text-[11px] uppercase tracking-[0.12em] text-muted2 font-medium mb-2">Compare areas</div>
              <div className="space-y-1.5">
                {list.map(a => (
                  <div key={a.key} className="flex items-center gap-3">
                    <span
                      className={`w-16 text-xs tabular truncate cursor-pointer ${a.key === selKey ? "text-ink font-semibold" : "text-muted hover:text-ink"}`}
                      onClick={() => setSelKey(a.key)}
                    >{a.label}</span>
                    <div className="flex-1 h-3 rounded-full bg-surface overflow-hidden flex">
                      {a.classes.map(c => {
                        const cls = classMap.get(c.id);
                        return (
                          <div
                            key={c.id}
                            style={{ width: `${c.share * 100}%`, background: cls?.color ?? "#9A968D" }}
                            title={`${cls?.label ?? c.id} · ${(c.share * 100).toFixed(1)}%`}
                          />
                        );
                      })}
                    </div>
                    <span className="w-12 text-right text-[10px] tabular text-muted2">{a.metrics.gini.toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[10px] text-muted2 text-right">trailing number = Gini</div>
            </div>
          )}
        </div>
      )}
    </SectionWrap>
  );
}

function SectionWrap({ children }: { children: React.ReactNode }) {
  return <section className="rounded-xl2 bg-surface border border-border shadow-card overflow-hidden">{children}</section>;
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "warn" | "crit" }) {
  const toneCls =
    tone === "good" ? "text-good" :
    tone === "warn" ? "text-warn" :
    tone === "crit" ? "text-crit" : "text-ink";
  return (
    <div className="rounded-md border border-border bg-surface2/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted2">{label}</div>
      <div className={`text-lg font-semibold tabular mt-0.5 ${toneCls}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted2 mt-0.5">{hint}</div>}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
        active ? "bg-ink text-bg" : "text-muted hover:text-ink hover:bg-surface2"
      }`}
    >
      {children}
    </button>
  );
}

function MiniStack({ classes, classMap }: { classes: { id: string; share: number }[]; classMap: Map<string, ClassDef> }) {
  return (
    <div className="mt-2 h-2 rounded-full bg-surface2 overflow-hidden flex">
      {classes.map(c => {
        const cls = classMap.get(c.id);
        return (
          <div
            key={c.id}
            style={{ width: `${c.share * 100}%`, background: cls?.color ?? "#9A968D" }}
            title={`${cls?.label ?? c.id} · ${(c.share * 100).toFixed(1)}%`}
          />
        );
      })}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="p-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-surface2 flex items-center justify-center text-2xl shrink-0">📊</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-ink">Class distribution snapshot not generated yet</div>
          <p className="text-xs text-muted mt-1">
            Run the export cell in <code className="bg-surface2 px-1 rounded">notebooks/pipeline.ipynb</code> §10
            and commit <code className="bg-surface2 px-1 rounded">public/class-stats.json</code> to enable this panel.
          </p>
          <p className="text-[11px] text-muted2 mt-2">
            Per-quadrant + per-S2-tile shares, Gini, Shannon entropy, minority flag — from the LDD shapefile.
          </p>
        </div>
      </div>
    </div>
  );
}
