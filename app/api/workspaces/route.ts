import { NextResponse } from "next/server";
import { run } from "@/lib/exec";
import { cached } from "@/lib/cache";
import { listRepos, repoSummary } from "@/lib/workspace-fs";
import type { WorkspacesResponse } from "@/lib/workspace-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Conductor-style workspace list: the GitHub identity (real `gh api user`) plus
 * every local git repo under the allowlist, each expanded into its branches /
 * worktrees. Diff stats are fetched lazily per branch via /api/workspaces/stat
 * so this stays fast (no per-branch git diff on first paint). Cached 15s.
 */
export async function GET() {
  const body: WorkspacesResponse = await cached("ws:list", 15_000, async () => {
    const [login, repos] = await Promise.all([
      ghLogin(),
      (async () => {
        const refs = await listRepos();
        return Promise.all(refs.map((r) => repoSummary(r)));
      })(),
    ]);
    return { login, repos, fetchedAt: new Date().toISOString() };
  });
  return NextResponse.json(body);
}

async function ghLogin(): Promise<string | null> {
  return cached("ws:login", 5 * 60_000, async () => {
    const r = await run("gh api user --jq .login", { timeoutMs: 8000 });
    if (!r.ok) return null;
    const login = r.stdout.trim();
    return login || null;
  });
}
