import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Send a push notification to all subscribers. */
export async function POST(req: Request) {
  try {
    const { title, body, tag, url } = await req.json();
    const webpush = await import("web-push");
    const pubKey = process.env.VAPID_PUBLIC_KEY || "";
    const privKey = process.env.VAPID_PRIVATE_KEY || "";
    if (!pubKey || !privKey) {
      return NextResponse.json(
        { ok: false, error: "VAPID keys not configured" },
        { status: 500 },
      );
    }
    webpush.setVapidDetails(
      process.env.VAPID_CONTACT ?? "mailto:admin@example.com",
      pubKey,
      privKey,
    );

    // Read subscription store
    const fs = await import("fs/promises");
    const store = "/tmp/hermes-push-subs.json";
    let subs: any[] = [];
    try {
      const raw = await fs.readFile(store, "utf-8");
      subs = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { ok: false, error: "No subscribers" },
        { status: 404 },
      );
    }

    const payload = JSON.stringify({
      title,
      body,
      tag: tag || "hermes",
      data: { url: url || "/" },
    });

    const results = await Promise.allSettled(
      subs.map((sub) => webpush.sendNotification(sub, payload)),
    );
    const sent = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    return NextResponse.json({ ok: true, sent, failed });
  } catch (e) {
    console.error("push send error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}