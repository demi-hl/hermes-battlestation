import { acpBridge, type AcpTurnEvent } from "@/lib/acp-bridge";
import { resolveRepoCwd } from "@/lib/local-repos";
import { tryLock, unlock, sessionTitleFor } from "@/lib/sessions";
import type { ChatStreamEvent, SendRequest } from "@/lib/chat-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
function frame(ev: ChatStreamEvent): Uint8Array {
  return encoder.encode(JSON.stringify(ev) + "\n");
}

/**
 * Send one message to the real Hermes agent over the long-lived ACP bridge
 * (the same streaming spine the desktop TUI uses), NOT a cold `hermes chat -q`
 * subprocess. The cold-CLI path hung two ways: a fresh turn rotated onto a
 * throttled OAuth cred and blocked, and `-q` itself has a shutdown hang at exit.
 * The ACP adapter stays warm, picks a working cred once and reuses it like the
 * gateway, and streams token-by-token deltas + tool activity.
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

  // Skills selected in the composer have no per-turn ACP flag (that was the
  // `-s` CLI path). Bridge them by asking the agent to load them first; it
  // calls skill_view on demand, same end state as preloading.
  const skills = Array.isArray(body.skills) ? body.skills.filter(Boolean) : [];
  const prompt = skills.length
    ? `Load and follow these skills before responding: ${skills.join(", ")}.\n\n${message}`
    : message;

  const started = Date.now();
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (ev: ChatStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(frame(ev));
        } catch {
          /* torn down */
        }
      };

      // Keep the bubble's elapsed counter ticking during the cold-boot wait
      // (first turn boots the agent + MCP servers, ~7s) before any delta lands.
      heartbeat = setInterval(() => {
        emit({ type: "status", elapsedMs: Date.now() - started, note: "" });
      }, 1000);

      const stopHeartbeat = () => {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
      };

      const relay = (e: AcpTurnEvent) => {
        switch (e.kind) {
          case "session":
            emit({ type: "session", sessionId: e.sessionId, title, isNew: e.isNew });
            break;
          case "delta":
            stopHeartbeat();
            emit({ type: "delta", text: e.text });
            break;
          case "thought":
            stopHeartbeat();
            emit({ type: "thought", text: e.text });
            break;
          case "tool-start":
            stopHeartbeat();
            emit({ type: "tool", id: e.id, name: e.name, title: e.title, phase: "start" });
            break;
          case "tool-end":
            emit({ type: "tool", id: e.id, name: e.name, title: e.title, phase: "end", ok: e.ok });
            break;
          case "usage":
            emit({ type: "usage", used: e.used, total: e.total, messageCount: 0 });
            break;
          case "done":
            emit({ type: "done", elapsedMs: Date.now() - started });
            break;
          case "error":
            emit({ type: "error", error: e.error });
            break;
        }
      };

      try {
        await acpBridge().prompt(repo, cwd, prompt, relay);
      } catch (e) {
        emit({ type: "error", error: e instanceof Error ? e.message : "agent failed" });
        emit({ type: "done", elapsedMs: Date.now() - started });
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        closed = true;
        unlock(title);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      void acpBridge().cancel(repo);
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
