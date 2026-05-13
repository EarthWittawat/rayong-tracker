// Admin status is stored on the database — public.profiles.is_admin.
// Flipping the column does NOT require a redeploy. Use the promote_user(uuid,
// boolean) RPC to change it; direct column UPDATEs are revoked from
// authenticated users so a logged-in user cannot self-promote.
//
// As a transitional fallback we still honour NEXT_PUBLIC_ADMIN_EMAILS — useful
// for bootstrapping the very first admin before the migration has been
// applied, or for local dev against a Supabase project where you cannot edit
// the column directly. Set the env var to a comma-separated list of emails.

import { getSupabase } from "./supabase";
import type { Profile } from "./auth";

function adminEmails(): string[] {
  const raw = process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? "";
  return raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}

export function isAdmin(profile: Profile | null | undefined): boolean {
  if (!profile) return false;
  if (profile.is_admin === true) return true;
  if (profile.email && adminEmails().includes(profile.email.toLowerCase())) return true;
  return false;
}

// Admins call this to promote / demote another user. Wraps the
// SECURITY DEFINER RPC which enforces "caller is an admin" inside Postgres,
// so the client cannot just patch is_admin directly.
export async function promoteUser(userId: string, value: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "not configured" };
  const { error } = await sb.rpc("promote_user", { p_user_id: userId, p_value: value });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
