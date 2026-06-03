import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveRepoCwd } from "@/lib/local-repos";
import { run } from "@/lib/exec";
import {
  sessionTitleFor,
  querySessionByTitle,
  renameSession,
  parseSessionId,
  buildChatArgs,
  tryLock,
  unlock,
} from "@/lib/sessions";
import type { AgentEditRequest, AgentEditResult, AgentEditFile } from "@/lib/chat-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Agent-inline-edit backend (owned by the chat slice; the editor slice renders
 * the entry point + review UI against this contract; the polish slice wires
 * accept->write at integration).
 *
 * Flow: drive the ACTIVE repo's bound session to edit ONE target file per the
 * instruction, read the agent-proposed content, compute a structured unified
 * diff, then RESTORE the file on disk so nothing is committed yet. The caller
 * reviews the changeset and (slice 6) writes `newContent` on accept.
 *
 * v1 scope: a single target file. The result type is already an array so a
 * later version can return a multi-file changeset without an interface change.
 */
export async function POST(req: Request) {
  let body: AgentEditRequest;
  try {
    body = (await req.json()) as AgentEditRequest;
  } catch {
    return json({ ok: false, files: [], sessionId: null, error: "bad request" }, 400);
  }

  const instruction = (body.instruction ?? "").trim();
  if (!instruction) {
    return json({ ok: false, files: [], sessionId: null, error: "missing instruction" }, 400);
  }

  const cwd = await resolveRepoCwd(body.repo);
  if (!cwd) return json({ ok: false, files: [], sessionId: null, error: "unknown repo" }, 404);

  // Resolve + contain the target path within the repo (no traversal).
  const abs = path.resolve(cwd, body.path ?? "");
  const rel = path.relative(cwd, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return json({ ok: false, files: [], sessionId: null, error: "path escapes repo" }, 400);
  }

  const title = sessionTitleFor(body.repo);
  if (!tryLock(title)) {
    return json(
      { ok: false, files: [], sessionId: null, error: "a turn is already running for this thread" },
      409,
    );
  }

  try {
    let existedBefore = true;
    let oldContent = "";
    try {
      oldContent = await fs.readFile(abs, "utf8");
    } catch {
      existedBefore = false;
    }

    const prompt = buildEditPrompt(rel, instruction, body.selection);
    const existing = await querySessionByTitle(title);
    const resume = !!existing;
    const args = buildChatArgs({ title, resume, message: prompt });

    const { code, stderr } = await spawnTurn(args, cwd);
    const sid = parseSessionId(stderr) ?? existing?.id ?? null;
    if (!resume && sid) await renameSession(sid, title);

    // Read the agent-proposed content, then restore disk.
    let newContent = "";
    let newExists = true;
    try {
      newContent = await fs.readFile(abs, "utf8");
    } catch {
      newExists = false;
    }

    // Restore original state (non-destructive proposal).
    if (existedBefore) {
      await fs.writeFile(abs, oldContent, "utf8");
    } else if (newExists) {
      await fs.rm(abs, { force: true });
    }

    if (code !== 0 && oldContent === newContent) {
      return json({
        ok: false,
        files: [],
        sessionId: sid,
        error: "the agent turn failed",
        note: stderr.split("\n").filter(Boolean).slice(-3).join(" "),
      });
    }

    if (oldContent === newContent) {
      return json({
        ok: true,
        files: [],
        sessionId: sid,
        note: "the agent did not change the file",
      });
    }

    const diff = await unifiedDiff(rel, oldContent, newContent);
    const { additions, deletions } = countDiff(diff);
    const file: AgentEditFile = {
      path: rel,
      additions,
      deletions,
      oldContent,
      newContent,
      diff,
    };
    return json({ ok: true, files: [file], sessionId: sid });
  } catch (e) {
    return json({
      ok: false,
      files: [],
      sessionId: null,
      error: e instanceof Error ? e.message : "agent edit failed",
    });
  } finally {
    unlock(title);
  }
}

function buildEditPrompt(rel: string, instruction: string, selection?: string): string {
  const sel = selection?.trim()
    ? `\n\nFocus on this selected region:\n<<<\n${selection.trim()}\n>>>`
    : "";
  return (
    `Edit ONLY the file \`${rel}\` in this repo. Apply this change and save it to disk: ` +
    `${instruction}.${sel}\n\n` +
    `Do not touch any other file. Do not run git. When done, reply with just the word DONE.`
  );
}

function spawnTurn(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("hermes", args, {
      cwd,
      env: {
        ...process.env,
        HERMES_SESSION_SOURCE: "locals-only",
        // Non-interactive: auto-approve so the file write does not hang on a
        // prompt no one can answer.
        HERMES_YOLO_MODE: "1",
        HERMES_ACCEPT_HOOKS: "1",
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on("error", () => resolve({ code: 127, stdout, stderr }));
  });
}

// Unified diff via `git diff --no-index` over temp files (works for tracked,
// untracked, and new files), relabeled to the repo-relative path.
async function unifiedDiff(rel: string, oldText: string, newText: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lol-edit-"));
  const a = path.join(dir, "old");
  const b = path.join(dir, "new");
  try {
    await fs.writeFile(a, oldText);
    await fs.writeFile(b, newText);
    const r = await run(
      `git diff --no-index --unified=3 '${a}' '${b}'`,
      { timeoutMs: 8000 },
    );
    // git diff --no-index exits 1 when files differ; that is expected.
    let out = r.stdout || "";
    out = out
      .replace(new RegExp(escapeRe(a), "g"), `a/${rel}`)
      .replace(new RegExp(escapeRe(b), "g"), `b/${rel}`);
    return out.trim();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countDiff(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
}

function json(payload: AgentEditResult, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
