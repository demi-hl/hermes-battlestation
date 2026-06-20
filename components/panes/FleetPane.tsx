"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { usePolling } from "@/components/usePolling";
import { resolveLane, type FleetAgent } from "@/lib/fleet/types";
import { FleetHealthStrip } from "./fleet/FleetHealthStrip";
import { AgentBoard } from "./fleet/AgentBoard";
import { PullToRefresh } from "./parts";

/** Fleet pane: compact fleet health summary + live agent kanban board.
 *  Agents fetched from /api/fleet/agents and lane-resolved (done requires
 *  a real commit sha). Stale detection is handled inside AgentCard. */
export function FleetPane() {
  const {
    data: rawAgents,
    loading,
    error,
    updatedAt,
    reload,
  } = usePolling<FleetAgent[]>("/api/fleet/agents", 5_000);

  /* HARD RULE: enforce that `done` requires a real commit sha. */
  const agents = useMemo(
    () => (rawAgents ?? []).map(resolveLane),
    [rawAgents],
  );

  return (
    <PullToRefresh onRefresh={reload}>
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col gap-3 pt-1"
    >
      {/* Compact fleet health summary */}
      <FleetHealthStrip />

      {/* Agent kanban board */}
      <div className="px-3">
        <header className="mb-2 flex items-baseline justify-between">
          <h3 className="text-display font-mondwest text-[0.72rem] tracking-[0.14em] text-text-secondary">
            Agents
          </h3>
          {updatedAt && (
            <span className="font-mono-ui text-[0.56rem] text-text-disabled">
              {agents.length} active · polled {updatedAt ? new Date(updatedAt).toLocaleTimeString() : ""}
            </span>
          )}
        </header>

        {loading && !rawAgents ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-[120px] animate-pulse rounded-[var(--radius-md)] border border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)]"
              />
            ))}
          </div>
        ) : (
          <AgentBoard agents={agents} />
        )}

        {error && (
          <p className="mt-2 font-mono-ui text-[0.6rem] text-[color:var(--color-warning)]">
            {error}
          </p>
        )}
      </div>
    </motion.div>
    </PullToRefresh>
  );
}
