/**
 * Agent-inline-edit interface (cross-slice contract).
 *
 * PROJECT.md makes the agent a first-class editor: from a file/selection you ask
 * the agent to edit, review the returned diff, then accept (write to disk) or
 * reject. The SESSION call that produces the edit is owned by the Chat slice
 * (slice 2) — it holds the per-repo Hermes session. THIS slice (Editor) owns the
 * entry point + the diff-review UI + the accept→write path.
 *
 * `requestAgentEdit` is the seam. When slice 2 is merged it registers a real
 * implementation via `setAgentEditProvider`; until then the default returns an
 * honest `unwired` result so the UI degrades to a clear "wiring pending" state
 * instead of faking a streamed edit.
 */

export interface AgentEditRequest {
  /** Repo slug the active workspace is bound to. */
  repo: string;
  /** Repo-relative file path. */
  path: string;
  /** Current full file contents (the editor's live doc). */
  content: string;
  /** Optional selected range the instruction targets. */
  selection?: { from: number; to: number; text: string };
  /** Natural-language instruction, e.g. "add input validation". */
  instruction: string;
}

export interface AgentEditResult {
  /** False when no provider is wired yet (slice 2 not merged). */
  wired: boolean;
  /** Proposed full new file contents (null when unwired or on error). */
  proposed: string | null;
  /** Human-readable note (why unwired / model summary / error). */
  note: string;
}

export type AgentEditProvider = (
  req: AgentEditRequest,
) => Promise<AgentEditResult>;

let provider: AgentEditProvider | null = null;

/** Slice 2 calls this once its session bridge is available. */
export function setAgentEditProvider(p: AgentEditProvider | null): void {
  provider = p;
}

export function isAgentEditWired(): boolean {
  return provider !== null;
}

export async function requestAgentEdit(
  req: AgentEditRequest,
): Promise<AgentEditResult> {
  if (!provider) {
    return {
      wired: false,
      proposed: null,
      note: "Agent edit is not wired yet. The Chat slice owns the per-repo session that produces the edit; once merged it registers a provider here and this flow returns a real diff. The accept-and-write path below is already live.",
    };
  }
  try {
    return await provider(req);
  } catch (e) {
    return {
      wired: true,
      proposed: null,
      note: `Agent edit failed: ${(e as Error)?.message ?? "unknown error"}`,
    };
  }
}
