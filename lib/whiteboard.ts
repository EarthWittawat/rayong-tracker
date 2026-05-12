"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "./supabase";
import type { Profile } from "./auth";

export type WhiteboardRow = {
  id: string;
  slug: string;
  name: string;
  elements: unknown[];
  app_state: Record<string, unknown>;
  files: Record<string, unknown>;
  updated_at: string;
  updated_by: string | null;
  created_at: string;
};

export type WhiteboardScene = {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
  updatedAt: string;
  updatedBy: string | null;
};

export function useWhiteboard(slug: string, profile: Profile | null) {
  const [scene, setScene]   = useState<WhiteboardScene | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const lastSavedAtRef = useRef<string | null>(null);
  const saveTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) { setError("Supabase unavailable"); setLoading(false); return; }
    let alive = true;
    (async () => {
      setLoading(true);
      const { data, error } = await sb
        .from("whiteboards")
        .select("*")
        .eq("slug", slug)
        .maybeSingle();
      if (!alive) return;
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      let row = data as WhiteboardRow | null;
      if (!row) {
        // Auto-create on first load if the migration's seed row got dropped.
        const { data: ins, error: insErr } = await sb
          .from("whiteboards")
          .insert({ slug, name: slug })
          .select("*")
          .single();
        if (insErr) {
          if (alive) { setError(insErr.message); setLoading(false); }
          return;
        }
        row = ins as WhiteboardRow;
      }
      lastSavedAtRef.current = row.updated_at;
      setScene({
        elements: row.elements ?? [],
        appState: row.app_state ?? {},
        files: row.files ?? {},
        updatedAt: row.updated_at,
        updatedBy: row.updated_by,
      });
      setLoading(false);
    })();

    const ch = sb.channel(`wb-${slug}-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "whiteboards", filter: `slug=eq.${slug}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            setScene(null);
            return;
          }
          const row = payload.new as WhiteboardRow;
          // Drop echoes of our own debounced save.
          if (row.updated_at === lastSavedAtRef.current) return;
          lastSavedAtRef.current = row.updated_at;
          setScene({
            elements: row.elements ?? [],
            appState: row.app_state ?? {},
            files: row.files ?? {},
            updatedAt: row.updated_at,
            updatedBy: row.updated_by,
          });
        })
      .subscribe();

    return () => {
      alive = false;
      sb.removeChannel(ch);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [slug]);

  const save = useCallback((next: Pick<WhiteboardScene, "elements" | "appState" | "files">) => {
    if (!profile) return;
    const sb = getSupabase();
    if (!sb) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const { data, error } = await sb
        .from("whiteboards")
        .update({
          elements: next.elements,
          app_state: next.appState,
          files: next.files,
          updated_by: profile.id,
        })
        .eq("slug", slug)
        .select("updated_at")
        .single();
      if (error) {
        setError(error.message);
        return;
      }
      if (data?.updated_at) lastSavedAtRef.current = data.updated_at as string;
    }, 350);
  }, [slug, profile]);

  return { scene, loading, error, save };
}
