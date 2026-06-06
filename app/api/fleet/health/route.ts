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
  /** SSH alias for a read-only nvidia-smi probe. Set only for GPU nodes we can reach. */
  gpuHost?: string;
  /** SSH alias for a read-only CPU/RAM probe. "self" = probe locally (this box). */
  sysHost?: string;
  /** OS of the sys probe target — picks the probe command. */
  sysOs?: "linux" | "darwin" | "windows";
}[] = [
  { key: "pc1", display: "PC #1", host: "pop-os", role: "PC", controlled: true, gpuHost: "self", sysHost: "self", sysOs: "linux" },
  { key: "pc2", display: "PC #2", host: "desktop-f5siqio", role: "PC2", controlled: false, gpuHost: "gpu3070", sysHost: "gpu3070", sysOs: "windows" },
  { key: "mac", display: "MacBook", host: "christophers-macbook-pro", role: "Mac", controlled: true, sysHost: "mac", sysOs: "darwin" },
  { key: "vps", display: "VPS", host: "demi-poly", role: "VPS", controlled: true, sysHost: "demi-poly", sysOs: "linux" },
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

  return Promise.all(
    MACHINES.map(async (m) => {
      const hit = findPeer(m.host);
      const peer = hit?.peer;
      const isSelf = hit?.self ?? false;
      const lastSeen =
        peer?.LastSeen && !peer.LastSeen.startsWith("0001-01-01")
          ? peer.LastSeen
          : null;
      const online = isSelf ? true : Boolean(peer?.Online);
      // Probe GPU + sys only when reachable. Self probes locally; others over SSH.
      const [gpu, sys] = await Promise.all([
        m.gpuHost && online ? probeGpu(m.gpuHost) : Promise.resolve(null),
        m.sysHost && (online || isSelf) && m.sysOs
          ? probeSys(m.sysHost, m.sysOs)
          : Promise.resolve(null),
      ]);
      return {
        key: m.key,
        display: m.display,
        host: m.host,
        role: m.role,
        controlled: m.controlled,
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
