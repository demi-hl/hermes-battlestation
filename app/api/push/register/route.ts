import { NextResponse } from "next/server";
import os from "os";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Single user app: keep subscriptions in a JSON file under ~/.hermes so they
// survive restarts (and live outside /tmp, which gets reaped).
function storePath() {
  return path.join(os.homedir(), ".hermes", "push-subs.json");
}

/** Store a push subscription from the client. */
export async function POST(req: Request) {
  try {
    const sub = await req.json();
    if (!sub || !sub.endpoint) {
      return NextResponse.json(
        { ok: false, error: "Invalid subscription" },
        { status: 400 },
      );
    }
    const fs = await import("fs/promises");
    const file = storePath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    let subs: any[] = [];
    try {
      const raw = await fs.readFile(file, "utf-8");
      subs = JSON.parse(raw);
      if (!Array.isArray(subs)) subs = [];
    } catch {}
    // Replace an existing entry for this endpoint, else append.
    const idx = subs.findIndex((s: any) => s.endpoint === sub.endpoint);
    if (idx >= 0) subs[idx] = sub;
    else subs.push(sub);
    await fs.writeFile(file, JSON.stringify(subs, null, 2));
    return NextResponse.json({ ok: true, count: subs.length });
  } catch (e) {
    console.error("push register error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
