import { cancelAllForRepo } from "@/lib/acp-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CancelRequest {
  repo?: string;
}

/**
 * Cancel the in-flight agent turn for a repo's thread.
 *
 * The client's fetch-abort only tears down the HTTP stream; the ACP turn keeps
 * running on the agent until it receives session/cancel. The client does not
 * know which profile ran the turn, so we fan the cancel across every warm
 * bridge for that repo (cancelAllForRepo). Best-effort: returns the count of
 * bridges that had a live session.
 */
export async function POST(req: Request) {
  let body: CancelRequest;
  try {
    body = (await req.json()) as CancelRequest;
  } catch {
    return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const repo = (body.repo ?? "general").trim() || "general";
  const cancelled = await cancelAllForRepo(repo);
  return Response.json({ ok: true, cancelled });
}
