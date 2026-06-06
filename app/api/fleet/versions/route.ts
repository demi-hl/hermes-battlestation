import { NextResponse } from "next/server";
import { run } from "@/lib/exec";
import { cached } from "@/lib/cache";
import type { ApiEnvelope } from "@/lib/types";
import { FLEET } from "@/lib/fleet/hosts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-box version probe for the agent toolchain (Claude Code + Hermes).
 * Real SSH probes — no mock. Each configured box reports its installed Claude
 * Code and Hermes versions; we compare Claude Code against the npm `latest`
 * tag to flag an available update. SSH prefixes come from env
 * (lib/fleet/hosts.ts) — no hosts or usernames in source.
 */

type BoxProbe = {
  key: string;
  label: string;
  os: "linux" | "darwin" | "windows";
  // The command prefix that runs a remote command. Empty = local.
  sshPrefix: string;
};

// Build from the env-configured fleet; skip nodes with no SSH (unreachable).
const BOXES: BoxProbe[] = FLEET.filter((n) => n.ssh !== undefined).map((n) => ({
  key: n.key,
  label: n.display,
  os: n.os,
  sshPrefix: n.ssh as string,
}));

export interface BoxVersions {
  key: string;
  label: string;
  reachable: boolean;
  claudeCode: string | null;
  hermes: string | null;
  claudeUpdateAvailable: boolean;
  error?: string;
}

export interface VersionsPayload {
  boxes: BoxVersions[];
  claudeLatest: string | null;
}

function parseClaude(out: string): string | null {
  // "2.1.161 (Claude Code)" or "2.1.160"
  const m = out.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

function parseHermes(out: string): string | null {
  // "Hermes Agent v0.15.1 (2026.5.29)"
  const m = out.match(/v?(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

function cmp(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

async function probeBox(
  box: BoxProbe,
  claudeLatest: string | null,
): Promise<BoxVersions> {
  // One round-trip: print both versions. PC2 is a Windows box (no `head`), so
  // keep the remote command POSIX-only where possible and tolerate cmd.exe by
  // not relying on unix pipes. `claude --version` prints a single line anyway.
  const isWindows = box.os === "windows";
  const remote = isWindows
    ? "echo CC:& claude --version& echo HM:& hermes --version"
    : "echo CC:$(claude --version 2>/dev/null | head -1); " +
      "echo HM:$(hermes --version 2>/dev/null | head -1)";
  const command = box.sshPrefix
    ? `${box.sshPrefix} '${remote.replace(/'/g, "'\\''")}'`
    : remote;

  const r = await run(command, { timeoutMs: 15000 });
  if (!r.ok && !r.stdout.includes("CC:")) {
    return {
      key: box.key,
      label: box.label,
      reachable: false,
      claudeCode: null,
      hermes: null,
      claudeUpdateAvailable: false,
      error: r.stderr.trim().split("\n")[0] || "unreachable",
    };
  }

  // Slice between the CC: and HM: markers so multi-line (Windows) output still
  // parses — the version may be on the line AFTER the marker.
  const ccBlock = r.stdout.split(/CC:/)[1]?.split(/HM:/)[0] ?? "";
  const hmBlock = r.stdout.split(/HM:/)[1] ?? "";
  const claudeCode = parseClaude(ccBlock);
  const hermes = parseHermes(hmBlock);

  const claudeUpdateAvailable = Boolean(
    claudeCode && claudeLatest && cmp(claudeCode, claudeLatest) < 0,
  );

  return {
    key: box.key,
    label: box.label,
    reachable: true,
    claudeCode,
    hermes,
    claudeUpdateAvailable,
  };
}

export async function GET() {
  const env: ApiEnvelope<VersionsPayload> = await cached(
    "fleet-versions",
    60_000,
    async () => {
      // npm latest for Claude Code.
      const latestR = await run(
        "npm view @anthropic-ai/claude-code version 2>/dev/null",
        { timeoutMs: 12000 },
      );
      const claudeLatest = latestR.ok ? latestR.stdout.trim() || null : null;

      const boxes = await Promise.all(
        BOXES.map((b) => probeBox(b, claudeLatest)),
      );

      return {
        data: { boxes, claudeLatest },
        fetchedAt: new Date().toISOString(),
      };
    },
  );
  return NextResponse.json(env);
}
