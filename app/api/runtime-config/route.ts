import { NextResponse } from "next/server";
import path from "node:path";
import { run } from "@/lib/exec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOME = process.env.HOME ?? process.cwd();
const HERMES_HOME = process.env.HERMES_HOME || path.join(HOME, ".hermes");
const CONFIG_PATH = path.join(HERMES_HOME, "config.yaml");
const HERMES_BIN = process.env.HERMES_BIN ?? "hermes";

/**
 * Runtime Hermes config — the knobs that decide what model the agent runs,
 * how approvals gate, reasoning effort, etc. Distinct from /api/config (which
 * is THIS app's own first-run setup). Reads config.yaml directly; writes the
 * whitelisted scalar keys via `hermes config set` so the CLI validates them.
 */

// Only these keys are editable from the UI. Each maps to a config.yaml path.
const EDITABLE = new Set([
  "model.default",
  "model.provider",
  "model.base_url",
  "approvals.mode",
  "agent.reasoning_effort",
  "agent.max_turns",
]);

interface RuntimeConfig {
  model: { default: string; provider: string; base_url: string };
  approvals: { mode: string };
  agent: { reasoning_effort?: string; max_turns?: number };
}

export async function GET() {
  // Read config.yaml via a python yaml dump → JSON (no yaml dep needed at edge).
  const py = [
    "import yaml,json",
    `d=yaml.safe_load(open(${JSON.stringify(CONFIG_PATH)})) or {}`,
    "m=d.get('model',{}) or {}",
    "a=d.get('approvals',{}) or {}",
    "g=d.get('agent',{}) or {}",
    "print(json.dumps({'model':{'default':m.get('default',''),'provider':m.get('provider',''),'base_url':m.get('base_url','')},'approvals':{'mode':a.get('mode','manual')},'agent':{'reasoning_effort':g.get('reasoning_effort',''),'max_turns':g.get('max_turns',60)}}))",
  ].join("; ");
  const res = await run(`python3 -c ${JSON.stringify(py)}`, { timeoutMs: 8000 });
  if (!res.ok) {
    return NextResponse.json({ error: "could not read config", detail: res.stderr.slice(0, 300) }, { status: 500 });
  }
  let cfg: RuntimeConfig;
  try {
    cfg = JSON.parse(res.stdout.trim());
  } catch {
    return NextResponse.json({ error: "config parse failed" }, { status: 500 });
  }
  return NextResponse.json({ config: cfg, configPath: CONFIG_PATH });
}

/** Set one config key. Body: { key: "model.default", value: "claude-opus-4-8" }. */
export async function POST(req: Request) {
  let body: { key?: string; value?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const key = (body.key ?? "").trim();
  const value = String(body.value ?? "").trim();
  if (!EDITABLE.has(key)) {
    return NextResponse.json({ error: `key not editable: ${key}` }, { status: 400 });
  }
  // value is single-quoted; empty string is allowed (e.g. clearing base_url).
  const sq = `'${value.replace(/'/g, "'\\''")}'`;
  const res = await run(`${HERMES_BIN} config set ${key} ${sq}`, { timeoutMs: 12000 });
  if (!res.ok) {
    return NextResponse.json(
      { error: (res.stderr || res.stdout || "config set failed").trim().slice(0, 400) },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, key, value });
}
