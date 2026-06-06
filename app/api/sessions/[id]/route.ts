import { NextResponse } from "next/server";
import path from "node:path";
import { run } from "@/lib/exec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOME = process.env.HOME ?? process.cwd();
const HERMES_HOME = process.env.HERMES_HOME || path.join(HOME, ".hermes");
const DB_PATH = path.join(HERMES_HOME, "state.db");

/**
 * Session mutations against state.db. PATCH renames (set title), DELETE removes
 * a session + its messages. Session ids are validated to a strict charset so
 * they can't break out of the python literal. Read/write SQL via python sqlite3.
 */

function validId(id: string): boolean {
  return /^[A-Za-z0-9_.:-]+$/.test(id) && id.length < 128;
}

async function sql(stmt: string): Promise<{ ok: boolean; out: string; err: string }> {
  const res = await run(`python3 -c ${JSON.stringify(stmt)}`, { timeoutMs: 10000 });
  return { ok: res.ok, out: res.stdout.trim(), err: res.stderr.trim() };
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!validId(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  let body: { title?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const title = String(body.title ?? "").slice(0, 200);
  const py = [
    "import sqlite3",
    `c=sqlite3.connect(${JSON.stringify(DB_PATH)})`,
    `c.execute("UPDATE sessions SET title=? WHERE id=?", (${JSON.stringify(title)}, ${JSON.stringify(id)}))`,
    "c.commit()",
    "print('ok', c.total_changes)",
  ].join("; ");
  const r = await sql(py);
  if (!r.ok || !r.out.startsWith("ok")) {
    return NextResponse.json({ error: r.err || "rename failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id, title });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!validId(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const py = [
    "import sqlite3",
    `c=sqlite3.connect(${JSON.stringify(DB_PATH)})`,
    `c.execute("DELETE FROM messages WHERE session_id=?", (${JSON.stringify(id)},))`,
    `c.execute("DELETE FROM sessions WHERE id=?", (${JSON.stringify(id)},))`,
    "c.commit()",
    "print('ok', c.total_changes)",
  ].join("; ");
  const r = await sql(py);
  if (!r.ok || !r.out.startsWith("ok")) {
    return NextResponse.json({ error: r.err || "delete failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id, deleted: true });
}
