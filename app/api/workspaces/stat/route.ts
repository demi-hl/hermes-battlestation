import { NextResponse } from "next/server";
import { resolveRepo, diffStat } from "@/lib/workspace-fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lazy real diff stats for one workspace, fetched when a repo row is expanded:
 * `git diff --numstat base...branch` plus uncommitted working changes for the
 * checked-out branch. Cached 20s in the fs layer.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const repo = searchParams.get("repo");
  const branch = searchParams.get("branch");
  if (!repo || !branch) {
    return NextResponse.json({ error: "repo and branch required" }, { status: 400 });
  }
  const ref = await resolveRepo(repo);
  if (!ref) {
    return NextResponse.json({ error: "unknown repo" }, { status: 404 });
  }
  try {
    const stat = await diffStat(ref, branch);
    return NextResponse.json(stat);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "stat failed" },
      { status: 500 },
    );
  }
}
