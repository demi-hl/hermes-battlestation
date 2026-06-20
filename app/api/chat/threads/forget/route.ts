import { NextResponse } from "next/server";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOME = os.homedir();
const HERMES_HOME = process.env.HERMES_HOME || path.join(HOME, ".hermes");

/**
 * Forget a chat thread's bridge mapping. The thread list (/api/chat/threads) is
 * rebuilt from the ACP bridge maps (~/.hermes/lo-acp-sessions*.json) on every
 * fetch, so archiving/deleting the DB session row alone does nothing — the
 * thread instantly reappears. To make a bridge thread (general, a repo/branch)
 * actually leave the list, we strip its key from every bridge map file here.
 * The underlying session row is handled separately by /api/sessions/[id].
 */
export async function POST(req: Request) {
  let key: string;
  try {
    const body = (await req.json()) as { key?: string };
    key = String(body.key ?? "").trim();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!key) return NextResponse.json({ error: "no key" }, { status: 400 });

  // Strip the thread key and its `lol-` title alias from every bridge map.
  const keys = new Set([key, `lol-${key}`, key.replace(/^lol-/, "")]);
  let removed = 0;
  let files = 0;
  try {
    for (const f of readdirSync(HERMES_HOME)) {
      if (!/^lo-acp-sessions.*\.json$/.test(f)) continue;
      const p = path.join(HERMES_HOME, f);
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
      } catch {
        continue;
      }
      let changed = false;
      for (const k of keys) {
        if (k in obj) {
          delete obj[k];
          removed++;
          changed = true;
        }
      }
      if (changed) {
        writeFileSync(p, JSON.stringify(obj));
        files++;
      }
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "forget failed" },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, key, removed, files });
}
