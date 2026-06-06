import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Runtime app config for the downloadable desktop app. A stranger who installs
 * the app has no .env — so user-overridable settings live in a JSON file under
 * the OS config dir, editable from the in-app Setup screen. Values here OVERLAY
 * environment variables (env wins when set, so power users / the dev repo keep
 * using .env). Nothing secret is stored; these are paths and a binary name.
 */

export interface AppConfig {
  /** Path/name of the hermes binary used to spawn the agent. */
  hermesBin?: string;
  /** Absolute roots scanned for git repos (Repos/Editor/Terminal). */
  repoRoots?: string[];
  /** Obsidian vault path (git-backed shared vault). */
  vaultPath?: string;
  /** Marks that the user has completed first-run setup. */
  setupComplete?: boolean;
}

function configDir(): string {
  // XDG on Linux, ~/Library on mac, %APPDATA% on win; fall back to ~/.config.
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return path.join(xdg, "locals-only");
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "locals-only");
  }
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "locals-only");
  }
  return path.join(os.homedir(), ".config", "locals-only");
}

function configPath(): string {
  return path.join(configDir(), "config.json");
}

let cache: { value: AppConfig; at: number } | null = null;

export async function readConfig(): Promise<AppConfig> {
  if (cache && Date.now() - cache.at < 3000) return cache.value;
  let value: AppConfig = {};
  try {
    const raw = await fs.readFile(configPath(), "utf8");
    value = JSON.parse(raw) as AppConfig;
  } catch {
    /* no config yet — first run */
  }
  cache = { value, at: Date.now() };
  return value;
}

export async function writeConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const current = await readConfig();
  const next: AppConfig = { ...current, ...patch };
  await fs.mkdir(configDir(), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify(next, null, 2), "utf8");
  cache = { value: next, at: Date.now() };
  return next;
}

/** Resolved hermes binary: env wins, then config, then "hermes" on PATH. */
export async function resolvedHermesBin(): Promise<string> {
  if (process.env.HERMES_BIN) return process.env.HERMES_BIN;
  const c = await readConfig();
  return c.hermesBin || "hermes";
}

/** Resolved repo roots: config roots if set, else env-style defaults
 *  ($HOME/projects, $HOME/agent). Always absolute. */
export async function resolvedRepoRoots(): Promise<string[]> {
  const home = os.homedir();
  const c = await readConfig();
  if (c.repoRoots && c.repoRoots.length) {
    return c.repoRoots.map((r) => (path.isAbsolute(r) ? r : path.join(home, r)));
  }
  return [path.join(home, "projects"), path.join(home, "agent")];
}

/** Resolved vault path: env wins, then config, then "$HOME/Obsidian Vault". */
export async function resolvedVaultPath(): Promise<string> {
  if (process.env.OBSIDIAN_VAULT_PATH) return process.env.OBSIDIAN_VAULT_PATH;
  const c = await readConfig();
  return c.vaultPath || path.join(os.homedir(), "Obsidian Vault");
}

export { configPath };
