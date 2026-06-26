import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  exchangeCode,
  oauthConfig,
  OAuthError,
  resolveRedirectUri,
  verifyPortalJwt,
} from "@/lib/oauth/nous";
import {
  OAUTH_COOKIE,
  OAUTH_PKCE_COOKIE,
  getSessionSecret,
  sessionDays,
  signSession,
} from "@/lib/oauth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/auth/oauth/callback?code&state[&error]
// Second leg of the Nous OAuth round trip. Validates the state against the
// httpOnly PKCE cookie (CSRF defence), exchanges the code for tokens at the
// Portal, verifies the RS256 access token against the Portal JWKS, then mints
// our OWN first-party HMAC session cookie (bs_oauth) the middleware trusts —
// the same symmetric-validation shape it uses for bs_token. On success it
// 302-redirects into the app; on failure it bounces to /connect with an error.
export async function GET(req: NextRequest) {
  const fail = (reason: string) => {
    const url = req.nextUrl.clone();
    url.pathname = "/connect";
    url.search = `?oauth_error=${encodeURIComponent(reason)}`;
    const res = NextResponse.redirect(url, 302);
    res.cookies.set(OAUTH_PKCE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  const cfg = oauthConfig();
  if (!cfg) return fail("oauth_not_configured");

  const params = req.nextUrl.searchParams;
  const idpError = params.get("error");
  if (idpError) return fail(`provider: ${idpError}`);

  const code = params.get("code") ?? "";
  const state = params.get("state") ?? "";
  if (!code || !state) return fail("missing code/state");

  // Recover state + verifier from the httpOnly cookie set by /start. The IDP
  // only echoes code+state on the callback URL, so the cookie is the only
  // server-controlled channel for the verifier.
  const pkceRaw = req.cookies.get(OAUTH_PKCE_COOKIE)?.value ?? "";
  const dot = pkceRaw.indexOf(".");
  if (dot < 0) return fail("missing PKCE state cookie");
  const expectedState = pkceRaw.slice(0, dot);
  const verifier = pkceRaw.slice(dot + 1);
  if (!expectedState || !verifier) return fail("malformed PKCE cookie");

  // CSRF: the round-trip state must match the cookie-stashed value.
  if (state !== expectedState) return fail("state mismatch (CSRF check failed)");

  const redirectUri = resolveRedirectUri(req);
  let claims;
  try {
    const tokens = await exchangeCode(cfg, {
      code,
      codeVerifier: verifier,
      redirectUri,
    });
    claims = await verifyPortalJwt(cfg, tokens.access_token);
  } catch (e) {
    if (e instanceof OAuthError) {
      return fail(e.kind === "invalid_code" ? "invalid code" : "provider error");
    }
    return fail("login failed");
  }

  // Identity proven. Mint the first-party session cookie. The signing secret
  // exists whenever a token is configured (remote mode); if it's absent we are
  // in loopback-open mode where the gate is already open, so just enter.
  const secret = getSessionSecret();
  const landing = req.nextUrl.clone();
  landing.pathname = "/";
  landing.search = "";
  const res = NextResponse.redirect(landing, 302);
  res.cookies.set(OAUTH_PKCE_COOKIE, "", { path: "/", maxAge: 0 });

  if (secret) {
    const now = Math.floor(Date.now() / 1000);
    // Cap our session lifetime at the bs_token policy; never outlive the
    // Portal access token's own exp.
    const policyExp = now + 60 * 60 * 24 * sessionDays();
    const exp = Math.min(policyExp, claims.exp || policyExp);
    const token = await signSession(
      { v: 1, sub: claims.sub, org: claims.org_id, provider: "nous", iat: now, exp },
      secret,
    );
    const secure =
      req.nextUrl.protocol === "https:" ||
      (req.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim() ===
        "https";
    res.cookies.set(OAUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: exp - now,
    });
  }
  return res;
}
