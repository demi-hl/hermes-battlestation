"use client";

import { ChatHub } from "@/components/chat/ChatHub";

/**
 * Chat slice entry point. The tab registry (slice 1) maps the `chat` tab to this
 * component; we keep that contract and render the real per-repo messaging hub
 * (ChatHub) instead of the placeholder.
 */
export function ChatPane() {
  return <ChatHub />;
}
