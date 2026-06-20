import { NextResponse } from "next/server";
import {
  querySessionById,
  querySessionByTitle,
  readBridgeSessions,
  resolveBridgeId,
  sessionTitleForBranch,
} from "@/lib/sessions";
import { readSessionTranscript } from "@/lib/transcript";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Backend-truth transcript for a thread. The iOS app paints from its localStorage
 * cache for instant load, then hydrates from THIS endpoint so the history shown
 * is always the real shared session (replayed from ~/.hermes/state.db), not a
 * per-device copy. A fresh device / cleared phone therefore still shows the full
 * conversation, because the durable history lives on the backend.
 *
 * Resolution order: the ACP bridge map (`lo-acp-sessions*.json`) is the real
 * registry of which session id backs a thread (the ACP path auto-titles the row
 * and never writes a `lol-*` DB title), so we resolve the id from the map first
 * and fall back to the legacy title lookup only if the map has no entry.
 *
 * Query: ?repo=<name|general>&branch=<branch?>
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const repo = url.searchParams.get("repo") || "general";
  const branch = url.searchParams.get("branch") || null;

  try {
    const bridgeId = resolveBridgeId(readBridgeSessions(), repo, branch);
    const row = bridgeId
      ? await querySessionById(bridgeId)
      : await querySessionByTitle(sessionTitleForBranch(repo, branch));
    if (!row?.id) {
      return NextResponse.json({ messages: [], sessionId: null });
    }
    const messages = await readSessionTranscript(row.id);
    return NextResponse.json({ messages, sessionId: row.id });
  } catch (e) {
    return NextResponse.json(
      { messages: [], sessionId: null, error: e instanceof Error ? e.message : "failed" },
      { status: 200 },
    );
  }
}
