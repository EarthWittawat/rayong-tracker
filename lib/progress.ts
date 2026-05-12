import type { Task } from "./supabase";

export type ProgressStats = {
  done: number;
  total: number;
  weightedPct: number;
  avgStagesPct: number;
  stages: number;
};

export function computeProgress(tasks: Task[]): ProgressStats {
  let done = 0;
  let total = 0;
  let ratioSum = 0;
  let stages = 0;
  for (const t of tasks) {
    done += t.done;
    total += t.total;
    if (t.total > 0) ratioSum += t.done / t.total;
    stages++;
  }
  const weightedPct = total > 0 ? (done / total) * 100 : 0;
  const avgStagesPct = stages > 0 ? (ratioSum / stages) * 100 : 0;
  return { done, total, weightedPct, avgStagesPct, stages };
}
