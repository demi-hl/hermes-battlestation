import { NextResponse } from "next/server";
import { run } from "@/lib/exec";
import { bust } from "@/lib/cache";
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

// Mutate a single task's lane. Supported actions map to real `hermes kanban`
// verbs that are reversible (no hard delete from the mobile surface):
//   archive  → swipe-to-remove (reversible; card leaves every column)
//   unblock  → push a blocked task back to ready
//   promote  → force a todo/blocked task to ready even if deps aren't done
const ACTIONS: Record<string, (id: string) => string> = {
  archive: (id) => `hermes kanban archive ${id}`,
  unblock: (id) => `hermes kanban unblock ${id}`,
  promote: (id) => `hermes kanban promote ${id} --force`,
};

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) {
    return NextResponse.json({ error: "invalid task id" }, { status: 400 });
  }

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const action = (body.action ?? "").trim();
  const build = ACTIONS[action];
  if (!build) {
    return NextResponse.json(
      { error: `unsupported action: ${action || "(none)"}` },
      { status: 400 },
    );
  }

  const r = await run(build(id), { timeoutMs: 15000 });
  if (!r.ok) {
    return NextResponse.json(
      { error: r.stderr.trim().split("\n")[0] || `hermes kanban ${action} failed` },
      { status: 500 },
    );
  }
  bust("kanban");
  return NextResponse.json({ ok: true, action, id });
}
