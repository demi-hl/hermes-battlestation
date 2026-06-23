import { NextResponse } from "next/server";
import { cached } from "@/lib/cache";
import { run, scrubPaths} from "@/lib/exec";
import type { ApiEnvelope, CronList, CronJob } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HERMES_BIN = process.env.HERMES_BIN ?? "hermes";

/** Shell-safe single-quote wrap. */
function sq(s: string): string {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

export async function GET() {
  const env: ApiEnvelope<CronList> = await cached("cron", 30_000, async () => {
    const at = new Date().toISOString();
    // Shell the real `hermes cron list` CLI (same pattern as the profiles
    // route). The old dashboardGet path scraped a session token off
    // 127.0.0.1:9119 — but that IS this battlestation server, not the Hermes
    // agent dashboard, so it always came back empty ("dashboard not running").
    const res = await run(`${HERMES_BIN} cron list`, { timeoutMs: 12_000 });
    if (!res.ok || !res.stdout.trim()) {
      return {
        data: {
          available: false,
          jobs: [],
          note: scrubPaths(res.stderr) || "hermes cron list returned nothing",
        },
        fetchedAt: at,
      };
    }
    return { data: { available: true, jobs: parseCronList(res.stdout) }, fetchedAt: at };
  });
  return NextResponse.json(env);
}

/**
 * Parse the boxed text output of `hermes cron list` into CronJob rows. Each job
 * is a `  <12-hex-id> [active|paused]` header followed by indented
 * `Key:  value` lines (Name / Schedule / Next run / Last run). The trailing
 * token of "Last run: <iso>  ok|error" is the status.
 */
function parseCronList(stdout: string): CronJob[] {
  const jobs: CronJob[] = [];
  let cur: CronJob | null = null;
  for (const raw of stdout.split("\n")) {
    const header = raw.match(/^\s*([0-9a-f]{8,})\s+\[(active|paused)\]/i);
    if (header) {
      if (cur) jobs.push(cur);
      cur = {
        id: header[1],
        name: "unnamed",
        schedule: "",
        lastStatus: null,
        enabled: header[2].toLowerCase() === "active",
        nextRunAt: null,
      };
      continue;
    }
    if (!cur) continue;
    const kv = raw.match(/^\s*([A-Za-z ]+):\s+(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim().toLowerCase();
    const val = kv[2].trim();
    if (key === "name") cur.name = val;
    else if (key === "schedule") cur.schedule = val;
    else if (key === "next run") cur.nextRunAt = val || null;
    else if (key === "last run") {
      // "2026-06-19T21:31:48-07:00  ok"  ->  status is the trailing word.
      const m = val.match(/\s(ok|error|failed)\s*$/i);
      cur.lastStatus = m ? m[1].toLowerCase() : null;
    }
  }
  if (cur) jobs.push(cur);
  return jobs;
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
