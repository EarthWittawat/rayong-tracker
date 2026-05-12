"use client";

import { useRef, useState, useEffect } from "react";
import { mentionTrigger, issueTrigger, type IssueIndexItem } from "@/lib/mentions";
import type { Profile } from "@/lib/auth";

type MentionHint = {
  kind: "mention";
  start: number;
  query: string;
  suggestions: Profile[];
  selected: number;
};

type IssueHint = {
  kind: "issue";
  start: number;
  query: string;
  suggestions: IssueIndexItem[];
  selected: number;
};

type Hint = MentionHint | IssueHint;

export function MentionInput({
  value, onChange, onSubmit, profiles, issues, placeholder, autoFocus, rows = 2, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  profiles: Profile[];
  /** Optional. Provide to enable the `#NNN` issue picker. */
  issues?: IssueIndexItem[];
  placeholder?: string;
  autoFocus?: boolean;
  rows?: number;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [hint, setHint] = useState<Hint | null>(null);

  function recomputeHint() {
    const el = ref.current;
    if (!el) return;
    const cur = el.selectionStart ?? value.length;

    // @ first — mention takes priority when both could match (rare).
    const mres = mentionTrigger(value, cur, profiles);
    if (mres.active && mres.suggestions.length > 0) {
      setHint(prev => {
        const keep = prev && prev.kind === "mention" && prev.start === mres.start ? prev : null;
        return {
          kind: "mention",
          start: mres.start,
          query: mres.query,
          suggestions: mres.suggestions,
          selected: keep ? Math.min(keep.selected, mres.suggestions.length - 1) : 0,
        };
      });
      return;
    }

    if (issues && issues.length > 0) {
      const ires = issueTrigger(value, cur, issues);
      if (ires.active && ires.suggestions.length > 0) {
        setHint(prev => {
          const keep = prev && prev.kind === "issue" && prev.start === ires.start ? prev : null;
          return {
            kind: "issue",
            start: ires.start,
            query: ires.query,
            suggestions: ires.suggestions,
            selected: keep ? Math.min(keep.selected, ires.suggestions.length - 1) : 0,
          };
        });
        return;
      }
    }

    setHint(null);
  }

  useEffect(() => {
    recomputeHint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, profiles, issues]);

  function acceptSuggestion(idx: number) {
    if (!hint) return;
    const before = value.slice(0, hint.start);
    const after = value.slice(hint.start + 1 + hint.query.length);
    let insertion: string;
    if (hint.kind === "mention") {
      const p = hint.suggestions[idx];
      insertion = `@${p.name} `;
    } else {
      const i = hint.suggestions[idx];
      insertion = `#${i.number} `;
    }
    const next = `${before}${insertion}${after}`;
    onChange(next);
    setHint(null);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const pos = before.length + insertion.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (hint) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHint(h => h ? ({ ...h, selected: (h.selected + 1) % h.suggestions.length } as Hint) : h);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHint(h => h ? ({ ...h, selected: (h.selected - 1 + h.suggestions.length) % h.suggestions.length } as Hint) : h);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        acceptSuggestion(hint.selected);
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
      {hint && hint.kind === "mention" && (
        <div className="absolute z-20 mt-1 left-0 bg-surface border border-border rounded-md shadow-cardHover py-1 min-w-[12rem] max-w-[20rem]">
          {hint.suggestions.map((p, i) => (
            <button
              key={p.id}
              onMouseDown={(e) => { e.preventDefault(); acceptSuggestion(i); }}
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
      {hint && hint.kind === "issue" && (
        <div className="absolute z-20 mt-1 left-0 bg-surface border border-border rounded-md shadow-cardHover py-1 min-w-[16rem] max-w-[24rem]">
          {hint.suggestions.map((i, idx) => {
            const closed = i.status === "closed";
            return (
              <button
                key={i.number}
                onMouseDown={(e) => { e.preventDefault(); acceptSuggestion(idx); }}
                className={`w-full flex items-center gap-2 text-left px-2 py-1.5 text-xs ${idx === hint.selected ? "bg-surface2" : "hover:bg-surface2"}`}
                title={i.title}
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${closed ? "bg-muted2" : "bg-good"}`}
                  title={closed ? "closed" : "open"}
                />
                <span className="tabular text-accent2 font-medium shrink-0">#{i.number}</span>
                <span className={`truncate ${closed ? "text-muted2 line-through" : "text-ink"}`}>{i.title}</span>
              </button>
            );
          })}
          {hint.suggestions.length === 0 && (
            <div className="px-2 py-1.5 text-[11px] text-muted2 italic">no matching issue</div>
          )}
        </div>
      )}
    </div>
  );
}
