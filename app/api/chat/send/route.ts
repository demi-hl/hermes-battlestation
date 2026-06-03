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

/** Kill + unlock helper for stream teardown. */
function cleanup(
  child: import("node:child_process").ChildProcess | null,
  title: string,
  heartbeat: ReturnType<typeof setInterval> | null,
): void {
  if (child && child.exitCode === null) {
    try { child.kill("SIGTERM"); } catch { /* already dead */ }
    setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* */ } }, 5000);
  }
  if (heartbeat) clearInterval(heartbeat);
  unlock(title);
}

/**
 * Send one message to a repo's bound session and stream the turn back as
 * newline-delimited JSON. This is the per-repo session spine:
 *
 *   - Resolve the repo name to a safe cwd (server-side allowlist).
 *   - Title = `lol-<slug>`. If a session already exists, resume it via
 *     `--continue <title>` (same context). If not, run a fresh turn, capture
 *     the printed session_id, and rename it to `<title>` so the NEXT turn
 *     resumes it.
 *
 * Reply delivery: the headless `--cli -q -Q` path prints the final response on
 * stdout at turn end (it is not a token stream), so we emit live `status`
 * heartbeats (elapsed time, the Hermes "working" feel) while the agent runs,
 * then the full `message` when it completes.
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
    start(controller) {
      // Run the turn in a background promise so we can return the stream fast.
      const p = runTurn(controller, title, repo, cwd, message, skills);
      // The stream stays alive until the promise resolves.
      return p.finally(() => {});
    },
    cancel() {
      // Client disconnected — force unlock. The running promise's finally
      // will also call it (idempotent since unlock is Set.delete).
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

/** One full turn. Broken out so `cancel()` can reference the mutable refs. */
async function runTurn(
  controller: ReadableStreamDefaultController<Uint8Array>,
  title: string,
  repo: string,
  cwd: string,
  message: string,
  skills: string[],
): Promise<void> {
  const started = Date.now();
  let closed = false;
  let child: import("node:child_process").ChildProcess | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let turnDone = false;

  const safeEnqueue = (ev: ChatStreamEvent) => {
    if (closed || turnDone) return;
    try {
      controller.enqueue(frame(ev));
    } catch {
      /* stream torn down — cancel will catch it */
    }
  };

  // Honour stream cancellation during the turn.
  // @ts-expect-error: cancel() signature differs across runtimes
  controller.signal?.addEventListener?.("abort", () => {
    cleanup(child, title, heartbeat);
    turnDone = true;
    closed = true;
  });

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
    heartbeat = setInterval(() => {
      safeEnqueue({
        type: "status",
        elapsedMs: Date.now() - started,
        note: resume ? "resuming session" : "starting session",
      });
    }, 1000);

    child = spawn("hermes", args, {
      cwd,
      env: {
        ...process.env,
        HERMES_SESSION_SOURCE: "locals-only",
        HERMES_YOLO_MODE: "1",
        HERMES_ACCEPT_HOOKS: "1",
      },
    });

    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (d) => { stdout += d.toString(); });
    child.stderr!.on("data", (d) => { stderr += d.toString(); });

    // Timeout: kill after 120s so the lock never hangs forever.
    const timeout = setTimeout(() => {
      if (child && child.exitCode === null) {
        try { child.kill("SIGTERM"); } catch { /* */ }
      }
    }, 120_000);

    const exitCode: number = await new Promise((resolve) => {
      child!.on("close", (code) => { clearTimeout(timeout); resolve(code ?? 1); });
      child!.on("error", () => { clearTimeout(timeout); resolve(127); });
    });

    clearInterval(heartbeat!);
    heartbeat = null;

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
      if (!resume && sid) {
        await renameSession(sid, title);
      }
      if (sid) {
        safeEnqueue({ type: "session", sessionId: sid, title, isNew: !resume });
      }
      safeEnqueue({ type: "message", text: reply });

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
    cleanup(child, title, heartbeat);
    turnDone = true;
    closed = true;
    try { controller.close(); } catch { /* already closed */ }
  }
}