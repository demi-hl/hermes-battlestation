import { NextResponse } from "next/server";
import os from "os";
import path from "path";
import { sendApns } from "@/lib/apns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function storePath() {
  return path.join(os.homedir(), ".hermes", "push-subs.json");
}

/**
 * Fan a notification out to BOTH delivery paths, independently:
 *   - Web Push (VAPID + service worker) for the browser / installed PWA.
 *   - Native APNs for the Capacitor iOS app (web push can't reach a WKWebView).
 * Either path being unconfigured or empty never blocks the other. Accepts
 * { title, body, threadId, tag }; threadId rides the payload so a tap deep
 * links to the right thread on both surfaces.
 */
export async function POST(req: Request) {
  let title = "Hermes";
  let body = "";
  let threadId: string | null = null;
  let tag: string | undefined;
  try {
    const j = await req.json();
    title = j.title || "Hermes";
    body = j.body || "";
    threadId = j.threadId ?? null;
    tag = j.tag;
  } catch {
    /* empty/invalid body — still allow an empty ping */
  }

  // ── Web Push ──────────────────────────────────────────────────────────────
  let webSent = 0;
  let webFailed = 0;
  let webError: string | null = null;
  const pubKey = process.env.VAPID_PUBLIC_KEY || "";
  const privKey = process.env.VAPID_PRIVATE_KEY || "";
  if (pubKey && privKey) {
    try {
      const webpush: any = await import("web-push");
      webpush.setVapidDetails(
        process.env.VAPID_CONTACT ?? "mailto:admin@example.com",
        pubKey,
        privKey,
      );
      const fs = await import("fs/promises");
      let subs: any[] = [];
      try {
        subs = JSON.parse(await fs.readFile(storePath(), "utf-8"));
        if (!Array.isArray(subs)) subs = [];
      } catch {
        subs = [];
      }
      if (subs.length) {
        const url = threadId ? "/?thread=" + encodeURIComponent(threadId) : "/";
        const payload = JSON.stringify({
          title,
          body,
          tag: tag || (threadId ? "thread-" + threadId : "hermes"),
          data: { threadId, url },
        });
        const results = await Promise.allSettled(
          subs.map((sub) => webpush.sendNotification(sub, payload)),
        );
        webSent = results.filter((r) => r.status === "fulfilled").length;
        webFailed = results.filter((r) => r.status === "rejected").length;
      }
    } catch (e) {
      webError = String(e);
    }
  } else {
    webError = "vapid-not-configured";
  }

  // ── Native APNs ─────────────────────────────────────────────────────────────
  let apns = { configured: false, sent: 0, failed: 0 };
  try {
    apns = await sendApns({ title, body, threadId, tag });
  } catch (e) {
    apns = { configured: false, sent: 0, failed: 0 };
    if (!webError) webError = String(e);
  }

  const totalSent = webSent + apns.sent;
  return NextResponse.json({
    ok: true,
    sent: totalSent,
    web: { sent: webSent, failed: webFailed, configured: !!(pubKey && privKey), error: webError },
    apns,
  });
}
