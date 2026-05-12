"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapContainer, TileLayer, Polygon, Polyline, CircleMarker, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet-draw";
import { forward as mgrsForward } from "mgrs";
import { RAYONG_OUTLINE, RAYONG_BBOX, RAYONG_CENTER, QUADRANTS } from "@/lib/rayong";
import type { Member, Task } from "@/lib/supabase";
import { computeProgress } from "@/lib/progress";

type LL = [number, number]; // [lat, lng]

const ESRI_IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_ATTRIB = 'Tiles © <a href="https://www.esri.com/">Esri</a> &mdash; Source: Esri, Maxar, Earthstar Geographics, USDA, USGS, AeroGRID, IGN';

function quadCenter(q: "NW" | "NE" | "SW" | "SE"): LL {
  const { minLng, maxLng, minLat, maxLat } = RAYONG_BBOX;
  const cLng = RAYONG_CENTER.lng;
  const cLat = RAYONG_CENTER.lat;
  const lng = q.includes("W") ? (minLng + cLng) / 2 : (cLng + maxLng) / 2;
  const lat = q.startsWith("N") ? (cLat + maxLat) / 2 : (minLat + cLat) / 2;
  return [lat, lng];
}

function ClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e) => onClick(e.latlng.lat, e.latlng.lng),
  });
  return null;
}

function InvalidateOnResize({ trigger }: { trigger: unknown }) {
  const map = useMap();
  useEffect(() => {
    // Leaflet only redraws when its container resizes if explicitly told.
    // Run a couple of times to cover the CSS transition.
    const a = setTimeout(() => map.invalidateSize(), 50);
    const b = setTimeout(() => map.invalidateSize(), 250);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [trigger, map]);
  return null;
}

type Bbox = { south: number; west: number; north: number; east: number };

function DrawControl({ onBbox }: { onBbox: (b: Bbox | null) => void }) {
  const map = useMap();
  useEffect(() => {
    const drawn = new L.FeatureGroup();
    map.addLayer(drawn);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Draw = (L as any).Control.Draw;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ev = (L as any).Draw.Event;

    const ctrl = new Draw({
      position: "topleft",
      draw: {
        rectangle: { shapeOptions: { color: "#C96442", weight: 2, fillOpacity: 0.08 } },
        polygon: false,
        polyline: false,
        circle: false,
        marker: false,
        circlemarker: false,
      },
      edit: { featureGroup: drawn, remove: true },
    });
    map.addControl(ctrl);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function onCreated(e: any) {
      drawn.clearLayers();
      drawn.addLayer(e.layer);
      const b = e.layer.getBounds();
      onBbox({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function onEdited(e: any) {
      e.layers.eachLayer((layer: L.Rectangle) => {
        const b = layer.getBounds();
        onBbox({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
      });
    }
    function onDeleted() {
      onBbox(null);
    }

    map.on(ev.CREATED, onCreated);
    map.on(ev.EDITED, onEdited);
    map.on(ev.DELETED, onDeleted);

    return () => {
      map.off(ev.CREATED, onCreated);
      map.off(ev.EDITED, onEdited);
      map.off(ev.DELETED, onDeleted);
      map.removeControl(ctrl);
      map.removeLayer(drawn);
    };
  }, [map, onBbox]);
  return null;
}

function safeMgrs(lat: number, lng: number, precision = 5): string {
  try {
    return mgrsForward([lng, lat], precision);
  } catch {
    return "—";
  }
}

function s2Tile(lat: number, lng: number): string {
  // First 5 chars of MGRS = Sentinel-2 100km tile (e.g. 47PQR).
  const s = safeMgrs(lat, lng, 0);
  return s.length >= 5 ? s.slice(0, 5) : "—";
}

export function MapClient({
  members, tasks, focusId, onFocus,
}: { members: Member[]; tasks: Task[]; focusId: string | null; onFocus: (id: string | null) => void }) {
  const outlineLatLng: LL[] = useMemo(
    () => RAYONG_OUTLINE.geometry.coordinates[0].map(([lng, lat]) => [lat, lng] as LL),
    []
  );

  const [click, setClick] = useState<{ lat: number; lng: number } | null>(null);
  const [bbox, setBbox] = useState<Bbox | null>(null);
  const [showS2, setShowS2] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lock body scroll + escape-to-exit while fullscreen.
  useEffect(() => {
    if (!fullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setFullscreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [fullscreen]);

  // S2 (Sentinel-2) 100km MGRS tile prefix grid: scan bbox at coarse step, derive unique tile labels and centers.
  const s2Tiles = useMemo(() => {
    if (!showS2) return [] as { id: string; lat: number; lng: number }[];
    const { minLng, maxLng, minLat, maxLat } = RAYONG_BBOX;
    const step = 0.1;
    const groups = new Map<string, { lats: number[]; lngs: number[] }>();
    for (let lat = minLat; lat <= maxLat + 0.01; lat += step) {
      for (let lng = minLng; lng <= maxLng + 0.01; lng += step) {
        const id = s2Tile(lat, lng);
        if (id === "—") continue;
        if (!groups.has(id)) groups.set(id, { lats: [], lngs: [] });
        const g = groups.get(id)!;
        g.lats.push(lat); g.lngs.push(lng);
      }
    }
    return [...groups.entries()].map(([id, g]) => ({
      id,
      lat: g.lats.reduce((a, b) => a + b, 0) / g.lats.length,
      lng: g.lngs.reduce((a, b) => a + b, 0) / g.lngs.length,
    }));
  }, [showS2]);

  const memberByQ = useMemo(() => {
    const out: Record<string, { member?: Member; pct: number }> = { NW: { pct: 0 }, NE: { pct: 0 }, SW: { pct: 0 }, SE: { pct: 0 } };
    for (const q of QUADRANTS) {
      const m = members.find(x => x.quadrant === q.key);
      if (!m) continue;
      out[q.key] = { member: m, pct: computeProgress(tasks.filter(t => t.member_id === m.id)).weightedPct };
    }
    return out;
  }, [members, tasks]);

  const allMember = useMemo(() => members.find(m => m.quadrant === "ALL"), [members]);
  const allPct = useMemo(
    () => (allMember ? computeProgress(tasks.filter(t => t.member_id === allMember.id)).weightedPct : 0),
    [allMember, tasks]
  );

  function flashCopy(label: string) {
    setCopyMsg(label);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyMsg(null), 1400);
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      flashCopy(`copied ${label}`);
    } catch {
      flashCopy("copy failed");
    }
  }

  const clickMgrs = click ? safeMgrs(click.lat, click.lng, 5) : null;
  const clickTile = click ? s2Tile(click.lat, click.lng) : null;

  const bboxGeojson = bbox && JSON.stringify({
    type: "Feature",
    properties: { source: "rayong-tracker", created_at: new Date().toISOString() },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [bbox.west, bbox.south], [bbox.east, bbox.south],
        [bbox.east, bbox.north], [bbox.west, bbox.north],
        [bbox.west, bbox.south],
      ]],
    },
  }, null, 2);

  const bboxPy = bbox && `bbox = [${bbox.west.toFixed(6)}, ${bbox.south.toFixed(6)}, ${bbox.east.toFixed(6)}, ${bbox.north.toFixed(6)}]  # [west, south, east, north]`;

  const mapWrapClasses = fullscreen
    ? "fixed top-0 left-0 right-0 bottom-0 z-[1400] rounded-none border-0 bg-bg flex flex-col"
    : "relative rounded-lg overflow-hidden border border-border";
  const mapWrapStyle: React.CSSProperties | undefined = fullscreen
    ? { width: "100vw", height: "100vh", top: 0, left: 0 }
    : undefined;
  const mapHeightClass = fullscreen ? "flex-1 h-full" : "h-[460px]";

  const mapNode = (
    <div className={mapWrapClasses} style={mapWrapStyle}>
        <MapContainer
          center={[RAYONG_CENTER.lat, RAYONG_CENTER.lng]}
          zoom={10}
          minZoom={7}
          maxZoom={18}
          scrollWheelZoom
          className={`${mapHeightClass} w-full`}
          style={{ background: "rgb(var(--c-surface2))" }}
        >
          <InvalidateOnResize trigger={fullscreen} />
          <TileLayer url={ESRI_IMAGERY} attribution={ESRI_ATTRIB} maxZoom={19} />

          <Polygon
            positions={outlineLatLng}
            pathOptions={{ color: "#F5F1E8", weight: 2, fillOpacity: 0.0, opacity: 0.9, interactive: false }}
          />

          {/* quadrant divider lines anchored at province centroid */}
          <Polyline
            positions={[[RAYONG_BBOX.maxLat, RAYONG_CENTER.lng], [RAYONG_BBOX.minLat, RAYONG_CENTER.lng]]}
            pathOptions={{ color: "#F5F1E8", weight: 1, dashArray: "4 6", opacity: 0.55, interactive: false }}
          />
          <Polyline
            positions={[[RAYONG_CENTER.lat, RAYONG_BBOX.minLng], [RAYONG_CENTER.lat, RAYONG_BBOX.maxLng]]}
            pathOptions={{ color: "#F5F1E8", weight: 1, dashArray: "4 6", opacity: 0.55, interactive: false }}
          />

          {/* quadrant member chips */}
          {QUADRANTS.map(q => {
            const cell = memberByQ[q.key];
            const [lat, lng] = quadCenter(q.key);
            const isFocus = !!focusId && cell.member?.id === focusId;
            const color = cell.member?.color ?? "#999";
            return (
              <CircleMarker
                key={q.key}
                center={[lat, lng]}
                radius={isFocus ? 14 : 10}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: cell.member ? 0.55 : 0.15,
                  weight: isFocus ? 3 : 2,
                }}
                eventHandlers={cell.member ? { click: () => onFocus(focusId === cell.member!.id ? null : cell.member!.id) } : undefined}
              >
                <Tooltip direction="top" offset={[0, -8]} opacity={1}>
                  <div className="text-xs">
                    <strong>{q.key}</strong>
                    {cell.member ? <> · {cell.member.emoji} {cell.member.name} · <span className="tabular">{cell.pct.toFixed(0)}%</span></> : " · unassigned"}
                  </div>
                </Tooltip>
              </CircleMarker>
            );
          })}

          {/* Sentinel-2 100km MGRS tile labels (only on toggle) */}
          {showS2 && s2Tiles.map(t => (
            <CircleMarker key={t.id} center={[t.lat, t.lng]} radius={4} pathOptions={{ color: "#F5C842", fillColor: "#F5C842", fillOpacity: 0.9, weight: 1, interactive: false }}>
              <Tooltip permanent direction="center" opacity={0.95}>
                <span className="text-[10px] font-semibold tabular text-ink">{t.id}</span>
              </Tooltip>
            </CircleMarker>
          ))}

          {/* clicked point marker */}
          {click && (
            <CircleMarker
              center={[click.lat, click.lng]}
              radius={8}
              pathOptions={{ color: "#FFFFFF", fillColor: "#C96442", fillOpacity: 1, weight: 3, interactive: false }}
            />
          )}

          <ClickHandler onClick={(lat, lng) => setClick({ lat, lng })} />
          <DrawControl onBbox={setBbox} />
        </MapContainer>

        {copyMsg && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[401] bg-ink text-bg text-xs px-3 py-1.5 rounded-md shadow-cardHover">
            {copyMsg}
          </div>
        )}

        <button
          type="button"
          onClick={() => setFullscreen(v => !v)}
          aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
          className="absolute top-3 right-3 z-[401] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-surface/95 backdrop-blur text-ink hover:bg-surface2 shadow-card"
        >
          {fullscreen ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8V5a2 2 0 0 1 2-2h3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M21 16v3a2 2 0 0 1-2 2h-3" /></svg>
          )}
          <span className="text-[11px] font-medium">{fullscreen ? "Exit" : "Fullscreen"}</span>
        </button>

        {/* compact readout floating bottom-left while fullscreen so the user
            can still see click + bbox coords without leaving the map */}
        {fullscreen && (click || bbox) && (
          <div className="absolute bottom-4 left-4 z-[401] max-w-md w-[min(28rem,calc(100vw-32px))] rounded-lg border border-border bg-surface/95 backdrop-blur p-3 space-y-2 shadow-cardHover text-xs">
            {click && (
              <div className="flex items-center gap-2">
                <span className="eyebrow text-[9px] text-muted2 w-14 shrink-0">point</span>
                <code className="flex-1 min-w-0 truncate text-ink bg-surface2 px-1.5 py-0.5 rounded">
                  {click.lat.toFixed(5)}, {click.lng.toFixed(5)} · {clickTile ?? "—"}
                </code>
                <button onClick={() => copy(`${click.lat.toFixed(6)}, ${click.lng.toFixed(6)}`, "lat,lng")} className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted hover:text-ink">copy</button>
                <button onClick={() => setClick(null)} aria-label="clear" className="text-muted2 hover:text-crit">×</button>
              </div>
            )}
            {bbox && (
              <div className="flex items-center gap-2">
                <span className="eyebrow text-[9px] text-muted2 w-14 shrink-0">bbox</span>
                <code className="flex-1 min-w-0 truncate text-ink bg-surface2 px-1.5 py-0.5 rounded">
                  {bbox.west.toFixed(4)}, {bbox.south.toFixed(4)}, {bbox.east.toFixed(4)}, {bbox.north.toFixed(4)}
                </code>
                <button onClick={() => bboxPy && copy(bboxPy, "py bbox")} className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted hover:text-ink">py</button>
                <button onClick={() => bboxGeojson && copy(bboxGeojson, "GeoJSON")} className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted hover:text-ink">geojson</button>
              </div>
            )}
          </div>
        )}

        {fullscreen && (
          <div className="absolute bottom-4 right-4 z-[401] flex items-center gap-2">
            <button
              onClick={() => setShowS2(v => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-colors ${showS2 ? "bg-accent text-bg border-accent" : "bg-surface/95 border-border text-ink hover:bg-surface2"}`}
            >
              <span className={`w-2 h-2 rounded-full ${showS2 ? "bg-bg" : "bg-warn"}`} />
              S2 tiles
            </button>
            <span className="text-[10px] eyebrow px-2 py-1 rounded-md bg-surface/85 border border-border text-muted">Esc to exit</span>
          </div>
        )}
      </div>
  );

  return (
    <div className="space-y-3">
      {/* When fullscreen, portal the map wrap to <body> so no ancestor's
          transform / filter / backdrop-filter can shrink the fixed container.
          Otherwise render in place. */}
      {fullscreen && typeof document !== "undefined" ? createPortal(mapNode, document.body) : mapNode}

      {/* control strip */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button
          onClick={() => setShowS2(v => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border transition-colors ${showS2 ? "bg-accent text-bg border-accent" : "bg-surface border-border text-ink hover:bg-surface2"}`}
        >
          <span className={`w-2 h-2 rounded-full ${showS2 ? "bg-bg" : "bg-warn"}`} />
          Sentinel-2 100km tiles
        </button>
        {click && (
          <button onClick={() => setClick(null)} className="text-muted hover:text-ink underline-offset-2 hover:underline">
            clear point
          </button>
        )}
        {allMember && (
          <button
            onClick={() => onFocus(focusId === allMember.id ? null : allMember.id)}
            className={`ml-auto inline-flex items-center gap-1.5 px-2 py-1 rounded-md border transition-colors ${focusId === allMember.id ? "border-border2 bg-surface2" : "border-border hover:bg-surface2"}`}
            title="cross-cutting role · no quadrant"
          >
            <span className="w-2 h-2 rounded-full" style={{ background: allMember.color }} />
            <span className="text-ink font-medium">{allMember.name}</span>
            <span className="tabular" style={{ color: allMember.color }}>{allPct.toFixed(0)}%</span>
            <span className="text-muted2">ALL</span>
          </button>
        )}
      </div>

      {/* readouts (click point + drawn bbox) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs uppercase tracking-wider text-muted2">Click point</h3>
            {click && <span className="text-[10px] text-muted2 tabular">{clickTile}</span>}
          </div>
          {click ? (
            <div className="space-y-2 text-sm">
              <Row label="lat, lng" value={`${click.lat.toFixed(6)}, ${click.lng.toFixed(6)}`} onCopy={() => copy(`${click.lat.toFixed(6)}, ${click.lng.toFixed(6)}`, "lat,lng")} />
              <Row label="python" value={`[${click.lng.toFixed(6)}, ${click.lat.toFixed(6)}]  # lng, lat`} onCopy={() => copy(`[${click.lng.toFixed(6)}, ${click.lat.toFixed(6)}]`, "py list")} />
              <Row label="MGRS" value={clickMgrs ?? "—"} onCopy={() => clickMgrs && copy(clickMgrs, "MGRS")} mono />
              <Row label="S2 tile" value={clickTile ?? "—"} onCopy={() => clickTile && copy(clickTile, "S2 tile")} mono />
            </div>
          ) : (
            <div className="text-sm text-muted2 italic">click anywhere on the map to read coordinates</div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs uppercase tracking-wider text-muted2">Drawn bbox</h3>
            <span className="text-[10px] text-muted2">use the rectangle tool ↖ to draw</span>
          </div>
          {bbox ? (
            <div className="space-y-2 text-sm">
              <Row
                label="bbox"
                value={`${bbox.west.toFixed(4)}, ${bbox.south.toFixed(4)}, ${bbox.east.toFixed(4)}, ${bbox.north.toFixed(4)}`}
                onCopy={() => copy(`${bbox.west.toFixed(6)},${bbox.south.toFixed(6)},${bbox.east.toFixed(6)},${bbox.north.toFixed(6)}`, "bbox")}
              />
              <Row label="python" value={bboxPy ?? ""} onCopy={() => bboxPy && copy(bboxPy, "py bbox")} mono />
              <details className="mt-1">
                <summary className="text-xs text-muted hover:text-ink cursor-pointer">GeoJSON</summary>
                <pre className="mt-1 text-[11px] bg-surface2 p-2 rounded-md overflow-auto max-h-48 tabular text-muted">{bboxGeojson}</pre>
                <button onClick={() => bboxGeojson && copy(bboxGeojson, "GeoJSON")} className="mt-1 text-xs text-info hover:underline">copy GeoJSON</button>
              </details>
            </div>
          ) : (
            <div className="text-sm text-muted2 italic">draw a rectangle on the map to export an AOI</div>
          )}
        </div>
      </div>

      {/* per-quadrant AOI presets — paste into notebooks/_build_notebook.py or just set CFG.aoi_quadrant */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs uppercase tracking-wider text-muted2">Quadrant AOI presets</h3>
          <span className="text-[10px] text-muted2">notebook · <code className="bg-surface2 px-1 rounded">CFG.aoi_quadrant</code></span>
        </div>
        <p className="text-[11px] text-muted mb-3">
          Each teammate computes on the same notebook, just with a different quadrant. Pick yours from the chips below — copy the one-line CFG override, or the raw bbox for a custom AOI.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {QUADRANTS.map(q => {
            const [lat, lng] = quadCenter(q.key);
            const { minLng, maxLng, minLat, maxLat } = RAYONG_BBOX;
            const cLng = RAYONG_CENTER.lng, cLat = RAYONG_CENTER.lat;
            const west = q.key.includes("W") ? minLng : cLng;
            const east = q.key.includes("W") ? cLng : maxLng;
            const south = q.key.startsWith("N") ? cLat : minLat;
            const north = q.key.startsWith("N") ? maxLat : cLat;
            const cfgLine = `CFG.aoi_quadrant = "${q.key}"`;
            const bboxPyLine = `aoi_bbox = (${west.toFixed(4)}, ${south.toFixed(4)}, ${east.toFixed(4)}, ${north.toFixed(4)})  # ${q.key}`;
            const member = memberByQ[q.key].member;
            return (
              <div key={q.key} className="rounded-md border border-border bg-surface2/40 p-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-semibold text-ink tabular">{q.key}</span>
                  {member && (
                    <span className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full"
                          style={{ background: `${member.color}1A`, color: member.color, border: `1px solid ${member.color}40` }}>
                      <span>{member.emoji}</span>{member.name}
                    </span>
                  )}
                </div>
                <div className="text-[10px] tabular text-muted2 mb-2">
                  W {west.toFixed(4)} · S {south.toFixed(4)} · E {east.toFixed(4)} · N {north.toFixed(4)}
                  <span className="ml-1 text-muted2/70">· center {lng.toFixed(3)}, {lat.toFixed(3)}</span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={() => copy(cfgLine, `${q.key} CFG line`)}
                    className="text-[10px] px-2 py-1 rounded border border-border text-muted hover:text-ink hover:bg-surface2 tabular"
                    title={cfgLine}
                  >copy CFG line</button>
                  <button
                    onClick={() => copy(bboxPyLine, `${q.key} bbox`)}
                    className="text-[10px] px-2 py-1 rounded border border-border text-muted hover:text-ink hover:bg-surface2 tabular"
                    title={bboxPyLine}
                  >copy bbox</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, onCopy, mono }: { label: string; value: string; onCopy: () => void; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[11px] uppercase tracking-wider text-muted2">{label}</span>
      <code className={`flex-1 min-w-0 truncate text-xs text-ink bg-surface2 px-2 py-1 rounded ${mono ? "font-mono" : ""}`} title={value}>{value}</code>
      <button onClick={onCopy} className="text-xs px-2 py-1 rounded border border-border text-muted hover:text-ink hover:bg-surface2" title="copy">copy</button>
    </div>
  );
}
