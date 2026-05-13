"use client";

import { useState } from "react";
import type { Profile } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { AdminBroadcast } from "./AdminBroadcast";

// One-click 📣 in the top nav for admins — skip the user-menu hop and open
// the broadcast composer directly. Renders nothing for non-admins so the
// header stays uncluttered for the rest of the team.
export function QuickBroadcastButton({
  profile, profiles,
}: {
  profile: Profile;
  profiles: Profile[];
}) {
  const [open, setOpen] = useState(false);
  if (!isAdmin(profile)) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Send a broadcast"
        aria-label="Send a broadcast"
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-white/20 nav-muted hover:nav-ink hover:bg-white/5"
      >
        <span className="text-base leading-none">📣</span>
        <span className="hidden sm:inline text-[11px] eyebrow">broadcast</span>
      </button>
      {open && (
        <AdminBroadcast
          profile={profile}
          profiles={profiles}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
