// Pure shared shapes for the Repos / Editor / Terminal slice. No node imports so
// client components can import these without dragging the fs/git layer into the
// browser bundle. The server layer (lib/workspace-fs.ts) imports the same types.

export type WorkspaceType = "worktree" | "branch";

export interface Workspace {
  name: string;
  type: WorkspaceType;
  path: string;
  isCurrent: boolean;
  checkedOut: boolean;
}

export interface RepoSummary {
  slug: string;
  root: string;
  currentBranch: string | null;
  base: string | null;
  workspaces: Workspace[];
}

export interface WorkspacesResponse {
  login: string | null;
  repos: RepoSummary[];
  fetchedAt: string;
  error?: string;
}

export interface DiffStat {
  adds: number;
  dels: number;
  files: number;
  includesWorking: boolean;
}

export interface TreeEntry {
  name: string;
  path: string;
  type: "dir" | "file";
}

export interface ReadResult {
  path: string;
  binary: boolean;
  tooLarge: boolean;
  size: number;
  content: string | null;
}

/** Repo avatar: two-letter abbreviation or custom image URL. Stored in localStorage. */
export interface RepoAvatar {
  letters: string;
  imageUrl?: string;
}

/** Hermes agent profile: model + provider + optional skill bundle. */
export interface AgentProfile {
  id: string;
  label: string;
  model: string;
  provider: string;
  /** Optional skill bundle name loaded when this profile is active. */
  skills?: string[];
}

/** An active/live session in progress. */
export interface ActiveSession {
  repo: string;
  branch: string;
  sessionId: string | null;
  startedAt: number;
  messageCount: number;
  usage: { used: number; total: number } | null;
}
