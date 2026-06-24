// Read a session's real transcript from ~/.hermes/state.db and shape it into the
// app's ChatMessage form. Used by /api/chat/history so the iOS app can hydrate
// its conversation from backend truth instead of device-local localStorage.
//
// TRUE PARITY: we surface user + assistant text AND reconstruct the tool-call
// activity (the ToolTray chips) that ran during each assistant turn, so a
// reopened session matches what was shown live. Each `role=tool` row in the DB
// is attached to the assistant turn it belongs to as a ToolActivity, with `ok`
// derived from the tool result's exit_code/error. Empty assistant shells that
// dispatched tools are KEPT (they carry the tray), unlike before.

import { spawn } from "node:child_process";

export interface TranscriptTool {
  id: string;
  name: string;
  title: string;
  done: boolean;
  ok: boolean;
}

export interface TranscriptMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  ts: number;
  tools?: TranscriptTool[];
}

const READ_SCRIPT = `
import sqlite3, sys, json, os
db = os.path.expanduser("~/.hermes/state.db")
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
sid = sys.argv[1]

def flatten(content):
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
                return "\\\\n".join(p for p in parts if p).strip()
            if isinstance(data, dict) and isinstance(data.get("text"), str):
                return data["text"]
            return s
        return s
    return str(s)

def tool_ok(content):
    # A tool result is OK unless its JSON payload carries a non-zero exit_code
    # or a non-null error. Non-JSON output is treated as success.
    if not content:
        return True
    t = content.strip()
    if not (t.startswith("{") or t.startswith("[")):
        return True
    try:
        d = json.loads(t)
    except Exception:
        return True
    if isinstance(d, dict):
        if d.get("error"):
            return False
        ec = d.get("exit_code")
        if isinstance(ec, int) and ec != 0:
            return False
    return True

HUMAN = {
    "terminal": "Terminal", "read_file": "Read file", "write_file": "Write file",
    "patch": "Edit file", "search_files": "Search", "web_search": "Web search",
    "web_extract": "Fetch page", "todo": "Todo", "process": "Process",
}
def titler(name):
    if not name:
        return "tool"
    return HUMAN.get(name, name.replace("_", " ").strip().title())

rows = con.execute(
    "SELECT id, role, content, tool_call_id, tool_name, timestamp "
    "FROM messages WHERE session_id=? AND (active IS NULL OR active=1) "
    "ORDER BY id ASC",
    (sid,),
).fetchall()

out = []
last_assistant = None  # the assistant msg dict tool rows attach to

for r in rows:
    role = r["role"]

    # Tool result rows -> attach to the current assistant turn as activity.
    if role == "tool" or r["tool_call_id"] or r["tool_name"]:
        name = r["tool_name"] or "tool"
        tool = {
            "id": f"db{r['id']}",
            "name": name,
            "title": titler(name),
            "done": True,
            "ok": tool_ok(r["content"]),
        }
        if last_assistant is not None:
            last_assistant.setdefault("tools", []).append(tool)
        continue

    if role not in ("user", "assistant"):
        continue

    text = flatten(r["content"])
    stripped = (text or "").lstrip()
    if stripped.startswith("[CONTEXT COMPACTION") or stripped.startswith("[System note:"):
        continue

    msg = {
        "id": f"db{r['id']}",
        "role": role,
        "text": text or "",
        "ts": int((r["timestamp"] or 0) * 1000),
    }
    if role == "assistant":
        last_assistant = msg
        out.append(msg)
    else:
        # user row: only keep if it has text
        last_assistant = None
        if text and text.strip():
            out.append(msg)

# Drop assistant shells that ended up with NEITHER text NOR tools (pure noise).
out = [m for m in out if (m["role"] == "user") or m.get("text", "").strip() or m.get("tools")]

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
