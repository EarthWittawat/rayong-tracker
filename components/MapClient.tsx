"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  return (
    <div className="space-y-3">
      <div className="relative rounded-lg overflow-hidden border border-border">
        <MapContainer
          center={[RAYONG_CENTER.lat, RAYONG_CENTER.lng]}
          zoom={10}
          minZoom={7}
          maxZoom={18}
          scrollWheelZoom
          className="h-[460px] w-full"
          style={{ background: "rgb(var(--c-surface2))" }}
        >
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
          <div className="absolute top-3 right-3 z-[401] bg-ink text-bg text-xs px-3 py-1.5 rounded-md shadow-cardHover">
            {copyMsg}
          </div>
        )}
      </div>

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
