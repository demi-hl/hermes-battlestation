"use client";

import { usePolling } from "../usePolling";
import { Panel, StatusDot } from "../Panel";
import { EmptyState, PanelSkeleton } from "../EmptyState";
import { CpuIcon } from "../Icons";
import { uptimeFrom } from "@/lib/format";
import type { Builds } from "@/lib/types";

export function ActiveBuildsPanel() {
  const { data, loading, updatedAt, reload } = usePolling<Builds>("/api/builds");

  return (
    <Panel
      title="Active builds"
      icon={<CpuIcon />}
      updatedAt={updatedAt}
      onReload={reload}
      badge={
        data?.available ? (
          <span className="text-[11px] font-mono text-ink-dim">
            {data.jobs.length} pm2
          </span>
        ) : null
      }
    >
      {loading && !data ? (
        <PanelSkeleton />
      ) : !data || !data.available ? (
        <EmptyState
          title="No PC PM2 jobs"
          sub={data?.note ?? "pm2 not present on PC local"}
        />
      ) : data.jobs.length === 0 ? (
        <EmptyState title="No running pm2 jobs on PC local" />
      ) : (
        <ul className="space-y-1.5">
          {data.jobs.map((j) => (
            <li
              key={j.name}
              className="flex items-center gap-2.5 rounded-lg border border-line bg-bg/40 px-3 py-2"
            >
              <StatusDot
                tone={j.status === "online" ? "up" : j.status === "stopped" ? "down" : "warn"}
                pulse={j.status === "online"}
              />
              <span className="truncate text-[13px] font-medium text-ink">{j.name}</span>
              <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">
                {j.uptimeMs && j.status === "online" ? uptimeFrom(j.uptimeMs) : j.status}
                {j.cpu != null && j.status === "online" ? ` · ${j.cpu}%` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
