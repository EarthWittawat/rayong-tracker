"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import "@excalidraw/excalidraw/index.css";
import type { Profile } from "@/lib/auth";
import { useWhiteboard } from "@/lib/whiteboard";
import { WhiteboardRefPicker, type RefPick } from "./WhiteboardRefPicker";

// Excalidraw is client-only + ~1.5 MB. Lazy-load so the rest of the app
// doesn't pay the bundle.
const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  {
    ssr: false,
    loading: () => (
      <div className="h-[70vh] rounded-lg border border-border bg-surface2 flex items-center justify-center text-muted text-sm">
        loading whiteboard…
      </div>
    ),
  },
);

type ExcalidrawAPI = {
  updateScene: (scene: { elements?: unknown[]; appState?: Record<string, unknown>; files?: Record<string, unknown> }) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSceneElements: () => readonly any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getAppState: () => any;
};

export function Whiteboard({ slug, profile, profiles }: { slug: string; profile: Profile; profiles: Profile[] }) {
  const { scene, loading, error, save } = useWhiteboard(slug, profile);
  const apiRef = useRef<ExcalidrawAPI | null>(null);
  const remoteAppliedAtRef = useRef<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // Track current site theme so Excalidraw matches.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = () => setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  // Apply remote scene updates to the Excalidraw canvas.
  useEffect(() => {
    if (!scene || !apiRef.current) return;
    if (scene.updatedAt === remoteAppliedAtRef.current) return;
    remoteAppliedAtRef.current = scene.updatedAt;
    apiRef.current.updateScene({
      elements: scene.elements,
      // Don't bleed appState across users (selections, viewport, etc.)
      // — just trust local appState after the first load.
    });
  }, [scene]);

  // initialData runs once on mount; subsequent remote updates flow through
  // `excalidrawAPI.updateScene`. We deliberately DROP the persisted
  // appState — Excalidraw is strict about its shape (zoom, viewBackground,
  // collaborators, etc.) and a stale or partial object from Supabase can
  // throw inside the constructor. Elements + files are stable wire types.
  const initialData = useMemo(() => {
    if (!scene) return null;
    return {
      elements: Array.isArray(scene.elements) ? scene.elements : [],
      files:    (scene.files && typeof scene.files === "object") ? scene.files : {},
      // appState intentionally omitted — Excalidraw fills its own defaults.
    };
  }, [scene]);

  const onChange = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (elements: readonly any[], appState: any, files: any) => {
      // Excalidraw fires onChange on every render including pointer move.
      // The save() helper debounces ~350 ms so we don't hammer Supabase.
      save({
        elements: elements as unknown[],
        appState: appState as Record<string, unknown>,
        files: files as Record<string, unknown>,
      });
    },
    [save],
  );

  // All hooks declared above the early returns so hook order stays stable
  // between renders (React error #310 fires if a hook lives below `return`).
  const insertRef = useCallback(async (pick: RefPick) => {
    const api = apiRef.current;
    if (!api) return;
    const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
    const app = api.getAppState();
    const zoom = app?.zoom?.value ?? 1;
    const x = -(app?.scrollX ?? 0) + 60 / zoom;
    const y = -(app?.scrollY ?? 0) + 60 / zoom;
    const created = convertToExcalidrawElements([
      {
        type: "text",
        x,
        y,
        text: pick.label,
        fontSize: 20,
        strokeColor: pick.color,
        link: pick.link,
      } as never,
    ]);
    api.updateScene({ elements: [...api.getSceneElements(), ...created] });
  }, []);

  if (loading) {
    return (
      <div className="h-[70vh] rounded-lg border border-border bg-surface2 flex items-center justify-center text-muted text-sm">
        loading whiteboard…
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-6 rounded-lg border border-crit/40 bg-crit/5 text-crit text-sm">
        Whiteboard error: {error}
      </div>
    );
  }
  if (!initialData) return null;

  return (
    <div className="relative h-[78vh] w-full rounded-lg overflow-hidden border border-border bg-surface">
      <Excalidraw
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        excalidrawAPI={(api: any) => { apiRef.current = api; }}
        initialData={initialData as never}
        onChange={onChange}
        theme={theme}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
            export: { saveFileToDisk: true },
          },
        }}
      />
      <WhiteboardRefPicker profiles={profiles} onPick={insertRef} />
    </div>
  );
}
