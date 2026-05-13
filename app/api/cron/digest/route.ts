// Daily digest cron.
//
// Triggered by Vercel Cron (see vercel.json). For each profile that has
// `notify_digest = true` and at least one un-emailed notification newer than
// their `last_digest_at`, send a single roll-up email and stamp the row.
//
// Auth: Vercel adds a CRON_SECRET header on cron requests when configured
// in the dashboard. We also accept a manual `?secret=` query for ad-hoc runs.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { mailerConfigured, sendMail } from "@/lib/mailer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const URL_         = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const APP_URL      = process.env.APP_URL ?? "";
const CRON_SECRET  = process.env.CRON_SECRET ?? "";

function htmlEscape(s: string) {
  return s.replace(/[&<>'"]/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  } as Record<string, string>)[c]);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const headerSecret = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const querySecret = url.searchParams.get("secret") ?? "";
  if (CRON_SECRET && headerSecret !== CRON_SECRET && querySecret !== CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!URL_ || !SERVICE_KEY) {
    return NextResponse.json({ ok: false, error: "supabase env not configured" }, { status: 500 });
  }

  const sb = createClient(URL_, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: users, error: uErr } = await sb
    .from("profiles")
    .select("id, name, email, last_digest_at")
    .eq("notify_digest", true);
  if (uErr) return NextResponse.json({ ok: false, error: uErr.message }, { status: 500 });

  let sentCount = 0;
  for (const u of users ?? []) {
    if (!u.email) continue;
    const since = u.last_digest_at ?? new Date(Date.now() - 25 * 3600 * 1000).toISOString();

    const { data: rows } = await sb
      .from("notifications")
      .select("kind, task_id, comment_id, payload, created_at")
      .eq("user_id", u.id)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50);

    if (!rows || rows.length === 0) continue;

    const items = rows.map(r => {
      const p = (r.payload ?? {}) as { author_name?: string; snippet?: string };
      const verb = r.kind === "mention" ? "mentioned you" : r.kind === "reply" ? "replied" : "updated";
      return `<li style="margin:6px 0;font-size:13px;"><strong>${htmlEscape(p.author_name ?? "Someone")}</strong> ${verb}: <span style="color:#6B6862;">${htmlEscape((p.snippet ?? "").slice(0, 140))}</span></li>`;
    }).join("");

    const taskUrl = APP_URL || "#";
    const subject = `Daily digest · ${rows.length} update${rows.length === 1 ? "" : "s"} on Rayong Tracker`;
    const html = `<!doctype html><html><body style="font-family:ui-sans-serif,system-ui,Segoe UI,Inter,sans-serif;background:#FAF9F7;padding:24px;color:#1F1E1B;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E7E4DD;border-radius:14px;padding:20px;">
    <p style="font-size:13px;color:#6B6862;margin:0 0 8px;">Hi ${htmlEscape(u.name)},</p>
    <p style="font-size:14px;margin:0 0 12px;">You have <strong>${rows.length}</strong> update${rows.length === 1 ? "" : "s"} since your last digest.</p>
    <ul style="padding-left:18px;margin:0 0 12px;">${items}</ul>
    <p><a href="${taskUrl}" style="display:inline-block;background:#1F1E1B;color:#FAF9F7;padding:8px 14px;border-radius:6px;text-decoration:none;font-size:13px;">Open tracker</a></p>
    <p style="font-size:11px;color:#9A968D;margin-top:20px;">Disable digest in your profile menu.</p>
  </div>
</body></html>`;

    if (!mailerConfigured()) {
      continue; // skip silently — digest is best-effort, in-app bell already covers the user
    }
    const r = await sendMail(u.email, subject, html);
    if (r.ok) {
      sentCount++;
      await sb.from("profiles").update({ last_digest_at: new Date().toISOString() }).eq("id", u.id);
    }
  }

  return NextResponse.json({ ok: true, sent: sentCount, candidates: users?.length ?? 0 });
}
