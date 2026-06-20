// Server-side local-repo discovery for the chat hub. This is intentionally
// minimal: it lists the git repos under the scan roots so the chat hub can bind
// a session per repo and resolve a repo name to its cwd. It is NOT the
// Conductor workspace sidebar (slice 3 owns that, with branch counts + diff
// stats); the chat hub only needs name + path + current branch to bind a
// thread. Keeping a separate, tiny lister avoids colliding with slice 3.

import { promises as fs } from "node:fs";
import path from "node:path";
import { run } from "./exec";
import { cached } from "./cache";
import { REPO_ROOTS, GENERAL_THREAD_ID, GENERAL_CWD } from "./sessions";
import { resolveRepo, repoSummary } from "./workspace-fs";
import type { ChatRepo } from "./chat-types";

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    const st = await fs.stat(path.join(dir, ".git"));
    return st.isDirectory() || st.isFile(); // worktrees use a .git file
  } catch {
    return false;
  }
}

async function currentBranch(dir: string): Promise<string | null> {
  const r = await run(`git -C ${shellQuote(dir)} rev-parse --abbrev-ref HEAD`, {
    timeoutMs: 5000,
  });
  if (!r.ok) return null;
  const b = r.stdout.trim();
  return b && b !== "HEAD" ? b : b === "HEAD" ? "detached" : null;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Discover bindable repos under the scan roots (cached ~30s). */
export async function listLocalRepos(): Promise<ChatRepo[]> {
  return cached("chat-local-repos", 30_000, async () => {
    const found: ChatRepo[] = [];
    for (const root of REPO_ROOTS) {
      let entries: string[];
      try {
        entries = await fs.readdir(root);
      } catch {
        continue;
      }
      for (const name of entries) {
        const dir = path.join(root, name);
        try {
          const st = await fs.stat(dir);
          if (!st.isDirectory()) continue;
        } catch {
          continue;
        }
        if (!(await isGitRepo(dir))) continue;
        found.push({ name, path: dir, branch: await currentBranch(dir) });
      }
    }
    found.sort((a, b) => a.name.localeCompare(b.name));
    return found;
  });
}

/** Resolve a repo NAME to a safe absolute cwd. Returns null for unknown names
 *  (never trusts a client-supplied path — the cwd is always derived here). */
export async function resolveRepoCwd(repo: string): Promise<string | null> {
  if (!repo || repo === GENERAL_THREAD_ID) return GENERAL_CWD;
  const repos = await listLocalRepos();
  const hit = repos.find((r) => r.name === repo);
  return hit ? hit.path : null;
}

/** Resolve (repo, branch) to the safe absolute cwd of that branch's checkout
 *  (its worktree path, or the repo root for the base/primary branch). The path
 *  is always derived server-side from the live worktree enumeration — a
 *  client-supplied path is never trusted. Falls back to the repo root when the
 *  branch has no dedicated worktree. Returns null for an unknown repo. */
export async function resolveBranchCwd(
  repo: string,
  branch: string | null | undefined,
): Promise<string | null> {
  const root = await resolveRepoCwd(repo);
  if (!root || !branch || repo === GENERAL_THREAD_ID) return root;
  const ref = await resolveRepo(repo);
  if (!ref) return root;
  try {
    const summary = await repoSummary(ref);
    const ws = summary.workspaces.find((w) => w.name === branch);
    return ws?.path ?? root;
  } catch {
    return root;
  }
}
