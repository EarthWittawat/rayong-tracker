export type ClassDef = {
  id: string;
  label: string;
  color: string;
  minority?: boolean;
};

export type ClassShare = {
  id: string;
  area_km2: number;
  share: number;
};

export type AreaMetrics = {
  shannon: number;       // entropy in bits — higher = more balanced
  gini: number;          // 0 = perfectly balanced, 1 = totally skewed
  max_min_ratio: number; // top class area / bottom class area (excl. zeros)
};

export type AreaStat = {
  key: string;
  label: string;
  kind: "overall" | "quadrant" | "s2_tile";
  area_km2_total: number;
  classes: ClassShare[];
  metrics: AreaMetrics;
};

export type ClassStats = {
  version: number;
  generated_at: string;
  source: string;
  classes: ClassDef[];
  areas: AreaStat[];
};

export async function loadClassStats(): Promise<ClassStats | null> {
  try {
    const res = await fetch("/class-stats.json", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as ClassStats;
  } catch {
    return null;
  }
}
