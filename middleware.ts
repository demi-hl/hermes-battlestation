import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ── Battlestation access gate ────────────────────────────────────────────────
// The app is a thin client that loads in full from the box running Hermes.
// When loopback-only (the default, single-machine dev), there's no token and
// the gate is OPEN — identical to the original behavior. The moment the box is
// network-reachable (so other devices can connect like the iOS app does), set
// BATTLESTATION_TOKEN on the box and every request must carry it. Without this,
// exposing the backend would leak sessions/keys to anyone who finds the URL.
//
// Token is accepted (in priority order) via:
//   - Authorization: Bearer <token>     (API clients)
//   - bs_token cookie                    (browser, set once via /connect)
//   - ?token=<token> query               (first-load deep link → cookie)
// Never a NEXT_PUBLIC_* var — the token is server-side truth only.

const TOKEN = process.env.BATTLESTATION_TOKEN ?? "";

// Cookie lifetime in days (F12) — default 30, override via env. Matches the
// /api/auth route's COOKIE_MAX_AGE.
const SESSION_DAYS = Math.max(
  1,
  parseInt(process.env.BATTLESTATION_SESSION_DAYS ?? "30", 10) || 30,
);

// Paths reachable WITHOUT a token: the connect screen, the auth handler, a
// health probe, and the static/asset/PWA files the login page needs. Matched
// with a segment boundary (isPublicPath) so e.g. /api/healthz is NOT public.
// /_next/ is intentionally omitted — the matcher already excludes the static
// and image subtrees, and a blanket /_next/ would expose internals like
// /_next/data through the gate.
const PUBLIC_PREFIXES = [
  "/connect",
  "/api/auth",
  "/api/health",
  "/icons",
  "/favicon.ico",
  "/manifest.webmanifest",
  "/sw.js",
  "/nous-logo.svg",
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

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // No token configured.
  if (!TOKEN) {
    // Loopback (single-machine dev) is fine. A remote request with no token set
    // is a misconfiguration — fail closed unless explicitly allowed.
    if (isLoopback(req) || ALLOW_INSECURE) return NextResponse.next();
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

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const presented = presentedToken(req);
  if (presented && safeEqual(presented, TOKEN)) {
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
