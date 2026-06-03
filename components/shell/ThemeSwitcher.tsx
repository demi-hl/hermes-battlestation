"use client";

import { BUILTIN_THEMES, useTheme, type DashboardTheme } from "@/lib/themes";
import type { ThemeListEntry } from "@/lib/themes";
import { Sheet } from "./Sheet";
import { CheckIcon } from "./icons";
import { haptic } from "./haptics";
import { cn } from "@/lib/utils";

/**
 * Mobile theme picker. Adapted from the desktop `ThemeSwitcher.tsx`: same
 * `useTheme()` wiring (localStorage key `hermes-dashboard-theme`, set via the
 * ported provider) and the same 3-stop swatch preview logic. Rewritten as a
 * dependency-free bottom sheet instead of the DS Button/ListItem/BottomSheet
 * stack (which we don't ship). Reachable from the app title long-press and the
 * Settings tab.
 */
export function ThemeSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { themeName, availableThemes, setTheme } = useTheme();

  return (
    <Sheet open={open} onClose={onClose} title="Theme">
      <ul role="listbox" aria-label="Theme" className="flex flex-col gap-0.5">
        {availableThemes.map((th) => (
          <ThemeRow
            key={th.name}
            entry={th}
            active={th.name === themeName}
            onSelect={() => {
              haptic(10);
              setTheme(th.name);
              onClose();
            }}
          />
        ))}
      </ul>
    </Sheet>
  );
}

function ThemeRow({
  entry,
  active,
  onSelect,
}: {
  entry: ThemeListEntry;
  active: boolean;
  onSelect: () => void;
}) {
  const paletteTheme = BUILTIN_THEMES[entry.name] ?? entry.definition;
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={active}
        onClick={onSelect}
        className={cn(
          "relative flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-left transition-colors",
          active
            ? "bg-[color-mix(in_srgb,var(--midground)_10%,transparent)]"
            : "active:bg-[color-mix(in_srgb,var(--midground)_6%,transparent)]",
        )}
      >
        {active && (
          <span
            aria-hidden
            className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-midground"
          />
        )}
        {paletteTheme ? <Swatch theme={paletteTheme} /> : <PlaceholderSwatch />}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-mondwest text-display truncate text-[0.82rem] tracking-wide text-midground">
            {entry.label}
          </span>
          {entry.description && (
            <span className="truncate text-[0.72rem] text-text-tertiary">
              {entry.description}
            </span>
          )}
        </span>
        <CheckIcon
          width={16}
          height={16}
          className={cn(
            "shrink-0 text-midground transition-opacity",
            active ? "opacity-100" : "opacity-0",
          )}
        />
      </button>
    </li>
  );
}

function Swatch({ theme }: { theme: DashboardTheme }) {
  // Inverted themes (Nous Blue) author pre-inversion, so they opt into an
  // explicit `swatchColors` triplet that mirrors the on-screen result;
  // everything else falls back to the raw palette hexes.
  const [c1, c2, c3] = theme.swatchColors ?? [
    theme.palette.background.hex,
    theme.palette.midground.hex,
    theme.palette.warmGlow,
  ];
  return (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 overflow-hidden rounded-full border border-border"
    >
      <span className="flex-1" style={{ background: c1 }} />
      <span className="flex-1" style={{ background: c2 }} />
      <span className="flex-1" style={{ background: c3 }} />
    </span>
  );
}

function PlaceholderSwatch() {
  return (
    <span
      aria-hidden
      className="h-7 w-7 shrink-0 rounded-full border border-dashed border-border"
    />
  );
}
