"use client";

import { usePolling } from "@/components/usePolling";
import { cn } from "@/lib/utils";
import { uptimeFrom, bytesToMB, relativeTime } from "@/lib/format";
import {
  NODE_META,
  type BotProcess,
  type FleetHealth,
  type FleetMachine,
  type MachineRole,
} from "@/lib/fleet/types";
import { ServerIcon, LaptopIcon, BotIcon } from "./icons";

function roleColor(role: MachineRole): string {
  if (role === "PC" || role === "PC2" || role === "Mac" || role === "VPS")
    return NODE_META[role].color;
  return "#94a3b8";
}

function StatusDot({ ok, dim }: { ok: boolean; dim?: boolean }) {
  const color = ok ? "var(--color-success)" : "var(--color-destructive)";
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ background: color, boxShadow: dim ? "none" : `0 0 7px ${color}` }}
    />
  );
}

function MachineRow({ m }: { m: FleetMachine }) {
  const Icon = m.role === "VPS" ? ServerIcon : m.role === "Mac" ? LaptopIcon : ServerIcon;
  return (
    <div className="flex items-center gap-2.5 rounded-[var(--radius-md)] border border-border bg-card px-2.5 py-2">
      <span
        className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-sm)]"
        style={{
          color: roleColor(m.role),
          background: `color-mix(in srgb, ${roleColor(m.role)} 12%, transparent)`,
        }}
      >
        <Icon width={15} height={15} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[0.78rem] text-midground">{m.display}</span>
          {m.self && (
            <span className="font-mono-ui rounded-full bg-[color-mix(in_srgb,var(--midground)_10%,transparent)] px-1 text-[0.52rem] uppercase tracking-wide text-text-tertiary">
              this box
            </span>
          )}
        </div>
        <span className="font-mono-ui block truncate text-[0.6rem] text-text-tertiary">
          {m.role === "PC" || m.role === "PC2" || m.role === "Mac" || m.role === "VPS"
            ? NODE_META[m.role].sub
            : m.display}
          {m.os ? ` · ${m.os}` : ""}
        </span>
        {m.gpu && (
          <span className="font-mono-ui tabular block truncate text-[0.56rem] text-text-disabled">
            {m.gpu.name.replace(/^NVIDIA GeForce /, "")} · {m.gpu.utilPct}% ·{" "}
            {Math.round(m.gpu.memUsedMB / 1024)}/{Math.round(m.gpu.memTotalMB / 1024)}G ·{" "}
            {m.gpu.tempC}°C
          </span>
        )}
        {m.sys && (
          <span className="font-mono-ui tabular block truncate text-[0.56rem] text-text-disabled">
            CPU {m.sys.cpuPct}% · {m.sys.cores}c · RAM{" "}
            {Math.round(m.sys.memUsedMB / 1024)}/{Math.round(m.sys.memTotalMB / 1024)}G
          </span>
        )}
        {m.agent && (
          <span className="font-mono-ui block truncate text-[0.56rem]">
            <span
              style={{
                color: m.agent.reachable
                  ? "var(--color-success)"
                  : "var(--text-disabled)",
              }}
            >
              ● agent {m.agent.reachable ? "up" : "down"}
            </span>
            {m.agent.reachable && m.agent.latencyMs != null
              ? ` · ${m.agent.latencyMs}ms`
              : ""}
          </span>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="flex items-center gap-1.5">
          <StatusDot ok={m.online} />
          <span
            className={cn(
              "text-[0.64rem]",
              m.online ? "text-midground" : "text-text-tertiary",
            )}
          >
            {m.online ? "online" : "offline"}
          </span>
        </span>
        <span className="font-mono-ui text-[0.54rem] text-text-disabled">
          {m.controlled ? "controlled" : "status-only"}
          {!m.online && m.lastSeen ? ` · ${relativeTime(m.lastSeen)}` : ""}
        </span>
      </div>
    </div>
  );
}

function ProcRow({ p }: { p: BotProcess }) {
  const warn = !p.healthy;
  return (
    <div className="flex items-center gap-2 py-1.5">
      <StatusDot ok={p.status === "online"} dim />
      <span className="font-mono-ui min-w-0 flex-1 truncate text-[0.66rem] text-midground">
        {p.name}
      </span>
      <span className="font-mono-ui tabular flex shrink-0 items-center gap-2 text-[0.58rem] text-text-tertiary">
        {p.uptimeMs ? <span>{uptimeFrom(p.uptimeMs)}</span> : null}
        {p.cpu != null && <span>{p.cpu}%</span>}
        {p.memBytes != null && <span>{bytesToMB(p.memBytes)}</span>}
        <span
          className={cn(warn && "font-medium")}
          style={warn ? { color: "var(--color-warning)" } : undefined}
          title="restarts · unstable restarts"
        >
          ↻{p.restarts}
          {p.unstableRestarts > 0 ? ` ⚠${p.unstableRestarts}` : ""}
        </span>
      </span>
    </div>
  );
}

function BotCard({ bot }: { bot: FleetHealth["bot"] }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-border bg-card px-3 py-2.5">
      <header className="flex items-center gap-2">
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-sm)]"
          style={{
            color: NODE_META.VPS.color,
            background: `color-mix(in srgb, ${NODE_META.VPS.color} 12%, transparent)`,
          }}
        >
          <BotIcon width={15} height={15} />
        </span>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[0.78rem] text-midground">
            Polymarket bot
          </span>
          <span className="font-mono-ui block text-[0.6rem] text-text-tertiary">
            VPS · pm2
          </span>
        </div>
        <span className="flex items-center gap-1.5">
          <StatusDot ok={bot.reachable && bot.procs.every((p) => p.healthy)} />
          <span className="text-[0.64rem] text-text-secondary">
            {bot.reachable ? "reachable" : "unreachable"}
          </span>
        </span>
      </header>

      {bot.reachable ? (
        <>
          <div className="mt-1.5 divide-y divide-border/60">
            {bot.procs.length ? (
              bot.procs.map((p) => <ProcRow key={p.name} p={p} />)
            ) : (
              <p className="py-2 text-[0.64rem] text-text-tertiary">
                No bot family processes found.
              </p>
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between border-t border-border/60 pt-1.5">
            <span className="font-mono-ui text-[0.56rem] text-text-disabled">
              + {bot.otherCount} other pm2 process{bot.otherCount === 1 ? "" : "es"}
            </span>
            <span className="font-mono-ui text-[0.56rem] text-text-disabled">
              last-trade ts n/a
            </span>
          </div>
        </>
      ) : (
        <p className="mt-2 text-[0.66rem] text-[color:var(--color-warning)]">
          {bot.error ?? "bot host unreachable"}
        </p>
      )}
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-[52px] animate-pulse rounded-[var(--radius-md)] border border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)]"
        />
      ))}
    </div>
  );
}

export function FleetHealthStrip() {
  const { data, loading, error, updatedAt } = usePolling<FleetHealth>(
    "/api/fleet/health",
    10_000,
  );

  return (
    <section className="px-3 pt-1">
      <header className="mb-2 flex items-baseline justify-between">
        <h3 className="text-display font-mondwest text-[0.72rem] tracking-[0.14em] text-text-secondary">
          Fleet health
        </h3>
        {updatedAt && (
          <span className="font-mono-ui text-[0.56rem] text-text-disabled">
            tailscale + pm2 · {relativeTime(updatedAt)}
          </span>
        )}
      </header>

      {loading && !data ? (
        <SkeletonRows />
      ) : (
        <div className="flex flex-col gap-2">
          {data?.machines.map((m) => <MachineRow key={m.key} m={m} />)}
          {data?.bot && <BotCard bot={data.bot} />}
          {error && !data && (
            <p className="text-[0.66rem] text-[color:var(--color-warning)]">{error}</p>
          )}
        </div>
      )}
    </section>
  );
}
