import {
  getOrCreateSession,
  attach,
  writeToSession,
  resizeSession,
  killSession,
  defaultCwd,
} from "@/lib/pty";
import { resolveRepo } from "@/lib/workspace-fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Terminal transport. SSE carries PTY output (GET); a sibling POST carries
 * keystrokes / resize / signals. The session id is the repo slug so the PTY
 * survives the pane unmounting on tab-switch and resumes with its scrollback.
 * The cwd is always resolved server-side from the slug (client cwd is never
 * trusted). `repo` omitted / "general" → a shell in $HOME.
 */

const enc = new TextEncoder();

async function cwdFor(repo: string | null): Promise<string | null> {
  if (!repo || repo === "general") return defaultCwd();
  const ref = await resolveRepo(repo);
  return ref ? ref.root : null;
}

function sessionId(repo: string | null): string {
  return !repo || repo === "general" ? "general" : `repo:${repo}`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const repo = searchParams.get("repo");
  const cwd = await cwdFor(repo);
  if (cwd === null) {
    return new Response("unknown repo", { status: 404 });
  }
  const id = sessionId(repo);
  const session = getOrCreateSession(id, cwd);

  let detach: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: string) => {
        try {
          controller.enqueue(
            enc.encode(`event: ${event}\ndata: ${data}\n\n`),
          );
        } catch {
          /* controller closed */
        }
      };

      const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

      const { replay, detach: off } = attach(session, {
        onData: (chunk) => send("out", b64(chunk)),
        onExit: (code) => {
          send("exit", String(code));
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        },
      });
      detach = off;

      // Tell the client the session id + replay the scrollback so the screen
      // reconstructs after a reconnect / tab switch.
      send("ready", b64(JSON.stringify({ id, cwd })));
      if (replay) send("out", b64(replay));

      // Heartbeat keeps intermediaries from idling the connection out.
      const ping = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: ping\n\n`));
        } catch {
          clearInterval(ping);
        }
      }, 25_000);
      if (typeof ping.unref === "function") ping.unref();

      const onAbort = () => {
        clearInterval(ping);
        detach?.();
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      };
      req.signal.addEventListener("abort", onAbort);
    },
    cancel() {
      detach?.();
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

export async function POST(req: Request) {
  let payload: {
    repo?: string | null;
    data?: string;
    resize?: { cols: number; rows: number };
    kill?: boolean;
  };
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const repo = payload.repo ?? null;
  const cwd = await cwdFor(repo);
  if (cwd === null) {
    return Response.json({ error: "unknown repo" }, { status: 404 });
  }
  const id = sessionId(repo);

  if (payload.kill) {
    const ok = killSession(id);
    return Response.json({ ok });
  }
  if (payload.resize) {
    const ok = resizeSession(id, payload.resize.cols, payload.resize.rows);
    return Response.json({ ok });
  }
  if (typeof payload.data === "string") {
    const ok = writeToSession(id, payload.data);
    return Response.json({ ok });
  }
  return Response.json({ error: "nothing to do" }, { status: 400 });
}
