// Identity is now sourced from Supabase Auth + the profiles table.
// This file remains as a thin compatibility shim that re-exports the type and
// the palette constants from lib/auth.ts so existing imports keep working.

export type { Profile as Identity } from "./auth";
export { PALETTE_COLORS, EMOJI_CHOICES } from "./auth";
