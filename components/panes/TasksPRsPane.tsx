"use client";

import { PanePlaceholder } from "./PanePlaceholder";
import { PullRequestIcon } from "@/components/shell/icons";

/** Placeholder. The Tasks & PRs slice fills this with `gh`-authed open PRs and
 *  assigned issues for the active repo plus an all-repos roll-up. */
export function TasksPRsPane() {
  return (
    <PanePlaceholder
      icon={PullRequestIcon}
      title="Tasks & PRs"
      blurb="Open pull requests and assigned issues across your repos, with CI status, review state, and diff stats from the gh CLI."
    />
  );
}
