import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OpenRouter intelligence pane backend. Pulls the LIVE public model catalog
 * (https://openrouter.ai/api/v1/models — no API key required, so this works
 * for any OSS user), classifies every model by capability + price, and builds:
 *   - a multi-stage creative PIPELINE (reasoning → image-prompt → image-gen →
 *     vision review) with a model picked per stage,
 *   - three cost MODES (cheapest paid / free / premium) — the pipeline is
 *     resolved for all three so the client can toggle with no refetch,
 *   - the NEWEST FREE models feed, with active campaigns (e.g. NVIDIA Nemotron)
 *     surfaced first.
 * Catalog is cached to ~/.hermes for 6h; on network failure we serve the cache,
 * and if there's no cache we return source:"offline" honestly (never faked).
 */

const HERMES_HOME = process.env.HERMES_HOME || path.join(os.homedir(), ".hermes");
const CACHE_FILE = path.join(HERMES_HOME, "openrouter_models_cache.json");
// Applied pipeline lives in its OWN file — NEVER config.yaml. Applying a
// pipeline here must never repoint the agent's own loop (that would switch
// the primary provider onto metered OpenRouter billing). This is a
// preference doc the app reads, not a runtime model override.
const PIPELINE_FILE = path.join(HERMES_HOME, "battlestation-pipeline.json");
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MODELS_URL = "https://openrouter.ai/api/v1/models";

const STAGE_IDS = ["reasoning", "image_prompt", "image_gen", "vision"] as const;
type StageId = (typeof STAGE_IDS)[number];

interface SavedPipeline {
  mode: Mode;
  stages: Partial<Record<StageId, string>>;
  savedAt: string;
}

async function readSavedPipeline(): Promise<SavedPipeline | null> {
  try {
    const raw = JSON.parse(await fs.readFile(PIPELINE_FILE, "utf8")) as SavedPipeline;
    if (raw && typeof raw === "object" && raw.stages) return raw;
  } catch {
    /* none saved */
  }
  return null;
}

type ORPricing = { prompt?: string; completion?: string; image?: string };
type ORArch = { input_modalities?: string[]; output_modalities?: string[] };
type ORModel = {
  id: string;
  name?: string;
  created?: number;
  context_length?: number;
  pricing?: ORPricing;
  architecture?: ORArch;
  supported_parameters?: string[];
};

type Mode = "cheapest" | "free" | "premium";

interface PickedModel {
  id: string;
  name: string;
  ctx: number;
  /** blended $ per 1M tokens (prompt+completion average). 0 = free. */
  perM: number;
  priceIn: number;
  priceOut: number;
  free: boolean;
  router: boolean;
  reasoning: boolean;
  tools: boolean;
  inputs: string[];
  outputs: string[];
}

interface Stage {
  stage: string;
  label: string;
  blurb: string;
  /** model per mode; null when no candidate exists for that mode. */
  picks: Record<Mode, PickedModel | null>;
}

function num(s: string | undefined): number {
  const n = Number(s ?? "0");
  // OpenRouter uses "-1" to mean "variable/router-resolved" — not free, not a
  // real per-token price. Treat anything non-positive as 0 for blending but
  // flag routers separately (see isMetaRouter) so they're excluded from picks.
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Meta-routers (openrouter/auto, /fusion, /free, …) and variable-priced
 *  entries aren't concrete callable models — keep them out of stage picks so a
 *  mode resolves to a REAL model or honestly to "none". */
function isMetaRouter(m: ORModel): boolean {
  if (m.id.startsWith("openrouter/")) return true;
  const p = m.pricing ?? {};
  return p.prompt === "-1" || p.completion === "-1";
}

function toPicked(m: ORModel): PickedModel {
  const pr = m.pricing ?? {};
  const priceIn = num(pr.prompt);
  const priceOut = num(pr.completion);
  const perM = ((priceIn + priceOut) / 2) * 1_000_000;
  const sp = m.supported_parameters ?? [];
  const arch = m.architecture ?? {};
  const router = isMetaRouter(m);
  return {
    id: m.id,
    name: m.name ?? m.id,
    ctx: m.context_length ?? 0,
    perM,
    priceIn,
    priceOut,
    // a router is never "free" — its price is variable.
    free: !router && priceIn === 0 && priceOut === 0,
    router,
    reasoning: sp.includes("reasoning"),
    tools: sp.includes("tools"),
    inputs: arch.input_modalities ?? [],
    outputs: arch.output_modalities ?? [],
  };
}

/** Pick a model for a stage+mode from candidates (already capability-filtered). */
function pick(cands: PickedModel[], mode: Mode): PickedModel | null {
  if (!cands.length) return null;
  if (mode === "free") {
    const free = cands.filter((c) => c.free);
    if (!free.length) return null;
    // prefer the largest-context free model (most useful at $0).
    return free.slice().sort((a, b) => b.ctx - a.ctx)[0];
  }
  const paid = cands.filter((c) => !c.free);
  const pool = paid.length ? paid : cands;
  if (mode === "cheapest") {
    return pool.slice().sort((a, b) => a.perM - b.perM)[0];
  }
  // premium — most expensive (flagship), tie-break by context.
  return pool.slice().sort((a, b) => b.perM - a.perM || b.ctx - a.ctx)[0];
}

function buildStage(
  all: PickedModel[],
  stage: string,
  label: string,
  blurb: string,
  predicate: (m: PickedModel) => boolean,
): Stage {
  const cands = all.filter((m) => !m.router && predicate(m));
  return {
    stage,
    label,
    blurb,
    picks: {
      cheapest: pick(cands, "cheapest"),
      free: pick(cands, "free"),
      premium: pick(cands, "premium"),
    },
  };
}

async function loadCatalog(): Promise<{
  models: ORModel[];
  source: "live" | "cache" | "offline";
  latencyMs: number | null;
}> {
  // try live first
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 12_000);
    const t0 = Date.now();
    const res = await fetch(MODELS_URL, {
      headers: { "User-Agent": "hermes-battlestation" },
      signal: ac.signal,
      cache: "no-store",
    });
    clearTimeout(t);
    const latencyMs = Date.now() - t0;
    if (res.ok) {
      const json = (await res.json()) as { data?: ORModel[] };
      const models = json.data ?? [];
      if (models.length) {
        fs.writeFile(
          CACHE_FILE,
          JSON.stringify({ at: Date.now(), models }),
          "utf8",
        ).catch(() => {});
        return { models, source: "live", latencyMs };
      }
    }
  } catch {
    /* fall through to cache */
  }
  // cache fallback
  try {
    const raw = JSON.parse(await fs.readFile(CACHE_FILE, "utf8")) as {
      at: number;
      models: ORModel[];
    };
    if (raw.models?.length) return { models: raw.models, source: "cache", latencyMs: null };
  } catch {
    /* no cache */
  }
  return { models: [], source: "offline", latencyMs: null };
}

/** Detect active free-model campaigns by vendor (e.g. NVIDIA Nemotron drop). */
function detectCampaigns(free: PickedModel[]): { name: string; vendor: string; blurb: string; models: string[] }[] {
  const out: { name: string; vendor: string; blurb: string; models: string[] }[] = [];
  const nvidia = free.filter((m) => m.id.startsWith("nvidia/"));
  if (nvidia.length) {
    out.push({
      name: "NVIDIA Nemotron 3 — free",
      vendor: "nvidia",
      blurb:
        "NVIDIA's Nemotron 3 family is free on OpenRouter right now — including the 550B-param Ultra and an omni model that takes audio + image + video.",
      models: nvidia.map((m) => m.id),
    });
  }
  const oss = free.filter((m) => m.id.startsWith("openai/gpt-oss"));
  if (oss.length) {
    out.push({
      name: "OpenAI gpt-oss — free",
      vendor: "openai",
      blurb: "OpenAI's open-weight gpt-oss models (20B / 120B) are free to call.",
      models: oss.map((m) => m.id),
    });
  }
  return out;
}

export async function GET() {
  const { models, source, latencyMs } = await loadCatalog();
  const all = models.map(toPicked);
  const saved = await readSavedPipeline();

  // capability predicates
  const isText = (m: PickedModel) => m.inputs.includes("text") || m.inputs.length === 0;
  const isReasoning = (m: PickedModel) => m.reasoning;
  const isImageOut = (m: PickedModel) => m.outputs.includes("image");
  const isVision = (m: PickedModel) => m.inputs.includes("image");

  // the creative pipeline the user described: think → write prompt → render → review
  const pipeline: Stage[] = [
    buildStage(
      all,
      "reasoning",
      "Reasoning",
      "Plans the work and thinks step-by-step before anything is generated.",
      isReasoning,
    ),
    buildStage(
      all,
      "image_prompt",
      "Image Prompt",
      "Turns the plan into a vivid, model-ready image prompt.",
      (m) => isText(m) && m.tools,
    ),
    buildStage(
      all,
      "image_gen",
      "Image Generation",
      "Renders the actual image from the crafted prompt.",
      isImageOut,
    ),
    buildStage(
      all,
      "vision",
      "Vision Review",
      "Looks at the result and critiques / captions it for the next loop.",
      isVision,
    ),
  ];

  // newest free models, campaigns first
  const free = all.filter((m) => m.free);
  const freeByNew = free
    .map((m) => {
      const orig = models.find((x) => x.id === m.id);
      return { ...m, created: orig?.created ?? 0 };
    })
    .sort((a, b) => b.created - a.created);
  const campaigns = detectCampaigns(free);

  // per-mode one-line summary (count of stages resolved + blended cost)
  const modes: Record<Mode, { resolved: number; perMTotal: number; note: string }> = {
    cheapest: { resolved: 0, perMTotal: 0, note: "Lowest paid model at every stage — pennies, no rate limits." },
    free: { resolved: 0, perMTotal: 0, note: "$0 models only — rate-limited, prompts may be used for training." },
    premium: { resolved: 0, perMTotal: 0, note: "Flagship model at every stage — best quality, highest spend." },
  };
  for (const st of pipeline) {
    (Object.keys(modes) as Mode[]).forEach((mo) => {
      const p = st.picks[mo];
      if (p) {
        modes[mo].resolved += 1;
        modes[mo].perMTotal += p.perM;
      }
    });
  }

  const counts = {
    total: all.length,
    free: free.length,
    reasoning: all.filter(isReasoning).length,
    imageOut: all.filter(isImageOut).length,
    vision: all.filter(isVision).length,
  };

  // compact catalog for client-side search across the whole list. Strip to the
  // fields the search UI needs; keep payload small.
  const catalog = all
    .filter((m) => !m.router && !m.id.startsWith("~"))
    .map((m) => ({
      id: m.id,
      ctx: m.ctx,
      perM: m.perM,
      free: m.free,
      reasoning: m.reasoning,
      tools: m.tools,
      inputs: m.inputs,
      outputs: m.outputs,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  // honest reachability telemetry — measured during THIS request's catalog
  // fetch. null latency = served from cache / offline (no live round-trip).
  const health = {
    reachable: source === "live",
    latencyMs,
    status: source === "live" ? "online" : source === "cache" ? "cached" : "offline",
  };

  return NextResponse.json({
    source,
    counts,
    health,
    pipeline,
    modes,
    campaigns,
    freeModels: freeByNew.slice(0, 30),
    catalog,
    saved,
    fetchedAt: new Date().toISOString(),
  });
}

/**
 * Apply / clear a pipeline. Writes ONLY to battlestation-pipeline.json — never
 * config.yaml, never the `model` block. This is a saved preference the app
 * reads back; it does NOT change which model the agent's own loop runs, so it
 * can't silently flip the primary provider onto metered billing.
 * Body: { action: "apply", mode, stages: {stageId: modelId} } | { action: "clear" }.
 */
export async function POST(req: Request) {
  let body: { action?: string; mode?: Mode; stages?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (body.action === "clear") {
    await fs.unlink(PIPELINE_FILE).catch(() => {});
    return NextResponse.json({ ok: true, cleared: true });
  }

  if (body.action !== "apply") {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  const mode: Mode = ["cheapest", "free", "premium"].includes(body.mode as string)
    ? (body.mode as Mode)
    : "cheapest";

  // whitelist stage ids + validate model-id shape (provider/model[:variant]).
  const stages: Partial<Record<StageId, string>> = {};
  const ID_RX = /^[A-Za-z0-9._\/:-]{1,128}$/;
  for (const sid of STAGE_IDS) {
    const v = body.stages?.[sid];
    if (typeof v === "string" && v && ID_RX.test(v)) stages[sid] = v;
  }
  if (!Object.keys(stages).length) {
    return NextResponse.json({ error: "no valid stages" }, { status: 400 });
  }

  const payload: SavedPipeline = { mode, stages, savedAt: new Date().toISOString() };
  try {
    await fs.writeFile(PIPELINE_FILE, JSON.stringify(payload, null, 2), "utf8");
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 500 });
  }
  return NextResponse.json({ ok: true, saved: payload, path: PIPELINE_FILE });
}
