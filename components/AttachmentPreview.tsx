"use client";

import { useEffect, useState } from "react";
import { signedUrl, isPreviewable, humanSize, type AttachmentRow } from "@/lib/storage";

export function AttachmentChip({
  att, onRemove,
}: { att: AttachmentRow; onRemove?: () => void }) {
  const [open, setOpen] = useState(false);
  const kind = isPreviewable(att.mime);

  const iconChar = att.mime.startsWith("image/") ? "🖼️"
                  : att.mime === "application/pdf" ? "📄"
                  : att.mime.startsWith("text/") || att.mime === "application/json" ? "📝"
                  : att.mime.startsWith("audio/") ? "🎵"
                  : att.mime.startsWith("video/") ? "🎬"
                  : "📎";

  return (
    <>
      <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border bg-surface text-[11px] hover:bg-surface2">
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 truncate max-w-[16rem]"
          title={`${att.filename} · ${humanSize(att.size_bytes)}`}
        >
          <span>{iconChar}</span>
          <span className="text-ink truncate">{att.filename}</span>
          <span className="text-muted2 tabular">{humanSize(att.size_bytes)}</span>
          {kind && <span className="text-info">· preview</span>}
        </button>
        {onRemove && (
          <button onClick={onRemove} aria-label="remove" className="text-muted hover:text-crit ml-0.5">✕</button>
        )}
      </div>
      {open && <PreviewModal att={att} onClose={() => setOpen(false)} />}
    </>
  );
}

function PreviewModal({ att, onClose }: { att: AttachmentRow; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kind = isPreviewable(att.mime);

  useEffect(() => {
    let alive = true;
    (async () => {
      const u = await signedUrl(att.storage_path, 600);
      if (!alive) return;
      if (!u) { setError("Could not sign URL"); return; }
      setUrl(u);
      if (kind === "text") {
        try {
          const r = await fetch(u);
          const t = await r.text();
          if (alive) setText(t.slice(0, 20000));
        } catch (e) {
          if (alive) setError(String(e));
        }
      }
    })();
    return () => { alive = false; };
  }, [att.storage_path, kind]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/60 backdrop-blur-sm p-4"
         onClick={onClose}>
      <div className="bg-surface rounded-xl2 shadow-cardHover border border-border max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface2/50">
          <div className="text-sm font-medium text-ink truncate">{att.filename}</div>
          <div className="flex items-center gap-2 text-xs text-muted2">
            <span>{humanSize(att.size_bytes)}</span>
            {url && <a href={url} download={att.filename} className="text-info hover:underline">download</a>}
            <button onClick={onClose} aria-label="close"
                    className="w-6 h-6 rounded hover:bg-surface2 flex items-center justify-center text-muted">✕</button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-surface2/30 flex items-center justify-center p-3">
          {!url && !error && <span className="text-muted2 text-xs">loading preview…</span>}
          {error && <span className="text-crit text-xs">{error}</span>}
          {url && kind === "image" && (
            <img src={url} alt={att.filename} className="max-h-[70vh] max-w-full object-contain" />
          )}
          {url && kind === "pdf" && (
            <iframe src={url} title={att.filename} className="w-full h-[70vh] bg-white" />
          )}
          {url && kind === "text" && (
            <pre className="w-full h-full text-xs whitespace-pre-wrap bg-surface p-3 rounded font-mono text-ink overflow-auto max-h-[70vh]">
              {text ?? "loading…"}
            </pre>
          )}
          {url && kind === "audio" && (
            <audio src={url} controls className="w-full" />
          )}
          {url && kind === "video" && (
            <video src={url} controls className="max-h-[70vh] max-w-full" />
          )}
          {url && !kind && (
            <div className="text-center text-xs text-muted">
              <p>No inline preview for <code className="bg-surface2 px-1 rounded">{att.mime || "unknown"}</code>.</p>
              <p className="mt-2"><a href={url} download={att.filename} className="text-info hover:underline">Download {att.filename}</a></p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
