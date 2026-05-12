"use client";

import { useMemo } from "react";
import { RAYONG_OUTLINE, RAYONG_BBOX, RAYONG_CENTER, QUADRANTS, type QuadKey } from "@/lib/rayong";
import type { Member, Task } from "@/lib/supabase";
import { computeProgress } from "@/lib/progress";

const PAD = 16;
const W = 560;
const H = 360;

function project(lng: number, lat: number) {
  const { minLng, maxLng, minLat, maxLat } = RAYONG_BBOX;
  // preserve aspect ratio: pick smaller scale, center the polygon
  const innerW = W - 2 * PAD;
  const innerH = H - 2 * PAD;
  const sx = innerW / (maxLng - minLng);
  const sy = innerH / (maxLat - minLat);
  const s = Math.min(sx, sy);
  const dx = (innerW - (maxLng - minLng) * s) / 2;
  const dy = (innerH - (maxLat - minLat) * s) / 2;
  const x = PAD + dx + (lng - minLng) * s;
  const y = PAD + dy + (1 - (lat - minLat) / (maxLat - minLat)) * (maxLat - minLat) * s;
  return [x, y] as const;
}

export function RayongMap({
  members, tasks, focusId, onFocus,
}: { members: Member[]; tasks: Task[]; focusId: string | null; onFocus: (id: string | null) => void }) {

  const outline = useMemo(() => {
    const coords = RAYONG_OUTLINE.geometry.coordinates[0];
    return coords.map((c: number[], i: number) => {
      const [x, y] = project(c[0], c[1]);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ") + " Z";
  }, []);

  const qCenter: Record<QuadKey, [number, number]> = useMemo(() => {
    const c = RAYONG_CENTER;
    const halfNW: [number, number] = [(RAYONG_BBOX.minLng + c.lng) / 2, (c.lat + RAYONG_BBOX.maxLat) / 2];
    const halfNE: [number, number] = [(c.lng + RAYONG_BBOX.maxLng) / 2, (c.lat + RAYONG_BBOX.maxLat) / 2];
    const halfSW: [number, number] = [(RAYONG_BBOX.minLng + c.lng) / 2, (RAYONG_BBOX.minLat + c.lat) / 2];
    const halfSE: [number, number] = [(c.lng + RAYONG_BBOX.maxLng) / 2, (RAYONG_BBOX.minLat + c.lat) / 2];
    const p = (xy: [number, number]): [number, number] => {
      const [x, y] = project(xy[0], xy[1]);
      return [x, y];
    };
    return { NW: p(halfNW), NE: p(halfNE), SW: p(halfSW), SE: p(halfSE) };
  }, []);

  const byQ = useMemo(() => {
    const out: Record<QuadKey, { member?: Member; pct: number }> = {
      NW: { pct: 0 }, NE: { pct: 0 }, SW: { pct: 0 }, SE: { pct: 0 },
    };
    for (const q of QUADRANTS) {
      const member = members.find(m => m.quadrant === q.key);
      if (!member) continue;
      const t = tasks.filter(t => t.member_id === member.id);
      out[q.key] = { member, pct: computeProgress(t).weightedPct };
    }
    return out;
  }, [members, tasks]);

  const allMember = useMemo(() => members.find(m => m.quadrant === "ALL"), [members]);
  const allPct = useMemo(() => {
    if (!allMember) return 0;
    return computeProgress(tasks.filter(t => t.member_id === allMember.id)).weightedPct;
  }, [allMember, tasks]);

  const [cx, cy] = project(RAYONG_CENTER.lng, RAYONG_CENTER.lat);

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Rayong province with quadrant progress">
        <defs>
          <clipPath id="rayongClip"><path d={outline} /></clipPath>
        </defs>

        {/* base land */}
        <path d={outline} fill="#F4F2EE" stroke="none" />

        {/* quadrant fills, opacity ∝ progress, clipped to polygon */}
        <g clipPath="url(#rayongClip)">
          {QUADRANTS.map(q => {
            const [qx, qy] = q.key === "NW" ? [0, 0] :
                             q.key === "NE" ? [cx, 0] :
                             q.key === "SW" ? [0, cy] : [cx, cy];
            const ww = q.key.includes("W") ? cx : (W - cx);
            const hh = q.key.startsWith("N") ? cy : (H - cy);
            const m = byQ[q.key].member;
            const pct = byQ[q.key].pct;
            const isFocus = focusId && m?.id === focusId;
            // Opacity rises with progress: 0.08 base → 0.55 at 100%.
            const op = m ? 0.08 + (pct / 100) * 0.47 : 0.04;
            return (
              <g key={q.key}>
                <rect x={qx} y={qy} width={ww} height={hh}
                      fill={m?.color || "#D9D5CC"} fillOpacity={isFocus ? Math.min(0.7, op + 0.15) : op} />
              </g>
            );
          })}
        </g>

        {/* outline stroke on top */}
        <path d={outline} fill="none" stroke="#1F1E1B" strokeOpacity="0.55" strokeWidth="1.4" />

        {/* quadrant divider lines (clipped) */}
        <g clipPath="url(#rayongClip)" opacity="0.5">
          <line x1={cx} y1={PAD} x2={cx} y2={H - PAD} stroke="#1F1E1B" strokeOpacity="0.22" strokeDasharray="2 4" strokeWidth="1" />
          <line x1={PAD} y1={cy} x2={W - PAD} y2={cy} stroke="#1F1E1B" strokeOpacity="0.22" strokeDasharray="2 4" strokeWidth="1" />
        </g>

        {/* quadrant labels with member chip */}
        {QUADRANTS.map(q => {
          const m = byQ[q.key].member;
          const pct = byQ[q.key].pct;
          const [qx, qy] = qCenter[q.key];
          const isFocus = focusId && m?.id === focusId;
          return (
            <g key={q.key} style={{ cursor: m ? "pointer" : "default" }} onClick={() => m && onFocus(focusId === m.id ? null : m.id)}>
              <rect x={qx - 58} y={qy - 26} width={116} height={52} rx={10}
                    fill="#FFFFFF" stroke={isFocus ? (m?.color || "#1F1E1B") : "#E7E4DD"}
                    strokeWidth={isFocus ? 2 : 1} />
              <text x={qx} y={qy - 8} textAnchor="middle" fontSize="11" fill="#6B6862" fontWeight="500">
                {q.key} {m ? `· ${m.name}` : ""}
              </text>
              <text x={qx} y={qy + 13} textAnchor="middle" fontSize="16" fontWeight="600"
                    fill={m?.color || "#9A968D"} className="tabular">
                {m ? `${pct.toFixed(0)}%` : "unassigned"}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="flex items-center justify-between text-[11px] text-muted2 px-1">
        <span>Fill darkness rises with progress · click a quadrant to focus that member.</span>
        {allMember && (
          <button
            onClick={() => onFocus(focusId === allMember.id ? null : allMember.id)}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border transition-colors ${focusId === allMember.id ? "border-border2 bg-surface2" : "border-border hover:bg-surface2"}`}
            title="cross-cutting role · no quadrant"
          >
            <span className="w-2 h-2 rounded-full" style={{ background: allMember.color }} />
            <span className="text-ink font-medium">{allMember.name}</span>
            <span className="tabular" style={{ color: allMember.color }}>{allPct.toFixed(0)}%</span>
            <span className="text-muted2">ALL</span>
          </button>
        )}
      </div>
    </div>
  );
}
