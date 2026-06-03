"use client";

import { cn } from "@/lib/utils";

/** Nous Research brand lockup — the official NOUS logo mark + "hermes agent"
 *  subtitle. Used in the app header. */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn("flex select-none flex-col gap-[3px]", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/nous-logo.svg"
        alt="Nous Research"
        draggable={false}
        className="h-[26px] w-auto"
      />
      <span className="font-mondwest text-display pl-[2px] text-[0.6rem] leading-none tracking-[0.34em] text-text-tertiary">
        hermes agent
      </span>
    </span>
  );
}