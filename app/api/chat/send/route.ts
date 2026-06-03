import { resolveRepoCwd } from "@/lib/local-repos";
import { sessionTitleFor, tryLock, unlock } from "@/lib/sessions";
import { acpBridge, type AcpTurnEvent } from "@/lib/acp-bridge";
import type { ChatStreamEvent, SendRequest } from "@/lib/chat-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
function frame(ev: ChatStreamEvent): Uint8Array {
  return encoder.encode(JSON.stringify(ev) + "\n");
}

/**
 * Send one message to a repo's bound Hermes session and stream the turn back as
 * newline-delimited JSON — live. This drives the real agent over ACP
 * (Agent Client Protocol), so the browser receives token-by-token text,
 * reasoning, and tool-call activity as it happens, exactly like the desktop
 * TUI. One ACP session per repo (cwd = repo path); the adapter persists
 * sessions so context carries across turns and server restarts.
 */
export async function POST(req: Request) {
  let body: SendRequest;
  try {
    body = (await req.json()) as SendRequest;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const message = (body.message ?? "").trim();
  if (!message) return new Response("empty message", { status: 400 });

  const repo = body.repo || "general";
  const cwd = await resolveRepoCwd(repo);
  if (!cwd) return new Response("unknown repo", { status: 404 });

  const title = sessionTitleFor(repo);

  if (!tryLock(title)) {
    return new Response(
      JSON.stringify({ type: "error", error: "a turn is already running for this thread" }),
      { status: 409, headers: { "content-type": "application/json" } },
    );
  }

  const started = Date.now();
  const bridge = acpBridge();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const emit = (ev: ChatStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(frame(ev));
        } catch {
          /* torn down */
        }
      };

      const onEvent = (e: AcpTurnEvent) => {
        switch (e.kind) {
          case "session":
            emit({ type: "session", sessionId: e.sessionId, title, isNew: e.isNew });
            break;
          case "delta":
            emit({ type: "delta", text: e.text });
            break;
          case "thought":
            emit({ type: "thought", text: e.text });
            break;
          case "tool-start":
            emit({ type: "tool", id: e.id, name: e.name, title: e.title, phase: "start" });
            break;
          case "tool-end":
            emit({
              type: "tool",
              id: e.id,
              name: e.name,
              title: e.title,
              phase: "end",
              ok: e.ok,
            });
            break;
          case "usage":
            if (e.total > 0)
              emit({ type: "usage", used: e.used, total: e.total, messageCount: 0 });
            break;
          case "error":
            emit({ type: "error", error: e.error });
            break;
          case "done":
            // handled after prompt() resolves
            break;
        }
      };

      bridge
        .prompt(repo, cwd, message, onEvent)
        .catch((err) => {
          emit({ type: "error", error: err instanceof Error ? err.message : "send failed" });
        })
        .finally(() => {
          emit({ type: "done", elapsedMs: Date.now() - started });
          unlock(title);
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        });
    },
    cancel() {
      // Client disconnected — cancel the in-flight turn and release the lock.
      void bridge.cancel(repo);
      unlock(title);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
