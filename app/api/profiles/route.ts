import { exec } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { cached, bust } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const run = promisify(exec);

const HOME = os.homedir();
const HERMES_HOME = process.env.HERMES_HOME || path.join(HOME, ".hermes");

/** Valid reasoning-effort levels (mirrors hermes_constants.VALID_REASONING_EFFORTS),
 *  plus "" meaning "use the model/provider default". */
export const EFFORT_LEVELS = ["", "minimal", "low", "medium", "high", "xhigh"] as const;
export type Effort = (typeof EFFORT_LEVELS)[number];

export interface ProfileRow {
  id: string;
  label: string;
  model: string;
  provider: string;
  effort: Effort;
  active: boolean;
}

/** Title-case a profile slug for display: "macbook-sonnet" -> "Macbook Sonnet". */
function labelFor(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Resolve a profile's config.yaml path. "default" lives at the root; every
 *  other profile is under profiles/<id>/. */
function configPath(id: string): string {
  return id === "default"
    ? path.join(HERMES_HOME, "config.yaml")
    : path.join(HERMES_HOME, "profiles", id, "config.yaml");
}

/** Read the REAL provider + reasoning_effort straight from a profile's
 *  config.yaml (model.provider, agent.reasoning_effort) — no name-guessing. */
async function readProfileConfig(
  id: string,
): Promise<{ provider?: string; effort?: Effort }> {
  try {
    const raw = await fs.readFile(configPath(id), "utf8");
    const cfg = yaml.load(raw) as {
      model?: { provider?: string };
      agent?: { reasoning_effort?: string };
    } | null;
    const provider = cfg?.model?.provider?.trim() || undefined;
    const e = (cfg?.agent?.reasoning_effort ?? "").trim();
    const effort = (EFFORT_LEVELS as readonly string[]).includes(e)
      ? (e as Effort)
      : undefined;
    return { provider, effort };
  } catch {
    return {};
  }
}

/**
 * Real profiles, parsed from `hermes profile list` (Profile / Model / Gateway /
 * Alias / Distribution; active row marked with a leading diamond). Only profiles
 * with a model configured are surfaced. Each profile's provider + reasoning
 * effort are read from its actual config.yaml so the picker shows truth, not a
 * name-prefix guess.
 *
 * `hermes profile list` is slow (~8s cold), so the result is cached 60s. Only a
 * successful, non-empty parse is cached.
 */
export async function GET() {
  try {
    const payload = await cached("profiles", 60_000, async () => {
      const bin = process.env.HERMES_BIN || "hermes";
      const { stdout } = await run(`${bin} profile list`, {
        timeout: 12_000,
        env: process.env,
      });

      const parsed: { id: string; model: string; active: boolean }[] = [];
      for (const raw of stdout.split("\n")) {
        const line = raw.replace(/\u25C6/g, " ").trimEnd();
        const m = line.match(/^\s*([a-z0-9][a-z0-9._-]*)\s{2,}(\S.*)$/i);
        if (!m) continue;
        const id = m[1];
        if (id === "Profile") continue;
        const rest = m[2].trim();
        const model = rest.split(/\s{2,}|\s+/)[0];
        if (!model || model === "\u2014" || model === "-") continue;
        parsed.push({ id, model, active: /\u25C6/.test(raw) });
      }

      // Enrich each with its real provider + effort from config.yaml.
      const profiles: ProfileRow[] = await Promise.all(
        parsed.map(async (p) => {
          const { provider, effort } = await readProfileConfig(p.id);
          return {
            id: p.id,
            label: labelFor(p.id),
            model: p.model,
            provider: provider ?? "anthropic",
            effort: effort ?? "",
            active: p.active,
          };
        }),
      );

      profiles.sort((a, b) => (a.id === "default" ? -1 : b.id === "default" ? 1 : 0));

      if (profiles.length === 0) throw new Error("no profiles parsed");
      return { profiles, fetchedAt: new Date().toISOString() };
    });
    return Response.json(payload);
  } catch (e) {
    return Response.json(
      {
        profiles: [],
        error: e instanceof Error ? e.message : "failed to list profiles",
        fetchedAt: new Date().toISOString(),
      },
      { status: 200 },
    );
  }
}

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/**
 * Set a profile's reasoning effort via `hermes -p <profile> config set
 * agent.reasoning_effort <level>`. This writes the agent block (NOT the
 * billing-protected model block), so it's safe. Empty string clears the
 * override (back to the model/provider default).
 */
export async function POST(req: Request) {
  let body: { profile?: string; effort?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const profile = (body.profile ?? "").trim();
  const effort = (body.effort ?? "").trim();
  if (!ID_RE.test(profile)) {
    return Response.json({ error: "invalid profile" }, { status: 400 });
  }
  if (!(EFFORT_LEVELS as readonly string[]).includes(effort)) {
    return Response.json({ error: `invalid effort: ${effort}` }, { status: 400 });
  }

  const bin = process.env.HERMES_BIN || "hermes";
  // Empty string clears the key; the CLI accepts an empty value.
  const cmd = `${bin} -p ${profile} config set agent.reasoning_effort '${effort}'`;
  const r = await run(cmd, { timeout: 15_000, env: process.env }).then(
    () => ({ ok: true, err: "" }),
    (e: { stderr?: string; message?: string }) => ({
      ok: false,
      err: (e.stderr || e.message || "config set failed").split("\n")[0],
    }),
  );
  if (!r.ok) return Response.json({ error: r.err }, { status: 500 });

  bust("profiles");
  return Response.json({ ok: true, profile, effort });
}
