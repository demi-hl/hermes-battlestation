import { NextResponse } from "next/server";
import { resolveRepo, listChanges } from "@/lib/workspace-fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Working-tree changes for the active repo's source-control panel. Read-only. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const repo = url.searchParams.get("repo") ?? "";
  if (!repo) {
    return NextResponse.json({ error: "repo required" }, { status: 400 });
  }
  const ref = await resolveRepo(repo);
  if (!ref) {
    return NextResponse.json({ error: "unknown repo" }, { status: 404 });
  }
  try {
    const changes = await listChanges(ref.root);
    return NextResponse.json(changes);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "changes failed" },
      { status: 500 },
    );
  }
}
