"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@/lib/themes";
import { useWorkspace } from "@/components/shell/workspace-context";
import { ThemeSheet } from "@/components/shell/ThemeSwitcher";
import { Sheet } from "@/components/shell/Sheet";
import {
  PaletteIcon,
  CpuIcon,
  ChevronRightIcon,
  ReposIcon,
  VaultIcon,
} from "@/components/shell/icons";
import { haptic } from "@/components/shell/haptics";
import { cn } from "@/lib/utils";
import type { ComponentType, SVGProps } from "react";

interface RootStat {
  path: string;
  exists: boolean;
  repos: number;
}
interface SetupState {
  config: {
    hermesBin?: string;
    repoRoots?: string[];
    vaultPath?: string;
    setupComplete?: boolean;
  };
  detected: {
    hermesBin: string;
    hermesFound: boolean;
    hermesPath: string | null;
    repoRoots: RootStat[];
    vaultPath: string;
    vaultIsRepo: boolean;
  };
}

/**
 * Settings — theme, model, and the first-run Setup screen that lets a stranger
 * who downloaded the app point it at their hermes binary, repo roots, and
 * Obsidian vault without editing env files.
 */
export function SettingsPane() {
  const [themeOpen, setThemeOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const { theme } = useTheme();
  const { model } = useWorkspace();
  const [setup, setSetup] = useState<SetupState | null>(null);

  const loadSetup = useCallback(async () => {
    try {
      const res = await fetch("/api/config", { cache: "no-store" });
      if (res.ok) setSetup(await res.json());
    } catch {
      /* offline / dev */
    }
  }, []);

  useEffect(() => {
    loadSetup();
  }, [loadSetup]);

  const setupSummary = setup
    ? `${setup.detected.hermesFound ? "agent ok" : "agent not found"} · ${setup.detected.repoRoots.reduce((n, r) => n + r.repos, 0)} repos`
    : "configure";

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[520px] flex-col gap-6 px-5 pt-2">
      <section className="flex flex-col gap-1.5">
        <SectionLabel>Setup</SectionLabel>
        <Row
          icon={CpuIcon}
          label="Agent & paths"
          value={setupSummary}
          hint="hermes binary, repo roots, vault"
          tone={setup && !setup.detected.hermesFound ? "warn" : undefined}
          onClick={() => {
            haptic(10);
            setSetupOpen(true);
          }}
        />
      </section>

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
          value={model.label}
          hint="Switch from the context bar"
        />
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>About</SectionLabel>
        <p className="rounded-[var(--radius-lg)] border border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)] p-3.5 text-[0.82rem] leading-relaxed text-text-tertiary">
          An alternative launcher for your local agent. The app runs its own
          server on this machine and talks to your hermes install, repos, and
          vault. It is reachable from your phone over Tailscale while this
          machine is awake. Nothing is sent to a third party.
        </p>
      </section>

      <ThemeSheet open={themeOpen} onClose={() => setThemeOpen(false)} />
      <SetupSheet
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        setup={setup}
        onSaved={loadSetup}
      />
    </div>
  );
}

function SetupSheet({
  open,
  onClose,
  setup,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  setup: SetupState | null;
  onSaved: () => void;
}) {
  const [hermesBin, setHermesBin] = useState("");
  const [roots, setRoots] = useState("");
  const [vault, setVault] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && setup) {
      setHermesBin(setup.config.hermesBin ?? setup.detected.hermesBin ?? "");
      setRoots(
        (setup.config.repoRoots ?? setup.detected.repoRoots.map((r) => r.path)).join(
          "\n",
        ),
      );
      setVault(setup.config.vaultPath ?? setup.detected.vaultPath ?? "");
    }
  }, [open, setup]);

  const save = useCallback(async () => {
    setBusy(true);
    haptic(12);
    try {
      await fetch("/api/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hermesBin: hermesBin.trim(),
          repoRoots: roots
            .split("\n")
            .map((r) => r.trim())
            .filter(Boolean),
          vaultPath: vault.trim(),
          setupComplete: true,
        }),
      });
      haptic(20);
      onSaved();
      onClose();
    } catch {
      haptic(30);
    } finally {
      setBusy(false);
    }
  }, [hermesBin, roots, vault, onSaved, onClose]);

  return (
    <Sheet open={open} onClose={onClose} title="Setup">
      <div className="space-y-4 px-3 pb-3">
        {setup && (
          <div className="grid grid-cols-2 gap-2">
            <DetectChip
              ok={setup.detected.hermesFound}
              label="hermes binary"
              detail={
                setup.detected.hermesFound
                  ? setup.detected.hermesPath ?? setup.detected.hermesBin
                  : "not on PATH"
              }
            />
            <DetectChip
              ok={setup.detected.vaultIsRepo}
              label="vault repo"
              detail={setup.detected.vaultIsRepo ? "git ok" : "no .git"}
            />
          </div>
        )}

        <Field
          icon={CpuIcon}
          label="Hermes binary"
          hint="path or name on PATH"
          value={hermesBin}
          onChange={setHermesBin}
          placeholder="hermes"
        />
        <Field
          icon={ReposIcon}
          label="Repo roots"
          hint="one absolute path per line"
          value={roots}
          onChange={setRoots}
          placeholder="/home/you/projects"
          multiline
        />
        <Field
          icon={VaultIcon}
          label="Obsidian vault"
          hint="git-backed shared vault"
          value={vault}
          onChange={setVault}
          placeholder="/home/you/Obsidian Vault"
        />

        <button
          type="button"
          disabled={busy}
          onClick={save}
          className={cn(
            "flex w-full items-center justify-center rounded-[var(--radius-md)] px-4 py-2.5 text-[0.84rem] font-medium transition-colors",
            busy
              ? "cursor-wait bg-[color-mix(in_srgb,var(--midground)_12%,transparent)] text-text-disabled"
              : "bg-midground text-[var(--color-background)] active:scale-[0.98]",
          )}
        >
          {busy ? "Saving…" : "Save setup"}
        </button>
      </div>
    </Sheet>
  );
}

function DetectChip({
  ok,
  label,
  detail,
}: {
  ok: boolean;
  label: string;
  detail: string;
}) {
  return (
    <div className="flex flex-col rounded-[var(--radius-md)] border border-border px-3 py-2">
      <span className="flex items-center gap-1.5">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{
            background: ok ? "var(--color-success)" : "var(--color-warning, #f5b54a)",
          }}
        />
        <span className="text-[0.74rem] text-midground">{label}</span>
      </span>
      <span className="mt-0.5 truncate font-mono-ui text-[0.6rem] text-text-tertiary">
        {detail}
      </span>
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  hint,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5">
        <Icon width={13} height={13} className="text-text-tertiary" />
        <span className="font-mono-ui text-[0.6rem] uppercase tracking-[0.14em] text-text-tertiary">
          {label}
        </span>
        <span className="text-[0.6rem] text-text-disabled">· {hint}</span>
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="w-full resize-none rounded-[var(--radius-md)] border border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)] px-3 py-2 font-mono-ui text-[0.78rem] text-midground outline-none placeholder:text-text-disabled focus:border-[color-mix(in_srgb,var(--midground)_30%,transparent)]"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="w-full rounded-[var(--radius-md)] border border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)] px-3 py-2 font-mono-ui text-[0.8rem] text-midground outline-none placeholder:text-text-disabled focus:border-[color-mix(in_srgb,var(--midground)_30%,transparent)]"
        />
      )}
    </label>
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
  tone,
  onClick,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  value: string;
  hint?: string;
  tone?: "warn";
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
      <span
        className="font-mono-ui truncate text-[0.8rem]"
        style={{
          color: tone === "warn" ? "var(--color-warning, #f5b54a)" : "var(--text-secondary)",
        }}
      >
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
