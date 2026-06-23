import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { run, scrubPaths} from "@/lib/exec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOME = process.env.HOME ?? process.cwd();
const HERMES_HOME = process.env.HERMES_HOME || path.join(HOME, ".hermes");
const CONFIG_PATH = path.join(HERMES_HOME, "config.yaml");
const HERMES_BIN = process.env.HERMES_BIN ?? "hermes";

/**
 * MCP server + endpoint management. GET lists configured servers from
 * config.yaml (env values redacted). POST: add (stdio command or HTTP url),
 * test (live connect + tool count), toggle (enable/disable), install (catalog).
 * DELETE removes a server. Mutations shell `hermes mcp ...`; enable/disable is a
 * config.yaml flag (yaml round-trip) since there's no CLI verb for it.
 */

function sq(s: string): string {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

const NAME_RX = /^[a-zA-Z0-9._-]+$/;

interface McpServer {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
  env: Record<string, string>; // redacted
  toolCount?: number | null;
}

const LIST_SCRIPT = (cfg: string) => `
import yaml, json, re
d = yaml.safe_load(open(${JSON.stringify(cfg)})) or {}
servers = d.get("mcp_servers", {}) or {}
out = []
for name, s in servers.items():
    if not isinstance(s, dict): continue
    url = s.get("url")
    env = s.get("env", {}) or {}
    red = {}
    for k, v in env.items():
        sv = str(v)
        # redact unless it's a pure \${VAR} reference (those are safe to show)
        if re.fullmatch(r"\\\$\\{[^}]+\\}", sv): red[k] = sv
        elif len(sv) <= 6: red[k] = "****"
        else: red[k] = sv[:3] + "…" + sv[-3:]
    out.append({
        "name": name,
        "transport": "http" if url else "stdio",
        "command": s.get("command"),
        "args": s.get("args", []),
        "url": url,
        "enabled": bool(s.get("enabled", True)),
        "env": red,
    })
print(json.dumps(out))
`;

export async function GET() {
  const tmp = path.join(os.tmpdir(), `lo-mcp-${process.pid}-${Date.now()}.py`);
  try {
    await fs.writeFile(tmp, LIST_SCRIPT(CONFIG_PATH), "utf8");
    const res = await run(`python3 ${tmp}`, { timeoutMs: 8000 });
    if (!res.ok) {
      return NextResponse.json({ error: "could not read mcp servers", servers: [] }, { status: 500 });
    }
    const servers = JSON.parse(res.stdout.trim()) as McpServer[];
    return NextResponse.json({ servers, configPath: CONFIG_PATH });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200), servers: [] }, { status: 500 });
  } finally {
    fs.unlink(tmp).catch(() => {});
  }
}

export async function POST(req: Request) {
  let body: {
    action?: string;
    name?: string;
    url?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    enabled?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const action = body.action;
  const name = (body.name ?? "").trim();

  if (["add", "test", "toggle", "install", "login"].includes(action ?? "")) {
    if (!name || !NAME_RX.test(name)) {
      return NextResponse.json({ error: "invalid server name" }, { status: 400 });
    }
  }

  switch (action) {
    case "add": {
      const url = (body.url ?? "").trim();
      const command = (body.command ?? "").trim();
      if (!url && !command) {
        return NextResponse.json({ error: "url or command required" }, { status: 400 });
      }
      let cmd = `${HERMES_BIN} mcp add ${sq(name)}`;
      if (url) cmd += ` --url ${sq(url)}`;
      if (command) {
        cmd += ` --command ${sq(command)}`;
        const args = Array.isArray(body.args) ? body.args.filter((a) => typeof a === "string") : [];
        if (args.length) cmd += ` --args ${args.map(sq).join(" ")}`;
      }
      const env = body.env ?? {};
      const envPairs = Object.entries(env)
        .filter(([k]) => /^[A-Z0-9_]+$/i.test(k))
        .map(([k, v]) => `${k}=${v}`);
      if (envPairs.length) cmd += ` --env ${envPairs.map(sq).join(" ")}`;
      return runCli(cmd, 30000);
    }
    case "test":
      return runCli(`${HERMES_BIN} mcp test ${sq(name)}`, 30000);
    case "install":
      return runCli(`${HERMES_BIN} mcp install ${sq(name)}`, 45000);
    case "login":
      return runCli(`${HERMES_BIN} mcp login ${sq(name)}`, 20000);
    case "toggle": {
      if (typeof body.enabled !== "boolean") {
        return NextResponse.json({ error: "enabled (boolean) required" }, { status: 400 });
      }
      return toggleServer(name, body.enabled);
    }
    default:
      return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (!name || !NAME_RX.test(name)) {
    return NextResponse.json({ error: "invalid server name" }, { status: 400 });
  }
  return runCli(`${HERMES_BIN} mcp remove ${sq(name)}`, 15000);
}

async function runCli(cmd: string, timeoutMs: number) {
  const res = await run(cmd, { timeoutMs });
  if (!res.ok) {
    return NextResponse.json(
      { error: scrubPaths(res.stderr || res.stdout || "command failed").slice(0, 800) },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, output: res.stdout.trim().slice(0, 1200) });
}

/** Flip a server's `enabled` flag in config.yaml (no CLI verb for this). */
async function toggleServer(name: string, enabled: boolean) {
  const py = [
    "import yaml",
    `p=${JSON.stringify(CONFIG_PATH)}`,
    `n=${JSON.stringify(name)}`,
    `en=${enabled ? "True" : "False"}`,
    "d=yaml.safe_load(open(p)) or {}",
    "s=d.setdefault('mcp_servers',{})",
    "srv=s.get(n)",
    "import sys",
    "sys.exit(3) if not isinstance(srv,dict) else None",
    "srv['enabled']=en",
    "yaml.safe_dump(d,open(p,'w'),default_flow_style=False,sort_keys=False)",
    "print('ok')",
  ].join("; ");
  const res = await run(`python3 -c ${JSON.stringify(py)}`, { timeoutMs: 10000 });
  if (res.code === 3) {
    return NextResponse.json({ error: `no such server: ${name}` }, { status: 404 });
  }
  if (!res.ok || !res.stdout.includes("ok")) {
    return NextResponse.json(
      { error: scrubPaths(res.stderr || "toggle failed").slice(0, 300) },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, name, enabled });
}
