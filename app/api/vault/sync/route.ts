import { NextResponse } from "next/server";
import { vaultSync } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sync the shared vault: pull --rebase, commit local changes, push.
 *  Body (optional): { message?: string }. Stops at first failure. */
export async function POST(req: Request) {
  let body: { message?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }
  try {
    const steps = await vaultSync(body.message);
    const ok = steps.every((s) => s.ok);
    return NextResponse.json({ ok, steps }, { status: ok ? 200 : 409 });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "vault sync failed" },
      { status: 500 },
    );
  }
}
