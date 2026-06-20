import { NextResponse } from "next/server";
import { readProfileTranscript } from "@/lib/profile-sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only transcript for a session in any profile's store.
 * Query: ?profile=<name>&id=<sessionId>
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const profile = url.searchParams.get("profile") || "default";
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ messages: [], error: "id required" }, { status: 400 });
  }
  try {
    const messages = await readProfileTranscript(profile, id);
    return NextResponse.json({ messages });
  } catch (e) {
    return NextResponse.json(
      { messages: [], error: e instanceof Error ? e.message : "failed" },
      { status: 200 },
    );
  }
}
