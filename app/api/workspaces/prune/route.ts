import { NextResponse } from "next/server";
import { resolveRepo, pruneWorkspace } from "@/lib/workspace-fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Prune a stale workspace entry (worktree or branch). Body:
 *   { repo: <slug>, name: <branch/worktree name>, force?: boolean }
 * Safe (force=false): worktree removed only if clean, branch deleted only if
 * merged into base. force=true bypasses (UI gates it behind a confirm). Base
 * and checked-out branches are always protected.
 */
export async function POST(req: Request) {
  let body: { repo?: string; name?: string; force?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { repo, name, force } = body;
  if (!repo || !name) {
    return NextResponse.json({ error: "repo and name required" }, { status: 400 });
  }
  const ref = await resolveRepo(repo);
  if (!ref) {
    return NextResponse.json({ error: "unknown repo" }, { status: 404 });
  }
  try {
    const result = await pruneWorkspace(ref, name, !!force);
    if (!result.ok) {
      // 409 = refused on safety grounds (caller may retry with force); 500 =
      // git itself failed.
      const status = result.safe === false ? 409 : 500;
      return NextResponse.json(result, { status });
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "prune failed" },
      { status: 500 },
    );
  }
}
