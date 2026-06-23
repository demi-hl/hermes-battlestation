import { NextResponse } from "next/server";
import { run, sshCmd, scrubPaths} from "@/lib/exec";
import { cached } from "@/lib/cache";
import type { ApiEnvelope, BotStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOST = process.env.POLY_HOST ?? "";
const PROC = process.env.POLY_PROC ?? "app-server";

const PNL_REASON = "no clean read-only source (bot API requires login)";

type Pm2Entry = {
  name?: string;
  pm2_env?: {
    status?: string;
    restart_time?: number;
    unstable_restarts?: number;
    pm_uptime?: number;
  };
  monit?: { cpu?: number; memory?: number };
};

export async function GET() {
  const env: ApiEnvelope<BotStatus> = await cached(
    "polymarket",
    20_000,
    async () => {
      const at = new Date().toISOString();
      if (!HOST) {
        const status: BotStatus = {
          reachable: false,
          name: null,
          status: null,
          restarts: null,
          unstableRestarts: null,
          uptimeMs: null,
          cpu: null,
          memBytes: null,
          pnl: { available: false, reason: PNL_REASON },
          error: "not configured — set POLY_HOST to enable bot telemetry",
        };
        return { data: status, fetchedAt: at };
      }
      const r = await run(sshCmd(HOST, "pm2 jlist 2>/dev/null"), {
        timeoutMs: 14000,
      });
      if (!r.ok) {
        const status: BotStatus = {
          reachable: false,
          name: null,
          status: null,
          restarts: null,
          unstableRestarts: null,
          uptimeMs: null,
          cpu: null,
          memBytes: null,
          pnl: { available: false, reason: PNL_REASON },
          error: scrubPaths(r.stderr) || `ssh ${HOST} unreachable`,
        };
        return { data: status, fetchedAt: at };
      }
      let list: Pm2Entry[] = [];
      try {
        list = JSON.parse(r.stdout) as Pm2Entry[];
      } catch {
        const status: BotStatus = {
          reachable: false,
          name: null,
          status: null,
          restarts: null,
          unstableRestarts: null,
          uptimeMs: null,
          cpu: null,
          memBytes: null,
          pnl: { available: false, reason: PNL_REASON },
          error: "could not parse pm2 jlist",
        };
        return { data: status, fetchedAt: at };
      }
      const proc = list.find((p) => p.name && p.name.startsWith(PROC));
      if (!proc) {
        const status: BotStatus = {
          reachable: true,
          name: null,
          status: null,
          restarts: null,
          unstableRestarts: null,
          uptimeMs: null,
          cpu: null,
          memBytes: null,
          pnl: { available: false, reason: PNL_REASON },
          error: `no pm2 process named ${PROC}*`,
        };
        return { data: status, fetchedAt: at };
      }
      const status: BotStatus = {
        reachable: true,
        name: proc.name ?? null,
        status: proc.pm2_env?.status ?? null,
        restarts: proc.pm2_env?.restart_time ?? null,
        unstableRestarts: proc.pm2_env?.unstable_restarts ?? null,
        uptimeMs: proc.pm2_env?.pm_uptime ?? null,
        cpu: proc.monit?.cpu ?? null,
        memBytes: proc.monit?.memory ?? null,
        pnl: { available: false, reason: PNL_REASON },
      };
      return { data: status, fetchedAt: at };
    },
  );
  return NextResponse.json(env);
}
