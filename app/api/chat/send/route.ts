import { acpBridge, type AcpTurnEvent } from "@/lib/acp-bridge";
import { resolveBranchCwd } from "@/lib/local-repos";
import { tryLock, unlock, sessionTitleForBranch } from "@/lib/sessions";
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
  const branch = body.branch?.trim() || null;
  const cwd = await resolveBranchCwd(repo, branch);
  if (!cwd) return new Response("unknown repo", { status: 404 });

  // Branch-aware session title: a specific branch gets its own session
  // (lol-<repo>__<branch>) so branches run independently; the base/primary
  // branch collapses to the plain repo session.
  const title = sessionTitleForBranch(repo, branch);
  // Bridge session key: the title uniquely identifies repo+branch, so the ACP
  // session map (keyed by this string) keeps branches isolated.
  const sessionKey = title;
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

  // Image attachments (pasted/added in the composer) ride the turn as ACP
  // image content blocks. Cap count + payload so a fat clipboard paste can't
  // wedge the bridge; oversize/extra images are dropped silently.
  const MAX_IMAGES = 6;
  const MAX_IMG_CHARS = 12_000_000; // ~9MB decoded per image
  const images = (Array.isArray(body.images) ? body.images : [])
    .filter((im) => im && typeof im.data === "string" && im.data.length <= MAX_IMG_CHARS)
    .slice(0, MAX_IMAGES)
    .map((im) => ({ data: im.data, mime: typeof im.mime === "string" ? im.mime : "image/png" }));

  // Which brain runs this turn. Profile is the real lever (spawns
  // `hermes -p <profile> acp`); model/provider are optional per-turn overrides.
  const target = {
    profile: (body.profile || "default").trim() || "default",
    model: body.model?.trim() || undefined,
    provider: body.provider?.trim() || undefined,
  };

  const started = Date.now();
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  // Accumulate the assistant's streamed text so a turn-complete push can show a
  // preview. Fire-and-forget to /api/push/send — no-op (503) unless VAPID keys
  // are set and a device subscribed via the notifications toggle. The service
  // worker only surfaces the alert when the PWA is backgrounded; a focused tab
  // shows the reply inline, so this never double-notifies a turn you watched.
  let replyText = "";
  let notified = false;
  const notifyDone = async (text: string) => {
    if (notified) return;
    notified = true;
    try {
      const origin = new URL(req.url).origin;
      const body = (text || "").trim().replace(/\s+/g, " ").slice(0, 140);
      await fetch(`${origin}/api/push/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: repo === "general" ? "Hermes · general" : `Hermes · ${repo}`,
          body: body || "Turn complete",
          threadId: title,
          tag: `turn-${title}`,
        }),
      });
    } catch {
      /* push is best-effort; never block the stream teardown */
    }
  };

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
            replyText += e.text;
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
            void notifyDone(replyText);
            break;
          case "error":
            emit({ type: "error", error: e.error });
            break;
        }
      };

      try {
        await acpBridge(target).prompt(sessionKey, cwd, prompt, relay, images);
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
      // DURABLE TURNS: a dropped HTTP connection (iOS backgrounding the app,
      // network blip) must NOT cancel the agent turn — it keeps running on the
      // host to completion, fires the turn-done push, and the `finally` above
      // unlocks the session when it truly finishes. The client re-pulls history
      // on foreground to show the result. Only an explicit Stop
      // (/api/chat/cancel) cancels the live turn. We just stop our heartbeat;
      // the bridge prompt keeps streaming into `relay` (emit no-ops once closed).
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
