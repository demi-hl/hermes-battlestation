"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "./workspace-context";
import { usePolling } from "@/components/usePolling";
import type { CronList } from "@/lib/types";
import type { FleetAgent } from "@/lib/fleet/types";
import type { StatusInfo } from "@/app/api/status/route";

interface RuntimeConfig {
  model: { default: string; provider: string; base_url: string };
  approvals: { mode: string };
  agent: { reasoning_effort?: string; max_turns?: number };
}

// Hermes effort levels → display label. "max" is Anthropic's top adaptive
// level (xhigh is preserved on 4.7/4.8, downgraded to max on older models).
const EFFORT_LABEL: Record<string, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
};

// Bottom CLI-style status line for the desktop IDE shell. Mirrors the Hermes
// CLI status bar: gateway health + agents + cron on the left; context meter,
// session timer, active model, and version on the right. Every value is live —
// gateway/context/model from the workspace store, agents/cron/version polled.

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

const GATEWAY_LABEL: Record<string, string> = {
  online: "Gateway ready",
  connecting: "Gateway connecting",
  offline: "Gateway offline",
};
const GATEWAY_DOT: Record<string, string> = {
  online: "var(--positive, #6ee7b7)",
  connecting: "var(--warning, #fbbf24)",
  offline: "var(--negative, #f87171)",
};

export function StatusBar() {
  const { status, contextUsage, model } = useWorkspace();

  // Live polls — slow cadence; the status line is glanceable, not real-time.
  const cron = usePolling<CronList>("/api/cron", 60_000);
  const agents = usePolling<FleetAgent[]>("/api/fleet/agents", 30_000);
  const info = usePolling<StatusInfo>("/api/status", 300_000);
  const rc = usePolling<RuntimeConfig>("/api/runtime-config", 120_000);

  // App-session timer — ticks once a second from first mount.
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const used = contextUsage?.used ?? 0;
  const total = contextUsage?.total ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

  const activeAgents = (agents.data ?? []).filter(
    (a) => a.lane === "working" || a.lane === "spawned",
  ).length;
  const enabledCron = (cron.data?.jobs ?? []).filter((j) => j.enabled).length;

  const v = info.data;
  const versionLabel = v?.hermesVersion ? `v${v.hermesVersion}` : null;
  const aheadLabel = typeof v?.appAhead === "number" && v.appAhead > 0 ? ` (+${v.appAhead})` : "";

  return (
    <footer
      className="relative z-[2] flex h-7 w-full shrink-0 items-center justify-between gap-4 overflow-hidden border-t border-border px-3 font-mono-ui text-[0.68rem] text-text-tertiary"
      style={{
        background: "color-mix(in srgb, var(--background-base) 82%, transparent)",
        backdropFilter: "blur(12px) saturate(140%)",
        WebkitBackdropFilter: "blur(12px) saturate(140%)",
      }}
    >
      {/* ── Left cluster: gateway · agents · cron ── */}
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex shrink-0 items-center gap-1.5" title={`gateway ${status}`}>
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: GATEWAY_DOT[status] ?? GATEWAY_DOT.offline }}
          />
          <span className="truncate">{GATEWAY_LABEL[status] ?? "Gateway"}</span>
        </span>

        <span className="flex shrink-0 items-center gap-1" title={`${activeAgents} active agents`}>
          <span className="text-text-quaternary">⚡</span>
          <span>Agents</span>
          {activeAgents > 0 && <span className="tabular text-midground">{activeAgents}</span>}
        </span>

        <span
          className="flex shrink-0 items-center gap-1"
          title={cron.data?.available ? `${enabledCron} cron jobs enabled` : "cron unavailable"}
        >
          <span className="text-text-quaternary">⏱</span>
          <span>Cron</span>
          {enabledCron > 0 && <span className="tabular text-midground">{enabledCron}</span>}
        </span>
      </div>

      {/* ── Right cluster: tokens · meter · session · model · version ── */}
      <div className="flex shrink-0 items-center gap-3">
        {total > 0 && (
          <span className="flex items-center gap-1.5 tabular" title={`${used} / ${total} tokens`}>
            <span>
              {fmtTokens(used)}/{fmtTokens(total)}
            </span>
            <span className="relative h-1.5 w-12 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--midground)_14%,transparent)]">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-[color-mix(in_srgb,var(--midground)_55%,transparent)]"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span>{pct}%</span>
          </span>
        )}

        <span className="flex items-center gap-1.5 tabular" title="app session uptime">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--positive, #6ee7b7)", boxShadow: "0 0 6px var(--positive, #6ee7b7)" }}
          />
          <span>Session {fmtElapsed(now - start)}</span>
        </span>

        <span className="flex items-center gap-1" title={`${model.id} · effort ${rc.data?.agent?.reasoning_effort ?? "?"}`}>
          <span className="font-medium text-midground">{model.label}</span>
          {rc.data?.agent?.reasoning_effort && (
            <>
              <span className="text-text-quaternary">·</span>
              <span>{EFFORT_LABEL[rc.data.agent.reasoning_effort] ?? rc.data.agent.reasoning_effort}</span>
            </>
          )}
        </span>

        {versionLabel && (
          <span className="flex items-center gap-1 text-text-quaternary" title={`hermes ${versionLabel} · app ${v?.appCommit ?? ""}`}>
            <span>#</span>
            <span className="text-midground">{versionLabel}{aheadLabel}</span>
            {v?.appCommit && <span>{v.appCommit}</span>}
          </span>
        )}
      </div>
    </footer>
  );
}
