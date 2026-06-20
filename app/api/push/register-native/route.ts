import { NextResponse } from "next/server";
import os from "os";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Native APNs device tokens live alongside the web-push subs, in their own file
// so the two delivery paths stay independent.
function storePath() {
  return path.join(os.homedir(), ".hermes", "push-native-tokens.json");
}

/** Store an APNs device token from the iOS app. */
export async function POST(req: Request) {
  try {
    const { token, platform } = await req.json();
    if (!token || typeof token !== "string") {
      return NextResponse.json({ ok: false, error: "missing token" }, { status: 400 });
    }
    const fs = await import("fs/promises");
    const file = storePath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    let toks: { token: string; platform: string; ts: number }[] = [];
    try {
      const raw = await fs.readFile(file, "utf-8");
      toks = JSON.parse(raw);
      if (!Array.isArray(toks)) toks = [];
    } catch {}
    const idx = toks.findIndex((t) => t.token === token);
    const entry = { token, platform: platform || "ios", ts: Date.now() };
    if (idx >= 0) toks[idx] = entry;
    else toks.push(entry);
    await fs.writeFile(file, JSON.stringify(toks, null, 2));
    return NextResponse.json({ ok: true, count: toks.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
