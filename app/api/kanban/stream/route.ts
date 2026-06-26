import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Kanban real-time push. The board is a SQLite DB at ~/.hermes/kanban.db,
 * mutated out-of-process by `hermes kanban` — so there are no in-process events
 * to hook. Instead the SERVER polls a cheap filesystem fingerprint of the DB
 * (mtime + size of the main file and any WAL/journal sidecars) on a short tick
 * and pushes a "changed" SSE event only when the fingerprint moves. That folds
 * every client's 5s poll into one server-side stat loop and delivers updates the
 * instant the board actually changes, instead of on the next client poll.
 *
 * The route lives under /api/ so the access-gate middleware already requires a
 * token/cookie — it is NOT a public path. Mirrors app/api/terminal/route.ts.
 */

const enc = new TextEncoder();

const DB_PATH = path.join(homedir(), ".hermes", "kanban.db");
// Across SQLite journal modes the bytes land in different files: rollback-journal
// writes the main db (and a transient -journal); WAL writes -wal/-shm and may not
// touch the main file's mtime until a checkpoint. Fingerprint all of them so a
// change is caught regardless of mode.
const SIDECARS = ["", "-wal", "-shm", "-journal"] as const;

async function fingerprint(): Promise<string> {
  const parts: string[] = [];
  for (const suffix of SIDECARS) {
    try {
      const s = await stat(DB_PATH + suffix);
      parts.push(`${suffix}:${s.mtimeMs}:${s.size}`);
    } catch {
      parts.push(`${suffix}:-`); // absent (most modes keep only a subset live)
    }
  }
  return parts.join("|");
}

export async function GET(req: Request) {
  let poll: ReturnType<typeof setInterval> | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (s: string) => {
        try {
          controller.enqueue(enc.encode(s));
          return true;
        } catch {
          return false; // controller closed
        }
      };
      const send = (event: string, data: string) =>
        enqueue(`event: ${event}\ndata: ${data}\n\n`);

      const cleanup = () => {
        if (poll) clearInterval(poll);
        if (keepalive) clearInterval(keepalive);
        poll = null;
        keepalive = null;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Open the stream immediately so a curl/EventSource sees a live connection
      // (200 text/event-stream) before the first change.
      enqueue(`: connected\n\n`);
      let last = await fingerprint();
      send("ready", JSON.stringify({ at: new Date().toISOString() }));

      // Server-side change detection: one stat loop, push only on a real diff.
      poll = setInterval(async () => {
        const fp = await fingerprint();
        if (fp !== last) {
          last = fp;
          if (!send("changed", JSON.stringify({ at: new Date().toISOString() })))
            cleanup();
        }
      }, 2500);
      if (typeof poll.unref === "function") poll.unref();

      // Keepalive comment so proxies / the browser don't idle the stream out.
      keepalive = setInterval(() => {
        if (!enqueue(`: keepalive\n\n`)) cleanup();
      }, 25_000);
      if (typeof keepalive.unref === "function") keepalive.unref();

      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      if (poll) clearInterval(poll);
      if (keepalive) clearInterval(keepalive);
      poll = null;
      keepalive = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
