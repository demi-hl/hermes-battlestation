import { NextResponse } from "next/server";
import { run, sshCmd } from "@/lib/exec";
import { cached } from "@/lib/cache";
import type { ApiEnvelope, FleetHost } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PC is local (no ssh). The rest are ssh aliases from ~/.ssh/config.
const REMOTE: { host: string; label: string }[] = [
  { host: "gpu3070", label: "gpu3070" },
  { host: "demi-poly", label: "demi-poly" },
  { host: "ccmb", label: "ccmb" },
];

async function probeLocal(): Promise<FleetHost> {
  const r = await run("echo up", { timeoutMs: 4000 });
  return {
    host: "local",
    label: "PC local",
    up: r.ok && r.stdout.trim() === "up",
    latencyMs: r.ms,
    local: true,
  };
}

async function probeRemote(host: string, label: string): Promise<FleetHost> {
  const r = await run(sshCmd(host, "echo up", 5), { timeoutMs: 8000 });
  return {
    host,
    label,
    up: r.ok && r.stdout.trim() === "up",
    latencyMs: r.ok ? r.ms : null,
    local: false,
  };
}

export async function GET() {
  const env: ApiEnvelope<FleetHost[]> = await cached(
    "fleet",
    20_000,
    async () => {
      const results = await Promise.all([
        probeLocal(),
        ...REMOTE.map((h) => probeRemote(h.host, h.label)),
      ]);
      return { data: results, fetchedAt: new Date().toISOString() };
    },
  );
  return NextResponse.json(env);
}
