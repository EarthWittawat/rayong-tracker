"use client";

import Link from "next/link";
import { useIssueCounts } from "@/lib/issues";

export function IssuesNavLink() {
  const counts = useIssueCounts();
  const open = counts.open;
  const closed = counts.closed;
  const total = open + closed;
  const hasOpen = open > 0;

  return (
    <Link
      href="/issues"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-surface text-ink font-medium hover:bg-surface2 transition-colors whitespace-nowrap"
      title={total === 0
        ? "no issues yet"
        : `${open} open · ${closed} closed`}
    >
      <svg
        width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
        className={hasOpen ? "text-good" : "text-muted2"}
      >
        <circle cx="8" cy="8" r="7" />
        <circle cx="8" cy="8" r="2.5" fill="currentColor" />
      </svg>
      Issues
      {total > 0 && (
        <span
          className={`tabular text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${hasOpen ? "bg-good/15 text-good border border-good/40" : "bg-surface2 text-muted2 border border-border"}`}
        >
          {hasOpen ? open : `0/${closed}`}
        </span>
      )}
      {hasOpen && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-good pulse-soft"
          aria-hidden
          title="has open issues"
        />
      )}
    </Link>
  );
}
