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
// general), and fans out one notification per profile via the service-role
// key so the insert bypasses RLS (the webhook has no user session).

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

  const subjects = commits.map(c => (c.message ?? "").split("\n")[0]).filter(Boolean);
  const shown = subjects.slice(0, 5);
  const title = (shown[0] ?? `${commits.length} new commits`).slice(0, 120);
  const lines = shown.map(s => `• ${s}`);
  if (commits.length > shown.length) lines.push(`…and ${commits.length - shown.length} more`);
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
    },
  }));
  const { error: iErr } = await sb.from("notifications").insert(rows);
  if (iErr) return NextResponse.json({ ok: false, error: iErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, sent: rows.length, topic, commits: commits.length });
}
