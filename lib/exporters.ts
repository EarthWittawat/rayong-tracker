import type { Member, Task } from "./supabase";
import { STAGES } from "./supabase";

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function download(filename: string, mime: string, content: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

export function exportTasksCsv(members: Member[], tasks: Task[]) {
  const memberById = new Map(members.map(m => [m.id, m]));
  const headers = ["member_id", "member_name", "quadrant", "stage", "stage_label", "done", "total", "pct", "note", "updated_at"];
  const lines: string[] = [headers.join(",")];
  // Sort: member then stage order
  const stageOrder = new Map(STAGES.map((s, i) => [s.key, i]));
  const stageLabel = new Map(STAGES.map(s => [s.key, s.label]));
  const sorted = [...tasks].sort((a, b) => {
    const ma = memberById.get(a.member_id)?.name ?? "";
    const mb = memberById.get(b.member_id)?.name ?? "";
    if (ma !== mb) return ma.localeCompare(mb);
    return (stageOrder.get(a.stage) ?? 0) - (stageOrder.get(b.stage) ?? 0);
  });
  for (const t of sorted) {
    const m = memberById.get(t.member_id);
    const pct = t.total > 0 ? ((t.done / t.total) * 100).toFixed(1) : "0.0";
    lines.push([
      t.member_id,
      m?.name ?? "",
      m?.quadrant ?? "",
      t.stage,
      stageLabel.get(t.stage) ?? "",
      t.done,
      t.total,
      pct,
      t.note ?? "",
      t.updated_at ?? "",
    ].map(csvEscape).join(","));
  }
  download(`rayong-tracker-${todayStamp()}.csv`, "text/csv;charset=utf-8", lines.join("\n"));
}

export function exportTasksJson(members: Member[], tasks: Task[]) {
  const payload = {
    exported_at: new Date().toISOString(),
    stages: STAGES,
    members,
    tasks,
  };
  download(`rayong-tracker-${todayStamp()}.json`, "application/json;charset=utf-8", JSON.stringify(payload, null, 2));
}
