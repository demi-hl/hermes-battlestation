// Shapes for the Kanban pane. Mirrors the real `hermes kanban` JSON (SQLite
// board at ~/.hermes/kanban.db) — fields kept are the subset the pane renders.

export type KanbanStatus =
  | "triage"
  | "todo"
  | "ready"
  | "scheduled"
  | "running"
  | "review"
  | "blocked"
  | "done"
  | "archived";

export interface KanbanTask {
  id: string;
  title: string;
  body: string | null;
  assignee: string | null;
  status: KanbanStatus;
  priority: number;
  workspace_kind: string;
  branch_name: string | null;
  created_by: string | null;
  /** unix seconds. */
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  skills: string[];
}

export interface KanbanEvent {
  kind: string;
  created_at: number;
  run_id: string | null;
  payload?: Record<string, unknown> | null;
}

export interface KanbanComment {
  author?: string | null;
  body?: string | null;
  created_at?: number;
}

export interface KanbanTaskDetail {
  task: KanbanTask;
  comments: KanbanComment[];
  events: KanbanEvent[];
  latest_summary?: string | null;
}

export interface KanbanData {
  board: string;
  tasks: KanbanTask[];
}

/** Column layout. Real board statuses are grouped into the four review-friendly
 *  columns from the brief (ready / in-progress / blocked / done) plus a Review
 *  lane the Hermes board uses between running and done. */
export const KANBAN_COLUMNS: {
  id: string;
  label: string;
  statuses: KanbanStatus[];
}[] = [
  { id: "ready", label: "Ready", statuses: ["triage", "todo", "ready", "scheduled"] },
  { id: "running", label: "In Progress", statuses: ["running"] },
  { id: "review", label: "Review", statuses: ["review"] },
  { id: "blocked", label: "Blocked", statuses: ["blocked"] },
  { id: "done", label: "Done", statuses: ["done"] },
];

/** Accent per status for the card pill. */
export const STATUS_COLOR: Record<KanbanStatus, string> = {
  triage: "#94a3b8",
  todo: "#94a3b8",
  ready: "#7dd3fc",
  scheduled: "#a78bfa",
  running: "#2dd4bf",
  review: "#f5b54a",
  blocked: "#fb7185",
  done: "#4ade80",
  archived: "#6b7280",
};
