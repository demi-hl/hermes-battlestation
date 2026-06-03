"use client";

import { usePolling } from "../usePolling";
import { Panel } from "../Panel";
import { EmptyState, PanelSkeleton } from "../EmptyState";
import { BoltIcon } from "../Icons";
import { compactNumber } from "@/lib/format";
import type { MaxUsage } from "@/lib/types";

export function MaxUsagePanel() {
  const { data, loading, updatedAt, reload } = usePolling<MaxUsage>("/api/max-usage");

  return (
    <Panel
      title="Max usage"
      icon={<BoltIcon />}
      updatedAt={updatedAt}
      onReload={reload}
      badge={
        data?.ok ? (
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
              data.high
                ? "bg-warn/15 text-warn"
                : "bg-accent-soft text-accent"
            }`}
          >
            {data.high ? "high" : "nominal"}
          </span>
        ) : null
      }
    >
      {loading && !data ? (
        <PanelSkeleton />
      ) : !data || !data.ok ? (
        <EmptyState title="Max usage unreadable" sub={data?.error ?? undefined} />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 font-mono">
            <div className="rounded-lg border border-line bg-bg/40 px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wider text-faint">
                calls today
              </div>
              <div className="mt-0.5 text-[18px] font-semibold text-ink">
                {data.calls != null ? compactNumber(data.calls) : "n/a"}
              </div>
            </div>
            <div className="rounded-lg border border-line bg-bg/40 px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wider text-faint">
                tokens today
              </div>
              <div className="mt-0.5 text-[18px] font-semibold text-ink">
                {data.tokens != null ? compactNumber(data.tokens) : "n/a"}
              </div>
            </div>
          </div>
          {data.throttleSignals > 0 && (
            <div className="rounded-lg border border-warn/25 bg-warn/10 px-3 py-2 text-[11.5px] text-warn">
              {data.throttleSignals} throttle signal
              {data.throttleSignals === 1 ? "" : "s"} today, may be near the cap
            </div>
          )}
          <p className="text-[10.5px] leading-relaxed text-faint">{data.note}</p>
        </div>
      )}
    </Panel>
  );
}
