import { acpBridge, type AcpTurnEvent } from "@/lib/acp-bridge";
import {
  normalizeProfileName,
  readProfileTranscript,
  sessionMeta,
  validSessionId,
} from "@/lib/profile-sessions";
import type { ChatStreamEvent } from "@/lib/chat-types";
import { homedir } from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
function frame(ev: ChatStreamEvent): Uint8Array {
  return encoder.encode(JSON.stringify(ev) + "\n");
}

interface ContinueRequest {
  /** Hermes session id to continue (from the store). */
  sessionId: string;
  /** Profile that owns the session (default unless cross-profile). */
  profile?: string;
  message: string;
  model?: string;
  provider?: string;
  images?: { data: string; mime: string }[];
}

function cleanOverride(value: string | null | undefined): string | undefined {
  const v = value?.trim();
  if (!v || v.length > 200 || /[\0\r\n]/.test(v)) return undefined;
  return v;
}

/** Build a compact seed context from a transcript: keep the head (the goal)
 *  and the tail (recent state), trimmed to a char budget so we don't blow the
 *  context window priming a fresh session. */
function buildSeed(
  msgs: { role: string; text: string }[],
  budget = 24000,
): string {
  if (!msgs.length) return "";
  const fmt = (m: { role: string; text: string }) =>
    `${m.role === "user" ? "User" : "Assistant"}: ${m.text.trim()}`;
  const lines = msgs.map(fmt);
  let joined = lines.join("\n\n");
  if (joined.length <= budget) {
    return `Here is the prior conversation you are continuing:\n\n${joined}`;
  }
  // Keep head + tail, drop the middle with a marker.
  const half = Math.floor(budget / 2);
  let head = "";
  for (const l of lines) {
    if (head.length + l.length > half) break;
    head += l + "\n\n";
  }
  let tail = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    if (tail.length + lines[i].length > half) break;
    tail = lines[i] + "\n\n" + tail;
  }
  joined = `${head}\n[... earlier middle of the conversation omitted for length ...]\n\n${tail}`;
  return `Here is the prior conversation you are continuing (trimmed for length):\n\n${joined}`;
}

/**
 * Continue an EXISTING Hermes session by id. Two paths:
 *  - source="acp": the ACP adapter can restore it in place → resume the exact
 *    session via the bridge's session/load + prompt.
 *  - any other source (telegram/cron/cli): the adapter refuses to load a
 *    non-acp session, so we create a FRESH acp session seeded with the prior
 *    transcript as context and run the turn there. The reply is fully aware of
 *    the prior thread, and the new session is resumable in place from here on.
 * Streams the same NDJSON protocol the chat client parses.
 */
export async function POST(req: Request) {
  let body: ContinueRequest;
  try {
    body = (await req.json()) as ContinueRequest;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const sessionId = (body.sessionId ?? "").trim();
  const message = (body.message ?? "").trim();
  if (!validSessionId(sessionId)) return new Response("bad sessionId", { status: 400 });
  if (!message) return new Response("empty message", { status: 400 });

  const profile = normalizeProfileName(body.profile);
  if (!profile) return new Response("bad profile", { status: 400 });
  const requestedModel = cleanOverride(body.model);
  const requestedProvider = cleanOverride(body.provider);
  const meta = await sessionMeta(profile, sessionId);
  const cwd = meta.cwd || homedir();
  const isAcp = meta.source === "acp";
  const exactResume =
    isAcp &&
    (!requestedModel || requestedModel === meta.model) &&
    (!requestedProvider || requestedProvider === meta.provider);

  let seed = "";
  if (!exactResume) {
    try {
      const transcript = await readProfileTranscript(profile, sessionId);
      seed = buildSeed(transcript);
    } catch {
      /* no transcript — proceed with an empty seed */
    }
  }

  const MAX_IMAGES = 6;
  const MAX_IMG_CHARS = 12_000_000;
  const images = (Array.isArray(body.images) ? body.images : [])
    .filter((im) => im && typeof im.data === "string" && im.data.length <= MAX_IMG_CHARS)
    .slice(0, MAX_IMAGES)
    .map((im) => ({ data: im.data, mime: typeof im.mime === "string" ? im.mime : "image/png" }));

  const target = {
    profile,
    model: requestedModel,
    provider: requestedProvider,
  };

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
            emit({ type: "session", sessionId: e.sessionId, title: sessionId, isNew: e.isNew });
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
        const bridge = acpBridge(target);
        if (exactResume) {
          await bridge.promptSession(sessionId, cwd, message, relay, images);
        } else {
          await bridge.promptSeeded(cwd, seed, message, relay, images);
        }
      } catch (e) {
        emit({ type: "error", error: e instanceof Error ? e.message : "agent failed" });
        emit({ type: "done", elapsedMs: Date.now() - started });
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
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
