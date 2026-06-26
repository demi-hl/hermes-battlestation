import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  OAUTH_COOKIE,
  getSessionSecret,
  verifySession,
} from "@/lib/oauth/session";

// ── Battlestation access gate ────────────────────────────────────────────────
// The app is a thin client that loads in full from the box running Hermes.
// When loopback-only (the default, single-machine dev), there's no token and
// the gate is OPEN — identical to the original behavior. The moment the box is
// network-reachable (so other devices can connect like the iOS app does), set
// BATTLESTATION_TOKEN on the box and every request must carry it. Without this,
// exposing the backend would leak sessions/keys to anyone who finds the URL.
//
// Auth is satisfied by EITHER of two paths (additive — both always work):
//   1. The shared access token (BATTLESTATION_TOKEN), presented via:
//        - Authorization: Bearer ***     (API clients)
//        - bs_token cookie                    (browser, set once via /connect)
//        - ?token=<token> query               (first-load deep link → cookie)
//   2. A Nous OAuth session (bs_oauth cookie), minted by the OAuth callback
//      after the tester signs in with their Nous account. Validated here with a
//      cheap HMAC check (no network) — the same symmetric shape as bs_token.
// Never a NEXT_PUBLIC_* var — both credentials are server-side truth only.

const TOKEN = process.env.BATTLESTATION_TOKEN ?? "";

// OAuth is available when an OAuth client id is configured (env credential,
// shape agent:{instance_id}). Accept the Battlestation-namespaced var or the
// stock Hermes one so a box already wired for the stock dashboard can reuse it.
const OAUTH_ENABLED =
  (
    process.env.BATTLESTATION_OAUTH_CLIENT_ID ||
    process.env.HERMES_DASHBOARD_OAUTH_CLIENT_ID ||
    ""
  ).trim() !== "";

// Cookie lifetime in days (F12) — default 30, override via env. Matches the
// /api/auth route's COOKIE_MAX_AGE.
const SESSION_DAYS = Math.max(
  1,
  parseInt(process.env.BATTLESTATION_SESSION_DAYS ?? "30", 10) || 30,
);

// Paths reachable WITHOUT a token: the connect screen, the auth handlers
// (including the OAuth start/callback round trip under /api/auth/oauth), a
// health probe, and the static/asset/PWA files the login page needs. Matched
// with a segment boundary (isPublicPath) so e.g. /api/healthz is NOT public.
// /_next/ is intentionally omitted — the matcher already excludes the static
// and image subtrees, and a blanket /_next/ would expose internals like
// /_next/data through the gate.
const PUBLIC_PREFIXES = [
  "/connect",
  "/api/auth", // covers /api/auth + /api/auth/oauth/{start,callback}
  "/api/health",
  "/icons",
  "/favicon.ico",
  "/manifest.webmanifest",
  "/sw.js",
  "/nous-logo.svg",
  "/nous-icon.svg",
  "/fonts",
  "/filler-bg0.webp",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-512-maskable.png",
  "/apple-touch-icon.png",
];

// Length-blind constant-ish compare for the Edge runtime (no node:crypto sync
// API guaranteed here). Always walks the full expected length so it neither
// short-circuits nor leaks the token length via timing (F10). The token is
// high-entropy (openssl rand) so this is ample for the cookie/bearer path; the
// /api/auth route uses crypto.timingSafeEqual over SHA-256 for login.
function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let r = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    r |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return r === 0;
}

function presentedToken(req: NextRequest): string {
  const auth = req.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const cookie = req.cookies.get("bs_token")?.value;
  if (cookie) return cookie;
  const q = req.nextUrl.searchParams.get("token");
  if (q) return q;
  return "";
}

// True when the request carries a valid Nous OAuth session cookie. The HMAC is
// verified with the same secret the callback signed it with (derived from
// BATTLESTATION_SESSION_SECRET, falling back to BATTLESTATION_TOKEN); returns
// false when no secret is configured (loopback-open dev) or the cookie is
// absent/invalid/expired.
async function hasValidOAuthSession(req: NextRequest): Promise<boolean> {
  const secret = getSessionSecret();
  if (!secret) return false;
  const cookie = req.cookies.get(OAUTH_COOKIE)?.value;
  if (!cookie) return false;
  const session = await verifySession(cookie, secret);
  return session !== null;
}

// Explicit opt-in to run with NO token on a non-loopback interface. Without it,
// a tokenless deployment that's reachable remotely fails closed (F2).
const ALLOW_INSECURE = process.env.BATTLESTATION_ALLOW_INSECURE === "1";

// Is the request coming from the local machine? Loopback Host or no Host.
function isLoopback(req: NextRequest): boolean {
  const host = (req.headers.get("host") ?? "").split(":")[0].toLowerCase();
  return (
    host === "" ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]"
  );
}

// Public path test with a segment boundary (F5): a path is public only if it
// equals a prefix or sits directly below it — so /api/healthz is NOT public.
function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : p + "/"),
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // No shared token configured.
  if (!TOKEN) {
    // Loopback (single-machine dev) is fine — UNCHANGED behavior, loopback
    // stays open regardless of whether OAuth is configured (protects the local
    // desktop app from suddenly demanding a login).
    if (isLoopback(req) || ALLOW_INSECURE) return NextResponse.next();
    // Remote with no token AND no OAuth configured: no auth mechanism exists at
    // all — fail closed (UNCHANGED).
    if (!OAUTH_ENABLED) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          {
            error: "server has no access token set",
            detail:
              "Set BATTLESTATION_TOKEN to allow remote access, or BATTLESTATION_ALLOW_INSECURE=1 to override.",
          },
          { status: 503 },
        );
      }
      return new NextResponse(
        "This Hermes Battlestation has no access token set, so remote access is disabled. " +
          "Set BATTLESTATION_TOKEN on the box (or BATTLESTATION_ALLOW_INSECURE=1 to override).",
        { status: 503, headers: { "content-type": "text/plain" } },
      );
    }
    // Remote with no token but OAuth IS configured: fall through to the gate so
    // a valid Nous OAuth session is accepted (OAuth-only deployment).
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Path 1: shared access token (bearer / cookie / deep link). Guarded on TOKEN
  // so an empty TOKEN can never match an empty presented value.
  const presented = presentedToken(req);
  if (TOKEN && presented && safeEqual(presented, TOKEN)) {
    // A valid ?token= deep link promotes to a cookie so later requests pass.
    if (req.nextUrl.searchParams.get("token")) {
      const url = req.nextUrl.clone();
      url.searchParams.delete("token");
      const res = NextResponse.redirect(url);
      res.cookies.set("bs_token", presented, {
        httpOnly: true,
        sameSite: "lax",
        secure:
          req.nextUrl.protocol === "https:" ||
          (req.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim() ===
            "https",
        path: "/",
        maxAge: 60 * 60 * 24 * SESSION_DAYS,
      });
      return res;
    }
    return NextResponse.next();
  }

  // Path 2: Nous OAuth session cookie (additive).
  if (await hasValidOAuthSession(req)) {
    return NextResponse.next();
  }

  // Unauthenticated: API → 401 JSON; pages → the connect screen.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "unauthorized", detail: "missing or invalid battlestation token" },
      { status: 401 },
    );
  }
  const connect = req.nextUrl.clone();
  connect.pathname = "/connect";
  connect.search = "";
  return NextResponse.redirect(connect);
}

export const config = {
  // Run on everything except Next internals already covered above; matcher keeps
  // the middleware off the static pipeline for speed.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
