"use client";

import { usePolling } from "../usePolling";
import { Panel, StatusDot } from "../Panel";
import { PanelSkeleton } from "../EmptyState";
import { FleetIcon } from "../Icons";
import type { FleetHost } from "@/lib/types";

export function FleetPanel() {
  const { data, loading, updatedAt, reload } = usePolling<FleetHost[]>("/api/fleet");
  const upCount = data?.filter((h) => h.up).length ?? 0;

  return (
    <Panel
      id="panel-fleet"
      title="Fleet health"
      icon={<FleetIcon />}
      updatedAt={updatedAt}
      onReload={reload}
      badge={
        data ? (
          <span className="text-[11px] font-mono text-ink-dim">
            {upCount}/{data.length} up
          </span>
        ) : null
      }
    >
      {loading && !data ? (
        <PanelSkeleton />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {(data ?? []).map((h) => (
            <div
              key={h.host}
              className="rounded-lg border border-line bg-bg/40 px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <StatusDot tone={h.up ? "up" : "down"} pulse={h.up} />
                <span className="text-[13px] font-medium text-ink">{h.label}</span>
                {h.local && (
                  <span className="ml-auto text-[9.5px] uppercase tracking-wider text-faint">
                    local
                  </span>
                )}
              </div>
              <div className="mt-1 font-mono text-[11px] text-muted">
                {h.up
                  ? h.latencyMs != null
                    ? `${h.latencyMs} ms`
                    : "reachable"
                  : "down"}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
