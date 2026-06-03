"use client";

import { usePolling } from "../usePolling";
import { Panel } from "../Panel";
import { EmptyState, PanelSkeleton } from "../EmptyState";
import { InboxIcon } from "../Icons";
import type { CaptureInbox } from "@/lib/types";

export function CaptureInboxPanel() {
  const { data, loading, updatedAt, reload } = usePolling<CaptureInbox>("/api/inbox");

  return (
    <Panel
      title="Capture inbox"
      icon={<InboxIcon />}
      updatedAt={updatedAt}
      onReload={reload}
    >
      {loading && !data ? (
        <PanelSkeleton />
      ) : !data || !data.available ? (
        <EmptyState title="Inbox unreadable" sub={data?.note ?? undefined} />
      ) : (
        <div className="flex items-center gap-3.5">
          <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-lg border border-line bg-bg/40">
            <span className="text-[22px] font-semibold leading-none text-accent">
              {data.countToday}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-[13px] text-ink-dim">
              {data.countToday === 0
                ? "no captures today"
                : `captured today`}
            </p>
            <p className="truncate font-mono text-[11px] text-faint">
              {data.files.length ? data.files.join("  ") : "Inbox/ clean"}
            </p>
          </div>
        </div>
      )}
    </Panel>
  );
}
