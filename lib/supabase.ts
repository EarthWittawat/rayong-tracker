import { createClient } from "@supabase/supabase-js";

export type StageKey = "data" | "sr" | "gen" | "feat" | "rf";
export type Quadrant = "NW" | "NE" | "SW" | "SE" | "ALL";

export const STAGES: { key: StageKey; label: string; short: string; hint: string }[] = [
  { key: "data", label: "Data acquisition",       short: "Data",  hint: "Sentinel-2 L2A · SCL clean · monthly median" },
  { key: "sr",   label: "Super-resolution ×4",    short: "SR",    hint: "OpenSR latent diffusion · 10m → 2.5m" },
  { key: "gen",  label: "Generative augmentation", short: "GenAI", hint: "Diffusion-sampled · minority classes" },
  { key: "feat", label: "Feature extraction",     short: "Feat",  hint: "Rasterize · indices · GLCM/LBP texture" },
  { key: "rf",   label: "Random Forest",          short: "RF",    hint: "Per-pixel training · cascade classifier" },
];

export type Member = {
  id: string;
  name: string;
  quadrant: Quadrant;
  color: string;
  emoji: string;
  created_at?: string;
};

export type Task = {
  id: string;
  member_id: string;
  stage: StageKey;
  done: number;
  total: number;
  note: string | null;
  updated_at?: string;
};

export type DB = {
  members: Member[];
  tasks: Task[];
};

let _client: ReturnType<typeof createClient> | null = null;

export function getSupabase() {
  if (_client) return _client;
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null; // graceful fallback to demo mode
  _client = createClient(url, anon, {
    realtime: { params: { eventsPerSecond: 5 } },
  });
  return _client;
}

export function isLive() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
