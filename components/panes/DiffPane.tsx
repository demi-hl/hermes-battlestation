"use client";

import { PanePlaceholder } from "./PanePlaceholder";
import { DiffIcon } from "@/components/shell/icons";

/** Placeholder. The Diff slice fills this with a read-only `git diff` review
 *  view (staged + unstaged) for the active repo. */
export function DiffPane() {
  return (
    <PanePlaceholder
      icon={DiffIcon}
      title="Diff"
      blurb="Staged and unstaged git changes for the active repo, in a review-first view built for steering, not editing."
    />
  );
}
