// Shared shapes for the Chat slice — the per-repo session hub, skills surface,
// and the agent-inline-edit contract. Imported by both the route handlers
// (server) and the chat components (client). No em/en dashes in copy.

/** A repo the chat hub can bind a session to. Derived server-side from the
 *  local git repos under /home/demi/projects and /home/demi/agent. */
export interface ChatRepo {
  /** Repo slug / directory name, e.g. "polymarket-arbitrage-bot". */
  name: string;
  /** Absolute path (the cwd for the bound Hermes session). */
  path: string;
  /** Current git branch, when resolvable. */
  branch: string | null;
}

/** A chat thread = one persistent Hermes session. There is one per bound repo
 *  (title `lol-<slug>`) plus the "general" thread (cwd = home). */
export interface ChatThread {
  /** Stable thread id. "general" for the home thread, else the session title
   *  `lol-<slug>`. */
  id: string;
  /** Display title, e.g. the repo name or "general". */
  title: string;
  /** Repo binding (null for general). */
  repo: string | null;
  /** Absolute cwd the bound session runs in. */
  cwd: string;
  /** Hermes session title `lol-<slug>` (or "general-locals-only"). */
  sessionTitle: string;
  /** Underlying Hermes session id once the session exists, else null. */
  sessionId: string | null;
  /** Real message count from the session store (0 if not yet created). */
  messageCount: number;
  /** Real model the session ran on (from the session row), else null. */
  model: string | null;
  /** Last-active epoch ms (from the session store), else null. */
  lastActive: number | null;
  /** Derived context-window usage from the session's token counts. */
  usage: { used: number; total: number } | null;
}

export interface ThreadsPayload {
  threads: ChatThread[];
  repos: ChatRepo[];
  /** The home/general cwd. */
  home: string;
  fetchedAt: string;
  error?: string;
}

/** One installed skill, sourced from the on-disk skill registry that
 *  `hermes skills` manages (full name + description), cross-checked against
 *  `hermes skills list` for enabled state. */
export interface SkillEntry {
  name: string;
  description: string;
  category: string;
  source: string; // builtin | local | hub
  enabled: boolean;
}

export interface SkillGroup {
  category: string;
  skills: SkillEntry[];
}

export interface SkillBundle {
  name: string;
  skills: string[];
}

export interface SkillsPayload {
  groups: SkillGroup[];
  bundles: SkillBundle[];
  total: number;
  /** Raw `hermes skills list` row count, for the honest cross-check shown in
   *  the UI footer. */
  cliCount: number;
  fetchedAt: string;
  error?: string;
}

// --- Streaming send protocol (newline-delimited JSON over the POST body) -----

export type ChatStreamEvent =
  | { type: "session"; sessionId: string; title: string; isNew: boolean }
  | { type: "status"; elapsedMs: number; note: string }
  /** Incremental assistant text (ACP agent_message_chunk). Append to the bubble. */
  | { type: "delta"; text: string }
  /** Incremental reasoning text (ACP agent_thought_chunk). */
  | { type: "thought"; text: string }
  /** A tool call started. */
  | { type: "tool"; id: string; name: string; title: string; phase: "start" }
  /** A tool call finished. */
  | { type: "tool"; id: string; name: string; title: string; phase: "end"; ok: boolean }
  /** Terminal full text (fallback / non-streaming path). */
  | { type: "message"; text: string }
  | { type: "usage"; used: number; total: number; messageCount: number }
  | { type: "done"; elapsedMs: number }
  | { type: "error"; error: string };

export interface SendRequest {
  /** Repo name to bind (must match a server-side known repo), or "general". */
  repo: string;
  message: string;
  /** Skills to preload for this turn (hermes `-s`). */
  skills?: string[];
}

// --- Agent-inline-edit contract (owned here; slice 3 renders against it) ------

export interface AgentEditRequest {
  /** Repo name (server resolves to cwd). */
  repo: string;
  /** File path relative to the repo root (or absolute within the repo). */
  path: string;
  /** Optional selected text the edit should focus on. */
  selection?: string;
  /** Natural-language edit instruction. */
  instruction: string;
}

export interface AgentEditFile {
  /** Repo-relative path. */
  path: string;
  additions: number;
  deletions: number;
  /** Original on-disk content (restored after extraction). */
  oldContent: string;
  /** Agent-proposed content (slice 6 writes this on accept). */
  newContent: string;
  /** Unified diff (git format), for the review UI. */
  diff: string;
}

export interface AgentEditResult {
  ok: boolean;
  /** Single or multi-file changeset. v1 scopes to the one target file. */
  files: AgentEditFile[];
  /** The Hermes session that produced the edit. */
  sessionId: string | null;
  /** Honest note when the agent produced no change or hit a limit. */
  note?: string;
  error?: string;
}
