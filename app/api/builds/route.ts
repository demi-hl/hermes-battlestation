import { NextResponse } from "next/server";
import { run } from "@/lib/exec";
import { cached } from "@/lib/cache";
import type { ApiEnvelope, Builds, BuildJob } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Pm2Entry = {
  name?: string;
  pm2_env?: { status?: string; pm_uptime?: number };
  monit?: { cpu?: number; memory?: number };
};

export async function GET() {
  const env: ApiEnvelope<Builds> = await cached("builds", 20_000, async () => {
    const at = new Date().toISOString();
    // Resolve pm2 from the user's npm-global bin if it is not on PATH.
    const r = await run(
      'PATH="$HOME/.npm-global/bin:$PATH" pm2 jlist 2>/dev/null',
      { timeoutMs: 10000 },
    );
    if (!r.ok || !r.stdout.trim()) {
      return {
        data: { available: false, jobs: [], note: "pm2 not present on PC local" },
        fetchedAt: at,
      };
    }
    let list: Pm2Entry[] = [];
    try {
      list = JSON.parse(r.stdout) as Pm2Entry[];
    } catch {
      return {
        data: { available: false, jobs: [], note: "could not parse pm2 jlist" },
        fetchedAt: at,
      };
    }
    const jobs: BuildJob[] = list.map((p) => ({
      name: p.name ?? "unknown",
      status: p.pm2_env?.status ?? "unknown",
      uptimeMs: p.pm2_env?.pm_uptime ?? null,
      cpu: p.monit?.cpu ?? null,
      memBytes: p.monit?.memory ?? null,
    }));
    return { data: { available: true, jobs }, fetchedAt: at };
  });
  return NextResponse.json(env);
}
