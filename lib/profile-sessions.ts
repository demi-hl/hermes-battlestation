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

export function normalizeProfileName(profile: string | null | undefined): string | null {
  const p = (profile || DEFAULT_PROFILE).trim() || DEFAULT_PROFILE;
  return PROFILE_NAME.test(p) ? p : null;
}

export function validSessionId(id: string | null | undefined): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(id);
}

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
  limit = 1000,
): Promise<ProfileSession[]> {
  const db = dbPathForProfile(profile);
  if (!db) return [];
  const rows = await runPy<ProfileSession[]>(
    `
import sqlite3, sys, json, re
db, limit = sys.argv[1], int(sys.argv[2])
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
                return " ".join(p for p in parts if p).strip()
            if isinstance(data, dict) and isinstance(data.get("text"), str):
                return data["text"]
            return s
        return s
    return str(s)
def derive_title(con, sid):
    # First real user message → short title. Skips compaction/system noise.
    try:
        rows = con.execute(
            "SELECT content FROM messages WHERE session_id=? AND role='user' "
            "AND (active IS NULL OR active=1) ORDER BY id ASC LIMIT 5", (sid,)
        ).fetchall()
    except Exception:
        return None
    for r in rows:
        text = flatten(r[0]).strip()
        if not text: continue
        st = text.lstrip()
        # skip pure system-noise turns (no human content to title from)
        if st.startswith("[CONTEXT COMPACTION") or st.startswith("[System note:") or st.startswith("[IMPORTANT:") or st.startswith("[voice mode"): continue
        # image-only opener: a vision description is injected as
        # "[The user sent an image~ ... # Image Description <desc>". This script
        # rides inside a JS template literal, so backslash escapes get mangled
        # by the bundler. Use plain string ops only here, no regex, no escapes.
        if st.lower().startswith("[the user sent an image"):
            idx = text.lower().find("image description")
            if idx >= 0:
                body = text[idx + 17:]
            else:
                nl = text.find(chr(10))
                body = text[nl + 1:] if nl >= 0 else ""
            body = body.strip().lstrip("~:>#*- ").strip()
            cut = len(body)
            for i, ch in enumerate(body):
                if ch in ".!?" and (i + 1 >= len(body) or body[i + 1] <= " "):
                    cut = i + 1
                    break
            body = " ".join(body[:cut].split())
            return ("Image " + chr(183) + " " + (body[:38] + chr(8230) if len(body) > 38 else body)) if body else "Image"
        # unwrap a leading [DEMI] / [Replying to: "..."] / attachment marker; keep the text AFTER it
        text = re.sub(r'^\[DEMI\]\s*', "", text)
        text = re.sub(r'^\[Replying to:.*?\]\s*', "", text, flags=re.S)
        text = re.sub(r'^\[The user sent[^\]]*\]\s*', "", text, flags=re.I)
        text = re.sub(r'^\[Image attached[^\]]*\]\s*', "", text, flags=re.I)
        text = text.strip()
        if not text or text.startswith("["): continue
        text = " ".join(text.split())
        return (text[:48] + "\u2026") if len(text) > 48 else text
    return None
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
        title = r["title"]
        if not title or not str(title).strip():
            title = derive_title(con, r["id"])
        out.append({
            "id": r["id"],
            "title": title,
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

/** Resolve a session's working directory + source from the store. cwd null →
 *  caller uses home; source distinguishes acp (resumable in-place) from
 *  telegram/cron/cli (must be seeded into a fresh session). */
export async function sessionMeta(
  profile: string,
  sessionId: string,
): Promise<{ cwd: string | null; source: string | null; model: string | null; provider: string | null }> {
  const db = dbPathForProfile(profile);
  if (!db) return { cwd: null, source: null, model: null, provider: null };
  return runPy<{ cwd: string | null; source: string | null; model: string | null; provider: string | null }>(
    `
import sqlite3, sys, json
db, sid = sys.argv[1], sys.argv[2]
try:
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    row = con.execute("SELECT cwd, source, model, model_config FROM sessions WHERE id=?", (sid,)).fetchone()
    if row:
        provider = None
        try:
            cfg = json.loads(row[3] or "{}")
            provider = cfg.get("provider")
        except Exception:
            provider = None
        print(json.dumps({"cwd": row[0] or None, "source": row[1] or None, "model": row[2] or None, "provider": provider or None}))
    else:
        print(json.dumps({"cwd": None, "source": None, "model": None, "provider": None}))
except Exception:
    print(json.dumps({"cwd": None, "source": None, "model": None, "provider": None}))
`,
    [db, sessionId],
    { cwd: null, source: null, model: null, provider: null },
  );
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
