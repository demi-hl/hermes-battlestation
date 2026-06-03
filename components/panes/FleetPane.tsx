"use client";

import { PanePlaceholder } from "./PanePlaceholder";
import { FleetIcon } from "@/components/shell/icons";

/** Placeholder. The Fleet slice fills this with live tailnet machine status
 *  and the Polymarket bot PM2 health card. */
export function FleetPane() {
  return (
    <PanePlaceholder
      icon={FleetIcon}
      title="Fleet"
      blurb="Live status of every machine on the tailnet, who is working on what, and the Polymarket bot's PM2 health at a glance."
    />
  );
}
