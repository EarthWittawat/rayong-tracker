"use client";

import dynamic from "next/dynamic";
import type { Member, Task } from "@/lib/supabase";

const MapClient = dynamic(() => import("./MapClient").then(m => m.MapClient), {
  ssr: false,
  loading: () => (
    <div className="h-[460px] rounded-lg border border-border bg-surface2 flex items-center justify-center text-muted text-sm">
      loading satellite map…
    </div>
  ),
});

export function RayongMap(props: {
  members: Member[];
  tasks: Task[];
  focusId: string | null;
  onFocus: (id: string | null) => void;
}) {
  return <MapClient {...props} />;
}
