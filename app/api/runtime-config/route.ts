import { NextResponse } from "next/server";
import { writeFile, unlink } from "node:fs/promises";
import nodeOs from "node:os";
import path from "node:path";
import { run, scrubPaths, shellQuote } from "@/lib/exec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOME = process.env.HOME && process.env.HOME !== "~" ? process.env.HOME : nodeOs.homedir();
const rawHermesHome = process.env.HERMES_HOME || path.join(HOME, ".hermes");
const HERMES_HOME = rawHermesHome.startsWith("~/")
  ? path.join(HOME, rawHermesHome.slice(2))
  : rawHermesHome;
const CONFIG_PATH = path.join(HERMES_HOME, "config.yaml");

async function runPython(script: string, timeoutMs: number) {
  const file = path.join(
    nodeOs.tmpdir(),
    `battlestation-runtime-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.py`,
  );
  await writeFile(file, script, "utf8");
  try {
    return await run(`python3 ${shellQuote(file)}`, { timeoutMs });
  } finally {
    await unlink(file).catch(() => {});
  }
}

/**
 * Runtime Hermes config — the knobs that decide what model the agent runs,
 * how approvals gate, reasoning effort, skills, curator, and CLI/TUI behavior.
 * Distinct from /api/config (this app's first-run setup).
 */

const EDITABLE_TYPES = new Map<string, "string" | "number" | "boolean">([
  ["model.default", "string"],
  ["model.provider", "string"],
  ["model.base_url", "string"],
  ["approvals.mode", "string"],
  ["agent.reasoning_effort", "string"],
  ["agent.max_turns", "number"],
  ["display.busy_input_mode", "string"],
  ["display.tui_status_indicator", "string"],
  ["display.tool_progress", "string"],
  ["display.background_process_notifications", "string"],
  ["display.runtime_footer.enabled", "boolean"],
  ["skills.write_approval", "boolean"],
  ["skills.guard_agent_created", "boolean"],
  ["skills.creation_nudge_interval", "number"],
  ["curator.enabled", "boolean"],
  ["curator.consolidate", "boolean"],
  ["curator.prune_builtins", "boolean"],
  ["curator.interval_hours", "number"],
  ["curator.stale_after_days", "number"],
  ["curator.archive_after_days", "number"],
]);

interface RuntimeConfig {
  model: { default: string; provider: string; base_url: string };
  approvals: { mode: string };
  agent: { reasoning_effort?: string; max_turns?: number };
  display: {
    busy_input_mode: string;
    tui_status_indicator: string;
    tool_progress: string;
    background_process_notifications: string;
    runtime_footer_enabled: boolean;
  };
  skills: {
    write_approval: boolean;
    guard_agent_created: boolean;
    creation_nudge_interval: number;
    disabled: string[];
  };
  curator: {
    enabled: boolean;
    consolidate: boolean;
    prune_builtins: boolean;
    interval_hours: number;
    stale_after_days: number;
    archive_after_days: number;
  };
}

export async function GET() {
  const py = [
    "import yaml,json",
    `p=${JSON.stringify(CONFIG_PATH)}`,
    "d=yaml.safe_load(open(p)) or {}",
    "m=d.get('model',{}) or {}",
    "a=d.get('approvals',{}) or {}",
    "g=d.get('agent',{}) or {}",
    "disp=d.get('display',{}) or {}",
    "rf=disp.get('runtime_footer',{}) or {}",
    "sk=d.get('skills',{}) or {}",
    "cur=d.get('curator',{}) or {}",
    "out={",
    " 'model':{'default':m.get('default',''),'provider':m.get('provider',''),'base_url':m.get('base_url','')},",
    " 'approvals':{'mode':a.get('mode','manual')},",
    " 'agent':{'reasoning_effort':g.get('reasoning_effort',''),'max_turns':g.get('max_turns',60)},",
    " 'display':{'busy_input_mode':disp.get('busy_input_mode','interrupt'),'tui_status_indicator':disp.get('tui_status_indicator','kaomoji'),'tool_progress':disp.get('tool_progress','none'),'background_process_notifications':disp.get('background_process_notifications','all'),'runtime_footer_enabled':bool(rf.get('enabled',False))},",
    " 'skills':{'write_approval':bool(sk.get('write_approval',False)),'guard_agent_created':bool(sk.get('guard_agent_created',False)),'creation_nudge_interval':int(sk.get('creation_nudge_interval',15) or 15),'disabled':list(sk.get('disabled') or [])},",
    " 'curator':{'enabled':bool(cur.get('enabled',True)),'consolidate':bool(cur.get('consolidate',False)),'prune_builtins':bool(cur.get('prune_builtins',True)),'interval_hours':int(cur.get('interval_hours',168) or 168),'stale_after_days':int(cur.get('stale_after_days',30) or 30),'archive_after_days':int(cur.get('archive_after_days',90) or 90)},",
    "}",
    "print(json.dumps(out))",
  ].join("\n");
  const res = await runPython(py, 8000);
  if (!res.ok) {
    return NextResponse.json(
      { error: "could not read config", detail: scrubPaths(res.stderr || res.stdout).slice(0, 300) },
      { status: 500 },
    );
  }
  let cfg: RuntimeConfig;
  try {
    cfg = JSON.parse(res.stdout.trim());
  } catch {
    return NextResponse.json({ error: "config parse failed" }, { status: 500 });
  }
  return NextResponse.json({ config: cfg, configPath: CONFIG_PATH });
}

export async function POST(req: Request) {
  let body: { key?: string; value?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const key = (body.key ?? "").trim();
  const type = EDITABLE_TYPES.get(key);
  if (!type) {
    return NextResponse.json({ error: `key not editable: ${key}` }, { status: 400 });
  }

  let value: string | number | boolean;
  if (type === "boolean") {
    value = body.value === true || body.value === "true";
  } else if (type === "number") {
    const num = Number(body.value);
    if (!Number.isFinite(num)) {
      return NextResponse.json({ error: "number required" }, { status: 400 });
    }
    value = num;
  } else {
    value = String(body.value ?? "").trim();
  }

  const py = [
    "import json,os,re",
    `p=${JSON.stringify(CONFIG_PATH)}`,
    `parts=${JSON.stringify(key.split("."))}`,
    `value=json.loads(${JSON.stringify(JSON.stringify(value))})`,
    "def fmt(v):",
    "    if isinstance(v,bool): return 'true' if v else 'false'",
    "    if isinstance(v,(int,float)): return str(int(v) if isinstance(v,float) and v.is_integer() else v)",
    "    return json.dumps(str(v))",
    "def key_line(indent,k,v): return ' '*indent + k + ': ' + fmt(v) + '\\n'",
    "def find_key(lines,start,end,indent,k):",
    "    pat=re.compile(r'^ {'+str(indent)+r'}'+re.escape(k)+r':(?:\\s|$)')",
    "    for i in range(start,end):",
    "        s=lines[i]",
    "        if not s.lstrip().startswith('#') and pat.match(s): return i",
    "    return -1",
    "def block_end(lines,start,indent):",
    "    i=start+1",
    "    while i<len(lines):",
    "        s=lines[i]",
    "        if s.strip() and not s.lstrip().startswith('#'):",
    "            cur=len(s)-len(s.lstrip(' '))",
    "            if cur<=indent: break",
    "        i+=1",
    "    return i",
    "with open(p) as f: lines=f.readlines()",
    "if lines and not lines[-1].endswith('\\n'): lines[-1]+='\\n'",
    "if len(parts) not in (2,3): raise SystemExit('unsupported key depth')",
    "sec=parts[0]",
    "si=find_key(lines,0,len(lines),0,sec)",
    "if si<0:",
    "    if lines and lines[-1].strip(): lines.append('\\n')",
    "    lines.append(sec+':\\n')",
    "    si=len(lines)-1",
    "send=block_end(lines,si,0)",
    "if len(parts)==2:",
    "    ki=find_key(lines,si+1,send,2,parts[1])",
    "    if ki>=0: lines[ki]=key_line(2,parts[1],value)",
    "    else: lines.insert(send,key_line(2,parts[1],value))",
    "else:",
    "    sub=parts[1]; leaf=parts[2]",
    "    subi=find_key(lines,si+1,send,2,sub)",
    "    if subi<0:",
    "        lines.insert(send,'  '+sub+':\\n')",
    "        lines.insert(send+1,key_line(4,leaf,value))",
    "    else:",
    "        after=lines[subi].split(':',1)[1].strip()",
    "        if after and not after.startswith('#'): lines[subi]='  '+sub+':\\n'",
    "        subend=block_end(lines,subi,2)",
    "        li=find_key(lines,subi+1,subend,4,leaf)",
    "        if li>=0: lines[li]=key_line(4,leaf,value)",
    "        else: lines.insert(subend,key_line(4,leaf,value))",
    "tmp=p+'.tmp'",
    "with open(tmp,'w') as f: f.writelines(lines)",
    "os.replace(tmp,p)",
    "print('ok')",
  ].join("\n");

  const res = await runPython(py, 10000);
  if (!res.ok || !res.stdout.includes("ok")) {
    return NextResponse.json(
      { error: scrubPaths(res.stderr || res.stdout || "config write failed").slice(0, 500) },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, key, value });
}
