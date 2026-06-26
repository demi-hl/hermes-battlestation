// ── First-party OAuth session cookie (Edge + Node safe) ──────────────────────
// After the Nous OAuth callback verifies the Portal-issued RS256 JWT
// server-side (see lib/oauth/nous.ts), we mint our OWN compact, HMAC-signed
// session token and store it in the `bs_oauth` cookie. The middleware then only
// needs to verify that HMAC signature — cheap, no network, no JWKS — which is
// the exact symmetric-validation shape it already trusts for `bs_token`. The
// IDP proves identity once at callback; this is the resulting first-party
// session, just like a server-set login cookie.
//
// This module uses ONLY Web Crypto (globalThis.crypto.subtle) + btoa/atob so it
// is importable from BOTH the Edge middleware and the Node API routes. Do NOT
// add a `node:crypto` import here or the middleware bundle breaks.

export const OAUTH_COOKIE = "bs_oauth";
export const OAUTH_PKCE_COOKIE = "bs_oauth_pkce";

// Session cookie lifetime in days — mirrors the bs_token cookie (auth/route.ts
// + middleware.ts) so the two login paths feel identical. A leaked cookie
// self-expires; rotating the signing secret invalidates every session.
export function sessionDays(): number {
  return Math.max(
    1,
    parseInt(process.env.BATTLESTATION_SESSION_DAYS ?? "30", 10) || 30,
  );
}

export interface OAuthSession {
  v: 1;
  sub: string; // Nous user id (JWT `sub`)
  org: string; // org id, may be ""
  provider: string; // always "nous" for now
  iat: number; // issued-at (unix seconds)
  exp: number; // expiry (unix seconds)
}

// The signing secret for the first-party session HMAC. Prefer an explicit
// dedicated secret; otherwise derive from BATTLESTATION_TOKEN so that rotating
// the access token also invalidates OAuth sessions (consistent with the
// documented bs_token semantics). Returns null only when neither is set — that
// happens exclusively in loopback-open dev mode, where the gate is already open
// and no session needs minting or verifying.
export function getSessionSecret(): string | null {
  const explicit = (process.env.BATTLESTATION_SESSION_SECRET ?? "").trim();
  if (explicit) return explicit;
  const token = process.env.BATTLESTATION_TOKEN ?? "";
  if (token) return token;
  return null;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 === 0 ? "" : "=".repeat(4 - (norm.length % 4));
  const bin = atob(norm + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

// Produce `<b64url(payload)>.<b64url(hmac)>`. The payload is the JSON session;
// the signature is HMAC-SHA256 over the payload segment.
export async function signSession(
  session: OAuthSession,
  secret: string,
): Promise<string> {
  const payload = b64urlEncode(
    new TextEncoder().encode(JSON.stringify(session)),
  );
  const key = await hmacKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
  );
  return `${payload}.${b64urlEncode(sig)}`;
}

// Verify signature + expiry. Returns the session on success, null on any
// failure (bad shape, bad signature, expired). subtle.verify is constant-time
// over the MAC, so there is no signature-comparison timing leak.
export async function verifySession(
  token: string,
  secret: string,
): Promise<OAuthSession | null> {
  if (!token || token.indexOf(".") < 0) return null;
  const dot = token.indexOf(".");
  const payload = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);
  if (!payload || !sigPart) return null;

  let sigBytes: Uint8Array<ArrayBuffer>;
  try {
    sigBytes = b64urlDecode(sigPart);
  } catch {
    return null;
  }

  const key = await hmacKey(secret);
  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      new TextEncoder().encode(payload),
    );
  } catch {
    return null;
  }
  if (!ok) return null;

  let parsed: OAuthSession;
  try {
    const json = new TextDecoder().decode(b64urlDecode(payload));
    parsed = JSON.parse(json) as OAuthSession;
  } catch {
    return null;
  }

  if (
    !parsed ||
    parsed.v !== 1 ||
    typeof parsed.sub !== "string" ||
    !parsed.sub ||
    typeof parsed.exp !== "number"
  ) {
    return null;
  }
  if (parsed.exp <= Math.floor(Date.now() / 1000)) return null;
  return parsed;
}
