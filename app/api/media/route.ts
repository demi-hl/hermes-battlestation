import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
};

// Roots the WebView is allowed to read media from. Render outputs live under
// these. NOTE: ~/.hermes is deliberately NOT here — it holds .env, auth.json,
// config.yaml and state.db. Render pipelines that want their output served must
// write it under ~/.hermes/renders (allowed below) or one of the media dirs.
const ALLOWED_PREFIXES = [
  path.join(os.homedir(), ".hermes", "renders"),
  path.join(os.homedir(), "data"),
  path.join(os.homedir(), "Videos"),
  path.join(os.homedir(), "Pictures"),
  "/tmp",
];

// Only real media extensions are servable — never .env/.json/.db/.yaml/etc.
const MEDIA_EXTS = new Set(Object.keys(MIME));

// Path is inside an allowed root only if it equals the root or sits below it
// (segment boundary) — prevents ~/.hermes-backup or /tmpfoo style escapes.
function underAllowedRoot(filePath: string): boolean {
  return ALLOWED_PREFIXES.some(
    (p) => filePath === p || filePath.startsWith(p + path.sep),
  );
}

/**
 * Serve a local media file (render output: mp4/png/etc.) to the WebView so
 * `MEDIA:/path` and local `![](path)` references in transcripts render inline.
 * Supports HTTP range requests so <video> seeking works.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("path");
  if (!raw) return new Response("path required", { status: 400 });

  const filePath = path.resolve(raw.replace(/^~(?=\/)/, os.homedir()));
  if (!underAllowedRoot(filePath)) {
    return new Response("forbidden", { status: 403 });
  }
  // Reject anything that isn't a known media file — blocks .env/.json/.db reads
  // even if a future root change re-exposed a secrets dir.
  const ext = path.extname(filePath).toLowerCase();
  if (!MEDIA_EXTS.has(ext)) {
    return new Response("unsupported media type", { status: 415 });
  }

  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return new Response("not found", { status: 404 });
  }
  if (!stat.isFile()) return new Response("not a file", { status: 404 });

  const type = MIME[ext] || "application/octet-stream";
  const total = stat.size;
  const range = req.headers.get("range");

  // Range request → 206 partial (video seeking).
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : total - 1;
    const chunk = end - start + 1;
    const stream = createReadStream(filePath, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": type,
        "Content-Length": String(chunk),
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  const stream = createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": type,
      "Content-Length": String(total),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
