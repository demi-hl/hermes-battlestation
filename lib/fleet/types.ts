// Shared shapes for the Fleet slice: the Team-of-Agents board, the fleet
// health strip (tailnet machines + the VPS bot), and their colour metadata.
// Kept in its own module so the slice does not have to touch the slice-1
// `lib/types.ts` contract.

/** Logical fleet nodes. */
export type AgentNode = "PC" | "PC2" | "Mac" | "VPS";
export type AgentLane = "spawned" | "working" | "verifying" | "done" | "blocked";

export interface FleetAgent {
  id: string;
  objective: string;
  node: AgentNode;
  lane: AgentLane;
  parentId?: string;
  children?: string[];
  /** epoch ms. */
  startedAt: number;
  /** epoch ms — last time the agent emitted anything. Drives the stale pulse. */
  lastSignal: number;
  /** Live one-line status. */
  signal: string;
  diffStat?: { adds: number; dels: number };
  /**
   * HARD RULE: a real commit SHA is the ONLY proof of `done`. The board never
   * derives `done` from an agent self-report; a done card renders this sha as
   * its evidence. An agent that claims done with no sha is shown as verifying.
   */
  commitSha?: string;
  /** Branch the agent is committing to (shown beside the diff stat). */
  branch?: string;
}

/** The four flow lanes, left to right. `blocked` is rendered as a pinned tray,
 *  not a flow lane, so it is intentionally absent here. */
export const FLOW_LANES: { id: Exclude<AgentLane, "blocked">; label: string }[] = [
  { id: "spawned", label: "Spawned" },
  { id: "working", label: "Working" },
  { id: "verifying", label: "Verifying" },
  { id: "done", label: "Done" },
];

export const FLOW_LANE_ORDER: Exclude<AgentLane, "blocked">[] = [
  "spawned",
  "working",
  "verifying",
  "done",
];

export interface NodeMeta {
  label: string;
  /** Fixed data accent so node attribution is glanceable across themes. */
  color: string;
  /** Sub-label for the live count header / tooltips. */
  sub: string;
}

/** Node chip palette — PC teal, PC2 amber, Mac slate, VPS violet. */
export const NODE_META: Record<AgentNode, NodeMeta> = {
  PC: { label: "PC", color: "#2dd4bf", sub: "node 1" },
  PC2: { label: "PC #2", color: "#f5b54a", sub: "node 2" },
  Mac: { label: "Mac", color: "#94a3b8", sub: "node 3" },
  VPS: { label: "VPS", color: "#a78bfa", sub: "bot" },
};

/** Amber stale signal. A card with no signal for this long must be VISIBLE
 *  (the v1 verify-loop deadlock); a stuck agent must not look healthy. */
export const STALE_MS = 90_000;

export function isStale(agent: FleetAgent, now: number): boolean {
  if (agent.lane === "done") return false;
  return now - agent.lastSignal > STALE_MS;
}

/**
 * HARD RULE enforcement: a `done` lane is only legitimate with a real commit
 * sha as proof. Any agent claiming `done` without one is resolved DOWN to
 * `verifying` so the board never displays done off a self-report.
 */
export function resolveLane(agent: FleetAgent): FleetAgent {
  if (agent.lane === "done" && !agent.commitSha) {
    return { ...agent, lane: "verifying" };
  }
  return agent;
}

// ---------------------------------------------------------------------------
// Fleet health strip (real data: tailscale + VPS pm2)
// ---------------------------------------------------------------------------

export type MachineRole = "PC" | "PC2" | "Mac" | "VPS" | "aux";

export interface FleetMachine {
  /** Stable key for React. */
  key: string;
  /** Display name, e.g. "PC #1". */
  display: string;
  role: MachineRole;
  /** Whether we SSH-probe it (trusted) or show tailnet status only. */
  controlled: boolean;
  online: boolean;
  os: string | null;
  /** ISO last-seen for offline / status-only boxes. */
  lastSeen: string | null;
  self: boolean;
  /** Live GPU readout (SSH nvidia-smi). Null unless the box is a probed GPU node. */
  gpu?: GpuStat | null;
  /** Live CPU/RAM readout (SSH). Null unless the box is probed for system load. */
  sys?: SysStat | null;
  /** Live agent reachability. Null unless an agent endpoint is configured. */
  agent?: AgentStat | null;
}

/** Agent endpoint reachability — the fleet's "agents only" access layer.
 *  We GET the box's hermes agent/dashboard health URL; no shell, no SSH. */
export interface AgentStat {
  reachable: boolean;
  /** HTTP status from the health probe, or null on transport failure. */
  httpStatus: number | null;
  /** Round-trip latency in ms when reachable. */
  latencyMs: number | null;
}

export interface GpuStat {
  name: string;
  memUsedMB: number;
  memTotalMB: number;
  utilPct: number;
  tempC: number;
}

export interface SysStat {
  /** Whole-box CPU load, 0-100. */
  cpuPct: number;
  cores: number;
  memUsedMB: number;
  memTotalMB: number;
}

export interface BotProcess {
  name: string;
  status: string;
  restarts: number;
  unstableRestarts: number;
  /** epoch ms the process last (re)started; null if unknown. */
  uptimeMs: number | null;
  cpu: number | null;
  memBytes: number | null;
  healthy: boolean;
}

export interface BotHealth {
  reachable: boolean;
  procs: BotProcess[];
  /** pm2 processes outside the bot family (rolled up, not listed). */
  otherCount: number;
  /** No clean source for last-trade ts is exposed; never fabricated. */
  lastTrade: { available: false; reason: string };
  error?: string;
}

export interface FleetHealth {
  machines: FleetMachine[];
  bot: BotHealth;
}
