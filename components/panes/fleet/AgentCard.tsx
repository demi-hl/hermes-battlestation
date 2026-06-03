"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { haptic } from "@/components/shell/haptics";
import { NODE_META, isStale, type FleetAgent } from "@/lib/fleet/types";
import { NodeChip, BillingChip, agoShort } from "./chips";
import { ChevronRightIcon } from "@/components/shell/icons";
import { GitCommitIcon, LayersIcon } from "./icons";

const WARN = "#ffbd38";

function DiffStat({ adds, dels }: { adds: number; dels: number }) {
  return (
    <span className="font-mono-ui tabular inline-flex items-center gap-1.5 text-[0.62rem]">
      <span style={{ color: "var(--color-success)" }}>+{adds}</span>
      <span style={{ color: "var(--color-destructive)" }}>-{dels}</span>
    </span>
  );
}

/** Nested subagent row — the spawn-tree mini-stack revealed when a parent is
 *  expanded. Compact: node dot + id + objective + signal. */
function AgentMini({ agent, now }: { agent: FleetAgent; now: number }) {
  const stale = isStale(agent, now);
  const color = NODE_META[agent.node].color;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="overflow-hidden"
    >
      <div className="ml-2 mt-1.5 flex items-start gap-2 rounded-[var(--radius-sm)] border border-border/70 bg-[color-mix(in_srgb,var(--midground)_3%,transparent)] px-2 py-1.5">
        <span
          className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: color, boxShadow: `0 0 5px ${color}` }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-mono-ui truncate text-[0.62rem] text-text-secondary">
              {agent.id}
            </span>
            {agent.commitSha && (
              <span className="font-mono-ui inline-flex items-center gap-0.5 text-[0.58rem] text-[color:var(--color-success)]">
                <GitCommitIcon width={10} height={10} />
                {agent.commitSha}
              </span>
            )}
          </div>
          <p className="truncate text-[0.66rem] text-midground">{agent.objective}</p>
          <p
            className={cn(
              "font-mono-ui truncate text-[0.6rem]",
              stale ? "text-[color:var(--color-warning)]" : "text-text-tertiary",
            )}
          >
            {stale ? `stale ${agoShort(agent.lastSignal, now)}` : agent.signal}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

export function AgentCard({
  agent,
  childAgents,
  now,
}: {
  agent: FleetAgent;
  childAgents: FleetAgent[];
  now: number;
}) {
  const [open, setOpen] = useState(false);
  const stale = isStale(agent, now);
  const inProgress = agent.lane === "working" || agent.lane === "verifying";
  const hasChildren = childAgents.length > 0;
  // HARD RULE: `done` is only legitimate with a real commit sha as proof.
  const doneProof = agent.lane === "done" && Boolean(agent.commitSha);
  const doneNoSha = agent.lane === "done" && !agent.commitSha;

  return (
    <motion.div
      layout
      layoutId={agent.id}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 420, damping: 36 }}
      className={cn(
        "relative rounded-[var(--radius-md)] border bg-card px-2.5 py-2",
        stale
          ? "border-[color:color-mix(in_srgb,#ffbd38_55%,transparent)]"
          : "border-border",
      )}
    >
      {/* Stale pulse — the verify-loop deadlock must be VISIBLE, never silent. */}
      {stale && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{ boxShadow: `0 0 0 1.5px ${WARN}, 0 0 14px -2px ${WARN}` }}
          animate={{ opacity: [0.3, 0.85, 0.3] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      <div className="relative flex items-center gap-1.5">
        <span className="font-mono-ui truncate text-[0.66rem] text-text-secondary">
          {agent.id}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <NodeChip node={agent.node} />
          <BillingChip billing={agent.billing} />
        </span>
      </div>

      <p className="relative mt-1 line-clamp-2 text-[0.78rem] leading-snug text-midground">
        {agent.objective}
      </p>

      {/* Signal line — marching-ants underline while in progress. */}
      <div className="relative mt-1.5">
        {stale ? (
          <span className="font-mono-ui block truncate text-[0.64rem] text-[color:var(--color-warning)]">
            stale {agoShort(agent.lastSignal, now)} · {agent.signal}
          </span>
        ) : (
          <>
            <span className="font-mono-ui block truncate text-[0.64rem] text-text-tertiary">
              {agent.signal}
            </span>
            {inProgress && (
              <span aria-hidden className="march mt-1 block h-px w-full opacity-70" />
            )}
          </>
        )}
      </div>

      {/* Footer — diff stat / branch, done proof, child toggle. */}
      {(agent.diffStat || doneProof || doneNoSha || hasChildren) && (
        <div className="relative mt-1.5 flex items-center gap-2">
          {agent.diffStat && <DiffStat {...agent.diffStat} />}
          {agent.branch && (
            <span className="font-mono-ui truncate text-[0.58rem] text-text-tertiary">
              {agent.branch}
            </span>
          )}
          {doneProof && (
            <span
              className="font-mono-ui inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.58rem]"
              style={{
                color: "var(--color-success)",
                background: "color-mix(in srgb, var(--color-success) 12%, transparent)",
              }}
              title={`done · commit ${agent.commitSha}`}
            >
              <GitCommitIcon width={10} height={10} />
              {agent.commitSha}
            </span>
          )}
          {doneNoSha && (
            <span
              className="font-mono-ui inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[0.58rem]"
              style={{ color: WARN, background: `color-mix(in srgb, ${WARN} 12%, transparent)` }}
              title="reported done with no commit sha, not trusted"
            >
              no sha
            </span>
          )}

          {hasChildren && (
            <button
              type="button"
              onClick={() => {
                haptic(6);
                setOpen((v) => !v);
              }}
              aria-expanded={open}
              aria-label={`${open ? "Collapse" : "Expand"} ${childAgents.length} subagents`}
              className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[0.58rem] text-text-secondary transition-colors active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]"
            >
              <LayersIcon width={11} height={11} />
              <span className="tabular">{childAgents.length}</span>
              <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.18 }}>
                <ChevronRightIcon width={11} height={11} />
              </motion.span>
            </button>
          )}
        </div>
      )}

      {/* Spawn-tree mini-stack. */}
      {hasChildren && (
        <AnimatePresence initial={false}>
          {open && (
            <motion.div layout className="relative">
              {childAgents.map((c) => (
                <AgentMini key={c.id} agent={c} now={now} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </motion.div>
  );
}
