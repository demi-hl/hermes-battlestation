import { resolveRepoCwd } from "@/lib/local-repos";
import { sessionTitleFor } from "@/lib/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface NewSessionRequest {
  repo?: string;
}

/**
 * Hand the client a fresh thread title to switch to for a repo.
 *
 * The ACP bridge creates the underlying session lazily on the first prompt (see
 * app/api/chat/send), so there is nothing to spawn here. This route just
 * resolves the repo to a safe cwd (rejecting unknown repos) and returns the
 * canonical `lol-<slug>` title via sessionTitleFor so the client can switch to
 * the new thread immediately. Minimal by design.
 */
export async function POST(req: Request) {
  let body: NewSessionRequest;
  try {
    body = (await req.json()) as NewSessionRequest;
  } catch {
    return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  }

  const repo = (body.repo ?? "general").trim() || "general";
  const cwd = await resolveRepoCwd(repo);
  if (!cwd) {
    return Response.json({ ok: false, error: "unknown repo" }, { status: 404 });
  }

  const title = sessionTitleFor(repo);
  return Response.json({ ok: true, title, repo, cwd });
}
