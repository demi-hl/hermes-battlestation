import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { runFile } from "@/lib/run-file";
import { cached } from "@/lib/cache";
import { resolvedRepoRoots } from "@/lib/app-config";
import type {
  Workspace,
  RepoSummary,
  DiffStat,
  TreeEntry,
  ReadResult,
} from "@/lib/workspace-types";

export type {
  Workspace,
  RepoSummary,
  DiffStat,
  TreeEntry,
  ReadResult,
} from "@/lib/workspace-types";

/**
 * Workspace filesystem layer for the Repos / Editor / Terminal slice.
 *
 * Security model: the only entry points clients reach are a repo SLUG plus a
 * repo-relative path. Slugs are validated against the live enumeration of git
 * repos under a fixed allowlist of roots, and every relative path is resolved
 * and re-checked (including a realpath pass to defeat symlink escapes) so it can
 * never climb outside its repo root. No client value is ever interpolated into
 * a shell command (git runs via execFile argv).
 */

const HOME = os.homedir();

/** Default roots when no user config is set. The resolved set (config overlay)
 *  comes from resolvedRepoRoots(); this stays exported for back-compat. */
export const ALLOWED_ROOTS = [
  path.join(HOME, "projects"),
  path.join(HOME, "agent"),
];

/** Directories never walked in the file tree or shown as workspaces. */
const TREE_IGNORE = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  ".mypy_cache",
  ".pytest_cache",
  ".DS_Store",
  "out",
  "coverage",
]);

const SAFE_BRANCH = /^[\w./+@-]+$/;
const MAX_READ_BYTES = 2 * 1024 * 1024;

export interface RepoRef {
  /** Display slug = directory basename. */
  slug: string;
  /** Absolute, realpath-resolved repo root. */
  root: string;
}

/** Enumerate git repos under the resolved roots (basename = slug). Cached 30s. */
export async function listRepos(): Promise<RepoRef[]> {
  return cached("wsfs:repos", 30_000, async () => {
    const roots = await resolvedRepoRoots();
    const found: RepoRef[] = [];
    for (const root of roots) {
      let entries: string[] = [];
      try {
        entries = await fs.readdir(root);
      } catch {
        continue; // root may not exist on every box
      }
      for (const name of entries) {
        const dir = path.join(root, name);
        try {
          const st = await fs.stat(path.join(dir, ".git"));
          if (!st) continue;
        } catch {
          continue; // not a git repo
        }
        let real = dir;
        try {
          real = await fs.realpath(dir);
        } catch {
          /* keep dir */
        }
        // Slug collisions across roots: first wins, suffix the rest.
        let slug = name;
        if (found.some((r) => r.slug === slug)) {
          slug = `${name}~${path.basename(root)}`;
        }
        found.push({ slug, root: real });
      }
    }
    found.sort((a, b) => a.slug.localeCompare(b.slug));
    return found;
  });
}

export async function resolveRepo(slug: string): Promise<RepoRef | null> {
  const repos = await listRepos();
  return repos.find((r) => r.slug === slug) ?? null;
}

/**
 * Resolve a repo-relative path to an absolute path guaranteed to stay inside
 * the repo root. Throws on escape. Empty/"." → the root itself.
 */
export async function resolveInRepo(
  repoRoot: string,
  relPath: string,
): Promise<string> {
  const clean = (relPath ?? "").replace(/^[/\\]+/, "");
  const abs = path.resolve(repoRoot, clean);
  const rootWithSep = repoRoot.endsWith(path.sep)
    ? repoRoot
    : repoRoot + path.sep;
  if (abs !== repoRoot && !abs.startsWith(rootWithSep)) {
    throw new Error("path escapes repo root");
  }
  // Defeat symlink escapes: if the target exists, its realpath must also be
  // inside the root. (Non-existent targets — e.g. a new file — are fine.)
  try {
    const real = await fs.realpath(abs);
    if (real !== repoRoot && !real.startsWith(rootWithSep)) {
      throw new Error("path escapes repo root via symlink");
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw e;
  }
  return abs;
}

// ---------------------------------------------------------------------------
// Git: branches, worktrees, base, diff stats
// ---------------------------------------------------------------------------

async function git(root: string, args: string[], timeoutMs = 8000) {
  return runFile("git", args, { cwd: root, timeoutMs });
}

/** Detect the base branch: origin/HEAD target, else main, else master, else null. */
async function detectBase(root: string): Promise<string | null> {
  const head = await git(root, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (head.ok) {
    const ref = head.stdout.trim().replace(/^origin\//, "");
    if (ref) return ref;
  }
  for (const cand of ["main", "master"]) {
    const r = await git(root, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${cand}`,
    ]);
    if (r.ok) return cand;
  }
  return null;
}

interface WorktreeInfo {
  path: string;
  branch: string | null;
}

async function listWorktrees(root: string): Promise<WorktreeInfo[]> {
  const r = await git(root, ["worktree", "list", "--porcelain"]);
  if (!r.ok) return [];
  const out: WorktreeInfo[] = [];
  let cur: Partial<WorktreeInfo> = {};
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (cur.path) out.push({ path: cur.path, branch: cur.branch ?? null });
      cur = { path: line.slice("worktree ".length).trim(), branch: null };
    } else if (line.startsWith("branch ")) {
      cur.branch = line
        .slice("branch ".length)
        .trim()
        .replace(/^refs\/heads\//, "");
    } else if (line === "" && cur.path) {
      out.push({ path: cur.path, branch: cur.branch ?? null });
      cur = {};
    }
  }
  if (cur.path) out.push({ path: cur.path, branch: cur.branch ?? null });
  return out;
}

export async function repoSummary(ref: RepoRef): Promise<RepoSummary> {
  const [branchesR, currentR, base, worktrees] = await Promise.all([
    git(ref.root, [
      "for-each-ref",
      "--sort=-committerdate",
      "--format=%(refname:short)",
      "refs/heads",
    ]),
    git(ref.root, ["rev-parse", "--abbrev-ref", "HEAD"]),
    detectBase(ref.root),
    listWorktrees(ref.root),
  ]);

  const current = currentR.ok ? currentR.stdout.trim() : null;
  const branchNames = branchesR.ok
    ? branchesR.stdout.split("\n").map((s) => s.trim()).filter(Boolean)
    : [];

  // Map branch -> checked-out working tree path (primary or linked worktree).
  const treeByBranch = new Map<string, string>();
  for (const wt of worktrees) {
    if (wt.branch) treeByBranch.set(wt.branch, wt.path);
  }

  const workspaces: Workspace[] = branchNames.map((name) => {
    const wtPath = treeByBranch.get(name);
    const isCurrent = name === current;
    const isLinkedWorktree = !!wtPath && wtPath !== ref.root;
    return {
      name,
      type: isLinkedWorktree ? "worktree" : "branch",
      // Non-checked-out branches fall back to the primary tree so the
      // Editor/Terminal still have a real cwd (no mobile checkout in v1).
      path: wtPath ?? ref.root,
      isCurrent,
      checkedOut: !!wtPath,
    };
  });

  // Surface the current branch first, then most-recent.
  workspaces.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));

  return {
    slug: ref.slug,
    root: ref.root,
    currentBranch: current,
    base,
    workspaces,
  };
}

export interface CreateWorktreeResult {
  branch: string;
  path: string;
  created: boolean;
  base: string | null;
}

/**
 * Create a git worktree for `branch`, checked out at a sibling path
 * `<repo>-worktrees/<safe-branch>`. If the branch already exists it is checked
 * out; otherwise it is created from `from` (defaults to the detected base).
 * Everything runs via execFile argv — no client value touches a shell.
 */
export async function createWorktree(
  ref: RepoRef,
  branch: string,
  from?: string,
): Promise<CreateWorktreeResult> {
  if (!SAFE_BRANCH.test(branch)) {
    throw new Error("invalid branch name");
  }
  if (from && !SAFE_BRANCH.test(from)) {
    throw new Error("invalid base ref");
  }

  const base = await detectBase(ref.root);
  const startPoint = from || base || "HEAD";

  // Already has a worktree for this branch? Return it.
  const existing = await listWorktrees(ref.root);
  const match = existing.find((w) => w.branch === branch);
  if (match) {
    return { branch, path: match.path, created: false, base };
  }

  const safeDir = branch.replace(/[/\\]+/g, "-").replace(/[^\w.-]+/g, "_");
  const parent = `${ref.root}-worktrees`;
  const dest = path.join(parent, safeDir);
  await fs.mkdir(parent, { recursive: true });

  // Does the branch ref already exist locally?
  const hasBranch = await git(ref.root, [
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${branch}`,
  ]);

  const args = hasBranch.ok
    ? ["worktree", "add", dest, branch]
    : ["worktree", "add", "-b", branch, dest, startPoint];

  const r = await git(ref.root, args, 20000);
  if (!r.ok) {
    throw new Error(r.stderr.trim() || "git worktree add failed");
  }
  return { branch, path: dest, created: true, base };
}

function sumNumstat(stdout: string): { adds: number; dels: number; files: number } {
  let adds = 0;
  let dels = 0;
  let files = 0;
  for (const line of stdout.split("\n")) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t/);
    if (!m) continue;
    files += 1;
    if (m[1] !== "-") adds += parseInt(m[1], 10);
    if (m[2] !== "-") dels += parseInt(m[2], 10);
  }
  return { adds, dels, files };
}

/**
 * Real `git diff --numstat` stats for a workspace: commits that branch adds vs
 * the repo base (base...branch), plus uncommitted working changes when it is
 * the checked-out branch. Cached 20s per (repo, branch).
 */
export async function diffStat(
  ref: RepoRef,
  branch: string,
): Promise<DiffStat> {
  if (!SAFE_BRANCH.test(branch)) {
    return { adds: 0, dels: 0, files: 0, includesWorking: false };
  }
  return cached(`wsfs:stat:${ref.root}:${branch}`, 20_000, async () => {
    const base = await detectBase(ref.root);
    const current = (
      await git(ref.root, ["rev-parse", "--abbrev-ref", "HEAD"])
    ).stdout.trim();

    let adds = 0;
    let dels = 0;
    let files = 0;

    if (base && base !== branch) {
      const committed = await git(ref.root, [
        "diff",
        "--numstat",
        `${base}...${branch}`,
      ]);
      if (committed.ok) {
        const s = sumNumstat(committed.stdout);
        adds += s.adds;
        dels += s.dels;
        files += s.files;
      }
    }

    let includesWorking = false;
    if (branch === current) {
      const working = await git(ref.root, ["diff", "--numstat", "HEAD"]);
      if (working.ok && working.stdout.trim()) {
        const s = sumNumstat(working.stdout);
        adds += s.adds;
        dels += s.dels;
        files += s.files;
        includesWorking = true;
      }
    }

    return { adds, dels, files, includesWorking };
  });
}

// ---------------------------------------------------------------------------
// File tree + read/write
// ---------------------------------------------------------------------------

export async function listDir(
  repoRoot: string,
  relPath: string,
): Promise<TreeEntry[]> {
  const abs = await resolveInRepo(repoRoot, relPath);
  const dirents = await fs.readdir(abs, { withFileTypes: true });
  const entries: TreeEntry[] = [];
  for (const d of dirents) {
    if (d.name.startsWith(".") && d.name !== ".env.example") {
      if (TREE_IGNORE.has(d.name)) continue;
    }
    if (TREE_IGNORE.has(d.name)) continue;
    const isDir = d.isDirectory();
    if (!isDir && !d.isFile() && !d.isSymbolicLink()) continue;
    const rel = path.posix.join(
      relPath.replace(/^[/\\]+/, "").split(path.sep).join("/"),
      d.name,
    );
    entries.push({ name: d.name, path: rel, type: isDir ? "dir" : "file" });
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

export async function readFileSafe(
  repoRoot: string,
  relPath: string,
): Promise<ReadResult> {
  const abs = await resolveInRepo(repoRoot, relPath);
  const st = await fs.stat(abs);
  if (!st.isFile()) throw new Error("not a file");
  if (st.size > MAX_READ_BYTES) {
    return { path: relPath, binary: false, tooLarge: true, size: st.size, content: null };
  }
  const buf = await fs.readFile(abs);
  // Binary heuristic: a NUL byte in the first 8KB.
  const probe = buf.subarray(0, 8192);
  const binary = probe.includes(0);
  return {
    path: relPath,
    binary,
    tooLarge: false,
    size: st.size,
    content: binary ? null : buf.toString("utf8"),
  };
}

export async function writeFileSafe(
  repoRoot: string,
  relPath: string,
  content: string,
): Promise<{ bytes: number }> {
  const abs = await resolveInRepo(repoRoot, relPath);
  // Refuse to clobber a directory.
  try {
    const st = await fs.stat(abs);
    if (st.isDirectory()) throw new Error("target is a directory");
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw e;
  }
  await fs.writeFile(abs, content, "utf8");
  return { bytes: Buffer.byteLength(content, "utf8") };
}

// ---------------------------------------------------------------------------
// Git: working-tree changes (the source-control "Changes" panel)
// ---------------------------------------------------------------------------

export interface ChangeEntry {
  path: string;
  /** Single-letter status: M, A, D, R, C, ?, U. */
  status: string;
  staged: boolean;
  adds: number | null;
  dels: number | null;
}

export interface ChangesResult {
  branch: string | null;
  ahead: number;
  behind: number;
  entries: ChangeEntry[];
}

/** Parse `git status --porcelain=v1 -b -z` + `git diff --numstat` into a flat
 *  change list for the Changes panel. Read-only; argv-only (no shell). */
export async function listChanges(root: string): Promise<ChangesResult> {
  const [statusR, numR, numStagedR] = await Promise.all([
    git(root, ["status", "--porcelain=v1", "-b", "-z"]),
    git(root, ["diff", "--numstat", "-z"]),
    git(root, ["diff", "--numstat", "-z", "--cached"]),
  ]);

  // numstat: "adds\tdels\tpath\0" repeated.
  const parseNum = (out: string): Map<string, [number, number]> => {
    const m = new Map<string, [number, number]>();
    for (const rec of out.split("\0")) {
      if (!rec) continue;
      const t = rec.split("\t");
      if (t.length < 3) continue;
      const adds = t[0] === "-" ? 0 : Number(t[0]);
      const dels = t[1] === "-" ? 0 : Number(t[1]);
      m.set(t[2], [adds, dels]);
    }
    return m;
  };
  const numUnstaged = numR.ok ? parseNum(numR.stdout) : new Map();
  const numStaged = numStagedR.ok ? parseNum(numStagedR.stdout) : new Map();

  let branch: string | null = null;
  let ahead = 0;
  let behind = 0;
  const entries: ChangeEntry[] = [];

  if (statusR.ok) {
    const recs = statusR.stdout.split("\0");
    for (const rec of recs) {
      if (!rec) continue;
      if (rec.startsWith("## ")) {
        // "## branch...origin/branch [ahead 1, behind 2]"
        const head = rec.slice(3);
        branch = head.split(/\.\.\.|\s/)[0] || null;
        const a = head.match(/ahead (\d+)/);
        const b = head.match(/behind (\d+)/);
        if (a) ahead = Number(a[1]);
        if (b) behind = Number(b[1]);
        continue;
      }
      const x = rec[0];
      const y = rec[1];
      const path = rec.slice(3);
      const staged = x !== " " && x !== "?";
      const code = (staged ? x : y) || "?";
      const num = (staged ? numStaged : numUnstaged).get(path) ?? null;
      entries.push({
        path,
        status: code === "?" ? "?" : code,
        staged,
        adds: num ? num[0] : null,
        dels: num ? num[1] : null,
      });
    }
  }

  return { branch, ahead, behind, entries };
}
