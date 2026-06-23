import { execFile } from "node:child_process";
import { scrubPaths } from "@/lib/exec";
import { promisify } from "node:util";
import { resolveRepoCwd } from "@/lib/local-repos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

// Branch names are constrained to a conservative safe set (letters, digits,
// dot, underscore, slash, dash). This blocks shell metacharacters AND git
// option injection is avoided separately by passing argv as an array (no
// shell) plus a leading "--" guard would still be defeated by a leading dash,
// so the regex also keeps names from starting with a dash via the same set.
const BRANCH_RE = /^[A-Za-z0-9._\/-]+$/;

interface BranchRequest {
  repo?: string;
  branch?: string;
  from?: string;
}

/**
 * Create and check out a new git branch in a known repo.
 *
 * POST { repo, branch, from? } runs `git -C <cwd> checkout -b <branch> [from]`
 * via execFile with an argv array (NOT a shell), so the branch/from values are
 * never interpolated into a command line. The repo is resolved to a safe cwd
 * server-side (the client-supplied repo is a NAME, never a path), and the
 * branch (and from) names are validated against a conservative character set.
 */
export async function POST(req: Request) {
  let body: BranchRequest;
  try {
    body = (await req.json()) as BranchRequest;
  } catch {
    return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  }

  const repo = (body.repo ?? "").trim();
  const branch = (body.branch ?? "").trim();
  const from = (body.from ?? "").trim();

  if (!repo) {
    return Response.json({ ok: false, error: "missing repo" }, { status: 400 });
  }
  if (!branch || !BRANCH_RE.test(branch) || branch.startsWith("-")) {
    return Response.json({ ok: false, error: "invalid branch name" }, { status: 400 });
  }
  if (from && (!BRANCH_RE.test(from) || from.startsWith("-"))) {
    return Response.json({ ok: false, error: "invalid from ref" }, { status: 400 });
  }

  const cwd = await resolveRepoCwd(repo);
  if (!cwd) {
    return Response.json({ ok: false, error: "unknown repo" }, { status: 404 });
  }

  const args = ["-C", cwd, "checkout", "-b", branch];
  if (from) args.push(from);

  try {
    await execFileAsync("git", args, { timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
    return Response.json({ ok: true, branch, cwd });
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    const detail = scrubPaths(err.stderr ?? err.message ?? "git checkout failed");
    return Response.json({ ok: false, error: detail, branch, cwd }, { status: 200 });
  }
}
