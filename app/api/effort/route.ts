import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { resetAllBridges } from "@/lib/acp-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reasoning effort selector. Hermes reads `agent.reasoning_effort` from
 * config.yaml at adapter boot — there is no per-turn flag — so changing it
 * means: rewrite that one key, then kill the warm ACP bridges so the next turn
 * respawns on the new effort. Valid values mirror the CLI: minimal | low |
 * medium | high | xhigh.
 *
 * Billing-safe + comment-safe: we do a SURGICAL line edit (not a yaml
 * round-trip) so the `model` block, every comment, and the file's formatting
 * are preserved byte-for-byte. There are two `reasoning_effort` keys in the
 * file (under `agent:` and under `delegation:`); we track the current
 * top-level section and only touch the one under `agent:`.
 */

const HOME = os.homedir();
const HERMES_HOME = process.env.HERMES_HOME || path.join(HOME, ".hermes");
const CONFIG = path.join(HERMES_HOME, "config.yaml");

const VALID = ["minimal", "low", "medium", "high", "xhigh"] as const;
type Effort = (typeof VALID)[number];

async function readEffort(): Promise<Effort> {
  try {
    const raw = await fs.readFile(CONFIG, "utf8");
    const cfg = yaml.load(raw) as { agent?: { reasoning_effort?: string } } | null;
    const v = (cfg?.agent?.reasoning_effort ?? "").toLowerCase();
    return (VALID as readonly string[]).includes(v) ? (v as Effort) : "high";
  } catch {
    return "high";
  }
}

/** Replace `agent.reasoning_effort` via line edit; returns null if not found. */
function setAgentEffort(raw: string, effort: Effort): string | null {
  const lines = raw.split("\n");
  let section: string | null = null;
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Top-level key (column 0, no leading space): e.g. "agent:", "delegation:".
    const top = line.match(/^([A-Za-z_][\w-]*):/);
    if (top) {
      section = top[1];
      continue;
    }
    if (section === "agent") {
      const m = line.match(/^(\s+)reasoning_effort:\s*\S.*$/);
      if (m) {
        lines[i] = `${m[1]}reasoning_effort: ${effort}`;
        changed = true;
        break;
      }
    }
  }
  if (changed) return lines.join("\n");
  // Key absent under agent: inject it right after the `agent:` line.
  for (let i = 0; i < lines.length; i++) {
    if (/^agent:/.test(lines[i])) {
      lines.splice(i + 1, 0, `  reasoning_effort: ${effort}`);
      return lines.join("\n");
    }
  }
  return null;
}

export async function GET() {
  const effort = await readEffort();
  return NextResponse.json({ effort, options: VALID, fetchedAt: new Date().toISOString() });
}

export async function POST(req: Request) {
  let body: { effort?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const effort = (body.effort ?? "").toLowerCase();
  if (!(VALID as readonly string[]).includes(effort)) {
    return NextResponse.json(
      { error: `effort must be one of ${VALID.join(", ")}` },
      { status: 400 },
    );
  }

  let raw: string;
  try {
    raw = await fs.readFile(CONFIG, "utf8");
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "config read failed" },
      { status: 500 },
    );
  }

  const next = setAgentEffort(raw, effort as Effort);
  if (next == null) {
    return NextResponse.json({ error: "could not locate agent block" }, { status: 500 });
  }

  try {
    await fs.writeFile(CONFIG, next, "utf8");
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "config write failed" },
      { status: 500 },
    );
  }

  // Respawn the brains so the new effort takes effect on the next turn.
  const reset = resetAllBridges();
  return NextResponse.json({ ok: true, effort, bridgesReset: reset });
}
