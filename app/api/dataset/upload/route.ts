// Dataset upload: accepts a multipart form with one or more files, pushes each
// into the shared Drive folder via the service account. Requires a signed-in
// member — we use the Supabase JWT on the request cookie to confirm.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { uploadDatasetFile } from "@/lib/drive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const SUPA_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPA_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

async function requireUser(req: Request): Promise<{ id: string; email: string | null } | null> {
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

  const form = await req.formData();
  const entries = form.getAll("files");
  if (entries.length === 0) return NextResponse.json({ ok: false, error: "no files" }, { status: 400 });

  const results: Array<{ name: string; ok: boolean; id?: string; size?: string; error?: string }> = [];
  for (const entry of entries) {
    if (!(entry instanceof File)) continue;
    try {
      const buf = Buffer.from(await entry.arrayBuffer());
      const r = await uploadDatasetFile(
        entry.name,
        entry.type || "application/octet-stream",
        buf,
        { uploaded_by: user.id, uploaded_by_email: user.email ?? "" },
      );
      results.push({ name: entry.name, ok: true, id: r.id, size: r.size });
    } catch (e) {
      results.push({ name: entry.name, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ ok: true, results });
}
