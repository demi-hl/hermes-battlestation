import { NextResponse } from "next/server";
import { resolveRepo, writeFileSafe } from "@/lib/workspace-fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Write a file back to disk in the active repo (save). */
export async function POST(req: Request) {
  let payload: { repo?: string; path?: string; content?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { repo, path: filePath, content } = payload;
  if (!repo || !filePath || typeof content !== "string") {
    return NextResponse.json(
      { error: "repo, path and content required" },
      { status: 400 },
    );
  }
  const ref = await resolveRepo(repo);
  if (!ref) {
    return NextResponse.json({ error: "unknown repo" }, { status: 404 });
  }
  try {
    const { bytes } = await writeFileSafe(ref.root, filePath, content);
    return NextResponse.json({ ok: true, bytes });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "write failed" },
      { status: 400 },
    );
  }
}
