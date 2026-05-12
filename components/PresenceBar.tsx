"use client";

import type { PresenceUser } from "@/lib/useStore";

function Avatar({ u, isSelf, onClick }: { u: PresenceUser; isSelf: boolean; onClick?: () => void }) {
  const className = `w-7 h-7 rounded-full flex items-center justify-center text-sm ring-2 ring-bg shrink-0 ${isSelf ? "cursor-pointer hover:scale-105 transition-transform" : "cursor-default"}`;
  if (u.avatar_url) {
    return (
      <button onClick={onClick} title={`${u.name}${isSelf ? " (you)" : ""}`}
              className={className}
              style={{ background: `${u.color}26`, padding: 0, border: `1px solid ${u.color}` }}>
        <img src={u.avatar_url} alt={u.name} className="w-full h-full rounded-full object-cover" />
      </button>
    );
  }
  return (
    <button onClick={onClick} title={`${u.name}${isSelf ? " (you)" : ""}`}
            className={className}
            style={{ background: `${u.color}26`, color: u.color, border: `1px solid ${u.color}` }}>
      {u.emoji}
    </button>
  );
}

export function PresenceBar({
  users, selfId, onEditMe,
}: {
  users: PresenceUser[];
  selfId?: string;
  onEditMe: () => void;
}) {
  if (users.length === 0) {
    return (
      <button
        onClick={onEditMe}
        className="text-xs text-muted2 px-2 py-1 rounded-md border border-dashed border-border hover:bg-surface2"
        title="set your profile"
      >
        + identify
      </button>
    );
  }

  const max = 6;
  const visible = users.slice(0, max);
  const overflow = users.length - visible.length;

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex -space-x-2">
        {visible.map(u => (
          <Avatar key={u.id} u={u} isSelf={u.id === selfId} onClick={u.id === selfId ? onEditMe : undefined} />
        ))}
        {overflow > 0 && (
          <span className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-medium bg-surface2 text-muted ring-2 ring-bg border border-border">
            +{overflow}
          </span>
        )}
      </div>
      <span className="text-[10px] text-muted2 hidden sm:inline">{users.length} online</span>
    </div>
  );
}
