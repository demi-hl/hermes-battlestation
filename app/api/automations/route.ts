import { NextResponse } from "next/server";
import { run, scrubPaths} from "@/lib/exec";
import { cached } from "@/lib/cache";
import type { ApiEnvelope } from "@/lib/types";
import { type AutomationsPayload, parseCronList } from "@/lib/prs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Source of truth = `hermes cron list` (the SQLite-backed scheduler the Hermes
// CLI reads). It has no --json mode, so we parse its table. This is real,
// always-available data on the box, no dashboard token dependency. Read-only.
export async function GET() {
  const env: ApiEnvelope<AutomationsPayload> = await cached(
    "automations",
    30_000,
    async () => {
      const at = new Date().toISOString();
      const r = await run("hermes cron list", { timeoutMs: 12_000 });
      if (!r.ok) {
        return {
          data: {
            available: false,
            jobs: [],
            note: scrubPaths(r.stderr) || "hermes cron list failed",
          },
          fetchedAt: at,
        };
      }
      const jobs = parseCronList(r.stdout);
      return {
        data: {
          available: true,
          jobs,
          note: jobs.length === 0 ? "no scheduled jobs" : undefined,
        },
        fetchedAt: at,
      };
    },
  );
  return NextResponse.json(env);
}
