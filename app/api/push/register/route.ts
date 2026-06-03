import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Store a push subscription from the client. */
export async function POST(req: Request) {
  try {
    const sub = await req.json();
    // Store subscription keyed by user-agent fingerprint or a userId.
    // For a single-user app like this, just keep it in memory or a file.
    // Using a simple file-based store to survive restarts.
    const fs = await import("fs/promises");
    const path = "/tmp/hermes-push-subs.json";
    let subs = [];
    try {
      const raw = await fs.readFile(path, "utf-8");
      subs = JSON.parse(raw);
    } catch {}
    // Replace or append
    const endpoint = sub.endpoint;
    const idx = subs.findIndex((s: any) => s.endpoint === endpoint);
    if (idx >= 0) subs[idx] = sub;
    else subs.push(sub);
    await fs.writeFile(path, JSON.stringify(subs, null, 2));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("push register error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}