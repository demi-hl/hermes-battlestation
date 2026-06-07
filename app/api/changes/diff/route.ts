import { NextResponse } from "next/server";
import { resolveRepo, getFileDiff } from "@/lib/workspace-fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Unified diff text for one file in the active repo. Read-only. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const repo = url.searchParams.get("repo") ?? "";
  const path = url.searchParams.get("path") ?? "";
  const staged = url.searchParams.get("staged") === "1";
  if (!repo || !path) {
    return NextResponse.json({ error: "repo and path required" }, { status: 400 });
  }
  const ref = await resolveRepo(repo);
  if (!ref) {
    return NextResponse.json({ error: "unknown repo" }, { status: 404 });
  }
  try {
    const diff = await getFileDiff(ref.root, path, staged);
    return NextResponse.json(diff);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "diff failed" },
      { status: 500 },
    );
  }
}
