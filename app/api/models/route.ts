import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Model picker source for the bottom bar. Tries the live Hermes provider caches
 * (~/.hermes/provider_models_cache.json — the real models the user has wired,
 * per provider) and the bundled model catalog; falls back to a curated static
 * list of major providers + flagship models when no caches exist (a fresh OSS
 * install). Returns only model IDs + provider names — never any API key.
 */

interface ProviderModels {
  provider: string;
  label: string;
  models: string[];
}

const HOME = os.homedir();
const HERMES_HOME = process.env.HERMES_HOME || path.join(HOME, ".hermes");

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  "openai-api": "OpenAI",
  "openai-codex": "OpenAI",
  openrouter: "OpenRouter",
  "x-ai": "xAI",
  xai: "xAI",
  "xai-oauth": "xAI",
  google: "Google",
  "google-vertex": "Google",
  deepseek: "DeepSeek",
  groq: "Groq",
  copilot: "GitHub Copilot",
  mistral: "Mistral",
  togetherai: "Together",
  fireworks: "Fireworks",
  cerebras: "Cerebras",
  ollama: "Ollama",
  bedrock: "AWS Bedrock",
  nous: "Nous",
};

// Curated fallback — major providers + flagship tool-calling models. Used only
// when the live caches are absent (fresh install with no model picker run yet).
// Public build: every router imaginable so a fresh clone can pick any path.
const STATIC_FALLBACK: ProviderModels[] = [
  {
    provider: "anthropic",
    label: "Anthropic",
    models: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"],
  },
  {
    provider: "openai",
    label: "OpenAI",
    models: ["gpt-5.5", "gpt-5.5-pro", "gpt-5.4-mini", "o4"],
  },
  {
    provider: "openrouter",
    label: "OpenRouter",
    models: [
      "anthropic/claude-opus-4.8",
      "openai/gpt-5.5",
      "google/gemini-3.1-pro-preview",
      "x-ai/grok-4.3",
      "deepseek/deepseek-v4-pro",
      "meta-llama/llama-4-405b-instruct",
      "qwen/qwen-3-max",
    ],
  },
  {
    provider: "google",
    label: "Google",
    models: ["gemini-3.1-pro-preview", "gemini-3.5-flash"],
  },
  { provider: "xai", label: "xAI", models: ["grok-4.3", "grok-4.3-mini"] },
  {
    provider: "deepseek",
    label: "DeepSeek",
    models: ["deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"],
  },
  { provider: "groq", label: "Groq", models: ["llama-3.3-70b-versatile", "moonshotai/kimi-k2"] },
  { provider: "mistral", label: "Mistral", models: ["mistral-large-latest", "codestral-latest"] },
  { provider: "togetherai", label: "Together", models: ["meta-llama/Llama-4-405B-Instruct", "Qwen/Qwen3-235B"] },
  { provider: "fireworks", label: "Fireworks", models: ["accounts/fireworks/models/qwen3-235b", "accounts/fireworks/models/deepseek-v4"] },
  { provider: "deepinfra", label: "DeepInfra", models: ["meta-llama/Llama-4-Maverick", "deepseek-ai/DeepSeek-V4"] },
  { provider: "cerebras", label: "Cerebras", models: ["llama-4-scout", "qwen-3-235b"] },
  { provider: "novita", label: "Novita", models: ["deepseek/deepseek-v4", "qwen/qwen3-235b"] },
  { provider: "nous", label: "Nous Portal", models: ["hermes-4-405b", "deepseek-v4-flash"] },
  { provider: "ollama", label: "Ollama (local)", models: ["llama3.3", "qwen3", "deepseek-r1"] },
  { provider: "moonshot", label: "Moonshot / Kimi", models: ["kimi-k2.5", "moonshot-v1-128k"] },
  { provider: "zai", label: "z.ai / GLM", models: ["glm-4.6", "glm-4-plus"] },
];

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function labelFor(p: string): string {
  return PROVIDER_LABELS[p] ?? p.charAt(0).toUpperCase() + p.slice(1);
}

/** Pretty short label for a model id, e.g. "claude-opus-4-8" -> "Opus 4.8",
 *  "gpt-5.5-pro" -> "GPT 5.5 Pro", "x-ai/grok-4.3" -> "Grok 4.3". Strips the
 *  provider prefix (anything before a slash) and family noise. */
function modelLabel(id: string): string {
  const tail = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  let s = tail
    .replace(/^claude-/, "")
    .replace(/^gpt-/, "GPT ")
    .replace(/^grok-/, "Grok ")
    .replace(/^gemini-/, "Gemini ")
    .replace(/^deepseek-/, "DeepSeek ")
    .replace(/^o(\d)/, "o$1");
  // "opus-4-8" -> "Opus 4.8"; collapse hyphen-number runs into dotted versions.
  s = s.replace(/(\d)-(\d)/g, "$1.$2").replace(/-/g, " ");
  // Title-case word starts (but keep GPT/o-series casing already applied).
  s = s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
  return s.trim();
}

interface FlatModel {
  id: string;
  label: string;
  provider: string;
  providerLabel: string;
}

// Billing-safety ordering: when the SAME model id is offered by multiple
// providers (e.g. gpt-5.5 via both metered `openai-api` and the flat-rate
// `openai-codex` subscription), the bottom bar's `modelById` first-match must
// land on the SUBSCRIPTION provider, never the metered key. Lower rank = earlier
// in the flattened list = what the picker selects. Subscription/OAuth-backed
// providers rank above pay-per-token API keys.
const PROVIDER_RANK: Record<string, number> = {
  anthropic: 0,
  "openai-codex": 0,
  "xai-oauth": 0,
  copilot: 1,
  nous: 1,
  "openai-api": 8,
  openai: 8,
  openrouter: 9,
};
function providerRank(p: string): number {
  return PROVIDER_RANK[p] ?? 5;
}

/** Flatten the per-provider lists into a single ordered model list the bottom
 *  bar consumes directly (its workspace-context reads `data.models`). Default
 *  provider's models lead; the rest follow by billing rank (subscription before
 *  metered), then provider-grouped + de-duped by id. */
function flatten(providers: ProviderModels[], defaultProvider: string): FlatModel[] {
  const seen = new Set<string>();
  const out: FlatModel[] = [];
  const ordered = [...providers].sort((a, b) => {
    if (a.provider === defaultProvider) return -1;
    if (b.provider === defaultProvider) return 1;
    const r = providerRank(a.provider) - providerRank(b.provider);
    if (r !== 0) return r;
    return a.label.localeCompare(b.label);
  });
  for (const p of ordered) {
    for (const m of p.models) {
      const key = `${p.provider}::${m}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: m,
        label: modelLabel(m),
        provider: p.provider,
        providerLabel: p.label,
      });
    }
  }
  return out;
}

export async function GET() {
  // 1. Live provider caches (the real wired providers + models).
  const cache = await readJson<
    Record<string, { models?: string[] }>
  >(path.join(HERMES_HOME, "provider_models_cache.json"));

  let providers: ProviderModels[] = [];
  if (cache && Object.keys(cache).length) {
    providers = Object.entries(cache)
      .filter(([, v]) => Array.isArray(v.models) && v.models.length)
      .map(([provider, v]) => ({
        provider,
        label: labelFor(provider),
        models: v.models!,
      }));
  }

  // 2. Fallback to curated static list on a fresh install.
  let source: "live" | "static" = "live";
  if (!providers.length) {
    providers = STATIC_FALLBACK;
    source = "static";
  }

  // 3. Current default (from config.model, env-overridable). Keys never read.
  let defaultProvider = process.env.NEXT_PUBLIC_MODEL_PROVIDER ?? "anthropic";
  let defaultModel = "claude-opus-4-8";
  try {
    const raw = await fs.readFile(path.join(HERMES_HOME, "config.yaml"), "utf8");
    const cfg = yaml.load(raw) as {
      model?: { default?: string; provider?: string };
    } | null;
    if (cfg?.model) {
      if (cfg.model.provider) defaultProvider = cfg.model.provider;
      if (cfg.model.default) defaultModel = cfg.model.default;
    }
  } catch {
    /* no config / parse error — keep defaults */
  }

  return NextResponse.json({
    source,
    defaultProvider,
    defaultModel,
    models: flatten(providers, defaultProvider),
    providers: providers.sort((a, b) => a.label.localeCompare(b.label)),
    fetchedAt: new Date().toISOString(),
  });
}
