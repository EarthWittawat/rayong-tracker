"use client";

import { labelColor } from "@/lib/issues";

export function LabelChip({
  name, onRemove, size = "sm",
}: {
  name: string;
  onRemove?: () => void;
  size?: "sm" | "md";
}) {
  const c = labelColor(name);
  const px = size === "md" ? "px-2 py-0.5 text-[11px]" : "px-1.5 py-0.5 text-[10px]";
  return (
    <span
      className={`inline-flex items-center gap-1 ${px} rounded-full font-medium tabular`}
      style={{ background: `${c}1A`, color: c, border: `1px solid ${c}55` }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />
      {name}
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); onRemove(); }}
          className="ml-0.5 opacity-60 hover:opacity-100"
          aria-label={`remove ${name}`}
        >×</button>
      )}
    </span>
  );
}
