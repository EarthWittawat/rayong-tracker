// Supabase Edge Function · send-mail
// Invoked by the client after inserting a comment (task) or
// issue_comment (issue). Looks up @mentioned users + subscribers /
// assignee (excluding the commenter), writes per-recipient rows into
// `public.notifications`, then sends real-time emails via Resend for
// users whose `notify_mentions` / `notify_replies` preferences are true.
//
// Payload shapes:
//   { "comment_id":       "<uuid>" }   // task comment (legacy path)
//   { "issue_comment_id": "<uuid>" }   // issue comment (new path)
//
// Deploy:
//   supabase functions deploy send-mail --no-verify-jwt
//   supabase secrets set RESEND_API_KEY=...
//   supabase secrets set MAIL_FROM="Rayong Tracker <board@yourdomain.com>"
//   supabase secrets set APP_URL=https://your-app.vercel.app

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

type Payload =
  | { comment_id: string; issue_comment_id?: undefined }
  | { issue_comment_id: string; comment_id?: undefined };

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const MAIL_FROM      = Deno.env.get("MAIL_FROM") ?? "Rayong Tracker <onboarding@resend.dev>";
const APP_URL        = Deno.env.get("APP_URL") ?? "";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ──────────────────────────── helpers ────────────────────────────

async function sendResendMail(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  if (!RESEND_API_KEY) return { ok: false, error: "RESEND_API_KEY not set" };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: MAIL_FROM, to, subject, html }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    return { ok: false, error: `resend ${r.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true };
}

function htmlEscape(s: string): string {
  return s.replace(/[&<>'"]/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  } as Record<string, string>)[c]);
}

function renderTaskEmail(opts: {
  recipientName: string;
  authorName: string;
  body: string;
  taskId: string;
  isMention: boolean;
  attachmentCount: number;
}): { subject: string; html: string } {
  const subjectVerb = opts.isMention ? "mentioned you" : "commented on a task you follow";
  const subject = `${opts.authorName} ${subjectVerb} · Rayong Tracker`;
  const taskUrl = APP_URL ? `${APP_URL}/?task=${encodeURIComponent(opts.taskId)}` : "#";
  const attachLine = opts.attachmentCount > 0
    ? `<p style="color:#6B6862;font-size:12px;">📎 ${opts.attachmentCount} attachment${opts.attachmentCount > 1 ? "s" : ""}</p>`
    : "";
  const html = `<!doctype html>
<html><body style="font-family:ui-sans-serif,system-ui,Segoe UI,Inter,sans-serif;background:#FAF9F7;padding:24px;color:#1F1E1B;">
  <div style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid #E7E4DD;border-radius:14px;padding:20px;">
    <p style="font-size:13px;color:#6B6862;margin:0 0 12px;">
      Hi ${htmlEscape(opts.recipientName)},
    </p>
    <p style="font-size:14px;margin:0 0 12px;">
      <strong>${htmlEscape(opts.authorName)}</strong> ${opts.isMention ? "mentioned you" : "commented on a task you follow"}:
    </p>
    <div style="border-left:3px solid #C96442;background:#F4F2EE;padding:10px 14px;border-radius:6px;white-space:pre-wrap;font-size:14px;">
      ${htmlEscape(opts.body)}
    </div>
    ${attachLine}
    <p style="margin-top:18px;"><a href="${taskUrl}" style="display:inline-block;background:#1F1E1B;color:#FAF9F7;padding:8px 14px;border-radius:6px;text-decoration:none;font-size:13px;">Open in tracker</a></p>
    <p style="font-size:11px;color:#9A968D;margin-top:24px;">
      You're getting this because you ${opts.isMention ? "were @mentioned in" : "previously commented on"} this task.
      Adjust notifications in your profile menu.
    </p>
  </div>
</body></html>`;
  return { subject, html };
}

function renderIssueEmail(opts: {
  recipientName: string;
  authorName: string;
  body: string;
  issueNumber: number;
  issueTitle: string;
  isMention: boolean;       // true for @mention, false for assignee fan-out
}): { subject: string; html: string } {
  const reason = opts.isMention ? "mentioned you" : "commented on an issue assigned to you";
  const subject = `${opts.authorName} ${reason} · Issue #${opts.issueNumber}`;
  const url = APP_URL ? `${APP_URL}/issues/${opts.issueNumber}` : "#";
  const html = `<!doctype html>
<html><body style="font-family:ui-sans-serif,system-ui,Segoe UI,Inter,sans-serif;background:#FAF9F7;padding:24px;color:#1F1E1B;">
  <div style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid #E7E4DD;border-radius:14px;padding:20px;">
    <p style="font-size:13px;color:#6B6862;margin:0 0 12px;">
      Hi ${htmlEscape(opts.recipientName)},
    </p>
    <p style="font-size:14px;margin:0 0 12px;">
      <strong>${htmlEscape(opts.authorName)}</strong> ${reason}
      <strong>#${opts.issueNumber} · ${htmlEscape(opts.issueTitle)}</strong>:
    </p>
    <div style="border-left:3px solid #58A6FF;background:#F4F2EE;padding:10px 14px;border-radius:6px;white-space:pre-wrap;font-size:14px;">
      ${htmlEscape(opts.body)}
    </div>
    <p style="margin-top:18px;"><a href="${url}" style="display:inline-block;background:#1F1E1B;color:#FAF9F7;padding:8px 14px;border-radius:6px;text-decoration:none;font-size:13px;">Open issue #${opts.issueNumber}</a></p>
    <p style="font-size:11px;color:#9A968D;margin-top:24px;">
      You're getting this because you ${opts.isMention ? "were @mentioned in" : "are assigned to"} this issue.
      Adjust notifications in your profile menu.
    </p>
  </div>
</body></html>`;
  return { subject, html };
}

// ──────────────────────── handlers ────────────────────────

async function handleTaskComment(commentId: string): Promise<Response> {
  const { data: comment, error: cErr } = await admin
    .from("comments")
    .select("id, task_id, author_id, body, mentions, created_at")
    .eq("id", commentId)
    .single();
  if (cErr || !comment) return new Response(`comment lookup failed: ${cErr?.message}`, { status: 404 });

  const { data: author } = await admin.from("profiles").select("id, name").eq("id", comment.author_id).single();
  const authorName = author?.name ?? "Someone";

  const recipientIds = new Set<string>();
  for (const id of (comment.mentions ?? [])) recipientIds.add(id as string);
  const { data: subs } = await admin.from("task_subscribers").select("user_id").eq("task_id", comment.task_id);
  for (const s of subs ?? []) recipientIds.add(s.user_id as string);
  recipientIds.delete(comment.author_id);

  if (recipientIds.size === 0) {
    return json({ ok: true, sent: 0, note: "no recipients" });
  }

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, name, email, notify_mentions, notify_replies")
    .in("id", Array.from(recipientIds));

  const { data: attachments } = await admin
    .from("attachments")
    .select("id")
    .eq("comment_id", comment.id);
  const attachmentCount = attachments?.length ?? 0;

  let sent = 0;
  let queued = 0;
  for (const p of profiles ?? []) {
    const isMention = (comment.mentions ?? []).includes(p.id);
    const kind = isMention ? "mention" : "reply";

    await admin.from("notifications").insert({
      user_id: p.id,
      kind,
      task_id: comment.task_id,
      comment_id: comment.id,
      payload: { author_id: comment.author_id, author_name: authorName, snippet: comment.body.slice(0, 160) },
    });
    queued++;

    const wants = (isMention && p.notify_mentions) || (!isMention && p.notify_replies);
    if (!wants || !p.email) continue;

    const { subject, html } = renderTaskEmail({
      recipientName: p.name,
      authorName,
      body: comment.body,
      taskId: comment.task_id,
      isMention,
      attachmentCount,
    });
    const r = await sendResendMail(p.email, subject, html);
    if (r.ok) {
      sent++;
      await admin
        .from("notifications")
        .update({ emailed_at: new Date().toISOString() })
        .eq("user_id", p.id)
        .eq("comment_id", comment.id);
    } else {
      console.warn("mail failed for", p.email, r.error);
    }
  }

  return json({ ok: true, queued, sent });
}

async function handleIssueComment(issueCommentId: string): Promise<Response> {
  const { data: c, error: cErr } = await admin
    .from("issue_comments")
    .select("id, issue_id, author_id, body, mentions, created_at")
    .eq("id", issueCommentId)
    .single();
  if (cErr || !c) return new Response(`issue_comment lookup failed: ${cErr?.message}`, { status: 404 });

  const { data: issue } = await admin
    .from("issues")
    .select("id, number, title, assignee_id")
    .eq("id", c.issue_id)
    .single();
  if (!issue) return new Response("issue not found", { status: 404 });

  const { data: author } = await admin.from("profiles").select("id, name").eq("id", c.author_id).single();
  const authorName = author?.name ?? "Someone";

  // Recipients = mentions ∪ {assignee} \ {author}.
  const recipientIds = new Set<string>();
  for (const id of (c.mentions ?? [])) recipientIds.add(id as string);
  if (issue.assignee_id) recipientIds.add(issue.assignee_id);
  recipientIds.delete(c.author_id);

  if (recipientIds.size === 0) {
    return json({ ok: true, sent: 0, note: "no recipients" });
  }

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, name, email, notify_mentions, notify_replies")
    .in("id", Array.from(recipientIds));

  let sent = 0;
  let queued = 0;
  for (const p of profiles ?? []) {
    const isMention = (c.mentions ?? []).includes(p.id);
    const kind = isMention ? "mention" : "reply";

    await admin.from("notifications").insert({
      user_id: p.id,
      kind,
      issue_id: issue.id,
      issue_comment_id: c.id,
      payload: {
        author_id: c.author_id,
        author_name: authorName,
        issue_number: issue.number,
        issue_title: issue.title,
        snippet: c.body.slice(0, 160),
      },
    });
    queued++;

    const wants = (isMention && p.notify_mentions) || (!isMention && p.notify_replies);
    if (!wants || !p.email) continue;

    const { subject, html } = renderIssueEmail({
      recipientName: p.name,
      authorName,
      body: c.body,
      issueNumber: issue.number,
      issueTitle: issue.title,
      isMention,
    });
    const r = await sendResendMail(p.email, subject, html);
    if (r.ok) {
      sent++;
      await admin
        .from("notifications")
        .update({ emailed_at: new Date().toISOString() })
        .eq("user_id", p.id)
        .eq("issue_comment_id", c.id);
    } else {
      console.warn("mail failed for", p.email, r.error);
    }
  }

  return json({ ok: true, queued, sent });
}

function json(obj: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ──────────────────────── entrypoint ────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }

  if ((payload as { comment_id?: string }).comment_id) {
    return handleTaskComment((payload as { comment_id: string }).comment_id);
  }
  if ((payload as { issue_comment_id?: string }).issue_comment_id) {
    return handleIssueComment((payload as { issue_comment_id: string }).issue_comment_id);
  }
  return new Response("missing comment_id or issue_comment_id", { status: 400 });
});
