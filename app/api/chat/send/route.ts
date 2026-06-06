import { spawn } from "node:child_process";
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
 * Send one message to Hermes via the CLI subprocess.
 * Uses `hermes chat -q` directly instead of the ACP bridge, which has a bug
 * where the agent runs silently and produces no streamed output in ACP mode.
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

  // Optional per-turn model/provider/skills (hermes -m / --provider / -s).
  const cliArgs = ["chat", "-q", message, "--yolo", "--quiet"];
  if (body.model) cliArgs.push("-m", body.model);
  if (body.provider) cliArgs.push("--provider", body.provider);
  if (Array.isArray(body.skills) && body.skills.length) {
    cliArgs.push("-s", body.skills.join(","));
  }

  const started = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (ev: ChatStreamEvent) => {
        if (closed) return;
        try { controller.enqueue(frame(ev)); } catch { /* torn down */ }
      };

      try {
        const child = spawn(
          process.env.HERMES_BIN ?? "hermes",
          cliArgs,
          { cwd, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] },
        );

        let out = "";
        child.stdout.on("data", (d: Buffer) => { out += d.toString(); });

        const exitCode = await new Promise<number | null>((resolve) => {
          child.on("close", (code: number | null) => resolve(code));
          child.on("error", () => resolve(null));
        });

        if (exitCode !== 0 && exitCode !== null) {
          // Use whatever we got on stderr as the error
          emit({ type: "error", error: `hermes exited ${exitCode}` });
        } else {
          // Parse: first line is "session_id: <id>", rest is the response text
          const lines = out.split("\n");
          const sidLine = lines.find((l) => l.startsWith("session_id: "));
          const sessionId = sidLine ? sidLine.replace("session_id: ", "").trim() : "cli";
          const responseText = lines
            .filter((l) => !l.startsWith("session_id: "))
            .join("\n")
            .trim();

          emit({ type: "session", sessionId, title, isNew: true });
          if (responseText) {
            emit({ type: "message", text: responseText });
          }
        }

        emit({ type: "done", elapsedMs: Date.now() - started });
        closed = true;
        controller.close();
      } catch (e) {
        emit({ type: "error", error: e instanceof Error ? e.message : "CLI failed" });
        emit({ type: "done", elapsedMs: Date.now() - started });
        closed = true;
        controller.close();
      } finally {
        unlock(title);
      }
    },
    cancel() {
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
