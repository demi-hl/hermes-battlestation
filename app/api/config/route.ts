import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import {
  readConfig,
  writeConfig,
  resolvedHermesBin,
  resolvedRepoRoots,
  resolvedVaultPath,
  type AppConfig,
} from "@/lib/app-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A hermes binary value is a command name or a path — never a shell expression.
// Validated on write AND before any lookup so a poisoned config can't inject a
// shell command (the lookup runs via execFile/argv, never /bin/sh).
const HERMES_BIN_RE = /^[A-Za-z0-9._][A-Za-z0-9._/ -]*$/;

// Resolve a binary via argv (no shell). Returns the resolved path or "".
// Uses real binaries (`which`/`where`), NOT the `command` shell builtin, so it
// works through execFile without a /bin/sh.
function locateBin(bin: string): Promise<string> {
  return new Promise((resolve) => {
    if (!HERMES_BIN_RE.test(bin)) return resolve("");
    const finder = process.platform === "win32" ? "where" : "which";
    execFile(finder, [bin], { timeout: 4000 }, (err, stdout) => {
      resolve(err ? "" : String(stdout).trim());
    });
  });
}

/**
 * First-run setup state. Returns the saved config plus live detection so the
 * Setup screen can show a stranger whether each piece is wired:
 *  - hermes binary found on PATH / at the configured path
 *  - which repo roots exist and how many git repos are under them
 *  - whether the vault path is a git repo
 */
export async function GET() {
  const [config, hermesBin, roots, vaultPath] = await Promise.all([
    readConfig(),
    resolvedHermesBin(),
    resolvedRepoRoots(),
    resolvedVaultPath(),
  ]);

  const whichOut = await locateBin(hermesBin);
  const hermesFound = whichOut.trim().length > 0;

  const rootStats = await Promise.all(
    roots.map(async (root) => {
      try {
        const entries = await fs.readdir(root, { withFileTypes: true });
        let repos = 0;
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          try {
            await fs.stat(`${root}/${e.name}/.git`);
            repos += 1;
          } catch {
            /* not a repo */
          }
        }
        return { path: root, exists: true, repos };
      } catch {
        return { path: root, exists: false, repos: 0 };
      }
    }),
  );

  let vaultIsRepo = false;
  try {
    await fs.stat(`${vaultPath}/.git`);
    vaultIsRepo = true;
  } catch {
    /* not a repo */
  }

  return NextResponse.json({
    config,
    detected: {
      hermesBin,
      hermesFound,
      hermesPath: hermesFound ? whichOut.split("\n")[0] : null,
      repoRoots: rootStats,
      vaultPath,
      vaultIsRepo,
    },
  });
}

/** Save setup config. Body is a partial AppConfig. */
export async function POST(req: Request) {
  let patch: Partial<AppConfig>;
  try {
    patch = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  // Whitelist the fields we persist; ignore anything else.
  const clean: Partial<AppConfig> = {};
  if (typeof patch.hermesBin === "string") {
    const v = patch.hermesBin.trim();
    // Reject shell metacharacters / leading-dash so a stored value can never
    // become a command injection when later resolved (see locateBin).
    if (v && !HERMES_BIN_RE.test(v)) {
      return NextResponse.json(
        { error: "invalid hermesBin: only letters, digits, . _ - / and spaces" },
        { status: 400 },
      );
    }
    clean.hermesBin = v;
  }
  if (Array.isArray(patch.repoRoots)) {
    clean.repoRoots = patch.repoRoots
      .filter((r): r is string => typeof r === "string")
      .map((r) => r.trim())
      .filter(Boolean);
  }
  if (typeof patch.vaultPath === "string") clean.vaultPath = patch.vaultPath.trim();
  if (typeof patch.setupComplete === "boolean") clean.setupComplete = patch.setupComplete;

  const saved = await writeConfig(clean);
  return NextResponse.json({ config: saved });
}
