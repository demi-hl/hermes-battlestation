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
  return NextResponse.json({
    ok: true,
    app: "hermes-battlestation",
    authRequired,
    oauthAvailable: oauthAvailable(),
  });
}
