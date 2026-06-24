import { NextResponse } from "next/server";
import {
  normalizeProfileName,
  readProfileTranscript,
  validSessionId,
} from "@/lib/profile-sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only transcript for a session in any profile's store.
 * Query: ?profile=<name>&id=<sessionId>
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const profile = normalizeProfileName(url.searchParams.get("profile"));
  const id = url.searchParams.get("id");
  if (!profile) {
    return NextResponse.json({ messages: [], error: "bad profile" }, { status: 400 });
  }
  if (!validSessionId(id)) {
    return NextResponse.json({ messages: [], error: "bad id" }, { status: 400 });
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
