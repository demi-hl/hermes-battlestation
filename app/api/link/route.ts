import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import QRCode from "qrcode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Build a one-scan login link + QR for THIS box. The caller is already past the
// middleware auth gate (this route is not in PUBLIC_PREFIXES), so handing back a
// link that embeds the token is safe — only an authenticated session can ask.
//
// The link is `${origin}/?token=…`. The middleware swaps that query token for a
// cookie on first load (see middleware.ts), so a fresh device that opens it is
// logged straight in — no typing. Reachability (Tailscale / LAN / tunnel) is
// whatever host the request arrived on, so the QR always points at a URL that
// actually reached this box.

function originFromRequest(req: NextRequest): string {
  const xfHost = (req.headers.get("x-forwarded-host") ?? "").split(",")[0].trim();
  const host = xfHost || req.headers.get("host") || req.nextUrl.host;
  const xfProto = (req.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim();
  const proto =
    xfProto || (req.nextUrl.protocol ? req.nextUrl.protocol.replace(":", "") : "http");
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  const token = process.env.BATTLESTATION_TOKEN ?? "";
  const origin = originFromRequest(req);

  // No token set → single-machine / loopback mode. A QR still helps (open on the
  // same box), but there's nothing to authenticate, so don't embed a token.
  const url = token ? `${origin}/?token=${encodeURIComponent(token)}` : origin;

  let qr = "";
  try {
    qr = await QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 480,
      color: { dark: "#06201f", light: "#ffffff" },
    });
  } catch {
    return NextResponse.json({ error: "qr generation failed" }, { status: 500 });
  }

  // token is returned so Settings can offer a one-tap "Copy token" (for pasting
  // into the native app's token field) alongside the QR. No new exposure: the
  // url already embeds it and this route is behind the auth gate.
  return NextResponse.json({ url, token, qr, hasToken: Boolean(token), origin });
}
