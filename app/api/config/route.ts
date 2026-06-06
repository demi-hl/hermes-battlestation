import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import {
  readConfig,
  writeConfig,
  resolvedHermesBin,
  resolvedRepoRoots,
  resolvedVaultPath,
  type AppConfig,
} from "@/lib/app-config";
import { run } from "@/lib/exec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const which = await run(
    process.platform === "win32"
      ? `where ${hermesBin}`
      : `command -v ${hermesBin}`,
    { timeoutMs: 4000 },
  );
  const hermesFound = which.ok && which.stdout.trim().length > 0;

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
      hermesPath: hermesFound ? which.stdout.trim().split("\n")[0] : null,
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
  if (typeof patch.hermesBin === "string") clean.hermesBin = patch.hermesBin.trim();
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
