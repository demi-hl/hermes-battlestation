"use client";

import { useState } from "react";
import { ChatIcon, ExternalIcon } from "./Icons";
import { StatusDot } from "./Panel";

const CHAT_URL =
  process.env.NEXT_PUBLIC_HERMES_CHAT_URL ?? "http://127.0.0.1:9119/chat";

// Center pane: the embedded Hermes chat (dashboard --tui). Loaded via iframe to
// the loopback dashboard, which self-authenticates with its injected session
// token. Works when browsing from the PC where the dashboard is reachable.
export function ChatPane() {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-surface/60 px-4 py-2.5 backdrop-blur-sm">
        <span className="text-accent">
          <ChatIcon width={16} height={16} />
        </span>
        <span className="text-[13px] font-semibold tracking-wide text-ink">
          Chat with Hermes
        </span>
        <span className="ml-2 flex items-center gap-1.5 text-[10.5px] text-faint">
          <StatusDot tone={loaded ? "up" : "warn"} pulse={loaded} />
          {loaded ? "embedded TUI" : "connecting"}
        </span>
        <a
          href={CHAT_URL}
          target="_blank"
          rel="noreferrer"
          className="ml-auto flex items-center gap-1 text-[11px] text-faint transition-colors hover:text-accent"
        >
          open <ExternalIcon />
        </a>
      </div>
      <div className="relative min-h-0 flex-1 bg-bg">
        {!loaded && (
          <div className="absolute inset-0 z-[1] flex items-center justify-center">
            <div className="flex items-center gap-2 text-[12px] text-muted">
              <span className="h-3.5 w-3.5 rounded-full border-2 border-line border-t-accent spin" />
              loading embedded chat
            </div>
          </div>
        )}
        <iframe
          src={CHAT_URL}
          title="Hermes chat"
          onLoad={() => setLoaded(true)}
          className="h-full w-full border-0 bg-bg"
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </div>
  );
}
