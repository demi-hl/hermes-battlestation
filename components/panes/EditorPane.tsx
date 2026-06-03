"use client";

import { PanePlaceholder } from "./PanePlaceholder";
import { EditorIcon } from "@/components/shell/icons";

/** Placeholder. The Editor slice fills this with CodeMirror 6 (touch-native)
 *  for the active repo. */
export function EditorPane() {
  return (
    <PanePlaceholder
      icon={EditorIcon}
      title="Editor"
      blurb="A CodeMirror 6 viewer and light editor for the active repo. The agent types the heavy edits; you steer and save."
    />
  );
}
