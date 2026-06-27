import { NextResponse } from "next/server";
import { oauthAvailable } from "@/lib/oauth/nous";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Unauthenticated liveness + auth-mode probe. The Connect screen hits this to
// learn whether a token is required (and whether Nous sign-in is available)
// before rendering its login affordances. Never leaks the token or client
// secret — only booleans about which mechanisms are configured.
export async function GET() {
  const authRequired = Boolean(process.env.BATTLESTATION_TOKEN);
  // Tailnet trust is only ACTIVE when opted-in AND Funnel is not exposing the
  // box publicly (a public Funnel carries no tailnet identity). Surfaced as a
  // boolean so the Connect screen / diagnostics can show the mode; never leaks
  // the token or any identity.
  const tailnetTrust =
    process.env.BATTLESTATION_TRUST_TAILNET === "1" &&
    process.env.BATTLESTATION_FUNNEL !== "1";
  return NextResponse.json({
    ok: true,
    app: "hermes-battlestation",
    authRequired,
    oauthAvailable: oauthAvailable(),
    tailnetTrust,
  });
}
