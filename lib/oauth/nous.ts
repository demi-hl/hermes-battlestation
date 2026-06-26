// ── Nous Portal OAuth (authorization-code + PKCE, S256) — Node only ───────────
// Mirrors the stock Hermes dashboard-auth Nous provider
// (hermes_cli plugins/dashboard_auth/nous) so a Battlestation tester can sign
// in with their existing Nous account instead of pasting a token. This module
// is imported ONLY from the Node-runtime API routes under app/api/auth/oauth/
// (it uses node:crypto + fetch); never import it from the Edge middleware.
//
// Endpoints (contract, verified against the stock provider):
//   authorize:  {portal}/oauth/authorize        (302 target, query params)
//   token:      {portal}/api/oauth/token         (POST authorization_code grant)
//   jwks:       {portal}/.well-known/jwks.json   (RS256 verification keys)
// scope:        agent_dashboard:access
// access token: RS256 JWT, aud == client_id, iss == portal_url, sub = user id.

import {
  createHash,
  createPublicKey,
  createVerify,
  randomBytes,
} from "node:crypto";

const DEFAULT_PORTAL_URL = "https://portal.nousresearch.com";
const SCOPE = "agent_dashboard:access";
const TOKEN_TIMEOUT_MS = 10_000;
const JWKS_CACHE_MS = 5 * 60_000; // contract C7: max-age 300

export interface OAuthConfig {
  clientId: string; // shape: agent:{instance_id}
  portalUrl: string; // no trailing slash
}

// Resolve the OAuth client config from env. The Battlestation-namespaced var
// wins; we also accept the stock HERMES_DASHBOARD_OAUTH_CLIENT_ID so a box that
// already provisioned a Nous client for the stock dashboard can reuse it. The
// client id is a per-instance credential (shape agent:{instance_id}); env is
// the correct home for it (never NEXT_PUBLIC_*, never committed). Returns null
// when no client id is configured (OAuth simply stays unavailable).
export function oauthConfig(): OAuthConfig | null {
  const clientId = (
    process.env.BATTLESTATION_OAUTH_CLIENT_ID ||
    process.env.HERMES_DASHBOARD_OAUTH_CLIENT_ID ||
    ""
  ).trim();
  if (!clientId) return null;
  const portalUrl = (
    process.env.BATTLESTATION_OAUTH_PORTAL_URL ||
    process.env.HERMES_DASHBOARD_PORTAL_URL ||
    DEFAULT_PORTAL_URL
  )
    .trim()
    .replace(/\/+$/, "");
  return { clientId, portalUrl: portalUrl || DEFAULT_PORTAL_URL };
}

export function oauthAvailable(): boolean {
  return oauthConfig() !== null;
}

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface Pkce {
  verifier: string;
  challenge: string;
  state: string;
}

// RFC 7636: verifier = 64 random bytes b64url (~86 chars); challenge =
// b64url(sha256(verifier)). state = 32 random bytes b64url (CSRF nonce).
export function buildPkce(): Pkce {
  const verifier = b64url(randomBytes(64));
  const challenge = b64url(
    createHash("sha256").update(verifier, "ascii").digest(),
  );
  const state = b64url(randomBytes(32));
  return { verifier, challenge, state };
}

export function authorizeUrl(
  cfg: OAuthConfig,
  opts: { redirectUri: string; state: string; challenge: string },
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: opts.redirectUri,
    scope: SCOPE,
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
  });
  return `${cfg.portalUrl}/oauth/authorize?${params.toString()}`;
}

// Reconstruct the absolute callback URL the IDP redirects back to. Prefer an
// operator-declared public URL (BATTLESTATION_PUBLIC_URL) so deploys behind a
// reverse proxy / Tailscale Serve are correct; otherwise rebuild from the
// request (honouring X-Forwarded-Proto/Host). The path must match the redirect
// URI registered for the OAuth client at the Portal.
export const CALLBACK_PATH = "/api/auth/oauth/callback";

export function resolveRedirectUri(req: Request): string {
  const declared = (process.env.BATTLESTATION_PUBLIC_URL ?? "").trim();
  if (declared) {
    return `${declared.replace(/\/+$/, "")}${CALLBACK_PATH}`;
  }
  const h = req.headers;
  const xfProto = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim();
  const xfHost = (h.get("x-forwarded-host") ?? "").split(",")[0].trim();
  const host = xfHost || h.get("host") || "127.0.0.1";
  let proto = xfProto;
  if (!proto) {
    try {
      proto = new URL(req.url).protocol.replace(":", "");
    } catch {
      proto = "http";
    }
  }
  return `${proto}://${host}${CALLBACK_PATH}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export class OAuthError extends Error {
  constructor(
    message: string,
    readonly kind: "invalid_code" | "provider" = "provider",
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

// Exchange an authorization code for tokens. Mirrors the stock provider's
// authorization_code grant POST to {portal}/api/oauth/token. A 400 means the
// code/PKCE/redirect_uri failed (invalid_code); any other non-200 is a
// provider error.
export async function exchangeCode(
  cfg: OAuthConfig,
  opts: { code: string; codeVerifier: string; redirectUri: string },
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: cfg.clientId,
    code_verifier: opts.codeVerifier,
  });
  let res: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
  try {
    res = await fetch(`${cfg.portalUrl}/api/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
      signal: controller.signal,
    });
  } catch (e) {
    throw new OAuthError(`Portal token endpoint unreachable: ${String(e)}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 400) {
    let errCode = "invalid_request";
    try {
      const j = (await res.json()) as { error?: string };
      if (j && typeof j.error === "string") errCode = j.error;
    } catch {
      /* ignore */
    }
    throw new OAuthError(
      `Portal rejected token request: ${errCode}`,
      "invalid_code",
    );
  }
  if (res.status !== 200) {
    const txt = (await res.text().catch(() => "")).slice(0, 200);
    throw new OAuthError(`Portal token endpoint returned ${res.status}: ${txt}`);
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new OAuthError("Portal token response was not JSON");
  }
  const accessToken = payload.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new OAuthError("Portal token response missing access_token");
  }
  const tokenType = String(payload.token_type ?? "").toLowerCase();
  if (tokenType && tokenType !== "bearer") {
    throw new OAuthError(`unexpected token_type=${tokenType}`);
  }
  const refresh = payload.refresh_token;
  return {
    access_token: accessToken,
    refresh_token: typeof refresh === "string" ? refresh : "",
    token_type: tokenType || "bearer",
  };
}

// ── JWKS-backed RS256 verification ───────────────────────────────────────────

interface Jwk {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

let jwksCache: { url: string; keys: Jwk[]; fetchedAt: number } | null = null;

async function fetchJwks(portalUrl: string): Promise<Jwk[]> {
  const url = `${portalUrl}/.well-known/jwks.json`;
  const now = Date.now();
  if (
    jwksCache &&
    jwksCache.url === url &&
    now - jwksCache.fetchedAt < JWKS_CACHE_MS
  ) {
    return jwksCache.keys;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } catch (e) {
    throw new OAuthError(`JWKS endpoint unreachable: ${String(e)}`);
  } finally {
    clearTimeout(timer);
  }
  if (res.status !== 200) {
    throw new OAuthError(`JWKS endpoint returned ${res.status}`);
  }
  let body: { keys?: Jwk[] };
  try {
    body = (await res.json()) as { keys?: Jwk[] };
  } catch {
    throw new OAuthError("JWKS response was not JSON");
  }
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache = { url, keys, fetchedAt: now };
  return keys;
}

function jwtSegments(token: string): [string, string, string] {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new OAuthError("malformed JWT", "invalid_code");
  }
  return [parts[0], parts[1], parts[2]];
}

function decodeJson(seg: string): Record<string, unknown> {
  const json = Buffer.from(
    seg.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf8");
  return JSON.parse(json) as Record<string, unknown>;
}

export interface PortalClaims {
  sub: string;
  org_id: string;
  exp: number;
}

// Verify a Portal-issued RS256 access token: locate the signing key in JWKS by
// kid, verify the signature, then validate iss/aud/exp and require sub. Throws
// OAuthError("invalid_code") on a token problem, OAuthError("provider") when
// JWKS is unreachable. Mirrors the stock provider's _verify_jwt.
export async function verifyPortalJwt(
  cfg: OAuthConfig,
  accessToken: string,
): Promise<PortalClaims> {
  const [headerSeg, payloadSeg, sigSeg] = jwtSegments(accessToken);

  let header: Record<string, unknown>;
  try {
    header = decodeJson(headerSeg);
  } catch {
    throw new OAuthError("JWT header undecodable", "invalid_code");
  }
  if (String(header.alg) !== "RS256") {
    throw new OAuthError(`unexpected JWT alg=${String(header.alg)}`, "invalid_code");
  }
  const kid = typeof header.kid === "string" ? header.kid : "";

  const keys = await fetchJwks(cfg.portalUrl);
  let jwk = keys.find((k) => k.kid === kid && k.kty === "RSA");
  // If no kid match (rotation / missing kid), fall back to the sole RSA key.
  if (!jwk) {
    const rsaKeys = keys.filter((k) => k.kty === "RSA");
    if (rsaKeys.length === 1) jwk = rsaKeys[0];
  }
  if (!jwk || !jwk.n || !jwk.e) {
    throw new OAuthError("no matching JWKS signing key", "invalid_code");
  }

  let publicKey: ReturnType<typeof createPublicKey>;
  try {
    publicKey = createPublicKey({
      key: { kty: "RSA", n: jwk.n, e: jwk.e },
      format: "jwk",
    });
  } catch (e) {
    throw new OAuthError(`bad JWKS key: ${String(e)}`);
  }

  const signingInput = `${headerSeg}.${payloadSeg}`;
  const signature = Buffer.from(
    sigSeg.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  );
  const verifier = createVerify("RSA-SHA256");
  verifier.update(signingInput);
  verifier.end();
  const ok = verifier.verify(publicKey, signature);
  if (!ok) {
    throw new OAuthError("JWT signature verification failed", "invalid_code");
  }

  let claims: Record<string, unknown>;
  try {
    claims = decodeJson(payloadSeg);
  } catch {
    throw new OAuthError("JWT payload undecodable", "invalid_code");
  }

  // iss must equal the Portal base URL.
  if (String(claims.iss ?? "").replace(/\/+$/, "") !== cfg.portalUrl) {
    throw new OAuthError(
      `JWT iss mismatch: ${String(claims.iss)} != ${cfg.portalUrl}`,
      "invalid_code",
    );
  }
  // aud is the bare client_id (string or array).
  const aud = claims.aud;
  const audOk =
    aud === cfg.clientId ||
    (Array.isArray(aud) && aud.some((a) => a === cfg.clientId));
  if (!audOk) {
    throw new OAuthError(
      `JWT aud mismatch: ${JSON.stringify(aud)} != ${cfg.clientId}`,
      "invalid_code",
    );
  }
  const exp = Number(claims.exp);
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) {
    throw new OAuthError("access token expired", "invalid_code");
  }
  const sub = String(claims.sub ?? "");
  if (!sub) {
    throw new OAuthError("token missing sub (user_id) claim", "invalid_code");
  }
  return { sub, org_id: String(claims.org_id ?? ""), exp };
}
