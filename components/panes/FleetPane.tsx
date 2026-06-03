"use client";

import { motion } from "framer-motion";
import { usePolling } from "@/components/usePolling";
import type { FleetAgent } from "@/lib/fleet/types";
import { AgentBoard } from "./fleet/AgentBoard";
import { FleetHealthStrip } from "./fleet/FleetHealthStrip";

/** Fleet pane: the Team-of-Agents board (centerpiece) over the live fleet
 *  health strip. The board polls every 3s; lanes are derived from ground
 *  truth in production (here from the fixture feed) and animate on change. */
export function FleetPane() {
  const { data, loading, error } = usePolling<FleetAgent[]>(
    "/api/fleet/agents",
    3_000,
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col gap-4 pt-1"
    >
      <header className="flex items-baseline justify-between px-3">
        <h2 className="text-display font-mondwest text-base tracking-[0.1em] text-midground">
          Team of agents
        </h2>
        <span
          className="font-mono-ui rounded-full border border-border px-1.5 py-0.5 text-[0.54rem] uppercase tracking-[0.14em] text-text-tertiary"
          title="Board renders off fleet.mock.ts. Real orchestrator registry hookup is an integration-phase task."
        >
          fixture · 3s
        </span>
      </header>

      {loading && !data ? (
        <BoardSkeleton />
      ) : data ? (
        <AgentBoard agents={data} />
      ) : (
        <p className="px-3 text-[0.7rem] text-[color:var(--color-warning)]">
          {error ?? "could not load fleet agents"}
        </p>
      )}

      <div className="mx-3 border-t border-border/60" />

      <FleetHealthStrip />
    </motion.div>
  );
}

function BoardSkeleton() {
  return (
    <div className="scrollbar-none flex gap-3 overflow-hidden px-3">
      {[0, 1, 2, 3].map((col) => (
        <div key={col} className="w-[78vw] max-w-[260px] shrink-0">
          <div className="mb-2 h-3 w-20 animate-pulse rounded bg-[color-mix(in_srgb,var(--midground)_10%,transparent)]" />
          <div className="flex flex-col gap-2">
            {[0, 1].map((c) => (
              <div
                key={c}
                className="h-[92px] animate-pulse rounded-[var(--radius-md)] border border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)]"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
