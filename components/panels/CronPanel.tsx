"use client";

import { usePolling } from "../usePolling";
import { Panel, StatusDot } from "../Panel";
import { EmptyState, PanelSkeleton } from "../EmptyState";
import { ClockIcon } from "../Icons";
import type { CronList } from "@/lib/types";

export function CronPanel() {
  const { data, loading, updatedAt, reload } = usePolling<CronList>("/api/cron");

  return (
    <Panel
      title="Cron jobs"
      icon={<ClockIcon />}
      updatedAt={updatedAt}
      onReload={reload}
      badge={
        data?.available ? (
          <span className="text-[11px] font-mono text-ink-dim">
            {data.jobs.length}
          </span>
        ) : null
      }
    >
      {loading && !data ? (
        <PanelSkeleton />
      ) : !data || !data.available ? (
        <EmptyState
          title="Cron feed unavailable"
          sub={data?.note ?? "dashboard not running"}
        />
      ) : data.jobs.length === 0 ? (
        <EmptyState title="No cron jobs scheduled" />
      ) : (
        <ul className="space-y-1.5">
          {data.jobs.map((j) => (
            <li
              key={j.id || j.name}
              className="flex items-center gap-2.5 rounded-lg border border-line bg-bg/40 px-3 py-2"
            >
              <StatusDot
                tone={
                  !j.enabled
                    ? "idle"
                    : j.lastStatus === "ok"
                      ? "up"
                      : j.lastStatus
                        ? "down"
                        : "warn"
                }
              />
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-medium text-ink">
                  {j.name}
                </div>
                <div className="font-mono text-[10.5px] text-faint">{j.schedule}</div>
              </div>
              <span className="ml-auto shrink-0 font-mono text-[10.5px] text-muted">
                {j.lastStatus ?? "no runs"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
