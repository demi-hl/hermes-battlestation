// Single source of truth for a model id -> context-window size, mirroring the
// key families in hermes-agent's DEFAULT_CONTEXT_LENGTHS. Used by both the
// /api/models route (server) and workspace-context (client) so the bottom-bar
// context meter can show a model's window BEFORE the first turn emits a live
// usage event. Live usage (usage_update.size) always wins when present; this is
// only the pre-turn seed. Longest-prefix match, specific entries before
// catch-alls.

const WINDOWS: Array<[string, number]> = [
  // Anthropic Claude (1M context on the 4.6+ line)
  ["claude-opus-4-8", 1_000_000],
  ["claude-opus-4.8", 1_000_000],
  ["claude-opus-4-7", 1_000_000],
  ["claude-opus-4.7", 1_000_000],
  ["claude-opus-4-6", 1_000_000],
  ["claude-opus-4.6", 1_000_000],
  ["claude-sonnet-4-6", 1_000_000],
  ["claude-sonnet-4.6", 1_000_000],
  ["claude-haiku-4-5", 200_000],
  ["claude", 200_000],
  // OpenAI GPT-5.x. Codex OAuth caps at 272k; direct API is larger, but the bar
  // shows the conservative subscription window. Live usage corrects either way.
  ["gpt-5.5", 272_000],
  ["gpt-5.4-nano", 400_000],
  ["gpt-5.4-mini", 400_000],
  ["gpt-5.4", 1_050_000],
  ["gpt-5.1-chat", 128_000],
  ["gpt-5", 400_000],
  ["gpt-4.1", 1_047_576],
  ["gpt-4", 128_000],
  ["o4", 200_000],
  ["o3", 200_000],
  // Google
  ["gemini", 1_048_576],
  // xAI
  ["grok-4-fast", 2_000_000],
  ["grok-4.20", 2_000_000],
  ["grok-4.3", 1_000_000],
  ["grok", 256_000],
  // DeepSeek
  ["deepseek-v4-pro", 1_000_000],
  ["deepseek-v4-flash", 1_000_000],
  ["deepseek-chat", 1_000_000],
  ["deepseek-reasoner", 1_000_000],
  ["deepseek", 128_000],
  // Qwen
  ["qwen3.6-plus", 1_048_576],
  ["qwen3-coder-plus", 1_000_000],
  ["qwen3-coder", 262_144],
  ["qwen", 131_072],
  // Misc open models
  ["minimax-m3", 1_000_000],
  ["minimax", 204_800],
  ["llama", 131_072],
  ["kimi", 256_000],
  ["glm", 200_000],
  ["hermes", 131_072],
];

const DEFAULT_WINDOW = 200_000;

/** Resolve a model id (bare or provider-prefixed) to its context window.
 *  Strips any `provider/` prefix, then longest-substring matches the table. */
export function contextWindowFor(modelId: string): number {
  if (!modelId) return DEFAULT_WINDOW;
  const id = (modelId.includes("/") ? modelId.slice(modelId.lastIndexOf("/") + 1) : modelId).toLowerCase();
  let best: number | null = null;
  let bestLen = -1;
  for (const [key, win] of WINDOWS) {
    if (id.includes(key) && key.length > bestLen) {
      best = win;
      bestLen = key.length;
    }
  }
  return best ?? DEFAULT_WINDOW;
}
