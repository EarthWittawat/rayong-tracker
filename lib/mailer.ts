// Nodemailer transport + sendMail() helper.
//
// Configure via env (Vercel project envs + .env.local):
//   SMTP_HOST    e.g. smtp.gmail.com
//   SMTP_PORT    e.g. 587 (STARTTLS) or 465 (TLS)
//   SMTP_USER    full account address used to authenticate
//   SMTP_PASS    Gmail App Password (requires 2FA) or Workspace SMTP password
//   MAIL_FROM    e.g. "SynthCrop Tracker <you@gmail.com>"
//
// Gmail note: ordinary account password will NOT work. Generate a 16-char
// App Password at https://myaccount.google.com/apppasswords (requires
// 2-step verification turned on) and paste that into SMTP_PASS.
//
// For Google Workspace via SMTP relay (smtp-relay.gmail.com:587) the same
// envs apply — relay just allows higher daily quotas.

import nodemailer, { type Transporter } from "nodemailer";

const SMTP_HOST = process.env.SMTP_HOST ?? "";
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 587);
const SMTP_USER = process.env.SMTP_USER ?? "";
const SMTP_PASS = process.env.SMTP_PASS ?? "";
const MAIL_FROM = process.env.MAIL_FROM ?? SMTP_USER;

let _transport: Transporter | null = null;
function transport(): Transporter | null {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  if (_transport) return _transport;
  _transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    // 465 → implicit TLS; everything else (587 / 25) starts plain and
    // upgrades via STARTTLS. Matches what Gmail expects.
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return _transport;
}

export function mailerConfigured(): boolean {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

export async function sendMail(
  to: string,
  subject: string,
  html: string,
  text?: string,
): Promise<{ ok: true; messageId?: string } | { ok: false; error: string }> {
  const tx = transport();
  if (!tx) return { ok: false, error: "SMTP env not configured (set SMTP_HOST / SMTP_USER / SMTP_PASS / MAIL_FROM)" };
  try {
    const info = await tx.sendMail({
      from: MAIL_FROM,
      to,
      subject,
      html,
      text,
    });
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
