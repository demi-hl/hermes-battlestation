import { NextResponse } from "next/server";
import { run } from "@/lib/exec";
import { HERMES_BIN, INSTALL_INFO } from "@/lib/onboarding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Onboarding detection for the "Get Hermes" pane. Reports whether the Hermes
 * Agent CLI is installed, its version, and whether the user is logged in to
 * Nous Portal — so a fresh public-build user sees exactly which steps remain.
 * Read-only; no install is performed from here (that's a user action).
 */
export async function GET() {
  const whichCmd =
    process.platform === "win32" ? `where ${HERMES_BIN}` : `command -v ${HERMES_BIN}`;
  const which = await run(whichCmd, { timeoutMs: 5000 });
  const installed = which.ok && which.stdout.trim().length > 0;
  const binPath = installed ? which.stdout.trim().split("\n")[0] : null;

  let version: string | null = null;
  let loggedIn: boolean | null = null;
  let providers: string[] = [];

  if (installed) {
    const v = await run(`${HERMES_BIN} --version`, { timeoutMs: 6000 });
    if (v.ok) version = v.stdout.trim().split("\n")[0].slice(0, 80);

    // auth list shows configured credential providers (best-effort parse).
    const auth = await run(`${HERMES_BIN} auth list`, { timeoutMs: 8000 });
    if (auth.ok) {
      const out = auth.stdout;
      // Lines like "anthropic (3 credentials):" → capture the provider name.
      const re = /^([a-z][a-z0-9_-]+)\s*\(\d+\s+credential/gim;
      let m: RegExpExecArray | null;
      while ((m = re.exec(out)) !== null) providers.push(m[1]);
      loggedIn = providers.length > 0;
    }
  }

  return NextResponse.json({
    installed,
    binPath,
    version,
    loggedIn,
    providers,
    install: INSTALL_INFO,
  });
}
