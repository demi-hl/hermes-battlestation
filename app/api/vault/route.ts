import { NextResponse } from "next/server";
import { vaultStatus } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Shared-vault git status: branch, remote, ahead/behind, dirty count, the
 *  agents (commit authors) writing to it, and recent commits. */
export async function GET() {
  try {
    const status = await vaultStatus();
    return NextResponse.json({ ...status, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "vault status failed" },
      { status: 500 },
    );
  }
}
