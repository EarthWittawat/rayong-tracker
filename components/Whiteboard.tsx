"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Profile } from "@/lib/auth";
import { useWhiteboard } from "@/lib/whiteboard";

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
};

export function Whiteboard({ slug, profile }: { slug: string; profile: Profile }) {
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

  const initialData = useMemo(() => {
    if (!scene) return null;
    return {
      elements: scene.elements,
      appState: scene.appState,
      files: scene.files,
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
    <div className="h-[78vh] w-full rounded-lg overflow-hidden border border-border bg-surface">
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
    </div>
  );
}
