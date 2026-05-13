// Browser-side dataset upload helpers.
//
// Two paths:
//
//   - Small (≤ SMALL_THRESHOLD): POST a multipart form to /api/dataset/upload
//     and let the server forward to Drive. One round trip, simple.
//
//   - Large (> SMALL_THRESHOLD): ask the server to mint a resumable session,
//     then PUT 8 MB chunks straight to Google. Bypasses the platform request
//     body cap, supports resume across page reloads, and retries transient
//     failures with exponential backoff.

export const SMALL_THRESHOLD = 4 * 1024 * 1024;          // 4 MB
export const CHUNK_BYTES     = 8 * 1024 * 1024;          // must be a 256 KB multiple
export const MAX_RETRIES     = 5;
const RESUME_PREFIX = "drive-upload:";
const RESUME_TTL_MS = 6 * 24 * 3600 * 1000;              // Google sessions live ~7 days

type ResumeRecord = { uploadUrl: string; bytesSent: number; savedAt: number };

function resumeKey(f: File): string {
  return `${RESUME_PREFIX}${f.name}:${f.size}:${f.lastModified}`;
}

function readResume(f: File): ResumeRecord | null {
  try {
    const raw = localStorage.getItem(resumeKey(f));
    if (!raw) return null;
    const j = JSON.parse(raw) as ResumeRecord;
    if (Date.now() - j.savedAt > RESUME_TTL_MS) {
      localStorage.removeItem(resumeKey(f));
      return null;
    }
    return j;
  } catch { return null; }
}

function writeResume(f: File, uploadUrl: string, bytesSent: number) {
  localStorage.setItem(resumeKey(f), JSON.stringify({ uploadUrl, bytesSent, savedAt: Date.now() } as ResumeRecord));
}

export function clearResume(f: File) {
  localStorage.removeItem(resumeKey(f));
}

async function backoff(attempt: number, signal?: AbortSignal): Promise<void> {
  const ms = 500 * Math.pow(2, attempt) + Math.random() * 250;
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new Error("cancelled")); });
  });
}

async function smallUpload(file: File, token: string, signal: AbortSignal): Promise<void> {
  const fd = new FormData();
  fd.append("files", file);
  const r = await fetch("/api/dataset/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
    signal,
  });
  if (!r.ok) throw new Error(`upload failed ${r.status}`);
  const j = await r.json();
  const first = j.results?.[0];
  if (!first?.ok) throw new Error(first?.error ?? "upload failed");
}

async function mintUploadUrl(file: File, token: string): Promise<string> {
  const r = await fetch("/api/dataset/upload-init", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error ?? `init failed ${r.status}`);
  return j.uploadUrl as string;
}

// Ask Google how many bytes it has so far on an existing session.
// Returns:
//   -1 → server says upload already complete
//   N  → next byte to send is N (i.e. N bytes already received)
async function queryResumeOffset(uploadUrl: string): Promise<number> {
  const r = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Range": "bytes */*" },
  });
  if (r.status === 200 || r.status === 201) return -1;
  if (r.status === 404 || r.status === 410) throw new Error("session expired");
  if (r.status !== 308) throw new Error(`offset query failed ${r.status}`);
  const range = r.headers.get("range");
  if (!range) return 0;
  const m = range.match(/bytes=0-(\d+)/);
  return m ? Number(m[1]) + 1 : 0;
}

async function bigUpload(
  file: File,
  token: string,
  onProgress: (bytesSent: number) => void,
  signal: AbortSignal,
): Promise<void> {
  let uploadUrl: string | undefined;
  let start = 0;

  const cached = readResume(file);
  if (cached) {
    try {
      const off = await queryResumeOffset(cached.uploadUrl);
      if (off === -1) { clearResume(file); onProgress(file.size); return; }
      uploadUrl = cached.uploadUrl;
      start = off;
    } catch {
      clearResume(file);
    }
  }
  if (!uploadUrl) {
    uploadUrl = await mintUploadUrl(file, token);
    writeResume(file, uploadUrl, 0);
  }
  onProgress(start);

  while (start < file.size) {
    if (signal.aborted) throw new Error("cancelled");
    const end = Math.min(start + CHUNK_BYTES, file.size);
    const chunk = file.slice(start, end);

    let attempt = 0;
    let advanced = false;
    while (!advanced) {
      try {
        const r = await fetch(uploadUrl!, {
          method: "PUT",
          headers: { "Content-Range": `bytes ${start}-${end - 1}/${file.size}` },
          body: chunk,
          signal,
        });
        if (r.status === 200 || r.status === 201) {
          clearResume(file);
          onProgress(file.size);
          return;
        }
        if (r.status === 308) {
          start = end;
          writeResume(file, uploadUrl!, start);
          onProgress(start);
          advanced = true;
          break;
        }
        if (r.status >= 500 || r.status === 429) {
          throw new Error(`chunk transient ${r.status}`);
        }
        throw new Error(`chunk failed ${r.status}: ${await r.text()}`);
      } catch (e) {
        if (signal.aborted) throw new Error("cancelled");
        attempt++;
        if (attempt >= MAX_RETRIES) throw e instanceof Error ? e : new Error(String(e));
        await backoff(attempt, signal);
      }
    }
  }
}

export async function uploadOne(
  file: File,
  token: string,
  onProgress: (bytesSent: number) => void,
  signal: AbortSignal,
): Promise<void> {
  if (file.size <= SMALL_THRESHOLD) {
    onProgress(0);
    await smallUpload(file, token, signal);
    onProgress(file.size);
    return;
  }
  await bigUpload(file, token, onProgress, signal);
}

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtRate(bytesPerSec: number): string {
  return `${fmtBytes(bytesPerSec)}/s`;
}

export function fmtEta(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return "—";
  if (secs < 60) return `${Math.ceil(secs)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.ceil(secs % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
