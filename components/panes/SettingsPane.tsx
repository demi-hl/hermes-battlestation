"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@/lib/themes";
import { useWorkspace } from "@/components/shell/workspace-context";
import { ThemeSheet, BackgroundSheet } from "@/components/shell/ThemeSwitcher";
import { Sheet } from "@/components/shell/Sheet";
import {
  PaletteIcon,
  CpuIcon,
  ChevronRightIcon,
  ReposIcon,
  VaultIcon,
  KeyIcon,
  PlugIcon,
} from "@/components/shell/icons";
import { haptic } from "@/components/shell/haptics";
import { usePet, PETS } from "@/lib/pet";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui";
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
  const [bgOpen, setBgOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [petOpen, setPetOpen] = useState(false);
  const { theme, bgOverride } = useTheme();
  const { pet, setPetId } = usePet();
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
        <Row
          icon={QrIcon}
          label="Link a device"
          value="QR"
          hint="Scan from a new phone to sign in"
          onClick={() => {
            haptic(10);
            setLinkOpen(true);
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
        <Row
          icon={PaletteIcon}
          label="Background"
          value={bgOverride ? bgOverride : "Theme default"}
          hint="Canvas color, keeps theme accents"
          onClick={() => {
            haptic(10);
            setBgOpen(true);
          }}
        />
        <Row
          icon={PawIcon}
          label="Pet"
          value={pet.label}
          hint="Sits by your profile, marks the session timer"
          onClick={() => {
            haptic(10);
            setPetOpen(true);
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

      <section className="flex flex-col gap-1.5">
        <SectionLabel>Integrations</SectionLabel>
        <Row
          icon={KeyIcon}
          label="API Keys"
          value="manage"
          hint="Provider credentials"
          onClick={() => {
            haptic(10);
            window.dispatchEvent(new CustomEvent("lo-nav", { detail: { tab: "keys" } }));
          }}
        />
        <Row
          icon={PlugIcon}
          label="MCP"
          value="servers"
          hint="Model Context Protocol servers"
          onClick={() => {
            haptic(10);
            window.dispatchEvent(new CustomEvent("lo-nav", { detail: { tab: "mcp" } }));
          }}
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
      <BackgroundSheet open={bgOpen} onClose={() => setBgOpen(false)} />
      <SetupSheet
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        setup={setup}
        onSaved={loadSetup}
      />
      <LinkSheet open={linkOpen} onClose={() => setLinkOpen(false)} />
      <PetSheet open={petOpen} onClose={() => setPetOpen(false)} petId={pet.id} setPetId={setPetId} />
    </div>
  );
}

// Inline QR glyph (house line-icon style).
function QrIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M14 14h3v3M20 14v.01M14 20h.01M17 20h.01M20 17v4" />
    </svg>
  );
}

// Inline paw glyph (house line-icon style).
function PawIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" {...props}>
      <ellipse cx="7" cy="9" rx="1.7" ry="2.2" />
      <ellipse cx="12" cy="7" rx="1.7" ry="2.3" />
      <ellipse cx="17" cy="9" rx="1.7" ry="2.2" />
      <path d="M12 12c-3 0-5 2.2-5 4.4 0 1.7 1.4 2.6 3 2.6 1 0 1.4-.4 2-.4s1 .4 2 .4c1.6 0 3-.9 3-2.6 0-2.2-2-4.4-5-4.4z" />
    </svg>
  );
}

// Pet picker — choose the sprite that sits by your profile and marks the
// session timer (replacing the status dot), or "Status dot" to disable it.
function PetSheet({
  open,
  onClose,
  petId,
  setPetId,
}: {
  open: boolean;
  onClose: () => void;
  petId: string;
  setPetId: (id: string) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Pet">
      <div className="flex flex-col gap-1.5 p-1">
        {PETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              haptic(8);
              setPetId(p.id);
            }}
            className={cn(
              "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
              p.id === petId
                ? "border-[color:var(--color-success)] bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)]"
                : "border-border/60 active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]",
            )}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center">
              {p.src ? (
                <img src={p.src} alt={p.label} className="h-7 w-7 object-contain" />
              ) : (
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: "var(--color-success)", boxShadow: "0 0 6px var(--color-success)" }}
                />
              )}
            </span>
            <span className="flex-1 text-sm text-midground">{p.label}</span>
            {p.id === petId && <CheckIconInline />}
          </button>
        ))}
        <p className="px-1 pt-1 text-[0.7rem] text-text-tertiary">
          Your pet sits next to the profile and marks the live session timer.
        </p>
      </div>
    </Sheet>
  );
}

function CheckIconInline() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="var(--color-success)" strokeWidth={2.4}>
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

// Link a device — fetches /api/link (server reads its own URL+token, returns a
// data-URL QR). Scanning it on a new phone opens the app already signed in.
function LinkSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [url, setUrl] = useState<string>("");
  const [hasToken, setHasToken] = useState(true);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQr(null);
    setErr(false);
    fetch("/api/link", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { qr: string; url: string; hasToken: boolean }) => {
        setQr(d.qr);
        setUrl(d.url);
        setHasToken(d.hasToken);
      })
      .catch(() => setErr(true));
  }, [open]);

  return (
    <Sheet open={open} onClose={onClose} title="Link a device">
      <div className="flex flex-col items-center gap-4 px-3 pb-4 pt-1 text-center">
        <p className="text-[0.8rem] leading-relaxed text-text-tertiary">
          Scan with a new phone&apos;s camera to open the app already signed in.
          The device needs to reach this box (Tailscale on, same network, or your
          tunnel).
        </p>

        {err ? (
          <p className="text-[0.8rem] text-[color:var(--negative,#f87171)]">
            Couldn&apos;t build the QR — is the app reachable?
          </p>
        ) : qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qr}
            alt="Device login QR"
            width={240}
            height={240}
            className="rounded-[var(--radius-lg)] border border-border bg-white p-2"
          />
        ) : (
          <div className="h-[240px] w-[240px] animate-pulse rounded-[var(--radius-lg)] border border-border bg-[color-mix(in_srgb,var(--midground)_6%,transparent)]" />
        )}

        {!hasToken && (
          <p className="text-[0.72rem] text-[color:var(--warning,#fbbf24)]">
            No access token set on this box — the QR links in without auth. Set
            BATTLESTATION_TOKEN before sharing.
          </p>
        )}

        {url && (
          <p className="break-all font-mono-ui text-[0.6rem] text-text-quaternary">
            {url.replace(/token=[^&]+/, "token=•••")}
          </p>
        )}

        <p className="text-[0.68rem] text-text-quaternary">
          A QR carries full access — only scan it on devices you own.
        </p>
      </div>
    </Sheet>
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

        <Button
          type="button"
          disabled={busy}
          onClick={save}
          className="w-full justify-center"
        >
          {busy ? "Saving…" : "Save setup"}
        </Button>
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
