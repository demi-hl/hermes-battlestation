"use client";

import { PanePlaceholder } from "./PanePlaceholder";
import { KanbanIcon } from "@/components/shell/icons";

/** Placeholder. The Kanban slice fills this with the shared Hermes task board
 *  (`hermes kanban ls --json`), grouped by status. */
export function KanbanPane() {
  return (
    <PanePlaceholder
      icon={KanbanIcon}
      title="Kanban"
      blurb="The shared Hermes task board, grouped by ready, in-progress, blocked, and done. Tap a task for its comments and events."
    />
  );
}
