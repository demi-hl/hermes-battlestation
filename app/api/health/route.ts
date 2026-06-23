import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Unauthenticated liveness + auth-mode probe. The Connect screen hits this to
// learn whether a token is required before showing the token field. Never
// leaks the token — only whether one is configured.
export async function GET() {
  const authRequired = Boolean(process.env.BATTLESTATION_TOKEN);
  return NextResponse.json({
    ok: true,
    app: "hermes-battlestation",
    authRequired,
  });
}
