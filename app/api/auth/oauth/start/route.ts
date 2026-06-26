import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  authorizeUrl,
  buildPkce,
  oauthConfig,
  resolveRedirectUri,
} from "@/lib/oauth/nous";
import { OAUTH_PKCE_COOKIE } from "@/lib/oauth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/auth/oauth/start
// First leg of the Nous OAuth round trip. Builds PKCE + state, stashes the
// verifier+state in a short-lived httpOnly cookie, and 302-redirects the
// browser to the Nous Portal authorize URL. Public (the middleware allowlists
// /api/auth/oauth) — this is how an unauthenticated tester begins sign-in.
//
// OAuth is ADDITIVE: when no OAuth client id is configured this returns 503 and
// the token path is entirely unaffected.
export async function GET(req: NextRequest) {
  const cfg = oauthConfig();
  if (!cfg) {
    return NextResponse.json(
      {
        error: "oauth_not_configured",
        detail:
          "Nous sign-in is not enabled on this box. Set BATTLESTATION_OAUTH_CLIENT_ID (shape agent:{instance_id}) to enable it, or use the access token.",
      },
      { status: 503 },
    );
  }

  const redirectUri = resolveRedirectUri(req);
  const { verifier, challenge, state } = buildPkce();
  const url = authorizeUrl(cfg, { redirectUri, state, challenge });

  const res = NextResponse.redirect(url, 302);
  // Stash state + verifier server-side only (httpOnly). Lax so it survives the
  // top-level GET navigation back from the IDP to /callback. 10-minute TTL =
  // the login lifetime. Secure when the request arrived over HTTPS so a
  // TLS-fronted deploy (Tailscale Serve / tunnel) keeps the cookie.
  const secure =
    req.nextUrl.protocol === "https:" ||
    (req.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim() ===
      "https";
  res.cookies.set(OAUTH_PKCE_COOKIE, `${state}.${verifier}`, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 10 * 60,
  });
  return res;
}
