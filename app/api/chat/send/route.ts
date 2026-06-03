import { spawn } from "node:child_process";
import { resolveRepoCwd } from "@/lib/local-repos";
import {
  sessionTitleFor,
  querySessionByTitle,
  renameSession,
  parseSessionId,
  usageFromRow,
  buildChatArgs,
  tryLock,
  unlock,
} from "@/lib/sessions";
import type { ChatStreamEvent, SendRequest } from "@/lib/chat-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
function frame(ev: ChatStreamEvent): Uint8Array {
  return encoder.encode(JSON.stringify(ev) + "\n");
}

/**
 * Send one message to a repo's bound session and stream the turn back as
 * newline-delimited JSON. This is the per-repo session spine:
 *
 *   - Resolve the repo name to a safe cwd (server-side allowlist).
 *   - Title = `lol-<slug>`. If a session already exists, resume it via
 *     `--continue <title>` (same context). If not, run a fresh turn, capture
 *     the printed session_id, and rename it to `<title>` so the NEXT turn
 *     resumes it. This is exactly how the bound, resumable per-repo context
 *     works.
 *
 * Reply delivery: the headless `--cli -q -Q` path prints the final response on
 * stdout at turn end (it is not a token stream), so we emit live `status`
 * heartbeats (elapsed time, the Hermes "working" feel) while the agent runs,
 * then the full `message` when it completes. Honest: this is a real round-trip
 * to the real agent, delivered as a complete turn, not token-by-token deltas.
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
  const skills = Array.isArray(body.skills) ? body.skills.slice(0, 6) : [];

  if (!tryLock(title)) {
    return new Response(
      JSON.stringify({ type: "error", error: "a turn is already running for this thread" }),
      { status: 409, headers: { "content-type": "application/json" } },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const started = Date.now();
      let closed = false;
      const safeEnqueue = (ev: ChatStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(frame(ev));
        } catch {
          /* stream already torn down (client navigated away) */
        }
      };

      try {
        const existing = await querySessionByTitle(title);
        const resume = !!existing;
        const args = buildChatArgs({ title, resume, message, skills });

        safeEnqueue({
          type: "session",
          sessionId: existing?.id ?? "",
          title,
          isNew: !resume,
        });

        // Heartbeat so the UI shows a live "working Ns" state.
        const heartbeat = setInterval(() => {
          safeEnqueue({
            type: "status",
            elapsedMs: Date.now() - started,
            note: resume ? "resuming session" : "starting session",
          });
        }, 1000);

        const child = spawn("hermes", args, {
          cwd,
          env: {
            ...process.env,
            HERMES_SESSION_SOURCE: "locals-only",
            // Autonomous hub (replaces Telegram): auto-approve tool/hook prompts
            // so a turn never hangs waiting on a prompt no one can answer.
            HERMES_YOLO_MODE: "1",
            HERMES_ACCEPT_HOOKS: "1",
          },
        });

        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => {
          stdout += d.toString();
        });
        child.stderr.on("data", (d) => {
          stderr += d.toString();
        });

        const exitCode: number = await new Promise((resolve) => {
          child.on("close", (code) => resolve(code ?? 1));
          child.on("error", () => resolve(127));
        });

        clearInterval(heartbeat);

        const reply = stdout.trim();
        const sid = parseSessionId(stderr);

        if (exitCode !== 0 || !reply) {
          const tail = stderr.split("\n").filter(Boolean).slice(-4).join(" ");
          safeEnqueue({
            type: "error",
            error:
              exitCode === 127
                ? "could not launch the hermes agent (is it on PATH?)"
                : tail || "the agent produced no response",
          });
        } else {
          // First turn: rename the fresh session to its lol-<slug> title so the
          // next turn resumes it. Best-effort; failure is reported via the
          // resume path next time (it would just create a second fresh one).
          if (!resume && sid) {
            await renameSession(sid, title);
          }
          if (sid) {
            safeEnqueue({ type: "session", sessionId: sid, title, isNew: !resume });
          }
          safeEnqueue({ type: "message", text: reply });

          // Re-read the row for the real updated usage + message count.
          const row = await querySessionByTitle(title);
          const usage = usageFromRow(row);
          if (usage && row) {
            safeEnqueue({
              type: "usage",
              used: usage.used,
              total: usage.total,
              messageCount: row.messageCount,
            });
          }
        }

        safeEnqueue({ type: "done", elapsedMs: Date.now() - started });
      } catch (e) {
        safeEnqueue({
          type: "error",
          error: e instanceof Error ? e.message : "send failed",
        });
      } finally {
        unlock(title);
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
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
