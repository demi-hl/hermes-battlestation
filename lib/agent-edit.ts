// Client contract for agent-inline-edit. The chat slice OWNS the session-call +
// diff-extraction (see app/api/agent-edit/route.ts). The editor slice (3)
// imports `requestAgentEdit` + the types and renders the entry point + review
// UI; the polish slice (6) wires accept->write-to-disk using `file.newContent`.
//
// Stub note for slice 3: call `requestAgentEdit({ repo, path, instruction })`
// and render `result.files[]` (each carries `diff`, `oldContent`, `newContent`,
// `additions`, `deletions`). `result.ok === false` => show `result.error`;
// empty `files` with `result.ok === true` => the agent made no change
// (`result.note`).

import type { AgentEditRequest, AgentEditResult } from "./chat-types";

export type { AgentEditRequest, AgentEditResult, AgentEditFile } from "./chat-types";

/**
 * Drive the active repo's Hermes session to edit one file and return a
 * structured, reviewable diff. The change is NOT written to disk here (it is
 * extracted then restored) so the review UI can accept or reject it.
 */
export async function requestAgentEdit(
  req: AgentEditRequest,
  signal?: AbortSignal,
): Promise<AgentEditResult> {
  try {
    const res = await fetch("/api/agent-edit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      signal,
    });
    const data = (await res.json()) as AgentEditResult;
    return data;
  } catch (e) {
    return {
      ok: false,
      files: [],
      sessionId: null,
      error: e instanceof Error ? e.message : "agent edit request failed",
    };
  }
}
