// Server-side per-repo session bridge. The load-bearing feature: each repo gets
// one persistent, resumable Hermes session named `lol-<slug>`, run with
// cwd = the repo path so the agent loads that repo's tools/memory/AGENTS.md.
//
// Mechanics verified against the real CLI:
//   - First turn (session does not exist yet): spawn a fresh classic-CLI chat
//     turn, capture the printed `session_id`, then `hermes sessions rename` it
//     to `lol-<slug>`.
//   - Later turns: `hermes chat --cli --continue lol-<slug> ...` resumes the
//     SAME session (message_count grows; not a fresh session).
//
// `--cli` forces the classic prompt_toolkit REPL path (NOT the node/PTY TUI),
// which runs headless from a non-TTY pipe; `-q` sends one query; `-Q` prints
// only the final response on stdout (session_id goes to stderr). We do not pass
// -m/-provider, so each session inherits the host agent's configured default
// model + provider (avoiding a mismatch with the app's expectations).

import { spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { run } from "./exec";

const HOME = process.env.HOME ?? process.cwd();

/** Roots scanned for bindable repos. The chat hub binds a session per repo. */
export const REPO_ROOTS = [`${HOME}/projects`, `${HOME}/agent`];

/** The general thread runs in the home dir with its own isolated session. */
export const GENERAL_THREAD_ID = "general";
export const GENERAL_SESSION_TITLE = "lol-general";
export const GENERAL_CWD = HOME;

/** Slugify a repo name into the session-title suffix. */
export function repoSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** The Hermes session title bound to a repo (or the general thread). */
export function sessionTitleFor(repo: string | null): string {
  if (!repo || repo === GENERAL_THREAD_ID) return GENERAL_SESSION_TITLE;
  return `lol-${repoSlug(repo)}`;
}

/** Slugify a branch name for use in a session title / thread id. */
export function branchSlug(branch: string): string {
  return branch
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Session title for a repo + specific branch. A branch that is the repo's
 *  base/primary checkout collapses to the plain repo title so the default repo
 *  thread and "open repo" land on the same session; any other branch gets its
 *  own `lol-<repo>__<branch>` session so branches run independently. */
export function sessionTitleForBranch(
  repo: string | null,
  branch: string | null | undefined,
  base?: string | null,
): string {
  const repoTitle = sessionTitleFor(repo);
  if (!repo || repo === GENERAL_THREAD_ID) return repoTitle;
  if (!branch || (base && branch === base)) return repoTitle;
  return `${repoTitle}__${branchSlug(branch)}`;
}

export interface SessionRow {
  id: string;
  title: string | null;
  source: string;
  model: string | null;
  messageCount: number;
  lastActive: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Estimated CURRENT context occupancy (~tokens) from active message content.
   *  Drops after a /compress, unlike the cumulative cache counters. */
  liveTokens?: number;
}

/** Context-window size used for the usage meter, per model. Opus/Sonnet/Haiku
 *  4.x all expose a 200k window; the meter is a derived indicator, not the
 *  exact live window (the headless CLI does not emit a live context gauge). */
const CONTEXT_WINDOW = 200_000;

export function usageFromRow(row: SessionRow | null): { used: number; total: number } | null {
  if (!row) return null;
  // Prefer the live estimate (active message content) — it reflects the CURRENT
  // context and shrinks after compression. The old path summed the session's
  // cumulative cache_read_tokens, which only ever grows and pinned every long
  // session to 100% even right after a /compress.
  const used = row.liveTokens && row.liveTokens > 0 ? row.liveTokens : 0;
  if (used <= 0) return null;
  return { used: Math.min(used, CONTEXT_WINDOW), total: CONTEXT_WINDOW };
}

// Read the session store read-only via python3 (ships with sqlite3; no native
// node dep added to the build). The script + its args go through `spawn`'s argv
// (NOT a shell) so multi-line scripts and titles never hit shell quoting.
async function queryDb<T>(script: string, args: string[], fallback: T): Promise<T> {
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

const ROW_SELECT = `
import sqlite3, sys, json, os
db = os.path.expanduser("~/.hermes/state.db")
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
def live_tokens(sid):
    # Estimate CURRENT context occupancy from the ACTIVE message content
    # (compression flips old rows to active=0, so this drops after a /compress —
    # unlike the session's cumulative cache_read_tokens which only ever grows).
    # ~4 chars/token is the standard rough heuristic; good enough for a meter.
    try:
        row = con.execute(
            "SELECT COALESCE(SUM("
            "  LENGTH(COALESCE(content,'')) + LENGTH(COALESCE(reasoning_content,'')) "
            "  + LENGTH(COALESCE(tool_calls,''))"
            "), 0) AS chars FROM messages WHERE session_id=? AND active=1",
            (sid,),
        ).fetchone()
        return int((row["chars"] or 0) / 4)
    except Exception:
        return 0
def pack(r):
    return {
        "id": r["id"], "title": r["title"], "source": r["source"],
        "model": r["model"], "messageCount": r["message_count"] or 0,
        "lastActive": r["started_at"],
        "inputTokens": r["input_tokens"] or 0,
        "outputTokens": r["output_tokens"] or 0,
        "cacheReadTokens": r["cache_read_tokens"] or 0,
        "cacheWriteTokens": r["cache_write_tokens"] or 0,
        "liveTokens": live_tokens(r["id"]),
    }
`;

/** Look up the live session row by its session id. The ACP bridge does NOT
 *  rename sessions to `lol-*` (it auto-titles them), so the bridge map's id is
 *  the source of truth for a thread — resolve the row by id, not by title. */
export async function querySessionById(id: string): Promise<SessionRow | null> {
  const script =
    ROW_SELECT +
    `
sid = sys.argv[1]
row = con.execute(
    "SELECT * FROM sessions WHERE id=? AND archived IS NOT 1 LIMIT 1",
    (sid,),
).fetchone()
print(json.dumps(pack(row) if row else None))
`;
  return queryDb<SessionRow | null>(script, [id], null);
}

/** Read every ACP bridge session map (`lo-acp-sessions*.json`) and merge into a
 *  single key->sessionId map. Files are merged oldest-first so the most recently
 *  written target (the active brain) wins on key collisions. This is the real
 *  registry of which Hermes session backs each thread — the chat send/resume
 *  path persists it, and the agent auto-titles the underlying DB row, so the
 *  `lol-*` DB title the old listing relied on never exists. */
export function readBridgeSessions(): Map<string, string> {
  const merged = new Map<string, string>();
  try {
    const dir = `${HOME}/.hermes`;
    const files = readdirSync(dir)
      .filter((f) => /^lo-acp-sessions.*\.json$/.test(f))
      .map((f) => {
        const p = `${dir}/${f}`;
        let mtime = 0;
        try {
          mtime = statSync(p).mtimeMs;
        } catch {
          /* race: file vanished */
        }
        return { p, mtime };
      })
      .sort((a, b) => a.mtime - b.mtime); // oldest first; newest overwrites
    for (const { p } of files) {
      try {
        const obj = JSON.parse(readFileSync(p, "utf8")) as Record<string, string>;
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === "string" && v) merged.set(k, v);
        }
      } catch {
        /* skip malformed map */
      }
    }
  } catch {
    /* ~/.hermes unreadable — no bridge sessions */
  }
  return merged;
}

/** Resolve a thread's backing session id from the bridge map, trying every key
 *  shape the map has used across versions: the current `lol-<slug>` title key,
 *  the slug alone, and the bare repo name (legacy maps keyed by repo name). */
export function resolveBridgeId(
  map: Map<string, string>,
  repo: string | null,
  branch?: string | null,
  base?: string | null,
): string | null {
  const candidates: string[] = [];
  if (!repo || repo === GENERAL_THREAD_ID) {
    candidates.push(GENERAL_SESSION_TITLE, GENERAL_THREAD_ID);
  } else {
    candidates.push(sessionTitleForBranch(repo, branch, base));
    candidates.push(sessionTitleFor(repo));
    candidates.push(repoSlug(repo), repo);
  }
  for (const c of candidates) {
    const id = map.get(c);
    if (id) return id;
  }
  return null;
}

/** Look up the live session row for a title (the most recent if duplicates). */
export async function querySessionByTitle(title: string): Promise<SessionRow | null> {
  const script =
    ROW_SELECT +
    `
title = sys.argv[1]
row = con.execute(
    "SELECT * FROM sessions WHERE title=? AND archived IS NOT 1 ORDER BY started_at DESC LIMIT 1",
    (title,),
).fetchone()
print(json.dumps(pack(row) if row else None))
`;
  return queryDb<SessionRow | null>(script, [title], null);
}

/** List every `lol-*` session (the existing repo threads). */
export async function listLolSessions(): Promise<SessionRow[]> {
  const script =
    ROW_SELECT +
    `
rows = con.execute(
    "SELECT * FROM sessions WHERE title LIKE 'lol-%' AND archived IS NOT 1 "
    "ORDER BY started_at DESC"
).fetchall()
print(json.dumps([pack(r) for r in rows]))
`;
  return queryDb<SessionRow[]>(script, [], []);
}

/** Rename a freshly created session to its `lol-<slug>` title. */
export async function renameSession(id: string, title: string): Promise<boolean> {
  const r = await run(
    `hermes sessions rename ${shellQuote(id)} ${shellQuote(title)}`,
    { timeoutMs: 10000 },
  );
  return r.ok;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Pull the `session_id: <id>` line the classic CLI prints on stderr. */
export function parseSessionId(stderr: string): string | null {
  const m = stderr.match(/session_id:\s*([A-Za-z0-9_]+)/);
  return m ? m[1] : null;
}

// Per-title turn lock. The classic CLI mutates the session's row in state.db;
// two concurrent turns on the same session would race. We serialize per title
// (single user, so this is just a safety rail) and reject overlap with a clear
// error rather than corrupting state.
const activeTitles = new Set<string>();

export function tryLock(title: string): boolean {
  if (activeTitles.has(title)) return false;
  activeTitles.add(title);
  return true;
}
export function unlock(title: string): void {
  activeTitles.delete(title);
}

/** Build the argv for a chat turn. `resume` true => continue the named session;
 *  false => fresh session (first turn, renamed afterward). */
export function buildChatArgs(opts: {
  title: string;
  resume: boolean;
  message: string;
  skills?: string[];
}): string[] {
  const args = ["chat", "--cli", "--source", "locals-only"];
  if (opts.resume) args.push("--continue", opts.title);
  for (const s of opts.skills ?? []) {
    if (s && /^[a-zA-Z0-9._-]+$/.test(s)) args.push("-s", s);
  }
  args.push("-q", opts.message, "-Q");
  return args;
}
