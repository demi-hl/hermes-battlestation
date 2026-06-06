import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOME = process.env.HOME ?? process.cwd();
const HERMES_HOME = process.env.HERMES_HOME || path.join(HOME, ".hermes");
const ENV_PATH = path.join(HERMES_HOME, ".env");

/**
 * Manage ~/.hermes/.env API keys from the UI. Values are REDACTED in the list
 * (only set/unset + a short tail preview). Writes preserve comments + ordering.
 * Known keys are grouped; unknown keys are shown under "other".
 */

// Curated list of well-known keys with labels + group, so the UI can show a
// useful form even for keys not yet set. Mirrors `hermes config show`.
const KNOWN: { key: string; label: string; group: string; secret?: boolean }[] = [
  // ── LLM Providers ──────────────────────────────────────────────────────
  { key: "OPENROUTER_API_KEY", label: "OpenRouter", group: "LLM Providers" },
  { key: "ANTHROPIC_API_KEY", label: "Anthropic", group: "LLM Providers" },
  { key: "OPENAI_API_KEY", label: "OpenAI", group: "LLM Providers" },
  { key: "DEEPSEEK_API_KEY", label: "DeepSeek", group: "LLM Providers" },
  { key: "XAI_API_KEY", label: "xAI / Grok", group: "LLM Providers" },
  { key: "GROQ_API_KEY", label: "Groq", group: "LLM Providers" },
  { key: "GOOGLE_API_KEY", label: "Google AI", group: "LLM Providers" },
  { key: "GEMINI_API_KEY", label: "Gemini", group: "LLM Providers" },
  { key: "MISTRAL_API_KEY", label: "Mistral", group: "LLM Providers" },
  { key: "TOGETHER_API_KEY", label: "Together AI", group: "LLM Providers" },
  { key: "FIREWORKS_API_KEY", label: "Fireworks", group: "LLM Providers" },
  { key: "DEEPINFRA_API_KEY", label: "DeepInfra", group: "LLM Providers" },
  { key: "CEREBRAS_API_KEY", label: "Cerebras", group: "LLM Providers" },
  { key: "NOVITA_API_KEY", label: "Novita AI", group: "LLM Providers" },
  { key: "MOONSHOT_API_KEY", label: "Moonshot / Kimi", group: "LLM Providers" },
  { key: "KIMI_API_KEY", label: "Kimi (Moonshot)", group: "LLM Providers" },
  { key: "ZAI_API_KEY", label: "z.ai / GLM", group: "LLM Providers" },
  { key: "DASHSCOPE_API_KEY", label: "Alibaba / Qwen (DashScope)", group: "LLM Providers" },
  { key: "NVIDIA_API_KEY", label: "NVIDIA NIM", group: "LLM Providers" },
  { key: "HF_TOKEN", label: "HuggingFace", group: "LLM Providers" },
  { key: "NOUS_API_KEY", label: "Nous Portal", group: "LLM Providers" },
  { key: "OLLAMA_HOST", label: "Ollama host (local)", group: "LLM Providers", secret: false },

  // ── Image Generation ───────────────────────────────────────────────────
  { key: "FAL_KEY", label: "FAL · FLUX / GPT-Image / Nano-Banana / Ideogram", group: "Image Generation" },
  { key: "KREA_API_KEY", label: "Krea", group: "Image Generation" },
  { key: "REPLICATE_API_TOKEN", label: "Replicate", group: "Image Generation" },

  // ── Video Generation ───────────────────────────────────────────────────
  // FAL_KEY (Image) and XAI_API_KEY (LLM) also drive video backends.
  { key: "MINIMAX_API_KEY", label: "MiniMax · video & voice", group: "Video Generation" },
  { key: "RUNWAY_API_KEY", label: "Runway", group: "Video Generation" },
  { key: "KLING_API_KEY", label: "Kling", group: "Video Generation" },
  { key: "LUMA_API_KEY", label: "Luma", group: "Video Generation" },

  // ── Audio & Voice (TTS / STT) ──────────────────────────────────────────
  { key: "ELEVENLABS_API_KEY", label: "ElevenLabs · TTS", group: "Audio & Voice" },
  { key: "VOICE_TOOLS_OPENAI_KEY", label: "OpenAI Voice (TTS/STT key)", group: "Audio & Voice" },

  // ── Web & Search ───────────────────────────────────────────────────────
  { key: "EXA_API_KEY", label: "Exa", group: "Web & Search" },
  { key: "TAVILY_API_KEY", label: "Tavily", group: "Web & Search" },
  { key: "PARALLEL_API_KEY", label: "Parallel", group: "Web & Search" },
  { key: "FIRECRAWL_API_KEY", label: "Firecrawl", group: "Web & Search" },
  { key: "FIRECRAWL_API_URL", label: "Firecrawl URL (self-hosted)", group: "Web & Search", secret: false },
  { key: "BRAVE_SEARCH_API_KEY", label: "Brave Search", group: "Web & Search" },
  { key: "SEARXNG_URL", label: "SearXNG URL (self-hosted)", group: "Web & Search", secret: false },
  { key: "BROWSERBASE_API_KEY", label: "Browserbase", group: "Web & Search" },
  { key: "BROWSER_USE_API_KEY", label: "Browser Use", group: "Web & Search" },

  // ── Integrations ───────────────────────────────────────────────────────
  { key: "GITHUB_TOKEN", label: "GitHub", group: "Integrations" },
  { key: "NOTION_API_KEY", label: "Notion", group: "Integrations" },
  { key: "LINEAR_API_KEY", label: "Linear", group: "Integrations" },
  { key: "AIRTABLE_API_KEY", label: "Airtable", group: "Integrations" },
  { key: "TENOR_API_KEY", label: "Tenor (GIFs)", group: "Integrations" },

  // ── Messaging ──────────────────────────────────────────────────────────
  { key: "TELEGRAM_BOT_TOKEN", label: "Telegram Bot", group: "Messaging" },
  { key: "DISCORD_BOT_TOKEN", label: "Discord Bot", group: "Messaging" },
  { key: "SLACK_BOT_TOKEN", label: "Slack Bot", group: "Messaging" },
  { key: "SLACK_APP_TOKEN", label: "Slack App", group: "Messaging" },
];

// Heuristic: treat as secret if name contains these tokens.
const SECRET_RX = /(KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIAL|API)/i;

function redact(value: string): string {
  const v = value.trim();
  if (!v) return "";
  if (v.length <= 8) return "****";
  return `${v.slice(0, 3)}…${v.slice(-4)}`;
}

/** Parse .env into ordered [key, value, rawLineIndex] preserving comments. */
async function readEnv(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let text: string;
  try {
    text = await fs.readFile(ENV_PATH, "utf8");
  } catch {
    return map;
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    // strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    map.set(key, val);
  }
  return map;
}

export async function GET() {
  const env = await readEnv();
  const seen = new Set<string>();

  const items: { key: string; label: string; group: string; set: boolean; preview: string; secret: boolean }[] = [];

  for (const k of KNOWN) {
    const val = env.get(k.key) ?? "";
    seen.add(k.key);
    const secret = k.secret ?? true;
    items.push({
      key: k.key,
      label: k.label,
      group: k.group,
      set: val.length > 0,
      preview: secret ? redact(val) : val.slice(0, 60),
      secret,
    });
  }
  // Any other env keys actually present that aren't in the known list.
  for (const [k, v] of env) {
    if (seen.has(k)) continue;
    const secret = SECRET_RX.test(k);
    items.push({
      key: k,
      label: k,
      group: "Other",
      set: v.length > 0,
      preview: secret ? redact(v) : v.slice(0, 40),
      secret,
    });
  }

  return NextResponse.json({ items, envPath: ENV_PATH });
}

/** Set or update a key. Body: { key, value }. Rewrites that line, preserving rest. */
export async function POST(req: Request) {
  let body: { key?: string; value?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const key = (body.key ?? "").trim();
  const value = String(body.value ?? "");
  if (!/^[A-Z0-9_]+$/i.test(key)) {
    return NextResponse.json({ error: "invalid key name" }, { status: 400 });
  }

  let text = "";
  try {
    text = await fs.readFile(ENV_PATH, "utf8");
  } catch {
    /* file may not exist yet */
  }
  const lines = text.split("\n");
  const line = `${key}=${value}`;
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0 && t.slice(0, eq).trim() === key) {
      lines[i] = line;
      replaced = true;
      break;
    }
  }
  if (!replaced) {
    if (lines.length && lines[lines.length - 1].trim() === "") lines.splice(lines.length - 1, 1);
    lines.push(line);
  }
  await fs.writeFile(ENV_PATH, lines.join("\n") + "\n", { mode: 0o600 });
  await fs.chmod(ENV_PATH, 0o600).catch(() => {});
  return NextResponse.json({ ok: true, key, set: value.length > 0 });
}

/** Delete a key. Body: { key }. */
export async function DELETE(req: Request) {
  let body: { key?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const key = (body.key ?? "").trim();
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

  let text = "";
  try {
    text = await fs.readFile(ENV_PATH, "utf8");
  } catch {
    return NextResponse.json({ ok: true }); // nothing to delete
  }
  const lines = text.split("\n").filter((l) => {
    const t = l.trim();
    if (t.startsWith("#") || !t) return true;
    const eq = t.indexOf("=");
    return !(eq > 0 && t.slice(0, eq).trim() === key);
  });
  await fs.writeFile(ENV_PATH, lines.join("\n"), { mode: 0o600 });
  return NextResponse.json({ ok: true, key, deleted: true });
}
