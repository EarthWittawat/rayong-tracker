"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Profile } from "@/lib/auth";

// Chip multi-select for issue assignees. Empty selection renders the
// "Everyone" chip to convey the "no specific owner" semantic.
export function AssigneePicker({
  profiles,
  selected,
  onChange,
  placeholder = "Add assignee…",
}: {
  profiles: Profile[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const byId = useMemo(() => {
    const m = new Map<string, Profile>();
    for (const p of profiles) m.set(p.id, p);
    return m;
  }, [profiles]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return profiles
      .filter(p => !selectedSet.has(p.id))
      .filter(p => !q || p.name.toLowerCase().includes(q));
  }, [profiles, selectedSet, query]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function add(id: string) {
    if (selectedSet.has(id)) return;
    onChange([...selected, id]);
    setQuery("");
    inputRef.current?.focus();
  }

  function remove(id: string) {
    onChange(selected.filter(x => x !== id));
  }

  function clearAll() {
    onChange([]);
  }

  return (
    <div ref={boxRef} className="relative">
      <div
        onClick={() => { setOpen(true); inputRef.current?.focus(); }}
        className="flex items-center gap-1.5 flex-wrap bg-surface2 border border-border rounded-md px-2 py-1.5 min-h-[36px] cursor-text"
      >
        {selected.length === 0 ? (
          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-info/15 text-info border border-info/40">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
            Everyone
          </span>
        ) : (
          selected.map(id => {
            const p = byId.get(id);
            if (!p) return null;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border"
                style={{ background: `${p.color}1F`, color: p.color, borderColor: `${p.color}55` }}
              >
                <span aria-hidden>{p.emoji}</span>
                <span>{p.name}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); remove(id); }}
                  className="ml-0.5 leading-none opacity-70 hover:opacity-100"
                  aria-label={`Remove ${p.name}`}
                >×</button>
              </span>
            );
          })
        )}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && query === "" && selected.length > 0) {
              remove(selected[selected.length - 1]);
            } else if (e.key === "Enter" && filtered.length > 0) {
              e.preventDefault();
              add(filtered[0].id);
            }
          }}
          placeholder={selected.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[80px] bg-transparent text-sm text-ink outline-none placeholder:text-muted2"
        />
        {selected.length > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); clearAll(); }}
            className="text-[10px] text-muted2 hover:text-ink ml-1"
            title="Clear (=> Everyone)"
          >clear</button>
        )}
      </div>

      {open && filtered.length > 0 && (
        <div
          className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-md border border-border bg-surface shadow-cardHover"
        >
          {filtered.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => add(p.id)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-sm text-ink hover:bg-surface2"
            >
              <span aria-hidden>{p.emoji}</span>
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-1 text-[10px] text-muted2">
        Empty selection = visible to everyone.
      </div>
    </div>
  );
}
