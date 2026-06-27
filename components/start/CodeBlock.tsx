"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// Copy-to-clipboard command row for the pre-auth /start onboarding flow. Mirrors
// the OnboardingPane CodeBlock but is dependency-light (no haptics/parts) so it
// can render on the public, pre-auth setup screens.
export function CodeBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable; no-op */
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copy command"
      className="group flex w-full items-center gap-2.5 rounded-lg border border-border bg-[color-mix(in_srgb,var(--background-base)_60%,transparent)] px-3 py-2.5 text-left transition-colors active:scale-[0.99]"
    >
      <span className="shrink-0 select-none font-mono-ui text-[0.72rem] text-text-tertiary">
        $
      </span>
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono-ui text-[0.72rem] text-text-primary [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {command}
      </code>
      <span
        className={cn(
          "grid h-6 w-6 shrink-0 place-items-center rounded-md transition-colors",
          copied
            ? "text-[var(--color-success,#4ade80)]"
            : "text-text-tertiary group-hover:text-midground",
        )}
      >
        {copied ? (
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </span>
    </button>
  );
}
