"use client";

import { getSupabase } from "./supabase";

export const ATTACH_BUCKET = "attachments";
export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

export type AttachmentRow = {
  id: string;
  comment_id: string;
  uploader_id: string;
  filename: string;
  mime: string;
  size_bytes: number;
  storage_path: string;
  created_at?: string;
};

export function safeFilename(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 80) || "file";
}

export function attachmentPath(taskId: string, commentId: string, filename: string): string {
  return `${taskId}/${commentId}/${Date.now()}_${safeFilename(filename)}`;
}

export async function uploadAttachment(
  file: File,
  opts: { taskId: string; commentId: string; uploaderId: string },
): Promise<AttachmentRow> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB > 5 MB).`);
  }
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");

  const path = attachmentPath(opts.taskId, opts.commentId, file.name);

  const { error: upErr } = await sb.storage
    .from(ATTACH_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || "application/octet-stream" });
  if (upErr) throw upErr;

  const { data: row, error: insErr } = await sb
    .from("attachments")
    .insert({
      comment_id: opts.commentId,
      uploader_id: opts.uploaderId,
      filename: file.name,
      mime: file.type || "application/octet-stream",
      size_bytes: file.size,
      storage_path: path,
    })
    .select("*")
    .single();
  if (insErr) {
    // Best-effort cleanup if metadata row didn't land
    await sb.storage.from(ATTACH_BUCKET).remove([path]).catch(() => {});
    throw insErr;
  }
  return row as AttachmentRow;
}

export async function signedUrl(path: string, expiresIn = 600): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.storage.from(ATTACH_BUCKET).createSignedUrl(path, expiresIn);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function removeAttachment(att: AttachmentRow): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.storage.from(ATTACH_BUCKET).remove([att.storage_path]).catch(() => {});
  await sb.from("attachments").delete().eq("id", att.id);
}

export function isPreviewable(mime: string): "image" | "pdf" | "text" | "audio" | "video" | null {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("text/") || mime === "application/json") return "text";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return null;
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
