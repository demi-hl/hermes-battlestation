"use client";

import { cn } from "@/lib/utils";

/** N-mark brand lockup. The white n on Hermes Teal serves as the app icon &
 *  navigation header badge. */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn("flex select-none flex-col gap-[3px]", className)}>
      <span className="flex h-[26px] w-[26px] items-center justify-center rounded-md bg-[#041c1c] text-[15px] font-bold leading-none tracking-[-0.04em] text-[#ffe6cb]">
        n
      </span>
      <span className="font-mondwest text-display pl-[2px] text-[0.6rem] leading-none tracking-[0.34em] text-text-tertiary">
        hermes agent
      </span>
    </span>
  );
}