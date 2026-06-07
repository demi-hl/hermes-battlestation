import { NextResponse } from "next/server";
import { run } from "@/lib/exec";
import { cached } from "@/lib/cache";
import type { ApiEnvelope } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HERMES_BIN = process.env.HERMES_BIN ?? "hermes";

export interface StatusInfo {
  /** Hermes agent semver, e.g. "0.16.0" (no leading v). */
  hermesVersion: string | null;
  /** Hermes upstream short sha, e.g. "d165933c". */
  hermesUpstream: string | null;
  /** This app's short commit sha. */
  appCommit: string | null;
  /** Commits on the app branch ahead of the last tag (the "(+N)" tag). */
  appAhead: number | null;
  /** App branch name. */
  appBranch: string | null;
}

function firstMatch(s: string, re: RegExp): string | null {
  const m = s.match(re);
  return m ? m[1] : null;
}

export async function GET() {
  const env: ApiEnvelope<StatusInfo> = await cached("status", 60_000, async () => {
    const at = new Date().toISOString();
    const [ver, sha, branch, tagDist] = await Promise.all([
      run(`${HERMES_BIN} --version`, { timeoutMs: 6000 }),
      run("git rev-parse --short HEAD", { timeoutMs: 4000 }),
      run("git rev-parse --abbrev-ref HEAD", { timeoutMs: 4000 }),
      // commits since the most recent tag; falls back to total count when untagged
      run("git describe --tags --long 2>/dev/null || echo", { timeoutMs: 4000 }),
    ]);

    const verLine = ver.ok ? ver.stdout : "";
    const hermesVersion = firstMatch(verLine, /v(\d+\.\d+\.\d+)/);
    const hermesUpstream = firstMatch(verLine, /upstream\s+([0-9a-f]{7,40})/i);

    // git describe --tags --long => "<tag>-<ahead>-g<sha>"; pull the ahead count.
    let appAhead: number | null = null;
    const desc = tagDist.ok ? tagDist.stdout.trim() : "";
    const ahead = firstMatch(desc, /-(\d+)-g[0-9a-f]+$/);
    if (ahead) appAhead = Number(ahead);

    return {
      data: {
        hermesVersion,
        hermesUpstream,
        appCommit: sha.ok ? sha.stdout.trim() : null,
        appAhead,
        appBranch: branch.ok ? branch.stdout.trim() : null,
      },
      fetchedAt: at,
    };
  });
  return NextResponse.json(env);
}
