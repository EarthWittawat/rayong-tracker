// Dataset status: count, total bytes, per-mime + per-class breakdown of the
// shared Drive folder. Read-only, no auth on the route itself — the service
// account is the only Drive identity in play.

import { NextResponse } from "next/server";
import { listDataset, summarize } from "@/lib/drive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const files = await listDataset();
    const summary = summarize(files);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
