// Admin = a small allowlist of email addresses configured via env.
//
// We deliberately do not store an `is_admin` column on profiles — the team is
// small enough that an env-driven list is easier to manage than a UI for
// granting roles. Set NEXT_PUBLIC_ADMIN_EMAILS to a comma-separated list of
// emails (case-insensitive) in .env.local.

import type { Profile } from "./auth";

function adminEmails(): string[] {
  const raw = process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? "";
  return raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}

export function isAdmin(profile: Profile | null | undefined): boolean {
  if (!profile?.email) return false;
  return adminEmails().includes(profile.email.toLowerCase());
}
