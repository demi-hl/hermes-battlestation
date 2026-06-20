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
      className="absolute inset-x-0 top-0 z-30 flex items-end justify-end gap-3 px-4 pb-1"
      style={{
        height: "calc(var(--app-header-h) + env(safe-area-inset-top))",
        paddingTop: "env(safe-area-inset-top)",
        background: "transparent",
      }}
    >
      <button
        type="button"
        aria-label="Switch theme"
        onClick={() => {
          haptic(8);
          setThemeOpen(true);
        }}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border text-text-secondary transition-colors active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]"
      >
        <PaletteIcon width={17} height={17} />
      </button>

      <ThemeSheet open={themeOpen} onClose={() => setThemeOpen(false)} />
    </header>
  );
}
