import { NextResponse } from "next/server";
import { run } from "@/lib/exec";
import type { ApiEnvelope } from "@/lib/types";
import type { KanbanTaskDetail } from "@/lib/kanban/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Task ids are short slugs (e.g. "t_7e25428b"). Validate before interpolating
// into the shell command so no client input can break out of the argument.
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const now = new Date().toISOString();
  if (!ID_RE.test(id)) {
    const bad: ApiEnvelope<null> = { data: null, fetchedAt: now, error: "invalid task id" };
    return NextResponse.json(bad, { status: 400 });
  }

  const r = await run(`hermes kanban show ${id} --json`, { timeoutMs: 12000 });
  if (!r.ok) {
    const env: ApiEnvelope<null> = {
      data: null,
      fetchedAt: now,
      error: r.stderr.trim().split("\n")[0] || "hermes kanban show failed",
    };
    return NextResponse.json(env);
  }
  try {
    const detail = JSON.parse(r.stdout) as KanbanTaskDetail;
    const env: ApiEnvelope<KanbanTaskDetail> = { data: detail, fetchedAt: now };
    return NextResponse.json(env);
  } catch {
    const env: ApiEnvelope<null> = {
      data: null,
      fetchedAt: now,
      error: "could not parse hermes kanban show output",
    };
    return NextResponse.json(env);
  }
}
