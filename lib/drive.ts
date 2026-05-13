// Google Drive client backed by a service-account JWT.
//
// No external SDK — we mint an RS256 JWT with the built-in `crypto` module,
// exchange it at the Google OAuth2 token endpoint, and call the Drive REST API
// directly. Keeps the bundle slim and the surface area small.
//
// ENV: `GOOGLE_SERVICE_ACCOUNT_JSON` must hold the full service-account JSON
// (the file Google gives you when you create a key). The folder this module
// targets is hard-coded — share it with the service-account email as Editor.

import crypto from "node:crypto";

export const DATASET_FOLDER_ID = "1BxBvqebYE9LDhDW1phyU0QjyelLMmja2";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

type ServiceAccount = {
  client_email: string;
  private_key: string;
};

let cachedToken: { value: string; exp: number } | null = null;

function loadCreds(): ServiceAccount {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON env var not set");
  const j = JSON.parse(raw);
  if (!j.client_email || !j.private_key) {
    throw new Error("service-account JSON missing client_email or private_key");
  }
  return { client_email: j.client_email, private_key: j.private_key };
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function signJwt(creds: ServiceAccount): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: creds.client_email,
    scope: DRIVE_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(Buffer.from(JSON.stringify(header)))}.${b64url(Buffer.from(JSON.stringify(claim)))}`;
  const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(creds.private_key);
  return `${unsigned}.${b64url(sig)}`;
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() / 1000 + 60) return cachedToken.value;
  const creds = loadCreds();
  const jwt = signJwt(creds);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`token exchange failed: ${r.status} ${await r.text()}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: j.access_token, exp: Date.now() / 1000 + j.expires_in };
  return j.access_token;
}

export type DriveFile = {
  id: string;
  name: string;
  size?: string;
  mimeType: string;
  createdTime: string;
  modifiedTime?: string;
};

export async function listDataset(): Promise<DriveFile[]> {
  const token = await getAccessToken();
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", `'${DATASET_FOLDER_ID}' in parents and trashed=false`);
    url.searchParams.set("fields", "nextPageToken, files(id,name,size,mimeType,createdTime,modifiedTime)");
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("orderBy", "createdTime desc");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`drive list failed: ${r.status} ${await r.text()}`);
    const j = (await r.json()) as { files?: DriveFile[]; nextPageToken?: string };
    out.push(...(j.files ?? []));
    pageToken = j.nextPageToken;
  } while (pageToken);
  return out;
}

// Resumable upload: server-side initiates a session and returns the upload URL
// (a single-use, signed Google URL). The browser then PUTs the file in chunks
// directly to Google — bypassing the function's request body cap entirely.
//
// Google docs: https://developers.google.com/drive/api/guides/manage-uploads#resumable
export async function initResumableUpload(
  filename: string,
  mimeType: string,
  sizeBytes: number,
  metadata: Record<string, string> = {},
): Promise<string> {
  const token = await getAccessToken();
  const fileMeta = {
    name: filename,
    parents: [DATASET_FOLDER_ID],
    mimeType,
    appProperties: metadata,
  };
  const r = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
        "X-Upload-Content-Length": String(sizeBytes),
      },
      body: JSON.stringify(fileMeta),
    },
  );
  if (!r.ok) throw new Error(`init resumable failed: ${r.status} ${await r.text()}`);
  const uploadUrl = r.headers.get("location");
  if (!uploadUrl) throw new Error("no Location header on resumable init");
  return uploadUrl;
}

export async function uploadDatasetFile(
  filename: string,
  mimeType: string,
  body: ArrayBuffer | Uint8Array,
  metadata: Record<string, string> = {},
): Promise<{ id: string; name: string; size?: string }> {
  const token = await getAccessToken();
  const fileMeta = {
    name: filename,
    parents: [DATASET_FOLDER_ID],
    mimeType,
    appProperties: metadata,
  };
  const boundary = `boundary_${crypto.randomBytes(8).toString("hex")}`;
  const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const multipart = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(fileMeta)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`,
    ),
    bodyBuf,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,size";
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": String(multipart.length),
    },
    body: multipart,
  });
  if (!r.ok) throw new Error(`drive upload failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as { id: string; name: string; size?: string };
}

export type DatasetStatus = {
  count: number;
  totalBytes: number;
  byMime: Record<string, { count: number; bytes: number }>;
  byClass: Record<string, { count: number; bytes: number }>;
  latest?: { name: string; createdTime: string };
  files: DriveFile[];
};

const CLASS_PREFIXES = ["durian", "langsat", "rambutan", "mangosteen"];

function classifyByName(name: string): string {
  const lower = name.toLowerCase();
  for (const c of CLASS_PREFIXES) if (lower.includes(c)) return c;
  return "other";
}

export function summarize(files: DriveFile[]): DatasetStatus {
  const byMime: DatasetStatus["byMime"] = {};
  const byClass: DatasetStatus["byClass"] = {};
  let totalBytes = 0;
  for (const f of files) {
    const sz = Number(f.size ?? 0);
    totalBytes += sz;
    const m = f.mimeType || "unknown";
    byMime[m] ??= { count: 0, bytes: 0 };
    byMime[m].count += 1;
    byMime[m].bytes += sz;
    const c = classifyByName(f.name);
    byClass[c] ??= { count: 0, bytes: 0 };
    byClass[c].count += 1;
    byClass[c].bytes += sz;
  }
  const latest = files[0] ? { name: files[0].name, createdTime: files[0].createdTime } : undefined;
  return { count: files.length, totalBytes, byMime, byClass, latest, files };
}
