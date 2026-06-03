import { NextResponse } from "next/server";
import { run } from "@/lib/exec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Trigger a Claude Code update on a fleet box, then verify by re-probing the
 * version. Real command execution — `claude update` (self-update) with an npm
 * fallback. Returns the version before/after so the UI can confirm the bump.
 */

const PREFIX: Record<string, string> = {
  pc: "",
  pc2: "ssh -o BatchMode=yes -o ConnectTimeout=8 gpu3070",
  mac: "ssh -o BatchMode=yes -o ConnectTimeout=8 christophergervais@christophers-macbook-pro",
  vps: "ssh -o BatchMode=yes -o ConnectTimeout=8 root@demi-poly",
};

function wrap(prefix: string, remote: string): string {
  return prefix ? `${prefix} '${remote.replace(/'/g, "'\\''")}'` : remote;
}

function parseVer(out: string): string | null {
  const m = out.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

export async function POST(req: Request) {
  let body: { box?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }

  const box = body.box ?? "";
  const prefix = PREFIX[box];
  if (prefix === undefined) {
    return NextResponse.json({ ok: false, error: "unknown box" }, { status: 404 });
  }

  // Before.
  const before = await run(wrap(prefix, "claude --version 2>/dev/null"), {
    timeoutMs: 15000,
  });
  const fromVer = parseVer(before.stdout);

  // Update: `claude update` self-updates the native binary. Fall back to npm
  // for npm-managed installs. 5 min cap — a full reinstall can be slow.
  const updateCmd =
    "claude update 2>&1 || npm install -g @anthropic-ai/claude-code@latest 2>&1";
  const upd = await run(wrap(prefix, updateCmd), { timeoutMs: 300_000 });

  // After.
  const after = await run(wrap(prefix, "claude --version 2>/dev/null"), {
    timeoutMs: 15000,
  });
  const toVer = parseVer(after.stdout);

  return NextResponse.json({
    ok: upd.ok || Boolean(toVer),
    box,
    fromVersion: fromVer,
    toVersion: toVer,
    bumped: Boolean(fromVer && toVer && fromVer !== toVer),
    log: upd.stdout.trim().split("\n").slice(-3).join(" "),
  });
}
