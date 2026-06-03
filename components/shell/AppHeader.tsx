"use client";

import { useState } from "react";
import { ThemeSheet } from "./ThemeSwitcher";
import { PaletteIcon } from "./icons";
import { haptic } from "./haptics";

/**
 * Frosted top bar. The palette button opens the theme sheet. Content scrolls
 * underneath the blur.
 */
export function AppHeader() {
  const [themeOpen, setThemeOpen] = useState(false);

  return (
    <header
      className="absolute inset-x-0 top-0 z-30 flex items-end justify-end gap-3 border-b border-border px-4 pb-2"
      style={{
        height: "calc(var(--app-header-h) + env(safe-area-inset-top))",
        paddingTop: "env(safe-area-inset-top)",
        background: "color-mix(in srgb, var(--background-base) 64%, transparent)",
        backdropFilter: "blur(20px) saturate(150%)",
        WebkitBackdropFilter: "blur(20px) saturate(150%)",
      }}
    >
      <button
        type="button"
        aria-label="Switch theme"
        onClick={() => {
          haptic(8);
          setThemeOpen(true);
        }}
        className="mb-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-text-secondary transition-colors active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]"
      >
        <PaletteIcon width={18} height={18} />
      </button>

      <ThemeSheet open={themeOpen} onClose={() => setThemeOpen(false)} />
    </header>
  );
}
