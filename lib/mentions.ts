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

// ─────────────────────────────────────────────────────────────
// Issue references: `#NNN` autolinks that point at /issues/NNN.
// Match when '#' sits at start of body or after whitespace / punctuation,
// so things like "id#123" inside a URL don't trigger.
// ─────────────────────────────────────────────────────────────

export type IssueRef = {
  number: number;
  start: number;   // index of '#'
  end: number;     // index after last digit
};

const ISSUE_RE = /(^|[^A-Za-z0-9_])#(\d{1,9})\b/g;

export function parseIssueRefs(body: string): IssueRef[] {
  if (!body) return [];
  const out: IssueRef[] = [];
  let m: RegExpExecArray | null;
  ISSUE_RE.lastIndex = 0;
  while ((m = ISSUE_RE.exec(body)) !== null) {
    const num = parseInt(m[2], 10);
    if (!Number.isFinite(num) || num <= 0) continue;
    const start = m.index + (m[1]?.length ?? 0);
    out.push({ number: num, start, end: start + 1 + m[2].length });
  }
  return out;
}

type Tok =
  | { kind: "mention"; start: number; end: number; data: MentionMatch }
  | { kind: "issue";   start: number; end: number; data: IssueRef };

// Combined renderer: mentions + #NNN issue refs.
// Skip overlapping tokens (last writer wins on conflict — unlikely in practice).
export function renderRichHTML(body: string, profiles: Profile[]): string {
  if (!body) return "";
  const mentions = parseMentions(body, profiles);
  const refs     = parseIssueRefs(body);
  if (mentions.length === 0 && refs.length === 0) return escapeHtml(body);

  const tokens: Tok[] = [
    ...mentions.map(m => ({ kind: "mention" as const, start: m.start, end: m.end, data: m })),
    ...refs.map(r => ({ kind: "issue"   as const, start: r.start, end: r.end, data: r })),
  ].sort((a, b) => a.start - b.start);

  const parts: string[] = [];
  let cursor = 0;
  for (const t of tokens) {
    if (t.start < cursor) continue;            // overlap — drop later token
    if (t.start > cursor) parts.push(escapeHtml(body.slice(cursor, t.start)));
    if (t.kind === "mention") {
      parts.push(`<span class="mention" data-uid="${t.data.id}">@${escapeHtml(t.data.name)}</span>`);
    } else {
      const n = t.data.number;
      parts.push(`<a class="issue-ref" href="/issues/${n}" data-issue="${n}">#${n}</a>`);
    }
    cursor = t.end;
  }
  if (cursor < body.length) parts.push(escapeHtml(body.slice(cursor)));
  return parts.join("");
}

// Minimal shape needed for the #issue picker so this file doesn't have
// to circularly import from `./issues`.
export type IssueIndexItem = {
  number: number;
  title: string;
  status?: "open" | "closed";
};

// Find suggestions while user is typing `#partial`. Returns the active
// token (substring after the last "#" before cursor) plus matching issues.
// Stays active even when `issues` is empty so the dropdown can render a
// "no matching issue" hint — otherwise users typing `#` see nothing and
// assume the picker is broken.
export function issueTrigger(text: string, cursor: number, issues: IssueIndexItem[]): {
  active: boolean;
  query: string;
  start: number;
  suggestions: IssueIndexItem[];
} {
  const left = text.slice(0, cursor);
  const hashIdx = left.lastIndexOf("#");
  if (hashIdx < 0) return { active: false, query: "", start: -1, suggestions: [] };
  const prev = hashIdx > 0 ? left[hashIdx - 1] : " ";
  if (!/\s|[(,;:]/.test(prev) && hashIdx !== 0) return { active: false, query: "", start: -1, suggestions: [] };
  // Issue refs can't contain whitespace — once the user types a space
  // after `#`, the ref is finalised and the picker closes.
  const tail = left.slice(hashIdx + 1);
  if (/\s/.test(tail) || tail.length > 30) {
    return { active: false, query: "", start: -1, suggestions: [] };
  }

  const query = tail;
  const q = query.toLowerCase();
  let suggestions: IssueIndexItem[];
  if (q.length === 0) {
    suggestions = issues.slice(0, 6);                     // newest 6
  } else if (/^\d+$/.test(q)) {
    suggestions = issues.filter(i => String(i.number).startsWith(q)).slice(0, 6);
  } else {
    suggestions = issues
      .filter(i => i.title.toLowerCase().includes(q) || String(i.number).startsWith(q))
      .slice(0, 6);
  }
  return { active: true, query, start: hashIdx, suggestions };
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
