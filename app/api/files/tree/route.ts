import { NextResponse } from "next/server";
import { resolveRepo, listDir } from "@/lib/workspace-fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One directory level of the active repo's tree (lazy expand). */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const repo = searchParams.get("repo");
  const dir = searchParams.get("path") ?? "";
  if (!repo) {
    return NextResponse.json({ error: "repo required" }, { status: 400 });
  }
  const ref = await resolveRepo(repo);
  if (!ref) {
    return NextResponse.json({ error: "unknown repo" }, { status: 404 });
  }
  try {
    const entries = await listDir(ref.root, dir);
    return NextResponse.json({ path: dir, entries });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "tree failed" },
      { status: 400 },
    );
  }
}
