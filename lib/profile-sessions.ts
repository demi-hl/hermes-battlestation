// Read-only cross-profile session browsing. Each Hermes profile keeps its own
// session store: default → ~/.hermes/state.db, named → ~/.hermes/profiles/<n>/state.db.
// The Sessions pane merges these so you can browse every profile's history from
// the phone. READ-ONLY: cross-profile threads are not resumable here (the chat
// bridge runs against the default profile), so we never expose Open-in-chat for
// them. All reads go through python3 sqlite3 in ?mode=ro — no writes, ever.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();
const PROFILES_DIR = path.join(HOME, ".hermes", "profiles");
export const DEFAULT_PROFILE = "default";

const PROFILE_NAME = /^[a-zA-Z0-9._-]+$/;

/** Resolve a profile name to its state.db path (validated, never shell-bound). */
export function dbPathForProfile(profile: string): string | null {
  if (profile === DEFAULT_PROFILE) return path.join(HOME, ".hermes", "state.db");
  if (!PROFILE_NAME.test(profile)) return null;
  return path.join(PROFILES_DIR, profile, "state.db");
}

export interface ProfileSession {
  id: string;
  title: string | null;
  source: string | null;
  model: string | null;
  messageCount: number;
  lastActive: number | null; // epoch ms
  used: number | null; // derived context occupancy
}

export interface ProfileInfo {
  name: string;
  count: number;
}

const CONTEXT_WINDOW = 200_000;

function runPy<T>(script: string, args: string[], fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const child = spawn("python3", ["-c", script, ...args], { timeout: 8000 });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("error", () => resolve(fallback));
    child.on("close", (code) => {
      if (code !== 0) return resolve(fallback);
      try {
        resolve(JSON.parse(out) as T);
      } catch {
        resolve(fallback);
      }
    });
  });
}

/** Every profile that has a session store, plus default, with live counts. */
export async function listProfiles(): Promise<ProfileInfo[]> {
  const names: string[] = [DEFAULT_PROFILE];
  try {
    const entries = await fs.readdir(PROFILES_DIR, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (!PROFILE_NAME.test(e.name)) continue;
      try {
        await fs.stat(path.join(PROFILES_DIR, e.name, "state.db"));
        names.push(e.name);
      } catch {
        // no store in this profile yet
      }
    }
  } catch {
    // profiles dir absent
  }

  const out: ProfileInfo[] = [];
  for (const name of names) {
    const db = dbPathForProfile(name);
    if (!db) continue;
    const count = await runPy<number>(
      `
import sqlite3, sys, json
db = sys.argv[1]
try:
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    n = con.execute("SELECT COUNT(*) FROM sessions WHERE archived IS NOT 1").fetchone()[0]
    print(json.dumps(n))
except Exception:
    print(json.dumps(0))
`,
      [db],
      0,
    );
    out.push({ name, count });
  }
  return out;
}

/** All non-archived sessions for a profile, newest first. Read-only. */
export async function listSessionsForProfile(
  profile: string,
  limit = 120,
): Promise<ProfileSession[]> {
  const db = dbPathForProfile(profile);
  if (!db) return [];
  const rows = await runPy<ProfileSession[]>(
    `
import sqlite3, sys, json
db, limit = sys.argv[1], int(sys.argv[2])
try:
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT id, title, source, model, message_count, started_at, "
        "input_tokens, output_tokens, cache_read_tokens "
        "FROM sessions WHERE archived IS NOT 1 "
        "ORDER BY started_at DESC LIMIT ?",
        (limit,),
    ).fetchall()
    out = []
    for r in rows:
        used = (r["cache_read_tokens"] or 0) + (r["input_tokens"] or 0) + (r["output_tokens"] or 0)
        out.append({
            "id": r["id"],
            "title": r["title"],
            "source": r["source"],
            "model": r["model"],
            "messageCount": r["message_count"] or 0,
            "lastActive": int((r["started_at"] or 0) * 1000) if r["started_at"] else None,
            "used": used if used > 0 else None,
        })
    print(json.dumps(out))
except Exception:
    print(json.dumps([]))
`,
    [db, String(limit)],
    [],
  );
  return rows.map((r) => ({
    ...r,
    used: r.used != null ? Math.min(r.used, CONTEXT_WINDOW) : null,
  }));
}

/** Read a session's transcript from a specific profile's store. Read-only. */
export async function readProfileTranscript(
  profile: string,
  sessionId: string,
): Promise<{ id: string; role: "user" | "assistant"; text: string; ts: number }[]> {
  const db = dbPathForProfile(profile);
  if (!db) return [];
  return runPy(
    `
import sqlite3, sys, json
db, sid = sys.argv[1], sys.argv[2]
def flatten(content):
    if content is None: return ""
    s = content
    if isinstance(s, str):
        t = s.strip()
        if t.startswith("[") or t.startswith("{"):
            try:
                data = json.loads(t)
            except Exception:
                return s
            if isinstance(data, list):
                parts = []
                for it in data:
                    if isinstance(it, dict):
                        if isinstance(it.get("text"), str): parts.append(it["text"])
                        elif it.get("type") == "text" and isinstance(it.get("content"), str): parts.append(it["content"])
                    elif isinstance(it, str): parts.append(it)
                return "\\n".join(p for p in parts if p).strip()
            if isinstance(data, dict) and isinstance(data.get("text"), str):
                return data["text"]
            return s
        return s
    return str(s)
try:
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT id, role, content, tool_call_id, tool_name, timestamp "
        "FROM messages WHERE session_id=? AND (active IS NULL OR active=1) ORDER BY id ASC",
        (sid,),
    ).fetchall()
    out = []
    for r in rows:
        if r["role"] not in ("user", "assistant"): continue
        if r["tool_call_id"] or r["tool_name"]: continue
        text = flatten(r["content"])
        if not text or not text.strip(): continue
        stripped = text.lstrip()
        if stripped.startswith("[CONTEXT COMPACTION") or stripped.startswith("[System note:"): continue
        out.append({"id": f"db{r['id']}", "role": r["role"], "text": text, "ts": int((r["timestamp"] or 0) * 1000)})
    print(json.dumps(out))
except Exception:
    print(json.dumps([]))
`,
    [db, sessionId],
    [],
  );
}
