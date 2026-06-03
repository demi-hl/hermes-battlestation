"use client";

import { PanePlaceholder } from "./PanePlaceholder";
import { TerminalIcon } from "@/components/shell/icons";

/** Placeholder. The Terminal slice fills this with xterm.js wired to a PTY
 *  WebSocket for the active repo's cwd. */
export function TerminalPane() {
  return (
    <PanePlaceholder
      icon={TerminalIcon}
      title="Terminal"
      blurb="A live PTY for the active repo's working directory. Run commands, watch builds, reuse the dashboard's existing PTY bridge."
    />
  );
}
