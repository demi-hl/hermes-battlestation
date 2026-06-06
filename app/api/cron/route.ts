import { NextResponse } from "next/server";
import { dashboardGet } from "@/lib/hermes";
import { cached } from "@/lib/cache";
import { run } from "@/lib/exec";
import type { ApiEnvelope, CronList, CronJob } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HERMES_BIN = process.env.HERMES_BIN ?? "hermes";

/** Shell-safe single-quote wrap. */
function sq(s: string): string {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

type RawCron = {
  id?: string;
  name?: string;
  schedule_display?: string;
  schedule?: { display?: string };
  last_status?: string | null;
  enabled?: boolean;
  next_run_at?: string | null;
};

export async function GET() {
  const env: ApiEnvelope<CronList> = await cached("cron", 30_000, async () => {
    const at = new Date().toISOString();
    const res = await dashboardGet("/api/cron/jobs");
    if (!res.ok || !Array.isArray(res.data)) {
      return {
        data: {
          available: false,
          jobs: [],
          note:
            res.status === 0
              ? "dashboard not running on 127.0.0.1:9119"
              : `dashboard returned ${res.status}`,
        },
        fetchedAt: at,
      };
    }
    const jobs: CronJob[] = (res.data as RawCron[]).map((j) => ({
      id: j.id ?? "",
      name: j.name ?? "unnamed",
      schedule: j.schedule_display ?? j.schedule?.display ?? "",
      lastStatus: j.last_status ?? null,
      enabled: j.enabled ?? false,
      nextRunAt: j.next_run_at ?? null,
    }));
    return { data: { available: true, jobs }, fetchedAt: at };
  });
  return NextResponse.json(env);
}

/**
 * Cron mutations via the `hermes cron` CLI. Actions:
 *  - create  {schedule, prompt?, name?}  -> hermes cron create <schedule> [prompt] [--name]
 *  - pause   {id}                        -> hermes cron pause <id>
 *  - resume  {id}                        -> hermes cron resume <id>
 *  - trigger {id}                        -> hermes cron run <id>
 *  - remove  {id}                        -> hermes cron remove <id> --yes
 * Bust the GET cache so the next poll reflects the change.
 */
export async function POST(req: Request) {
  let body: { action?: string; id?: string; name?: string; schedule?: string; prompt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const action = body.action;
  let cmd: string | null = null;

  switch (action) {
    case "create": {
      const schedule = (body.schedule ?? "").trim();
      if (!schedule) return NextResponse.json({ error: "schedule required" }, { status: 400 });
      const prompt = (body.prompt ?? "").trim();
      const name = (body.name ?? "").trim();
      cmd = `${HERMES_BIN} cron create ${sq(schedule)}`;
      if (prompt) cmd += ` ${sq(prompt)}`;
      if (name) cmd += ` --name ${sq(name)}`;
      break;
    }
    case "pause":
    case "resume":
    case "trigger": {
      const id = (body.id ?? "").trim();
      if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const verb = action === "trigger" ? "run" : action;
      cmd = `${HERMES_BIN} cron ${verb} ${sq(id)}`;
      break;
    }
    case "remove": {
      const id = (body.id ?? "").trim();
      if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
      cmd = `${HERMES_BIN} cron remove ${sq(id)}`;
      break;
    }
    default:
      return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  }

  const res = await run(cmd, { timeoutMs: 20000 });
  if (!res.ok) {
    return NextResponse.json(
      { error: (res.stderr || res.stdout || "command failed").trim().slice(0, 500) },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, output: res.stdout.trim().slice(0, 500) });
}
