"use client";

import { PanePlaceholder } from "./PanePlaceholder";
import { ChatIcon } from "@/components/shell/icons";

/** Placeholder. The Chat slice fills this with the per-repo agent threads
 *  (the messaging hub that replaces Telegram). */
export function ChatPane() {
  return (
    <PanePlaceholder
      icon={ChatIcon}
      title="Chat"
      blurb="Talk to the Hermes agent here. One persistent thread per repo, plus a general thread. This is the messaging hub, not a side tab."
    />
  );
}
