"use client";

import { useState } from "react";
import { useTheme } from "@/lib/themes";
import { useWorkspace } from "@/components/shell/workspace-context";
import { ThemeSheet } from "@/components/shell/ThemeSwitcher";
import {
  PaletteIcon,
  CpuIcon,
  ChevronRightIcon,
} from "@/components/shell/icons";
import { haptic } from "@/components/shell/haptics";
import type { ComponentType, SVGProps } from "react";

/**
 * Settings — the slice-1-owned ThemeSwitcher entry point, plus identity and an
 * honest note on the hub's reachability. (The app title also long-presses to
 * the theme sheet.)
 */
export function SettingsPane() {
  const [themeOpen, setThemeOpen] = useState(false);
  const { theme } = useTheme();
  const { model } = useWorkspace();

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[520px] flex-col gap-6 px-5 pt-2">
      <section className="flex flex-col gap-1.5">
        <SectionLabel>Appearance</SectionLabel>
        <Row
          icon={PaletteIcon}
          label="Theme"
          value={theme.label}
          onClick={() => {
            haptic(10);
            setThemeOpen(true);
          }}
        />
      </section>

      <section className="flex flex-col gap-1.5">
        <SectionLabel>Agent</SectionLabel>
        <Row
          icon={CpuIcon}
          label="Model"
          value={`${model.label} · ${model.plan}`}
          hint="Switch from the context bar"
        />
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>About</SectionLabel>
        <p className="rounded-[var(--radius-lg)] border border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)] p-3.5 text-[0.82rem] leading-relaxed text-text-tertiary">
          Hermes Agent is the mobile hub, reached over
          Tailscale. Unlike Telegram, it is live only while this PC is
          awake and your phone is on the tailnet. If the PC sleeps or reboots,
          the hub goes dark and messages are not queued. Keep the PC always-on.
        </p>
      </section>

      <ThemeSheet open={themeOpen} onClose={() => setThemeOpen(false)} />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mondwest text-display px-1 text-[0.66rem] tracking-[0.16em] text-text-tertiary">
      {children}
    </span>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  hint,
  onClick,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  value: string;
  hint?: string;
  onClick?: () => void;
}) {
  const interactive = Boolean(onClick);
  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={onClick}
      className={cnRow(interactive)}
    >
      <span className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--midground)_8%,transparent)] text-midground">
        <Icon width={17} height={17} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="text-[0.9rem] text-midground">{label}</span>
        {hint && (
          <span className="text-[0.68rem] text-text-tertiary">{hint}</span>
        )}
      </span>
      <span className="font-mono-ui truncate text-[0.8rem] text-text-secondary">
        {value}
      </span>
      {interactive && (
        <ChevronRightIcon
          width={16}
          height={16}
          className="shrink-0 text-text-tertiary"
        />
      )}
    </button>
  );
}

function cnRow(interactive: boolean): string {
  return [
    "flex w-full items-center gap-3 rounded-[var(--radius-lg)] border border-border px-3 py-2.5",
    "bg-[color-mix(in_srgb,var(--midground)_3%,transparent)]",
    interactive
      ? "transition-colors active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]"
      : "opacity-90",
  ].join(" ");
}
