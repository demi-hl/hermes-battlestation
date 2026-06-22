import { acpBridge } from "@/lib/acp-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CancelRequest {
  sessionId?: string;
  /** Profile that owns the session (default unless cross-profile). */
  profile?: string;
}

/**
 * Cancel the in-flight agent turn for a CONTINUED session (the SessionReader
 * resume path). The client's fetch-abort only tears down the HTTP stream; the
 * ACP turn keeps running on the agent until it receives session/cancel. Unlike
 * the chat cancel (which fans across a repo's bridges), a continued session is
 * driven by promptSession(sessionId) on one profile's bridge, so we cancel that
 * exact session id on that profile's bridge. Best-effort.
 */
export async function POST(req: Request) {
  let body: CancelRequest;
  try {
    body = (await req.json()) as CancelRequest;
  } catch {
    return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const sessionId = (body.sessionId ?? "").trim();
  if (!sessionId) return Response.json({ ok: false, error: "sessionId required" }, { status: 400 });
  const profile = (body.profile || "default").trim() || "default";
  const bridge = acpBridge({ profile });
  const cancelled = await bridge.cancelBySessionId(sessionId);
  return Response.json({ ok: true, cancelled });
}
