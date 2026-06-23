import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { run, scrubPaths} from "@/lib/exec";
import { cached } from "@/lib/cache";
import type { ApiEnvelope, Repo } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

const HOME = process.env.HOME ?? homedir();
const PROJECTS_DIR = path.join(HOME, "projects");

// Conservative safe set for derived repo names: letters, digits, dot,
// underscore, dash. No slashes (keeps the clone target inside PROJECTS_DIR),
// no shell metacharacters. Git option injection is avoided by passing argv as
// an array (no shell) plus rejecting leading dashes.
const NAME_RE = /^[A-Za-z0-9._-]+$/;

export async function GET() {
  const env: ApiEnvelope<Repo[]> = await cached("repos", 60_000, async () => {
    const org = process.env.GH_ORG ?? "";
    const r = await run(
      `gh repo list ${org} --limit 30 --json name,description,pushedAt,url`,
      { timeoutMs: 12000 },
    );
    if (!r.ok) {
      return {
        data: null,
        fetchedAt: new Date().toISOString(),
        error: scrubPaths(r.stderr) || "gh repo list failed",
      };
    }
    let repos: Repo[] = [];
    try {
      repos = JSON.parse(r.stdout) as Repo[];
    } catch {
      return {
        data: null,
        fetchedAt: new Date().toISOString(),
        error: "could not parse gh output",
      };
    }
    repos.sort(
      (a, b) => new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime(),
    );
    return { data: repos, fetchedAt: new Date().toISOString() };
  });
  return NextResponse.json(env);
}

/** Derive a safe repo directory name from a git clone URL (the last path
 *  segment, minus a trailing ".git"). Returns null when nothing safe results. */
function deriveNameFromUrl(url: string): string | null {
  // Handles https URLs and scp-style git@host:owner/repo.git equally: take the
  // final path-ish segment after the last "/" or ":".
  const tail = url.trim().replace(/\.git$/i, "").split(/[\/:]/).pop() ?? "";
  const name = tail.trim();
  if (!name || !NAME_RE.test(name) || name.startsWith("-")) return null;
  return name;
}

interface ReposPostRequest {
  path?: string;
  url?: string;
}

/**
 * Add a local repo to the bindable set.
 *
 * POST { url } clones <url> into $HOME/projects/<derived-name> (execFile, argv
 * array, no shell). POST { path } validates that an existing absolute path is a
 * git repo. Either way the response reports the on-disk name + path so the
 * client can bind a session to it. Inputs are validated; the clone target is
 * always inside PROJECTS_DIR (the derived name has no slashes).
 */
export async function POST(req: Request) {
  let body: ReposPostRequest;
  try {
    body = (await req.json()) as ReposPostRequest;
  } catch {
    return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  }

  const url = (body.url ?? "").trim();
  const inputPath = (body.path ?? "").trim();

  // Clone path: derive a safe target name and clone into PROJECTS_DIR.
  if (url) {
    if (url.startsWith("-")) {
      return Response.json({ ok: false, error: "invalid url" }, { status: 400 });
    }
    const name = deriveNameFromUrl(url);
    if (!name) {
      return Response.json({ ok: false, error: "could not derive repo name from url" }, { status: 400 });
    }
    const dest = path.join(PROJECTS_DIR, name);
    try {
      await fs.access(dest);
      return Response.json({ ok: false, error: "destination already exists", name, path: dest }, { status: 409 });
    } catch {
      /* destination free, proceed */
    }
    try {
      await fs.mkdir(PROJECTS_DIR, { recursive: true });
      await execFileAsync("git", ["clone", url, dest], {
        timeout: 120000,
        maxBuffer: 16 * 1024 * 1024,
      });
      return Response.json({ ok: true, name, path: dest });
    } catch (e) {
      const err = e as { stderr?: string; message?: string };
      const detail = scrubPaths(err.stderr ?? err.message ?? "git clone failed");
      return Response.json({ ok: false, error: detail, name, path: dest }, { status: 200 });
    }
  }

  // Bind-existing path: validate it exists and is a git repo.
  if (inputPath) {
    if (!path.isAbsolute(inputPath)) {
      return Response.json({ ok: false, error: "path must be absolute" }, { status: 400 });
    }
    try {
      const st = await fs.stat(inputPath);
      if (!st.isDirectory()) {
        return Response.json({ ok: false, error: "path is not a directory" }, { status: 400 });
      }
    } catch {
      return Response.json({ ok: false, error: "path does not exist" }, { status: 404 });
    }
    try {
      const git = await fs.stat(path.join(inputPath, ".git"));
      if (!git.isDirectory() && !git.isFile()) {
        return Response.json({ ok: false, error: "not a git repo" }, { status: 400 });
      }
    } catch {
      return Response.json({ ok: false, error: "not a git repo" }, { status: 400 });
    }
    return Response.json({ ok: true, name: path.basename(inputPath), path: inputPath });
  }

  return Response.json({ ok: false, error: "provide a url or a path" }, { status: 400 });
}

interface ReposDeleteRequest {
  name?: string;
}

/**
 * Unbind a repo from the client's list. This is deliberately a no-op on disk:
 * it NEVER removes files (no rm -rf). It just validates the name and returns ok
 * so the mobile client can drop the repo from its list. Deleting the actual
 * checkout is intentionally out of scope (and dangerous) for a mobile client.
 */
export async function DELETE(req: Request) {
  let body: ReposDeleteRequest;
  try {
    body = (await req.json()) as ReposDeleteRequest;
  } catch {
    return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (!name || !NAME_RE.test(name) || name.startsWith("-")) {
    return Response.json({ ok: false, error: "invalid name" }, { status: 400 });
  }
  // Unbind only: nothing is removed from disk.
  return Response.json({ ok: true, name, unbound: true });
}
