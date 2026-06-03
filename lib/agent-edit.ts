/**
 * Agent-inline-edit interface (cross-slice contract).
 *
 * PROJECT.md makes the agent a first-class editor: from a file/selection you ask
 * the agent to edit, review the returned diff, then accept (write to disk) or
 * reject. The SESSION call that produces the edit is owned by the Chat slice
 * (slice 2) — it holds the per-repo Hermes session and calls /api/agent-edit.
 * THIS slice (Editor) owns the entry point + the diff-review UI.
 *
 * `requestAgentEdit` is the seam. When slice 2 is merged it sets a real provider
 * via `setAgentEditProvider`; until then the default returns an honest `unwired`
 * result so the UI degrades to a clear "wiring pending" state.
 */

export interface AgentEditRequest {
  repo: string;
  path: string;
  content: string;
  selection?: { from: number; to: number; text: string };
  instruction: string;
}

export interface AgentEditResult {
  wired: boolean;
  proposed: string | null;
  note: string;
}

export type AgentEditProvider = (req: AgentEditRequest) => Promise<AgentEditResult>;

let provider: AgentEditProvider | null = null;

export function setAgentEditProvider(p: AgentEditProvider | null): void {
  provider = p;
}

export function isAgentEditWired(): boolean {
  return provider !== null;
}

export async function requestAgentEdit(req: AgentEditRequest): Promise<AgentEditResult> {
  if (!provider) {
    return {
      wired: false,
      proposed: null,
      note: "Agent edit is not wired yet. The Chat slice owns the per-repo session that produces the edit; once merged it registers a provider here and this flow returns a real diff.",
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