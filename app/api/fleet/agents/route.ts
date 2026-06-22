import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "@/lib/exec";
import type { ApiEnvelope } from "@/lib/types";
import type { FleetAgent, AgentNode, AgentLane } from "@/lib/fleet/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOME = process.env.HOME ?? process.cwd();
const HERMES_HOME = process.env.HERMES_HOME || path.join(HOME, ".hermes");
const DB_PATH = path.join(HERMES_HOME, "state.db");
const RUNTIME_SESSIONS_PATH = path.join(HERMES_HOME, "sessions", "sessions.json");

/**
 * Real agent board: live Hermes sessions on THIS box (PC = the orchestrator
 * host) become FleetAgent cards. The main loop + every delegated subagent (a
 * row with parent_session_id set) form the spawn tree. Lanes are derived from
 * activity: recently-active = working, idle-but-open = spawned, ended = done.
 *
 * PC1 is both orchestrator and worker — local sessions map to node "PC". A
 * future cross-machine layer can fold CCMB/PC2/VPS sessions in via SSH; for now
 * the truth is "what is THIS agent host running right now."
 */

const WINDOW_SEC = 3600; // sessions active within the last hour
const FRESH_SEC = 120; // a turn within 120s = "working" not just open

// Map Hermes session source → display node. Local CLI/telegram/tui/cron all run
// on the PC host, so they're node "PC". (Cross-machine attribution would key off
// a per-session host tag once the orchestrator publishes one.)
function nodeForSource(_source: string): AgentNode {
  return "PC";
}

const SCRIPT = (db: string) => `
import sqlite3, json, time
db = ${JSON.stringify(db)}
now = time.time()
cut = now - ${WINDOW_SEC}
c = sqlite3.connect(db)
c.row_factory = sqlite3.Row
rows = c.execute(
  "SELECT id, source, parent_session_id, started_at, ended_at, end_reason, "
  "model, message_count, tool_call_count, cwd, title, archived "
  "FROM sessions WHERE started_at >= ? ORDER BY started_at DESC LIMIT 60", (cut,)
).fetchall()
def lastsig(r):
    # best proxy for last activity: the newest message timestamp in the session
    m = c.execute("SELECT MAX(timestamp) FROM messages WHERE session_id=?", (r["id"],)).fetchone()[0]
    try: return float(m)
    except: 
        try: return float(r["started_at"])
        except: return now
out = []
for r in rows:
    if r["archived"] == 1: continue
    started = 0.0
    try: started = float(r["started_at"])
    except: pass
    ls = lastsig(r)
    ended = r["ended_at"] not in (None, "", "None")
    out.append({
        "id": r["id"], "source": r["source"] or "cli",
        "parent": r["parent_session_id"] if r["parent_session_id"] not in (None,"","None") else None,
        "started": started, "lastSignal": ls, "ended": ended,
        "endReason": r["end_reason"], "model": r["model"] or "",
        "msgs": int(r["message_count"] or 0), "tools": int(r["tool_call_count"] or 0),
        "cwd": r["cwd"] or "", "title": r["title"] or "",
    })
print(json.dumps({"now": now, "rows": out}))
`;

interface RawRow {
  id: string;
  source: string;
  parent: string | null;
  started: number;
  lastSignal: number;
  ended: boolean;
  endReason: string | null;
  model: string;
  msgs: number;
  tools: number;
  cwd: string;
  title: string;
}

function laneFor(r: RawRow, now: number): AgentLane {
  if (r.ended) return "done";
  const idle = now - r.lastSignal;
  if (idle < FRESH_SEC) return "working";
  return "spawned"; // open session, no recent turn
}

function objectiveFor(r: RawRow): string {
  if (r.title && r.title.trim()) return r.title.trim();
  const dir = r.cwd ? path.basename(r.cwd) : "";
  if (dir && dir !== os.userInfo().username) return `session · ${dir}`;
  return `${r.source} session`;
}

/**
 * Live runtime sessions from ~/.hermes/sessions/sessions.json. A long-lived
 * gateway conversation (a Telegram DM open all day) is ONE persistent runtime
 * session that does not re-emit a state.db start/end row per turn, so it ages
 * out of the state.db window even while actively in use — that's why the badge
 * read 0 mid-conversation. This map carries a fresh `updated_at` ISO timestamp
 * on every turn, so it's the reliable "is a conversation active right now"
 * signal. We surface any session updated within the hour as an agent, deduped
 * against state.db rows by session_id (state.db wins — richer signal).
 */
interface RuntimeSession {
  session_id?: string;
  created_at?: string;
  updated_at?: string;
  display_name?: string;
  platform?: string;
  chat_type?: string;
}

function isoToEpoch(iso: string | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms / 1000 : 0;
}

async function liveRuntimeAgents(
  now: number,
  knownIds: Set<string>,
): Promise<FleetAgent[]> {
  let raw: string;
  try {
    raw = await fs.readFile(RUNTIME_SESSIONS_PATH, "utf8");
  } catch {
    return [];
  }
  let map: Record<string, RuntimeSession>;
  try {
    map = JSON.parse(raw) as Record<string, RuntimeSession>;
  } catch {
    return [];
  }
  const out: FleetAgent[] = [];
  for (const s of Object.values(map)) {
    const id = s.session_id;
    if (!id || knownIds.has(id)) continue; // state.db row wins
    const updated = isoToEpoch(s.updated_at);
    if (updated <= 0) continue;
    const idle = now - updated;
    if (idle > WINDOW_SEC) continue; // not active this hour
    knownIds.add(id);
    const lane: AgentLane = idle < FRESH_SEC ? "working" : "spawned";
    const platform = s.platform || "session";
    const who = s.display_name ? ` · ${s.display_name}` : "";
    out.push({
      id,
      objective: `${platform} ${s.chat_type ?? ""}`.trim() + who,
      node: nodeForSource(platform),
      lane,
      startedAt: Math.round(isoToEpoch(s.created_at) * 1000) || Math.round(updated * 1000),
      lastSignal: Math.round(updated * 1000),
      signal:
        lane === "working"
          ? `live · ${platform}${who}`
          : `idle · ${platform}`,
    });
  }
  return out;
}

export async function GET() {
  const tmp = path.join(os.tmpdir(), `lo-agents-${process.pid}-${Date.now()}.py`);
  let agents: FleetAgent[] = [];
  try {
    await fs.writeFile(tmp, SCRIPT(DB_PATH), "utf8");
    const res = await run(`python3 ${tmp}`, { timeoutMs: 12000 });
    if (res.ok) {
      const parsed = JSON.parse(res.stdout.trim()) as { now: number; rows: RawRow[] };
      const { now, rows } = parsed;
      const ids = new Set(rows.map((r) => r.id));
      // Build children map from parent links that are in-window.
      const childrenOf = new Map<string, string[]>();
      for (const r of rows) {
        if (r.parent && ids.has(r.parent)) {
          const arr = childrenOf.get(r.parent) ?? [];
          arr.push(r.id);
          childrenOf.set(r.parent, arr);
        }
      }
      agents = rows.map((r) => {
        const lane = laneFor(r, now);
        const kids = childrenOf.get(r.id);
        const a: FleetAgent = {
          id: r.id,
          objective: objectiveFor(r),
          node: nodeForSource(r.source),
          lane,
          startedAt: Math.round(r.started * 1000),
          lastSignal: Math.round(r.lastSignal * 1000),
          signal:
            lane === "working"
              ? `${r.msgs} msgs · ${r.tools} tools · ${r.model.replace(/^claude-/, "")}`
              : lane === "done"
                ? `ended: ${r.endReason ?? "complete"}`
                : `idle · ${r.msgs} msgs`,
        };
        if (r.parent && ids.has(r.parent)) a.parentId = r.parent;
        if (kids && kids.length) a.children = kids;
        return a;
      });
    }
  } catch {
    /* fall through to empty */
  } finally {
    fs.unlink(tmp).catch(() => {});
  }

  // Fold in live runtime sessions (sessions.json) that aren't already
  // represented by a state.db row — this is what makes an actively-used
  // long-lived gateway conversation count as a working agent.
  try {
    const knownIds = new Set(agents.map((a) => a.id));
    const live = await liveRuntimeAgents(Date.now() / 1000, knownIds);
    if (live.length) agents = agents.concat(live);
  } catch {
    /* runtime-session merge is best-effort; never fail the endpoint */
  }

  const env: ApiEnvelope<FleetAgent[]> = {
    data: agents,
    fetchedAt: new Date().toISOString(),
  };
  return NextResponse.json(env);
}
