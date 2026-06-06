import { runFile } from "@/lib/run-file";
import { cached } from "@/lib/cache";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

/**
 * Shared-vault git layer. The Obsidian vault is a git repo that every fleet
 * agent commits notes into and pushes to a common remote (GitHub is the hub);
 * each box pulls to sync. This module reports that repo's state and drives
 * pull / commit-all / push — the three operations the sync pane needs.
 *
 * Vault path resolution: OBSIDIAN_VAULT_PATH, else "$HOME/Obsidian Vault".
 * No secrets, no hardcoded user paths.
 */

export function vaultPath(): string {
  return process.env.OBSIDIAN_VAULT_PATH ?? path.join(os.homedir(), "Obsidian Vault");
}

async function git(args: string[], timeoutMs = 12000) {
  return runFile("git", args, { cwd: vaultPath(), timeoutMs });
}

export interface VaultAuthor {
  name: string;
  commits: number;
  lastIso: string | null;
}

export interface VaultCommit {
  sha: string;
  author: string;
  subject: string;
  iso: string;
}

export interface VaultStatus {
  configured: boolean;
  isRepo: boolean;
  branch: string | null;
  remote: string | null;
  ahead: number;
  behind: number;
  dirty: number;
  /** Distinct commit authors = the agents/machines that write to the vault. */
  authors: VaultAuthor[];
  recent: VaultCommit[];
  error?: string;
}

export async function vaultStatus(): Promise<VaultStatus> {
  return cached("vault:status", 10_000, async () => {
    const root = vaultPath();
    const base: VaultStatus = {
      configured: !!process.env.OBSIDIAN_VAULT_PATH,
      isRepo: false,
      branch: null,
      remote: null,
      ahead: 0,
      behind: 0,
      dirty: 0,
      authors: [],
      recent: [],
    };

    try {
      const st = await fs.stat(path.join(root, ".git"));
      if (!st) return { ...base, error: "vault is not a git repo" };
    } catch {
      return { ...base, error: "vault path has no .git (set OBSIDIAN_VAULT_PATH)" };
    }
    base.isRepo = true;

    const branchR = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
    base.branch = branchR.ok ? branchR.stdout.trim() : null;

    const remoteR = await git(["remote", "get-url", "origin"]);
    if (remoteR.ok) {
      // Strip any embedded credentials before exposing the remote.
      base.remote = remoteR.stdout
        .trim()
        .replace(/\/\/[^@/]+@/, "//");
    }

    const dirtyR = await git(["status", "--porcelain"]);
    base.dirty = dirtyR.ok
      ? dirtyR.stdout.split("\n").filter((l) => l.trim()).length
      : 0;

    // ahead/behind vs upstream (best-effort; no upstream = zeros).
    const countsR = await git([
      "rev-list",
      "--left-right",
      "--count",
      "@{upstream}...HEAD",
    ]);
    if (countsR.ok) {
      const m = countsR.stdout.trim().split(/\s+/);
      if (m.length === 2) {
        base.behind = Number(m[0]) || 0;
        base.ahead = Number(m[1]) || 0;
      }
    }

    // Distinct authors over the last 200 commits = the contributing agents.
    const authorsR = await git([
      "log",
      "-200",
      "--format=%an\t%aI",
    ]);
    if (authorsR.ok) {
      const map = new Map<string, VaultAuthor>();
      for (const line of authorsR.stdout.split("\n")) {
        if (!line.trim()) continue;
        const [name, iso] = line.split("\t");
        const a = map.get(name) ?? { name, commits: 0, lastIso: null };
        a.commits += 1;
        if (!a.lastIso || (iso && iso > a.lastIso)) a.lastIso = iso ?? a.lastIso;
        map.set(name, a);
      }
      base.authors = [...map.values()].sort((x, y) => y.commits - x.commits);
    }

    const recentR = await git([
      "log",
      "-12",
      "--format=%h\t%an\t%aI\t%s",
    ]);
    if (recentR.ok) {
      base.recent = recentR.stdout
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => {
          const [sha, author, iso, ...rest] = l.split("\t");
          return { sha, author, iso, subject: rest.join("\t") };
        });
    }

    return base;
  });
}

export interface SyncResult {
  ok: boolean;
  step: "pull" | "commit" | "push";
  message: string;
}

/**
 * Sync the vault: pull --rebase, optionally commit all local changes with a
 * machine-attributed message, then push. Stops and reports at the first failure
 * (e.g. a rebase conflict) so the user can resolve in the editor.
 */
export async function vaultSync(commitMessage?: string): Promise<SyncResult[]> {
  const steps: SyncResult[] = [];
  const machine = os.hostname().split(".")[0];

  const pull = await git(["pull", "--rebase", "--autostash"], 30000);
  steps.push({
    ok: pull.ok,
    step: "pull",
    message: pull.ok ? "pulled" : pull.stderr.trim().split("\n")[0] || "pull failed",
  });
  if (!pull.ok) return steps;

  const dirty = await git(["status", "--porcelain"]);
  if (dirty.ok && dirty.stdout.trim()) {
    const add = await git(["add", "-A"]);
    if (!add.ok) {
      steps.push({ ok: false, step: "commit", message: "git add failed" });
      return steps;
    }
    const msg = commitMessage?.trim() || `vault sync from ${machine}`;
    const commit = await git(["commit", "-m", msg], 15000);
    steps.push({
      ok: commit.ok,
      step: "commit",
      message: commit.ok ? msg : commit.stderr.trim().split("\n")[0] || "commit failed",
    });
    if (!commit.ok) return steps;
  } else {
    steps.push({ ok: true, step: "commit", message: "nothing to commit" });
  }

  const push = await git(["push"], 30000);
  steps.push({
    ok: push.ok,
    step: "push",
    message: push.ok ? "pushed" : push.stderr.trim().split("\n")[0] || "push failed",
  });
  return steps;
}
