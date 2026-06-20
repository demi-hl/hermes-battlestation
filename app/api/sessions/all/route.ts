import { NextResponse } from "next/server";
import {
  listProfiles,
  listSessionsForProfile,
  DEFAULT_PROFILE,
} from "@/lib/profile-sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only cross-profile session browser. Without ?profile, returns the list
 * of profiles (with counts) so the UI can render the chip filter. With
 * ?profile=<name>, returns that profile's non-archived sessions, newest first.
 * These are read-only — not resumable in chat (the chat bridge runs default).
 */
export async function GET(req: Request) {
  const fetchedAt = new Date().toISOString();
  const profile = new URL(req.url).searchParams.get("profile");
  try {
    if (!profile) {
      const profiles = await listProfiles();
      return NextResponse.json({ profiles, fetchedAt });
    }
    const sessions = await listSessionsForProfile(profile);
    return NextResponse.json({ profile, sessions, fetchedAt });
  } catch (e) {
    return NextResponse.json(
      {
        profiles: [{ name: DEFAULT_PROFILE, count: 0 }],
        sessions: [],
        fetchedAt,
        error: e instanceof Error ? e.message : "failed",
      },
      { status: 200 },
    );
  }
}
