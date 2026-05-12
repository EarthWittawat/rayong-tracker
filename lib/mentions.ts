// Lightweight @mention parsing.
// Names can contain spaces; we match greedily against the known profile set
// to support "@Wittawat K" without forcing nicknames.

import type { Profile } from "./auth";

export type MentionMatch = {
  id: string;       // profile.id
  name: string;     // matched display name
  start: number;    // index in body where the @ is
  end: number;      // exclusive end of name
};

const MENTION_RE = /(^|[^A-Za-z0-9_])@([A-Za-z0-9_][A-Za-z0-9_\s.\-]{0,40})/g;

export function parseMentions(body: string, profiles: Profile[]): MentionMatch[] {
  if (!body) return [];
  // Sort longest names first so "@Alice Smith" wins over "@Alice".
  const byNameLen = profiles
    .filter(p => p.name && p.name.length > 0)
    .slice()
    .sort((a, b) => b.name.length - a.name.length);

  const out: MentionMatch[] = [];
  const seen = new Set<string>();

  let m: RegExpExecArray | null;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(body)) !== null) {
    const atIdx = m.index + (m[1]?.length ?? 0);
    const rest  = body.slice(atIdx + 1);
    // Match against any known display name (case-insensitive).
    const hit = byNameLen.find(p => {
      const n = p.name.trim();
      if (!n) return false;
      const slice = rest.slice(0, n.length);
      return slice.toLowerCase() === n.toLowerCase();
    });
    if (!hit) continue;
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    out.push({
      id: hit.id,
      name: hit.name,
      start: atIdx,
      end: atIdx + 1 + hit.name.length,
    });
  }
  return out;
}

// Format the body with mentions wrapped in <span class="mention">…</span>.
// Returns plain HTML; callers must trust the source (own profile names only).
export function renderMentionsHTML(body: string, mentions: MentionMatch[]): string {
  if (mentions.length === 0) return escapeHtml(body);
  const sorted = mentions.slice().sort((a, b) => a.start - b.start);
  const parts: string[] = [];
  let cursor = 0;
  for (const m of sorted) {
    if (m.start > cursor) parts.push(escapeHtml(body.slice(cursor, m.start)));
    parts.push(`<span class="mention" data-uid="${m.id}">@${escapeHtml(m.name)}</span>`);
    cursor = m.end;
  }
  if (cursor < body.length) parts.push(escapeHtml(body.slice(cursor)));
  return parts.join("");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  } as Record<string, string>)[c]);
}

// Find suggestions while user is typing. Returns the active token (the
// substring after the last "@" before cursor) plus matching profiles.
export function mentionTrigger(text: string, cursor: number, profiles: Profile[]): {
  active: boolean;
  query: string;
  start: number;
  suggestions: Profile[];
} {
  const left = text.slice(0, cursor);
  const atIdx = left.lastIndexOf("@");
  if (atIdx < 0) return { active: false, query: "", start: -1, suggestions: [] };
  // Must be at start or preceded by whitespace/punct
  const prev = atIdx > 0 ? left[atIdx - 1] : " ";
  if (!/\s|[(,;:]/.test(prev) && atIdx !== 0) return { active: false, query: "", start: -1, suggestions: [] };
  const query = left.slice(atIdx + 1);
  // Allow spaces but cap to avoid runaway
  if (query.length > 40 || /\n/.test(query)) return { active: false, query: "", start: -1, suggestions: [] };
  const q = query.toLowerCase();
  const sug = profiles
    .filter(p => p.name && p.name.toLowerCase().includes(q))
    .slice(0, 6);
  return { active: true, query, start: atIdx, suggestions: sug };
}
