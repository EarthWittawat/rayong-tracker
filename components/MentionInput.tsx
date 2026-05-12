"use client";

import { useRef, useState, useEffect } from "react";
import { mentionTrigger } from "@/lib/mentions";
import type { Profile } from "@/lib/auth";

export function MentionInput({
  value, onChange, onSubmit, profiles, placeholder, autoFocus, rows = 2, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  profiles: Profile[];
  placeholder?: string;
  autoFocus?: boolean;
  rows?: number;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [hint, setHint] = useState<{ start: number; query: string; suggestions: Profile[]; selected: number } | null>(null);

  function recomputeHint() {
    const el = ref.current;
    if (!el) return;
    const cur = el.selectionStart ?? value.length;
    const res = mentionTrigger(value, cur, profiles);
    if (res.active && res.suggestions.length > 0) {
      setHint(prev => ({
        start: res.start,
        query: res.query,
        suggestions: res.suggestions,
        selected: prev && prev.start === res.start ? Math.min(prev.selected, res.suggestions.length - 1) : 0,
      }));
    } else {
      setHint(null);
    }
  }

  useEffect(() => {
    recomputeHint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, profiles]);

  function acceptSuggestion(p: Profile) {
    if (!hint) return;
    const before = value.slice(0, hint.start);
    const after  = value.slice(hint.start + 1 + hint.query.length);
    const next   = `${before}@${p.name} ${after}`;
    onChange(next);
    setHint(null);
    // restore caret after the inserted mention
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const pos = before.length + 1 + p.name.length + 1; // include trailing space
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (hint) {
      if (e.key === "ArrowDown") { e.preventDefault(); setHint(h => h ? { ...h, selected: (h.selected + 1) % h.suggestions.length } : h); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setHint(h => h ? { ...h, selected: (h.selected - 1 + h.suggestions.length) % h.suggestions.length } : h); return; }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        acceptSuggestion(hint.suggestions[hint.selected]);
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); setHint(null); return; }
    }
    if (onSubmit && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        onClick={recomputeHint}
        onKeyUp={recomputeHint}
        placeholder={placeholder ?? "Write a comment… @user to mention · #123 to link an issue"}
        autoFocus={autoFocus}
        rows={rows}
        disabled={disabled}
        className="w-full text-sm bg-surface2/50 border border-border rounded-md px-2.5 py-1.5 outline-none focus:border-border2 resize-y disabled:opacity-50"
      />
      {hint && (
        <div className="absolute z-20 mt-1 left-0 bg-surface border border-border rounded-md shadow-cardHover py-1 min-w-[12rem] max-w-[18rem]">
          {hint.suggestions.map((p, i) => (
            <button
              key={p.id}
              onMouseDown={(e) => { e.preventDefault(); acceptSuggestion(p); }}
              className={`w-full flex items-center gap-2 text-left px-2 py-1.5 text-xs ${i === hint.selected ? "bg-surface2" : "hover:bg-surface2"}`}
            >
              {p.avatar_url ? (
                <img src={p.avatar_url} alt={p.name} className="w-5 h-5 rounded-full object-cover" />
              ) : (
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px]"
                      style={{ background: `${p.color}1A`, color: p.color }}>{p.emoji}</span>
              )}
              <span className="text-ink truncate">{p.name}</span>
              {p.email && <span className="text-muted2 truncate text-[10px]">{p.email}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
