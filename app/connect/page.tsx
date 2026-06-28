"use client";

import { ConnectForm } from "@/components/connect/ConnectForm";
import { useVisualViewportHeight } from "@/components/connect/useVisualViewportHeight";

// ── Login / Connect screen ───────────────────────────────────────────────────
// Two ways to sign in to the box running your Hermes:
//   1. Sign in with Nous — OAuth with your existing Nous account (when the box
//      has an OAuth client configured). One tap → Nous Portal → back, signed in.
//   2. Access token — paste the box's BATTLESTATION_TOKEN (works for every box,
//      and is what API clients use). Kept as the secondary path.
// Plus an advanced "different box" handoff: point the whole app at another box
// you run with the token as a one-time deep link (?token=…); that box's
// middleware validates it, swaps it for a cookie, and the app loads from there.
// The token is never stored in the bundle or the repo — only as a cookie on the
// box it authenticates to. The URL is remembered locally for convenience.

export const dynamic = "force-dynamic";

export default function ConnectPage() {
  useVisualViewportHeight();

  return (
    <main
      className="relative flex w-full flex-col items-center justify-center overflow-y-auto px-5 py-8"
      style={{
        height: "var(--app-vh, 100dvh)",
        paddingBottom: "max(2rem, env(safe-area-inset-bottom))",
      }}
    >
      <div className="mb-6 flex items-center gap-2.5">
        <img src="/nous-logo.svg" alt="Nous" className="h-7 w-7" />
        <span className="font-mondwest text-lg tracking-[0.2em] text-text-primary">
          BATTLESTATION
        </span>
      </div>
      <ConnectForm />
    </main>
  );
}
