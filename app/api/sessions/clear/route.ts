import { NextResponse } from "next/server";
import path from "node:path";
import { run, scrubPaths} from "@/lib/exec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOME = process.env.HOME ?? process.cwd();
const HERMES_HOME = process.env.HERMES_HOME || path.join(HOME, ".hermes");
const DB_PATH = path.join(HERMES_HOME, "state.db");

/**
 * Clear the Tasks activity board by ARCHIVING sessions (reversible — the fleet
 * agents query already filters `archived = 1`, so archived rows just leave the
 * list; nothing is destroyed). Default scope = ended sessions only, so a live
 * working agent is never yanked out from under itself. `scope:"all"` archives
 * every non-archived session in the recent window.
 */
export async function POST(req: Request) {
  let body: { scope?: "ended" | "all" };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const scope = body.scope === "all" ? "all" : "ended";

  // Ended = has a non-null ended_at; "all" archives everything still open too.
  const where =
    scope === "all"
      ? "archived = 0"
      : "archived = 0 AND ended_at IS NOT NULL AND ended_at NOT IN ('', 'None')";

  const py = [
    "import sqlite3",
    `c=sqlite3.connect(${JSON.stringify(DB_PATH)})`,
    `c.execute("UPDATE sessions SET archived=1 WHERE ${where}")`,
    "c.commit()",
    "print('ok', c.total_changes)",
  ].join("; ");

  const r = await run(`python3 -c ${JSON.stringify(py)}`, { timeoutMs: 10000 });
  if (!r.ok || !r.stdout.trim().startsWith("ok")) {
    return NextResponse.json(
      { error: scrubPaths(r.stderr).split("\n")[0] || "clear failed" },
      { status: 500 },
    );
  }
  const cleared = parseInt(r.stdout.trim().split(/\s+/)[1] ?? "0", 10) || 0;
  return NextResponse.json({ ok: true, scope, cleared });
}
