/**
 * Fleet host configuration — resolved from environment at runtime.
 *
 * No real hostnames, usernames, or SSH aliases live in source. Every node's
 * reachability is supplied via env vars so the repo is safe to publish; a node
 * with no env is simply not probed. See .env.example for the full list.
 *
 * Per node (PC1 / PC2 / MAC / VPS):
 *   FLEET_<N>_MATCH  - tailnet peer name to match for online/last-seen status
 *   FLEET_<N>_SSH    - ssh prefix to run a remote command ("" = run locally)
 *   FLEET_<N>_GPU    - ssh alias for a read-only nvidia-smi probe ("self"=local)
 *   FLEET_<N>_SYS    - ssh alias for a read-only cpu/ram probe ("self"=local)
 *
 * Plus:
 *   FLEET_VPS_PROC   - pm2 process-name family treated as bot-health on the vps
 *
 * Defaults: PC1 probes locally ("self"), every other node is unset (skipped),
 * so a fresh clone with no env runs entirely against localhost and leaks nothing.
 */

export type FleetKey = "pc1" | "pc2" | "mac" | "vps";
export type FleetOs = "linux" | "darwin" | "windows";

export interface FleetNode {
  key: FleetKey;
  /** Public-facing label shown in the UI. */
  display: string;
  os: FleetOs;
  /** Tailnet peer name to match for status. undefined = no status probe. */
  match?: string;
  /** SSH command prefix, or "" to run locally. undefined = not reachable. */
  ssh?: string;
  /** SSH alias for nvidia-smi, "self" for local, undefined to skip. */
  gpu?: string;
  /** SSH alias for cpu/ram, "self" for local, undefined to skip. */
  sys?: string;
  /** Agent reachability: URL of the box's hermes agent/dashboard health
   *  endpoint (e.g. http://<peer>:9119). undefined = no agent probe. This is
   *  the ONLY cross-box access the fleet performs beyond read-only telemetry. */
  agent?: string;
  /** Whether this node hosts the pm2 bot-health rollup. */
  bot?: boolean;
}

const env = (k: string): string | undefined => process.env[k];

export const FLEET: FleetNode[] = [
  {
    key: "pc1",
    display: "PC1 (You)",
    os: "linux",
    match: env("FLEET_PC1_MATCH") ?? "localhost",
    ssh: env("FLEET_PC1_SSH") ?? "",
    gpu: env("FLEET_PC1_GPU") ?? "self",
    sys: env("FLEET_PC1_SYS") ?? "self",
    agent: env("FLEET_PC1_AGENT"),
  },
  {
    key: "pc2",
    display: "PC2 (Yours)",
    os: "windows",
    match: env("FLEET_PC2_MATCH"),
    ssh: env("FLEET_PC2_SSH"),
    gpu: env("FLEET_PC2_GPU"),
    sys: env("FLEET_PC2_SYS"),
    agent: env("FLEET_PC2_AGENT"),
  },
  {
    key: "mac",
    display: "MacBook",
    os: "darwin",
    match: env("FLEET_MAC_MATCH"),
    ssh: env("FLEET_MAC_SSH"),
    sys: env("FLEET_MAC_SYS"),
    agent: env("FLEET_MAC_AGENT"),
  },
  {
    key: "vps",
    display: "VPS",
    os: "linux",
    match: env("FLEET_VPS_MATCH"),
    ssh: env("FLEET_VPS_SSH"),
    sys: env("FLEET_VPS_SYS"),
    agent: env("FLEET_VPS_AGENT"),
    bot: true,
  },
];

export function fleetNode(key: FleetKey): FleetNode | undefined {
  return FLEET.find((n) => n.key === key);
}

/** pm2 process-name family treated as bot-health. Generic default. */
export const BOT_PROC_RE = new RegExp(
  process.env.FLEET_VPS_PROC ?? "^app-(server|worker)",
  "i",
);
