"use client";

import { cn } from "@/lib/utils";

/**
 * Locals Only title lockup: the blackletter "locals only" wordmark over a
 * muted "hermes agent" subtitle. The wordmark asset is white-on-near-black
 * with a soft glow; `mix-blend-mode: screen` drops the near-black backing so
 * the glowing mark sits cleanly on any themed canvas (and the Backdrop's FG
 * inversion layer flips it to dark for the Nous Blue light theme).
 *
 * Replaces the "demigodzx's Team" header from the Conductor reference — this
 * is the app identity layer; themes recolor the workspace beneath it.
 */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn("flex select-none flex-col gap-[3px]", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/locals-only-logo.jpg"
        alt="locals only"
        draggable={false}
        className="h-[26px] w-auto object-contain"
        style={{
          mixBlendMode: "screen",
          filter: "drop-shadow(0 0 10px rgba(255,255,255,0.18))",
        }}
      />
      <span className="font-mondwest text-display pl-[2px] text-[0.6rem] leading-none tracking-[0.34em] text-text-tertiary">
        hermes agent
      </span>
    </span>
  );
}
