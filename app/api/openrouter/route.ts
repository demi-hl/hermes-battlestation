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
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MODELS_URL = "https://openrouter.ai/api/v1/models";

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

async function loadCatalog(): Promise<{ models: ORModel[]; source: "live" | "cache" | "offline" }> {
  // try live first
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 12_000);
    const res = await fetch(MODELS_URL, {
      headers: { "User-Agent": "hermes-battlestation" },
      signal: ac.signal,
      cache: "no-store",
    });
    clearTimeout(t);
    if (res.ok) {
      const json = (await res.json()) as { data?: ORModel[] };
      const models = json.data ?? [];
      if (models.length) {
        fs.writeFile(
          CACHE_FILE,
          JSON.stringify({ at: Date.now(), models }),
          "utf8",
        ).catch(() => {});
        return { models, source: "live" };
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
    if (raw.models?.length) return { models: raw.models, source: "cache" };
  } catch {
    /* no cache */
  }
  return { models: [], source: "offline" };
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
  const { models, source } = await loadCatalog();
  const all = models.map(toPicked);

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

  return NextResponse.json({
    source,
    counts,
    pipeline,
    modes,
    campaigns,
    freeModels: freeByNew.slice(0, 30),
    fetchedAt: new Date().toISOString(),
  });
}
