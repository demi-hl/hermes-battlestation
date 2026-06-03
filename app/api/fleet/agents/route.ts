import { NextResponse } from "next/server";
import type { ApiEnvelope } from "@/lib/types";
import type { FleetAgent } from "@/lib/fleet/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Team-of-Agents board feed. Currently disabled — mock data was removed.
 * When the orchestrator publishes agent state to a queryable endpoint this
 * route reads it and returns FleetAgent[] matching the contract.
 */
export async function GET() {
  const env: ApiEnvelope<FleetAgent[]> = {
    data: [],
    fetchedAt: new Date().toISOString(),
  };
  return NextResponse.json(env);
}