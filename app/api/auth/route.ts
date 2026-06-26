import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Validate a token from the Connect screen and, if good, set the bs_token
// cookie so the session is authenticated. The token itself is server-side
// truth (BATTLESTATION_TOKEN on the box); this route only compares + sets the
// cookie. When no token is configured, auth is disabled and this is a no-op OK.

// Constant-time compare over fixed-length SHA-256 digests: equalizes length
// (no length leak) and is constant-time (F10).
function tokensMatch(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// Cookie Secure flag — honor a TLS-terminating proxy (Tailscale/tunnel) so the
// token cookie isn't dropped to non-Secure on an HTTPS-fronted deployment (F7).
function isSecureRequest(req: NextRequest): boolean {
  const xfproto = (req.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim();
  return req.nextUrl.protocol === "https:" || xfproto === "https";
}

// Cookie lifetime in days. Default 30 (was 365 — F12); override with
// BATTLESTATION_SESSION_DAYS. A leaked cookie self-expires instead of being
// valid for a year. Rotating BATTLESTATION_TOKEN still invalidates all cookies.
const SESSION_DAYS = Math.max(
  1,
  parseInt(process.env.BATTLESTATION_SESSION_DAYS ?? "30", 10) || 30,
);
const COOKIE_MAX_AGE = 60 * 60 * 24 * SESSION_DAYS;

// In-memory per-IP brute-force throttle (F4). Single-box self-hosted app, so an
// in-process limiter is adequate. Sliding window + exponential lockout.
type Attempt = { fails: number; lockUntil: number };
const ATTEMPTS = new Map<string, Attempt>();
const MAX_FAILS = 5;
const BASE_LOCK_MS = 5_000;
const MAX_LOCK_MS = 15 * 60_000;

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "local";
}

function checkLock(ip: string): number {
  const a = ATTEMPTS.get(ip);
  if (a && a.lockUntil > Date.now()) return a.lockUntil - Date.now();
  return 0;
}

function recordFail(ip: string): void {
  const a = ATTEMPTS.get(ip) ?? { fails: 0, lockUntil: 0 };
  a.fails += 1;
  if (a.fails >= MAX_FAILS) {
    const over = a.fails - MAX_FAILS;
    a.lockUntil = Date.now() + Math.min(BASE_LOCK_MS * 2 ** over, MAX_LOCK_MS);
  }
  ATTEMPTS.set(ip, a);
}

function recordSuccess(ip: string): void {
  ATTEMPTS.delete(ip);
}

export async function POST(req: NextRequest) {
  const expected = process.env.BATTLESTATION_TOKEN ?? "";
  if (!expected) {
    // Auth disabled (loopback mode) — nothing to log into.
    return NextResponse.json({ ok: true, authDisabled: true });
  }

  const ip = clientIp(req);
  const wait = checkLock(ip);
  if (wait > 0) {
    return NextResponse.json(
      { ok: false, error: "too many attempts", retryAfterMs: wait },
      { status: 429, headers: { "retry-after": String(Math.ceil(wait / 1000)) } },
    );
  }

  let presented = "";
  try {
    const body = (await req.json()) as { token?: string };
    presented = (body.token ?? "").trim();
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  if (!presented || !tokensMatch(presented, expected)) {
    recordFail(ip);
    return NextResponse.json({ ok: false, error: "invalid token" }, { status: 401 });
  }
  recordSuccess(ip);

  const res = NextResponse.json({ ok: true });
  res.cookies.set("bs_token", presented, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}

export async function DELETE(req: NextRequest) {
  // Log out — clear both login cookies (token + OAuth session) so the same
  // logout works regardless of which path the user came in through.
  const res = NextResponse.json({ ok: true });
  res.cookies.set("bs_token", "", { path: "/", maxAge: 0 });
  res.cookies.set("bs_oauth", "", { path: "/", maxAge: 0 });
  return res;
}
