import { NextResponse } from "next/server";
import { run, sshCmd, shellQuote } from "@/lib/exec";
import { cached } from "@/lib/cache";
import type { ApiEnvelope } from "@/lib/types";
import type {
  BotHealth,
  BotProcess,
  FleetHealth,
  FleetMachine,
  GpuStat,
  MachineRole,
  SysStat,
} from "@/lib/fleet/types";
import { FLEET, BOT_PROC_RE, fleetNode, type FleetNode } from "@/lib/fleet/hosts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fleet nodes come from env (lib/fleet/hosts.ts). Each node's tailnet match
// name and SSH probe aliases are supplied at runtime; nothing is hardcoded so
// the repo is safe to publish. A node with no env config is simply not probed.
const ROLE: Record<string, MachineRole> = {
  pc1: "PC",
  pc2: "PC2",
  mac: "Mac",
  vps: "VPS",
};

function normName(s: string | undefined | null): string {
  if (!s) return "";
  // Strip the tailnet domain ("host.tailXXXX.ts.net.") to its first label,
  // then normalize case + separators so "DESKTOP-XXXXXX" matches the alias.
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

async function probeGpu(gpuHost: string): Promise<GpuStat | null> {
  const query =
    "nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu --format=csv,noheader,nounits";
  const r =
    gpuHost === "self"
      ? await run(query, { timeoutMs: 9000 })
      : await run(sshCmd(gpuHost, query, 6), { timeoutMs: 9000 });
  if (!r.ok) return null;
  const line = r.stdout.trim().split("\n")[0] ?? "";
  const parts = line.split(",").map((s) => s.trim());
  if (parts.length < 5) return null;
  const [name, memUsed, memTotal, util, temp] = parts;
  const num = (s: string) => {
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  };
  if (!name) return null;
  return {
    name,
    memUsedMB: num(memUsed),
    memTotalMB: num(memTotal),
    utilPct: num(util),
    tempC: num(temp),
  };
}

async function probeSys(
  sysHost: string,
  sysOs: "linux" | "darwin" | "windows",
): Promise<SysStat | null> {
  // Per-OS one-liner that prints "cpuPct|cores|memUsedMB|memTotalMB".
  let cmd: string;
  if (sysOs === "linux") {
    cmd =
      'C=$(nproc); read a b c d r < /proc/stat; i1=$d; t1=$((a+b+c+d)); ' +
      "sleep 0.3; read a b c d r < /proc/stat; i2=$d; t2=$((a+b+c+d)); " +
      'cpu=$((100-(100*(i2-i1))/(t2-t1))); ' +
      'M=$(free -m | awk "/^Mem:/{print \\$3\\"|\\"\\$2}"); echo "$cpu|$C|$M"';
  } else if (sysOs === "darwin") {
    cmd =
      "C=$(sysctl -n hw.ncpu); " +
      'CPU=$(ps -A -o %cpu | awk -v c=$C "{s+=\\$1} END{print int(s/c)}"); ' +
      "TM=$(( $(sysctl -n hw.memsize)/1048576 )); " +
      'PF=$(vm_stat | awk "/free/{f=\\$3} /inactive/{i=\\$3} END{print int((f+i)*4096/1048576)}"); ' +
      'echo "$CPU|$C|$((TM-PF))|$TM"';
  } else {
    // windows — wmic, parse separately below (different output shape).
    cmd =
      "wmic cpu get LoadPercentage,NumberOfLogicalProcessors /value & " +
      "wmic OS get FreePhysicalMemory,TotalVisibleMemorySize /value";
  }

  const local = sysHost === "self";
  const r = local
    ? await run(`bash -c ${shellQuote(cmd)}`, { timeoutMs: 9000 })
    : await run(sshCmd(sysHost, cmd, 6), { timeoutMs: 11000 });
  if (!r.ok) return null;
  const out = r.stdout;

  if (sysOs === "windows") {
    const grab = (k: string) => {
      const m = out.match(new RegExp(`${k}=(\\d+)`, "i"));
      return m ? Number(m[1]) : NaN;
    };
    const load = grab("LoadPercentage");
    const cores = grab("NumberOfLogicalProcessors");
    const freeKB = grab("FreePhysicalMemory");
    const totalKB = grab("TotalVisibleMemorySize");
    if (![load, cores, freeKB, totalKB].every(Number.isFinite)) return null;
    const memTotalMB = Math.round(totalKB / 1024);
    return {
      cpuPct: load,
      cores,
      memUsedMB: memTotalMB - Math.round(freeKB / 1024),
      memTotalMB,
    };
  }

  const parts = out.trim().split("\n")[0]?.split("|").map((s) => Number(s.trim()));
  if (!parts || parts.length < 4 || !parts.every(Number.isFinite)) return null;
  const [cpuPct, cores, memUsedMB, memTotalMB] = parts;
  return { cpuPct, cores, memUsedMB, memTotalMB };
}

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
  // direction (alias starts with peer name) — that lets a short prefix
  // wrongly claim a longer peer name.
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

  return Promise.all(
    FLEET.map(async (m: FleetNode) => {
      const hit = m.match ? findPeer(m.match) : null;
      const peer = hit?.peer;
      const isSelf = hit?.self ?? false;
      const lastSeen =
        peer?.LastSeen && !peer.LastSeen.startsWith("0001-01-01")
          ? peer.LastSeen
          : null;
      const online = isSelf ? true : Boolean(peer?.Online);
      // Probe GPU + sys only when reachable. "self" probes locally; others over SSH.
      const [gpu, sys] = await Promise.all([
        m.gpu && (online || m.gpu === "self") ? probeGpu(m.gpu) : Promise.resolve(null),
        m.sys && (online || isSelf || m.sys === "self")
          ? probeSys(m.sys, m.os)
          : Promise.resolve(null),
      ]);
      return {
        key: m.key,
        display: m.display,
        role: ROLE[m.key] ?? "aux",
        // "controlled" = we run remote probes against it (SSH configured).
        controlled: m.ssh !== undefined,
        // Self is always "online" (we are running on it).
        online,
        os: peer?.OS ?? null,
        lastSeen,
        self: isSelf,
        gpu,
        sys,
      } satisfies FleetMachine;
    }),
  );
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
  const vps = fleetNode("vps");
  const lastTrade = {
    available: false as const,
    reason: "no clean last-trade source exposed by the bot; not fabricated",
  };
  // No VPS SSH configured → bot health is simply unavailable, not an error.
  if (!vps?.ssh) {
    return {
      reachable: false,
      procs: [],
      otherCount: 0,
      lastTrade,
      error: "vps not configured",
    };
  }
  const r = await run(`${vps.ssh} 'pm2 jlist'`, { timeoutMs: 14000 });
  if (!r.ok) {
    return {
      reachable: false,
      procs: [],
      otherCount: 0,
      lastTrade,
      error: r.stderr.trim().split("\n")[0] || "pm2 jlist failed",
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

  const family = list.filter((p) => BOT_PROC_RE.test(p.name ?? ""));
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
