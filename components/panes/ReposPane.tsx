"use client";

import { PanePlaceholder } from "./PanePlaceholder";
import { ReposIcon } from "@/components/shell/icons";

/** Placeholder. The Repos slice fills this with the Conductor-style workspace
 *  list: repos with branch counts, expandable workspaces, live diff stats. */
export function ReposPane() {
  return (
    <PanePlaceholder
      icon={ReposIcon}
      title="Repos"
      blurb="Every git repo across the fleet, each expandable into its branches and live +adds / -dels diff stats. Selecting one binds the active context."
    />
  );
}
