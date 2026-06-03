import { NextResponse } from "next/server";
import { resolveRepo, readFileSafe } from "@/lib/workspace-fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read one file from the active repo (text only; binary/oversize flagged). */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const repo = searchParams.get("repo");
  const filePath = searchParams.get("path");
  if (!repo || !filePath) {
    return NextResponse.json({ error: "repo and path required" }, { status: 400 });
  }
  const ref = await resolveRepo(repo);
  if (!ref) {
    return NextResponse.json({ error: "unknown repo" }, { status: 404 });
  }
  try {
    const result = await readFileSafe(ref.root, filePath);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "read failed" },
      { status: 400 },
    );
  }
}
