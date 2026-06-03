"use client";

import { motion } from "framer-motion";
import type { ComponentType, SVGProps } from "react";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * Designed empty state for a not-yet-built pane. Slice 1 ships the shell; each
 * later slice replaces its pane's body. This is intentionally a "designed
 * empty state", not a raw "no data" string — it states what the pane will hold
 * and carries the signature arc-border glow so the scaffold already feels like
 * the finished app.
 */
export function PanePlaceholder({
  icon: Icon,
  title,
  blurb,
}: {
  icon: IconType;
  title: string;
  blurb: string;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 px-8 text-center">
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="relative grid h-20 w-20 place-items-center rounded-[calc(var(--theme-radius)+8px)] text-midground"
        style={{
          background: "color-mix(in srgb, var(--midground) 6%, transparent)",
        }}
      >
        <span className="arc-border" aria-hidden />
        <Icon width={34} height={34} />
      </motion.div>

      <div className="animate-slide-up">
        <h2 className="font-mondwest text-display text-lg tracking-wide text-midground">
          {title}
        </h2>
        <p className="mx-auto mt-2 max-w-[30ch] text-sm leading-relaxed text-text-tertiary">
          {blurb}
        </p>
      </div>

      <span className="font-mono-ui rounded-full border border-border px-2.5 py-1 text-[0.6rem] uppercase tracking-[0.18em] text-text-tertiary">
        scaffolded
      </span>
    </div>
  );
}
