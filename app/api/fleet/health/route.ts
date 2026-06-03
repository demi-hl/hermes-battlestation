import { NextResponse } from "next/server";
import { run, sshCmd } from "@/lib/exec";
import { cached } from "@/lib/cache";
import type { ApiEnvelope } from "@/lib/types";
import type {
  BotHealth,
  BotProcess,
  FleetHealth,
  FleetMachine,
  MachineRole,
} from "@/lib/fleet/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Known fleet boxes. `host` is matched against the tailnet peer's DNSName /
// HostName (normalized). Controlled boxes are SSH-probed for bot health; the
// rest are tailnet-status-only (never push creds to untrusted boxes).
const MACHINES: {
  key: string;
  display: string;
  host: string;
  role: MachineRole;
  controlled: boolean;
}[] = [
  { key: "pc1", display: "PC #1", host: "demi-pc-wsl", role: "PC", controlled: true },
  { key: "pc2", display: "David's Max", host: "desktop-f5siqio", role: "PC2", controlled: false },
  { key: "mac", display: "MacBook", host: "christophers-macbook-pro", role: "Mac", controlled: true },
  { key: "vps", display: "VPS", host: "demi-poly", role: "VPS", controlled: true },
];

// Polymarket bot pm2 family — these are the bot-health processes (other pm2
// jobs on the box, e.g. pokeagent / hlmedia, are rolled up as a count).
const BOT_FAMILY = /^demi-(server|control|neg-risk)/i;

function normName(s: string | undefined | null): string {
  if (!s) return "";
  // Strip the tailnet domain ("host.tailXXXX.ts.net.") to its first label,
  // then normalize case + separators so "DESKTOP-F5SIQIO" matches the alias.
  return s
    .split(".")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type TsPeer = {
  HostName?: string;
  DNSName?: string;
  OS?: string;
  Online?: boolean;
  LastSeen?: string;
};

async function probeMachines(): Promise<FleetMachine[]> {
  const r = await run("tailscale status --json", { timeoutMs: 8000 });
  let self: TsPeer = {};
  let peers: TsPeer[] = [];
  if (r.ok) {
    try {
      const j = JSON.parse(r.stdout) as {
        Self?: TsPeer;
        Peer?: Record<string, TsPeer>;
      };
      self = j.Self ?? {};
      peers = Object.values(j.Peer ?? {});
    } catch {
      /* fall through to all-offline below */
    }
  }

  const all = [self, ...peers];
  // Match on the tailnet DNSName/HostName, exact first then alias-as-prefix
  // (peer name starts with the alias). We deliberately do NOT match the other
  // direction (alias starts with peer name) — that lets a short name like
  // "demi" wrongly claim "demi-poly".
  const findPeer = (host: string): { peer: TsPeer; self: boolean } | null => {
    const want = normName(host);
    const candidates = all
      .map((p) => ({ p, n: normName(p.DNSName || p.HostName) }))
      .filter((c) => c.n);
    const exact = candidates.find((c) => c.n === want);
    const hit = exact ?? candidates.find((c) => c.n.startsWith(want));
    if (!hit) return null;
    return { peer: hit.p, self: hit.p === self };
  };

  return MACHINES.map((m) => {
    const hit = findPeer(m.host);
    const peer = hit?.peer;
    const isSelf = hit?.self ?? false;
    const lastSeen =
      peer?.LastSeen && !peer.LastSeen.startsWith("0001-01-01")
        ? peer.LastSeen
        : null;
    return {
      key: m.key,
      display: m.display,
      host: m.host,
      role: m.role,
      controlled: m.controlled,
      // Self is always "online" (we are running on it).
      online: isSelf ? true : Boolean(peer?.Online),
      os: peer?.OS ?? null,
      lastSeen,
      self: isSelf,
    } satisfies FleetMachine;
  });
}

type Pm2Proc = {
  name?: string;
  pm2_env?: {
    status?: string;
    restart_time?: number;
    unstable_restarts?: number;
    pm_uptime?: number;
  };
  monit?: { cpu?: number; memory?: number };
};

async function probeBot(): Promise<BotHealth> {
  const r = await run(sshCmd("demi-poly", "pm2 jlist", 8), { timeoutMs: 14000 });
  const lastTrade = {
    available: false as const,
    reason: "no clean last-trade source exposed by the bot; not fabricated",
  };
  if (!r.ok) {
    return {
      reachable: false,
      procs: [],
      otherCount: 0,
      lastTrade,
      error: r.stderr.trim().split("\n")[0] || "ssh demi-poly pm2 jlist failed",
    };
  }
  let list: Pm2Proc[] = [];
  try {
    list = JSON.parse(r.stdout) as Pm2Proc[];
  } catch {
    return {
      reachable: false,
      procs: [],
      otherCount: 0,
      lastTrade,
      error: "could not parse pm2 jlist output",
    };
  }

  const family = list.filter((p) => BOT_FAMILY.test(p.name ?? ""));
  const procs: BotProcess[] = family.map((p) => {
    const status = p.pm2_env?.status ?? "unknown";
    const unstable = p.pm2_env?.unstable_restarts ?? 0;
    return {
      name: p.name ?? "unknown",
      status,
      restarts: p.pm2_env?.restart_time ?? 0,
      unstableRestarts: unstable,
      uptimeMs: p.pm2_env?.pm_uptime ?? null,
      cpu: p.monit?.cpu ?? null,
      memBytes: p.monit?.memory ?? null,
      healthy: status === "online" && unstable === 0,
    };
  });
  procs.sort((a, b) => a.name.localeCompare(b.name));

  return {
    reachable: true,
    procs,
    otherCount: list.length - family.length,
    lastTrade,
  };
}

export async function GET() {
  const env: ApiEnvelope<FleetHealth> = await cached(
    "fleet-health",
    10_000,
    async () => {
      const [machines, bot] = await Promise.all([probeMachines(), probeBot()]);
      return {
        data: { machines, bot },
        fetchedAt: new Date().toISOString(),
      };
    },
  );
  return NextResponse.json(env);
}
