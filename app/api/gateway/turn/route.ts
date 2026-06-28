import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOME = process.env.HOME ?? os.homedir();
const HERMES_HOME = process.env.HERMES_HOME || path.join(HOME, ".hermes");

// Is the gateway processing a turn RIGHT NOW? The gateway writes
// `active_agents` to gateway_state.json at every turn boundary (a running slot
// claimed/released), so `active_agents > 0` is the live "a turn is in flight"
// truth for EVERY entry point — Telegram, CLI, cron, the desktop — not just the
// app's own chat box. That's what lets the mobile dashboard show a running
// timer while you drive Hermes from your phone's Telegram and watch the app.
//
// `?profile=` reads a non-default profile's own gateway (each profile runs its
// own gateway service + state file under profiles/<name>/). Default → root.
export async function GET(req: Request) {
  const profile = new URL(req.url).searchParams.get("profile");
  const stateFile =
    profile && profile !== "default"
      ? path.join(HERMES_HOME, "profiles", profile, "gateway_state.json")
      : path.join(HERMES_HOME, "gateway_state.json");

  try {
    const raw = await fs.readFile(stateFile, "utf8");
    const s = JSON.parse(raw) as {
      gateway_state?: string;
      active_agents?: number;
      updated_at?: string;
    };
    const running = s.gateway_state === "running";
    const active = Math.max(0, Number(s.active_agents) || 0);
    return NextResponse.json({
      busy: running && active > 0,
      activeAgents: active,
      gatewayState: s.gateway_state ?? null,
      updatedAt: s.updated_at ?? null,
    });
  } catch {
    // No state file / unreadable / down → not busy. Never a spurious "busy".
    return NextResponse.json({ busy: false, activeAgents: 0, gatewayState: null, updatedAt: null });
  }
}
