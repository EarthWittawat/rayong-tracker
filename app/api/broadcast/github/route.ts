// GitHub push webhook → broadcast notification.
//
// Configure on the repo: Settings → Webhooks → Add webhook
//   Payload URL : https://<your-app>/api/broadcast/github
//   Content type: application/json
//   Secret      : <same value as GITHUB_WEBHOOK_SECRET in env>
//   Events      : "Just the push event"
//
// The handler verifies the HMAC SHA-256 signature, inspects which files
// changed across the push, picks a topic (notebook / webapp / release /
// general), filters out low-signal commits, and fans out one notification
// per profile via the service-role key so the insert bypasses RLS (the
// webhook has no user session).
//
// Filtering rules (in order — first match wins):
//   1. Any commit body contains [skip notify] / [no broadcast] → drop.
//   2. Any commit body contains [broadcast] / [announce]      → send.
//   3. Otherwise drop the push when every commit subject begins with a
//      Conventional Commits type in BROADCAST_SKIP_TYPES env (default
//      chore, docs, style, test, ci, build, refactor, deps).
//   4. Otherwise summarise the substantive commits and send.
// The summary lists up to five substantive subjects; maintenance commits
// are counted but their subjects are not shown.

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SUPA_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SVC_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const SECRET    = process.env.GITHUB_WEBHOOK_SECRET ?? "";
const MAIN_REF  = process.env.GITHUB_WEBHOOK_REF ?? "refs/heads/main";

type Commit = {
  id?: string;
  message?: string;
  added?: string[];
  modified?: string[];
  removed?: string[];
  author?: { name?: string; email?: string };
};

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verifySig(body: string, sig: string | null): boolean {
  if (!SECRET || !sig) return false;
  const mac = "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");
  return timingSafeEqualStr(mac, sig);
}

const NOTEBOOK_RE = /^notebooks\//;
const WEBAPP_RE   = /^(app|components|lib|supabase|public|next\.config\.js|tailwind\.config\.js|package\.json|pnpm-lock\.yaml)(\/|$)/;

function pickTopic(files: string[]): "notebook" | "webapp" | "release" | "general" {
  const nb  = files.some(f => NOTEBOOK_RE.test(f));
  const app = files.some(f => WEBAPP_RE.test(f));
  if (nb && app) return "release";
  if (nb) return "notebook";
  if (app) return "webapp";
  return "general";
}

// Conventional Commits prefixes considered low-signal. Pushes that consist
// entirely of these get dropped so the bell isn't flooded by every fmt /
// dep bump / typo fix. Override via BROADCAST_SKIP_TYPES env (comma list).
const DEFAULT_SKIP_TYPES = "chore,docs,style,test,ci,build,refactor,deps";
const SKIP_TYPES = new Set(
  (process.env.BROADCAST_SKIP_TYPES ?? DEFAULT_SKIP_TYPES)
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean),
);

function commitType(subject: string): string | null {
  const m = subject.match(/^(\w+)(\([^)]*\))?!?:/);
  return m ? m[1].toLowerCase() : null;
}

type Decision = { yes: boolean; reason: string; substantive: string[]; lowSignal: string[] };

function decideBroadcast(commits: Commit[]): Decision {
  const subjects = commits.map(c => (c.message ?? "").split("\n")[0]).filter(Boolean);

  // Hard skip marker: any [skip notify] / [no broadcast] in any commit
  // anywhere in the push cancels the broadcast.
  if (commits.some(c => /\[skip[\s-]?notify\]|\[no[\s-]?broadcast\]/i.test(c.message ?? ""))) {
    return { yes: false, reason: "skip-marker", substantive: [], lowSignal: subjects };
  }

  // Classify each subject. Anything without a recognised type is treated
  // as substantive (better to over-broadcast than swallow a real change).
  const substantive: string[] = [];
  const lowSignal: string[] = [];
  for (const s of subjects) {
    const t = commitType(s);
    if (t && SKIP_TYPES.has(t)) lowSignal.push(s);
    else substantive.push(s);
  }

  // Hard include marker on any commit forces a broadcast regardless of
  // the type filter — useful for ad-hoc "everyone should see this" pushes.
  if (commits.some(c => /\[broadcast\]|\[announce\]/i.test(c.message ?? ""))) {
    return { yes: true, reason: "force-marker", substantive: substantive.length ? substantive : subjects, lowSignal };
  }

  if (substantive.length === 0) {
    return { yes: false, reason: "all-low-signal", substantive, lowSignal };
  }
  return { yes: true, reason: `substantive:${substantive.length}`, substantive, lowSignal };
}

export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("x-hub-signature-256");
  if (!verifySig(raw, sig)) {
    return NextResponse.json({ ok: false, error: "bad signature" }, { status: 401 });
  }
  const event = req.headers.get("x-github-event") ?? "";
  if (event === "ping") return NextResponse.json({ ok: true, pong: true });
  if (event !== "push") return NextResponse.json({ ok: true, skipped: event || "no event header" });

  let payload: {
    ref?: string;
    commits?: Commit[];
    head_commit?: Commit | null;
    compare?: string;
    repository?: { full_name?: string };
    pusher?: { name?: string };
  } = {};
  try { payload = JSON.parse(raw); }
  catch { return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 }); }

  if (payload.ref !== MAIN_REF) {
    return NextResponse.json({ ok: true, skipped: `branch ${payload.ref}` });
  }
  const commits = payload.commits ?? [];
  if (commits.length === 0) {
    return NextResponse.json({ ok: true, skipped: "no commits" });
  }

  const files = commits.flatMap(c => [...(c.added ?? []), ...(c.modified ?? []), ...(c.removed ?? [])]);
  const topic = pickTopic(files);

  const decision = decideBroadcast(commits);
  if (!decision.yes) {
    return NextResponse.json({
      ok: true,
      skipped: decision.reason,
      commits: commits.length,
      low_signal: decision.lowSignal.length,
    });
  }

  const shown = decision.substantive.slice(0, 5);
  const title = (shown[0] ?? `${commits.length} new commits`).slice(0, 120);
  const lines = shown.map(s => `• ${s}`);
  if (decision.substantive.length > shown.length) {
    lines.push(`…and ${decision.substantive.length - shown.length} more substantive commits`);
  }
  if (decision.lowSignal.length > 0) {
    lines.push(`(+${decision.lowSignal.length} maintenance commits hidden)`);
  }
  const full = lines.join("\n");

  const authorName = payload.pusher?.name
    ?? commits[0]?.author?.name
    ?? "GitHub";

  if (!SUPA_URL || !SVC_KEY) {
    return NextResponse.json({ ok: false, error: "supabase env missing" }, { status: 500 });
  }
  const sb = createClient(SUPA_URL, SVC_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: profiles, error: pErr } = await sb.from("profiles").select("id");
  if (pErr) return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 });
  if (!profiles || profiles.length === 0) {
    return NextResponse.json({ ok: true, skipped: "no recipients" });
  }

  const rows = profiles.map(p => ({
    user_id: p.id,
    kind: "broadcast",
    payload: {
      author_name: authorName,
      title,
      snippet: full.slice(0, 240),
      full,
      topic,
      source: "github",
      repo: payload.repository?.full_name ?? null,
      compare_url: payload.compare ?? null,
      commit_count: commits.length,
      substantive_count: decision.substantive.length,
      low_signal_count: decision.lowSignal.length,
      decision: decision.reason,
    },
  }));
  const { error: iErr } = await sb.from("notifications").insert(rows);
  if (iErr) return NextResponse.json({ ok: false, error: iErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    sent: rows.length,
    topic,
    commits: commits.length,
    substantive: decision.substantive.length,
    low_signal: decision.lowSignal.length,
    reason: decision.reason,
  });
}
