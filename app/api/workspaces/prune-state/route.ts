import { NextResponse } from "next/server";
import { resolveRepo, pruneStates } from "@/lib/workspace-fs";
import { cached } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-workspace prune safety for a repo: which branches/worktrees are safe to
 * prune (clean worktree / merged branch) vs protected (base, checked-out,
 * dirty, unmerged). The ReposPane fetches this on expand to gate the
 * swipe-to-prune action. Read-only. Query: ?repo=<slug>. Cached 20s.
 */
export async function GET(req: Request) {
  const repo = new URL(req.url).searchParams.get("repo");
  if (!repo) {
    return NextResponse.json({ error: "repo required" }, { status: 400 });
  }
  const ref = await resolveRepo(repo);
  if (!ref) {
    return NextResponse.json({ error: "unknown repo" }, { status: 404 });
  }
  try {
    const states = await cached(`ws:prune:${ref.root}`, 20_000, () => pruneStates(ref));
    return NextResponse.json({ repo, states, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "prune-state failed" },
      { status: 500 },
    );
  }
}
