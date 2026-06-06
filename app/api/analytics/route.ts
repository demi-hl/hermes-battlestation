import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "@/lib/exec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOME = process.env.HOME ?? process.cwd();
const HERMES_HOME = process.env.HERMES_HOME || path.join(HOME, ".hermes");
const DB_PATH = path.join(HERMES_HOME, "state.db");

/**
 * Usage analytics computed from the Hermes session store (state.db). Returns
 * per-day token/cost/session totals + per-model breakdown for the last N days.
 * Read-only SQL via a temp python script (multi-line code can't go through
 * `python3 -c` over /bin/sh without newline mangling).
 */

const SCRIPT = (db: string, days: number) => `
import sqlite3, json, time, sys
db = ${JSON.stringify(db)}
cutoff = time.time() - ${days} * 86400
c = sqlite3.connect(db)
c.row_factory = sqlite3.Row
rows = c.execute(
  "SELECT started_at, model, source, message_count, input_tokens, output_tokens, "
  "cache_read_tokens, cache_write_tokens, estimated_cost_usd, actual_cost_usd "
  "FROM sessions WHERE started_at >= ? AND archived IS NOT 1", (cutoff,)
).fetchall()
daily = {}; models = {}; sources = {}
tot = {"sessions":0,"in":0,"out":0,"cacheR":0,"cacheW":0,"cost":0.0,"msgs":0}
for r in rows:
    try: ts = float(r["started_at"])
    except: continue
    day = time.strftime("%Y-%m-%d", time.localtime(ts))
    cost = r["actual_cost_usd"] if r["actual_cost_usd"] is not None else (r["estimated_cost_usd"] or 0)
    cost = float(cost or 0)
    i = int(r["input_tokens"] or 0); o = int(r["output_tokens"] or 0)
    cr = int(r["cache_read_tokens"] or 0); cw = int(r["cache_write_tokens"] or 0)
    d = daily.setdefault(day, {"date":day,"sessions":0,"in":0,"out":0,"cost":0.0})
    d["sessions"]+=1; d["in"]+=i; d["out"]+=o; d["cost"]+=cost
    m = r["model"] or "unknown"
    mm = models.setdefault(m, {"model":m,"sessions":0,"in":0,"out":0,"cost":0.0})
    mm["sessions"]+=1; mm["in"]+=i; mm["out"]+=o; mm["cost"]+=cost
    s = r["source"] or "unknown"
    sources[s] = sources.get(s,0)+1
    tot["sessions"]+=1; tot["in"]+=i; tot["out"]+=o; tot["cacheR"]+=cr; tot["cacheW"]+=cw
    tot["cost"]+=cost; tot["msgs"]+=int(r["message_count"] or 0)
out = {
  "days": ${days},
  "totals": tot,
  "daily": sorted(daily.values(), key=lambda x:x["date"]),
  "models": sorted(models.values(), key=lambda x:-x["cost"]),
  "sources": [{"source":k,"sessions":v} for k,v in sorted(sources.items(), key=lambda x:-x[1])],
}
print(json.dumps(out))
`;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get("days") ?? "30", 10) || 30));

  const tmp = path.join(os.tmpdir(), `lo-analytics-${process.pid}-${Date.now()}.py`);
  try {
    await fs.writeFile(tmp, SCRIPT(DB_PATH, days), "utf8");
    const res = await run(`python3 ${tmp}`, { timeoutMs: 15000 });
    if (!res.ok) {
      return NextResponse.json(
        { error: "analytics query failed", detail: res.stderr.slice(0, 300) },
        { status: 500 },
      );
    }
    return NextResponse.json(JSON.parse(res.stdout.trim()));
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 500 });
  } finally {
    fs.unlink(tmp).catch(() => {});
  }
}
