"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { haptic } from "@/components/shell/haptics";
import {
  FLOW_LANES,
  FLOW_LANE_ORDER,
  NODE_META,
  type AgentLane,
  type AgentNode,
  type FleetAgent,
} from "@/lib/fleet/types";
import { AgentCard } from "./AgentCard";
import { AdvanceIcon, RefreshIcon } from "./icons";

const DESTRUCTIVE = "#fb2c36";

/** Derive the live count header: working agents per node + the bot state. */
function CountHeader({ agents }: { agents: FleetAgent[] }) {
  const working = (node: AgentNode) =>
    agents.filter((a) => a.node === node && a.lane === "working").length;
  const vpsLive = agents.some((a) => a.node === "VPS" && a.lane === "working");

  const segs: { node: AgentNode; text: string }[] = [
    { node: "PC", text: working("PC") ? `${working("PC")} working` : "idle" },
    {
      node: "PC2",
      text: working("PC2") ? `${working("PC2")} working` : "idle",
    },
    { node: "Mac", text: working("Mac") ? `${working("Mac")} working` : "idle" },
    { node: "VPS", text: vpsLive ? "bot ok" : "idle" },
  ];

  return (
    <div className="font-mono-ui flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.64rem] text-text-secondary">
      {segs.map((s, i) => (
        <span key={s.node} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-text-disabled">·</span>}
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: NODE_META[s.node].color,
              boxShadow: `0 0 5px ${NODE_META[s.node].color}`,
            }}
          />
          <span className="text-midground">{NODE_META[s.node].label}:</span>
          <span>{s.text}</span>
        </span>
      ))}
    </div>
  );
}

function LaneColumn({
  label,
  agents,
  childrenOf,
  now,
}: {
  label: string;
  agents: FleetAgent[];
  childrenOf: (a: FleetAgent) => FleetAgent[];
  now: number;
}) {
  return (
    <section className="flex w-[78vw] max-w-[260px] shrink-0 snap-start flex-col">
      <header className="mb-2 flex items-center gap-2 px-0.5">
        <span className="text-display font-mondwest text-[0.66rem] tracking-[0.12em] text-text-secondary">
          {label}
        </span>
        <span className="font-mono-ui tabular grid h-4 min-w-4 place-items-center rounded-full bg-[color-mix(in_srgb,var(--midground)_12%,transparent)] px-1 text-[0.58rem] text-text-tertiary">
          {agents.length}
        </span>
      </header>
      <div className="flex flex-col gap-2">
        <AnimatePresence initial={false} mode="popLayout">
          {agents.map((a) => (
            <AgentCard key={a.id} agent={a} childAgents={childrenOf(a)} now={now} />
          ))}
        </AnimatePresence>
        {agents.length === 0 && (
          <div className="rounded-[var(--radius-md)] border border-dashed border-border/60 px-3 py-4 text-center text-[0.62rem] text-text-disabled">
            empty
          </div>
        )}
      </div>
    </section>
  );
}

export function AgentBoard({ agents }: { agents: FleetAgent[] }) {
  // Fixture-driven demo overlay: advance one agent a lane at a time so the
  // Framer layout transition between lanes is demonstrable standalone (real
  // lane changes arrive from the orchestrator poll in the integration phase).
  const [advanced, setAdvanced] = useState<Record<string, AgentLane>>({});
  const now = Date.now();

  const view = useMemo(
    () =>
      agents.map((a) =>
        advanced[a.id] ? { ...a, lane: advanced[a.id], lastSignal: now } : a,
      ),
    [agents, advanced, now],
  );

  const byId = useMemo(() => {
    const m = new Map<string, FleetAgent>();
    for (const a of view) m.set(a.id, a);
    return m;
  }, [view]);

  const topLevel = useMemo(() => view.filter((a) => !a.parentId), [view]);
  const childrenOf = (a: FleetAgent): FleetAgent[] =>
    (a.children ?? []).map((id) => byId.get(id)).filter((c): c is FleetAgent => Boolean(c));

  const blocked = topLevel.filter((a) => a.lane === "blocked");

  const advance = () => {
    // Move the least-advanced movable top-level agent one lane forward.
    const movable = topLevel
      .filter((a) => a.lane !== "blocked" && a.lane !== "done")
      .sort(
        (a, b) =>
          FLOW_LANE_ORDER.indexOf(a.lane as Exclude<AgentLane, "blocked">) -
          FLOW_LANE_ORDER.indexOf(b.lane as Exclude<AgentLane, "blocked">),
      );
    const target = movable[0];
    if (!target) return;
    const idx = FLOW_LANE_ORDER.indexOf(target.lane as Exclude<AgentLane, "blocked">);
    const next = FLOW_LANE_ORDER[Math.min(idx + 1, FLOW_LANE_ORDER.length - 1)];
    haptic(8);
    setAdvanced((prev) => ({ ...prev, [target.id]: next }));
  };

  return (
    <div>
      <div className="mb-2.5 flex items-start justify-between gap-2 px-3">
        <CountHeader agents={topLevel} />
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={advance}
            aria-label="Demo: advance an agent to the next lane"
            className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[0.6rem] text-text-secondary transition-colors active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]"
          >
            <AdvanceIcon width={12} height={12} />
            advance
          </button>
          {Object.keys(advanced).length > 0 && (
            <button
              type="button"
              onClick={() => {
                haptic(6);
                setAdvanced({});
              }}
              aria-label="Reset the demo advance overlay"
              className="grid h-6 w-6 place-items-center rounded-full border border-border text-text-tertiary transition-colors active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]"
            >
              <RefreshIcon width={12} height={12} />
            </button>
          )}
        </div>
      </div>

      <LayoutGroup>
        <div className="scrollbar-none flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-1">
          {FLOW_LANES.map((l) => (
            <LaneColumn
              key={l.id}
              label={l.label}
              agents={topLevel.filter((a) => a.lane === l.id)}
              childrenOf={childrenOf}
              now={now}
            />
          ))}
        </div>

        {/* BLOCKED tray — pinned below the flow, red so a stuck box can't hide. */}
        <div className="mt-3 px-3">
          <div
            className="rounded-[var(--radius-lg)] border px-3 py-2.5"
            style={{
              borderColor: `color-mix(in srgb, ${DESTRUCTIVE} 45%, transparent)`,
              background: `color-mix(in srgb, ${DESTRUCTIVE} 7%, transparent)`,
            }}
          >
            <header className="mb-2 flex items-center gap-2">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: DESTRUCTIVE, boxShadow: `0 0 6px ${DESTRUCTIVE}` }}
              />
              <span
                className="text-display font-mondwest text-[0.66rem] tracking-[0.12em]"
                style={{ color: DESTRUCTIVE }}
              >
                Blocked
              </span>
              <span className="font-mono-ui tabular text-[0.6rem] text-text-tertiary">
                {blocked.length}
              </span>
            </header>
            {blocked.length === 0 ? (
              <p className="text-[0.64rem] text-text-tertiary">
                Nothing blocked. A stuck agent surfaces here, never silently.
              </p>
            ) : (
              <div className="scrollbar-none flex snap-x gap-2 overflow-x-auto">
                <AnimatePresence initial={false} mode="popLayout">
                  {blocked.map((a) => (
                    <motion.div
                      key={a.id}
                      layout
                      className={cn("w-[72vw] max-w-[240px] shrink-0 snap-start")}
                    >
                      <AgentCard agent={a} childAgents={childrenOf(a)} now={now} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      </LayoutGroup>
    </div>
  );
}
