"use client";

import { usePolling } from "../usePolling";
import { Panel, StatusDot } from "../Panel";
import { EmptyState, PanelSkeleton } from "../EmptyState";
import { PolyIcon } from "../Icons";
import { uptimeFrom, bytesToMB } from "@/lib/format";
import type { BotStatus } from "@/lib/types";

export function PolymarketPanel() {
  const { data, loading, updatedAt, reload } = usePolling<BotStatus>(
    "/api/polymarket",
  );

  const online = data?.status === "online";

  return (
    <Panel
      id="panel-polymarket"
      title="Polymarket bot"
      icon={<PolyIcon />}
      updatedAt={updatedAt}
      onReload={reload}
      badge={
        data ? (
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-ink-dim">
            <StatusDot tone={online ? "up" : data.reachable ? "warn" : "down"} pulse />
            {online ? "online" : data.reachable ? data.status ?? "unknown" : "unreachable"}
          </span>
        ) : null
      }
    >
      {loading && !data ? (
        <PanelSkeleton />
      ) : !data || !data.reachable ? (
        <EmptyState
          title="Bot host unreachable"
          sub={data?.error ?? "ssh demi-poly failed"}
        />
      ) : data.name == null ? (
        <EmptyState title="demi-server not found in pm2" sub={data.error ?? undefined} />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 font-mono">
            <Stat label="uptime" value={data.uptimeMs ? uptimeFrom(data.uptimeMs) : "n/a"} />
            <Stat label="restarts" value={`${data.restarts ?? "n/a"}`} />
            <Stat label="cpu" value={data.cpu != null ? `${data.cpu}%` : "n/a"} />
          </div>
          <div className="grid grid-cols-3 gap-2 font-mono">
            <Stat label="mem" value={data.memBytes != null ? bytesToMB(data.memBytes) : "n/a"} />
            <Stat
              label="unstable"
              value={`${data.unstableRestarts ?? 0}`}
              tone={data.unstableRestarts ? "warn" : undefined}
            />
            <Stat label="proc" value={data.name} mono />
          </div>
          <div className="rounded-lg border border-line bg-bg/40 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-muted">Today PnL</span>
              <span className="text-[12px] font-medium text-faint">unavailable</span>
            </div>
            <p className="mt-0.5 text-[10.5px] text-faint">{data.pnl.reason}</p>
          </div>
        </div>
      )}
    </Panel>
  );
}

function Stat({
  label,
  value,
  tone,
  mono,
}: {
  label: string;
  value: string;
  tone?: "warn";
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-bg/40 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-faint">{label}</div>
      <div
        className={`mt-0.5 ${mono ? "truncate text-[12px]" : "text-[15px]"} font-semibold ${
          tone === "warn" ? "text-warn" : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
