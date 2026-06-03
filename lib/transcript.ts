// Read a session's real transcript from ~/.hermes/state.db and shape it into the
// app's ChatMessage form. Used by /api/chat/history so the iOS app can hydrate
// its conversation from backend truth instead of device-local localStorage.
//
// We surface only user + assistant *text* turns (the conversation as a human
// reads it). Tool-call rows and empty assistant shells (pure tool dispatch with
// no prose) are dropped — they belong to the live-stream ToolTray, not the
// persisted scrollback.

import { spawn } from "node:child_process";

export interface TranscriptMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  ts: number;
}

const READ_SCRIPT = `
import sqlite3, sys, json, os
db = os.path.expanduser("~/.hermes/state.db")
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
sid = sys.argv[1]

def flatten(content):
    # content is TEXT, may be a JSON string (list of parts) or a plain string.
    if content is None:
        return ""
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
                        if isinstance(it.get("text"), str):
                            parts.append(it["text"])
                        elif it.get("type") == "text" and isinstance(it.get("content"), str):
                            parts.append(it["content"])
                    elif isinstance(it, str):
                        parts.append(it)
                return "\\n".join(p for p in parts if p).strip()
            if isinstance(data, dict) and isinstance(data.get("text"), str):
                return data["text"]
            return s
        return s
    return str(s)

rows = con.execute(
    "SELECT id, role, content, tool_call_id, tool_name, timestamp "
    "FROM messages WHERE session_id=? AND (active IS NULL OR active=1) "
    "ORDER BY id ASC",
    (sid,),
).fetchall()

out = []
for r in rows:
    role = r["role"]
    if role not in ("user", "assistant"):
        continue
    # Skip tool-result rows masquerading as user/assistant.
    if r["tool_call_id"] or r["tool_name"]:
        continue
    text = flatten(r["content"])
    if not text or not text.strip():
        continue
    # Drop internal plumbing that is not part of the human-readable conversation:
    # context-compaction summaries and system-reminder fallbacks injected as
    # pseudo-turns.
    stripped = text.lstrip()
    if stripped.startswith("[CONTEXT COMPACTION") or stripped.startswith("[System note:"):
        continue
    out.append({
        "id": f"db{r['id']}",
        "role": role,
        "text": text,
        "ts": int((r["timestamp"] or 0) * 1000),
    })

print(json.dumps(out))
`;

export function readSessionTranscript(sessionId: string): Promise<TranscriptMessage[]> {
  return new Promise((resolve) => {
    const child = spawn("python3", ["-c", READ_SCRIPT, sessionId], { timeout: 8000 });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("error", () => resolve([]));
    child.on("close", (code) => {
      if (code !== 0) return resolve([]);
      try {
        resolve(JSON.parse(out) as TranscriptMessage[]);
      } catch {
        resolve([]);
      }
    });
  });
}
