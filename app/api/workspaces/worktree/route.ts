import { NextResponse } from "next/server";
import { resolveRepo, createWorktree } from "@/lib/workspace-fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create (or check out) a git worktree for a branch in a repo. Body:
 *   { repo: <slug>, branch: <name>, from?: <base ref> }
 * The branch is created from `from` (or the repo base) when it does not exist,
 * checked out at a sibling `<repo>-worktrees/<branch>` path. Git runs via argv.
 */
export async function POST(req: Request) {
  let body: { repo?: string; branch?: string; from?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { repo, branch, from } = body;
  if (!repo || !branch) {
    return NextResponse.json(
      { error: "repo and branch required" },
      { status: 400 },
    );
  }
  const ref = await resolveRepo(repo);
  if (!ref) {
    return NextResponse.json({ error: "unknown repo" }, { status: 404 });
  }
  try {
    const result = await createWorktree(ref, branch, from);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "worktree create failed" },
      { status: 500 },
    );
  }
}
