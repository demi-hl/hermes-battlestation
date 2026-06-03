import { NextResponse } from "next/server";
import type { ApiEnvelope } from "@/lib/types";
import type { FleetAgent } from "@/lib/fleet/types";
import { buildFleetAgents } from "@/lib/fleet/fleet.mock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Team-of-Agents board feed. Polled every 3s by the Fleet pane.
 *
 * For this slice the rows come from `fleet.mock.ts` so the board verifies
 * standalone. The real implementation reads the orchestrator registry joined
 * with per-node ps/tasklist ground truth, and DERIVES the lane from that
 * (spawned = proc, no output; working = mtime advancing; verifying = a build/
 * test running; done = a real commit SHA on the branch; blocked = stale > 90s
 * or explicit). The shape returned here is exactly that contract, so the
 * integration phase swaps the producer without touching the UI.
 */
export async function GET() {
  const env: ApiEnvelope<FleetAgent[]> = {
    data: buildFleetAgents(Date.now()),
    fetchedAt: new Date().toISOString(),
  };
  return NextResponse.json(env);
}
