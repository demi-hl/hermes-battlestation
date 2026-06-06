import { NextResponse } from "next/server";
import { run } from "@/lib/exec";
import { cached } from "@/lib/cache";
import type { ApiEnvelope, FleetHost } from "@/lib/types";
import { FLEET } from "@/lib/fleet/hosts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reachability probe per configured node. Hosts/labels come from env
// (lib/fleet/hosts.ts); only generic display names ever reach the client.

async function probeNode(
  key: string,
  label: string,
  ssh: string,
): Promise<FleetHost> {
  const local = ssh === "";
  const cmd = local ? "echo up" : `${ssh} 'echo up'`;
  const r = await run(cmd, { timeoutMs: local ? 4000 : 8000 });
  return {
    host: key,
    label,
    up: r.ok && r.stdout.trim() === "up",
    latencyMs: r.ok ? r.ms : null,
    local,
  };
}

export async function GET() {
  const env: ApiEnvelope<FleetHost[]> = await cached(
    "fleet",
    20_000,
    async () => {
      const nodes = FLEET.filter((n) => n.ssh !== undefined);
      const results = await Promise.all(
        nodes.map((n) => probeNode(n.key, n.display, n.ssh as string)),
      );
      return { data: results, fetchedAt: new Date().toISOString() };
    },
  );
  return NextResponse.json(env);
}
