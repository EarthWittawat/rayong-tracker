// Resumable upload session initiator.
//
// Browser POSTs { filename, mimeType, size } here; we mint a Google resumable
// upload session with the service account and hand the signed upload URL back.
// The browser then PUTs file chunks straight to Google — the data never flows
// through this function, so the request body cap of the platform does not bound
// the file size.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { initResumableUpload } from "@/lib/drive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SUPA_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPA_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

async function requireUser(req: Request) {
  if (!SUPA_URL || !SUPA_ANON) return null;
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!auth) return null;
  const sb = createClient(SUPA_URL, SUPA_ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.getUser(auth);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { filename, mimeType, size } = await req.json();
  if (!filename || typeof filename !== "string") {
    return NextResponse.json({ ok: false, error: "filename required" }, { status: 400 });
  }
  if (!Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ ok: false, error: "size required" }, { status: 400 });
  }

  try {
    const uploadUrl = await initResumableUpload(
      filename,
      mimeType || "application/octet-stream",
      Number(size),
      { uploaded_by: user.id, uploaded_by_email: user.email ?? "" },
    );
    return NextResponse.json({ ok: true, uploadUrl });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
