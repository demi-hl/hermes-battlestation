"use client";

import { PanePlaceholder } from "./PanePlaceholder";
import { AutomationIcon } from "@/components/shell/icons";

/** Placeholder. The Automations slice fills this with scheduled Hermes work
 *  (cron jobs / scheduled kanban tasks), read-only for v1. */
export function AutomationsPane() {
  return (
    <PanePlaceholder
      icon={AutomationIcon}
      title="Automations"
      blurb="Scheduled Hermes work: cron jobs and recurring tasks. A read-only view of what runs on its own across the fleet."
    />
  );
}
