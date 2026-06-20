import { NextResponse } from "next/server";
import { isLocked, sessionTitleForBranch } from "@/lib/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Is a durable turn still running on the host for this thread? Durable turns
 * keep running when the app is backgrounded (the send route no longer cancels
 * on disconnect), so the client polls this on foreground to RECONNECT to a
 * running turn instead of firing a fresh send that collides with the lock.
 *
 * Query: ?repo=<name|general>&branch=<branch?>
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const repo = url.searchParams.get("repo") || "general";
  const branch = url.searchParams.get("branch") || null;
  const title = sessionTitleForBranch(repo, branch);
  return NextResponse.json({ running: isLocked(title) });
}
