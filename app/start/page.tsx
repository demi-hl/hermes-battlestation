"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SVGProps,
} from "react";
import { ConnectForm } from "@/components/connect/ConnectForm";
import { useVisualViewportHeight } from "@/components/connect/useVisualViewportHeight";
import { CodeBlock } from "@/components/start/CodeBlock";
import { INSTALL_INFO, SERVER_SETUP } from "@/lib/onboarding";

// ── Pre-auth onboarding fork (/start) ────────────────────────────────────────
// The first screen a brand-new user sees when they open the app with NO server
// configured yet (public iOS build bakes no URL → ServerSetupVC; web → the
// middleware redirects unauthenticated page loads here). It forks three ways:
//
//   1. "I already have a Battlestation server"  → /connect (enter URL + token)
//   2. "I have a box, but no Battlestation yet"  → setup commands: clone the
//        repo, `npm install && npm run serve:vps` (builds + mints token + sets
//        up systemd-user + tailscale), then `npm run pair` (QR) / `npm run
//        token`. The token is SERVER-side — the box mints it, the app consumes
//        it. Nothing personal is baked into this public build.
//   3. "I'm new to Hermes"  → the install path (curl one-liner, signup, setup),
//        mirroring the gated /api/onboarding → OnboardingPane content but
//        reachable pre-auth via the shared lib/onboarding constants.
//
// This route is in middleware's PUBLIC_PREFIXES, so it renders with no token.

export const dynamic = "force-dynamic";

type P = SVGProps<SVGSVGElement>;

const icon = (props: P) => ({
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...props,
});

const ServerIcon = (p: P) => (
  <svg {...icon(p)}>
    <rect x="3" y="4" width="18" height="7" rx="1.5" />
    <rect x="3" y="13" width="18" height="7" rx="1.5" />
    <path d="M7 7.5h.01M7 16.5h.01" />
  </svg>
);

const BoxIcon = (p: P) => (
  <svg {...icon(p)}>
    <path d="M21 8 12 3 3 8l9 5 9-5Z" />
    <path d="M3 8v8l9 5 9-5V8" />
    <path d="M12 13v8" />
  </svg>
);

const SparkIcon = (p: P) => (
  <svg {...icon(p)}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
  </svg>
);

const ChevronIcon = (p: P) => (
  <svg {...icon(p)} width={16} height={16}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

const ExternalIcon = (p: P) => (
  <svg {...icon(p)} width={13} height={13}>
    <path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
  </svg>
);

type Choice = "have-server" | "have-box" | "new";
type WizardStep = 1 | 2 | 3;

const TOTAL_STEPS = 3;

const CHOICES: {
  id: Choice;
  icon: (p: P) => ReactNode;
  title: string;
  blurb: string;
}[] = [
  {
    id: "have-server",
    icon: ServerIcon,
    title: "I already have a Battlestation server",
    blurb: "Connect this app to a box that's already running Battlestation.",
  },
  {
    id: "have-box",
    icon: BoxIcon,
    title: "I have a box, but no Battlestation yet",
    blurb: "Stand up the server on a machine you control, then pair this app.",
  },
  {
    id: "new",
    icon: SparkIcon,
    title: "I'm new to Hermes",
    blurb: "Install the Hermes Agent CLI and create your Nous account first.",
  },
];

function StepLabel({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-border font-mono-ui text-[0.6rem] tabular text-text-secondary">
        {n}
      </span>
      <span className="text-[0.78rem] font-medium text-text-primary">
        {children}
      </span>
    </div>
  );
}

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[0.74rem] font-medium text-text-primary transition-colors hover:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)] active:scale-[0.98]"
    >
      {label}
      <ExternalIcon />
    </a>
  );
}

function WizardProgress({ step }: { step: WizardStep }) {
  const labels = ["Choose", "Guide", "Next"];

  return (
    <div className="mb-5 flex w-full flex-col gap-2 rounded-2xl border border-border bg-[color-mix(in_srgb,var(--background-base)_56%,transparent)] p-3 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3 font-mono-ui text-[0.64rem] uppercase tracking-wider text-text-tertiary">
        <span>
          Step {step} of {TOTAL_STEPS}
        </span>
        <span>{labels[step - 1]}</span>
      </div>
      <div className="grid grid-cols-3 gap-2" aria-hidden>
        {labels.map((label, i) => {
          const current = i + 1 <= step;
          return (
            <span
              key={label}
              className={`h-1.5 rounded-full transition-colors ${
                current ? "bg-midground" : "bg-border"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}

function ChoiceButton({
  item,
  selected,
  onSelect,
}: {
  item: (typeof CHOICES)[number];
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = item.icon;

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition-colors active:scale-[0.99] ${
        selected
          ? "border-midground bg-[color-mix(in_srgb,var(--midground)_12%,transparent)]"
          : "border-border bg-[color-mix(in_srgb,var(--background-base)_72%,transparent)] hover:bg-[color-mix(in_srgb,var(--midground)_4%,transparent)]"
      }`}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border text-midground">
        <Icon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.88rem] font-medium text-text-primary">
          {item.title}
        </span>
        <span className="mt-1 block font-mono-ui text-[0.68rem] leading-snug text-text-tertiary">
          {item.blurb}
        </span>
      </span>
    </button>
  );
}

function StartPageControls({
  choice,
  onBack,
  onNext,
  onRestart,
  step,
}: {
  choice: Choice | null;
  onBack: () => void;
  onNext: () => void;
  onRestart: () => void;
  step: WizardStep;
}) {
  return (
    <div className="mt-5 flex w-full items-center justify-between gap-3">
      <button
        type="button"
        onClick={step === 3 ? onRestart : onBack}
        disabled={step === 1}
        className={`rounded-full border border-border px-4 py-2 text-[0.78rem] font-medium text-text-secondary transition-opacity disabled:pointer-events-none disabled:opacity-0 ${
          step === 3 ? "font-mono-ui" : ""
        }`}
      >
        {step === 3 ? "Choose another path" : "Back"}
      </button>

      {step < 3 && (
        <button
          type="button"
          onClick={onNext}
          disabled={step === 1 && !choice}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-midground px-4 py-2.5 text-[0.82rem] font-medium text-background-base transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Continue
          <ChevronIcon />
        </button>
      )}
    </div>
  );
}

export default function StartPage() {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [step, setStep] = useState<WizardStep>(1);
  const mainRef = useRef<HTMLElement>(null);

  useVisualViewportHeight();

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [choice, step]);

  const goNext = () => {
    if (step === 1 && choice) setStep(2);
    if (step === 2) setStep(3);
  };

  const goBack = () => {
    if (step === 2) setStep(1);
    if (step === 3) setStep(2);
  };

  const restart = () => {
    setChoice(null);
    setStep(1);
  };

  return (
    <main
      ref={mainRef}
      className="relative flex w-full flex-col items-center overflow-y-auto px-5 py-8"
      style={{
        height: "var(--app-vh, 100dvh)",
        paddingTop: "max(2rem, env(safe-area-inset-top))",
        paddingBottom: "max(2rem, env(safe-area-inset-bottom))",
      }}
    >
      <div className="mb-6 flex items-center gap-2.5">
        <img src="/nous-logo.svg" alt="Nous" className="h-7 w-7" />
        <span className="font-mondwest text-lg tracking-[0.2em] text-text-primary">
          BATTLESTATION
        </span>
      </div>

      <section className="flex w-full max-w-lg flex-1 flex-col">
        <WizardProgress step={step} />

        <div className="flex min-h-0 flex-1 flex-col rounded-3xl border border-border bg-[color-mix(in_srgb,var(--background-base)_64%,transparent)] p-4 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.6)] backdrop-blur-sm sm:p-5">
          <div className="flex flex-col gap-2">
            <h1 className="font-mondwest text-xl tracking-wide text-text-primary">
              Welcome to Hermes Battlestation
            </h1>
            <p className="font-mono-ui text-[0.72rem] leading-relaxed text-text-tertiary">
              A cockpit for your own Hermes agent. The app is a thin client — it
              loads from a Battlestation server running on a box you control. Pick
              where you are and we&apos;ll take it from there.
            </p>
          </div>

          {step === 1 && (
            <div className="mt-5 flex flex-col gap-3">
              <h2 className="text-[0.98rem] font-medium text-text-primary">
                Do you already have a Hermes agent / Battlestation box?
              </h2>
              {CHOICES.map((item) => (
                <ChoiceButton
                  key={item.id}
                  item={item}
                  selected={choice === item.id}
                  onSelect={() => setChoice(item.id)}
                />
              ))}
            </div>
          )}

          {step === 2 && choice && <BranchStep choice={choice} />}

          {step === 3 && choice && <FinalStep choice={choice} />}
        </div>

        <StartPageControls
          choice={choice}
          onBack={goBack}
          onNext={goNext}
          onRestart={restart}
          step={step}
        />
      </section>

      <p className="mt-6 max-w-lg text-center font-mono-ui text-[0.62rem] leading-relaxed text-text-tertiary">
        The access token always lives on the server — the box mints it, this app
        only consumes it. Nothing personal is baked into the public build.
      </p>
    </main>
  );
}

function BranchStep({ choice }: { choice: Choice }) {
  const selected = CHOICES.find((item) => item.id === choice) ?? CHOICES[0];
  const Icon = selected.icon;

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border text-midground">
          <Icon />
        </span>
        <div className="min-w-0">
          <h2 className="text-[0.94rem] font-medium text-text-primary">
            {selected.title}
          </h2>
          <p className="mt-0.5 font-mono-ui text-[0.66rem] leading-snug text-text-tertiary">
            {selected.blurb}
          </p>
        </div>
      </div>

      {choice === "have-server" && <HaveServer />}
      {choice === "have-box" && <HaveBox />}
      {choice === "new" && <NewToHermes />}
    </div>
  );
}

function FinalStep({ choice }: { choice: Choice }) {
  if (choice === "have-server") {
    return (
      <div className="mt-5 flex flex-col gap-4">
        <h2 className="text-[0.98rem] font-medium text-text-primary">
          You&apos;re ready to connect
        </h2>
        <p className="font-mono-ui text-[0.7rem] leading-relaxed text-text-secondary">
          If the Connect form accepted your token, Battlestation will take you to
          the dashboard. If you still need to retry, open Connect and paste the
          URL + token from the box.
        </p>
        <a
          href="/connect"
          className="inline-flex items-center justify-center gap-2 rounded-full bg-midground px-4 py-2.5 text-[0.82rem] font-medium text-background-base transition-opacity hover:opacity-90"
        >
          Open Connect
          <ChevronIcon />
        </a>
      </div>
    );
  }

  if (choice === "have-box") {
    return (
      <div className="mt-5 flex flex-col gap-4">
        <h2 className="text-[0.98rem] font-medium text-text-primary">
          Here&apos;s your next step
        </h2>
        <p className="font-mono-ui text-[0.7rem] leading-relaxed text-text-secondary">
          Finish the box setup, run <code className="text-text-primary">npm run pair</code>{" "}
          or <code className="text-text-primary">npm run token</code>, then connect this
          app with the URL + token the box prints.
        </p>
        <a
          href="/connect"
          className="inline-flex items-center justify-center gap-2 rounded-full bg-midground px-4 py-2.5 text-[0.82rem] font-medium text-background-base transition-opacity hover:opacity-90"
        >
          Connect when ready
          <ChevronIcon />
        </a>
      </div>
    );
  }

  return (
    <div className="mt-5 flex flex-col gap-4">
      <h2 className="text-[0.98rem] font-medium text-text-primary">
        Here&apos;s your next step
      </h2>
      <p className="font-mono-ui text-[0.7rem] leading-relaxed text-text-secondary">
        Install the Hermes Agent CLI, create your Nous account, and run setup.
        Then come back to this wizard and choose the box setup path.
      </p>
      <div className="flex flex-wrap gap-2">
        <ExternalLink href={INSTALL_INFO.docs} label="Documentation" />
        <ExternalLink href={INSTALL_INFO.repo} label="GitHub" />
      </div>
    </div>
  );
}

/* ── State 1: already has a running server ───────────────────────────────── */
function HaveServer() {
  return (
    <div className="flex flex-col gap-4">
      <p className="font-mono-ui text-[0.7rem] leading-relaxed text-text-secondary">
        Great — head to Connect and enter your box&apos;s URL (its Tailscale
        Serve / HTTPS address) and access token. Already signed in elsewhere?
        Use <span className="text-text-primary">Sign in with Nous</span> there
        instead.
      </p>
      <ConnectForm
        autoFocusToken={false}
        className="max-w-none border-midground/35 bg-[color-mix(in_srgb,var(--background-base)_48%,transparent)] p-4 shadow-none"
        redirectIfAuthenticated={false}
        remoteUrlMode="inline"
        showStartLink={false}
      />
      <p className="font-mono-ui text-[0.62rem] leading-relaxed text-text-tertiary">
        Don&apos;t have the token handy? On the box, run{" "}
        <code className="text-text-secondary">npm run token</code> to print it,
        or <code className="text-text-secondary">npm run pair</code> for a QR.
      </p>
    </div>
  );
}

/* ── State 2: has a box, no Battlestation yet ────────────────────────────── */
function HaveBox() {
  return (
    <div className="flex flex-col gap-4">
      <p className="font-mono-ui text-[0.7rem] leading-relaxed text-text-secondary">
        Run these on the box you want Battlestation to live on (a VPS, home
        server, Raspberry Pi — anything with Node 18+ and Tailscale). It runs on
        any architecture; no DMG/AppImage needed.
      </p>

      <div className="flex flex-col gap-2">
        <StepLabel n={1}>Clone the repo</StepLabel>
        <CodeBlock command={SERVER_SETUP.clone} />
      </div>

      <div className="flex flex-col gap-2">
        <StepLabel n={2}>Install &amp; bring it up</StepLabel>
        <CodeBlock command={SERVER_SETUP.install} />
        <CodeBlock command={SERVER_SETUP.serve} />
        <p className="font-mono-ui text-[0.62rem] leading-relaxed text-text-tertiary">
          <code className="text-text-secondary">serve:vps</code> builds the
          server, mints a <code className="text-text-secondary">BATTLESTATION_TOKEN</code>,
          installs a reboot-proof systemd&nbsp;--user service, and fronts it with
          Tailscale Serve for real-TLS reach.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <StepLabel n={3}>Pair this app</StepLabel>
        <p className="font-mono-ui text-[0.62rem] leading-relaxed text-text-tertiary">
          <code className="text-text-secondary">serve:vps</code> prints a QR +
          link at the end. To reprint it anytime, or to grab the raw token to
          paste into Connect:
        </p>
        <CodeBlock command={SERVER_SETUP.pair} />
        <CodeBlock command={SERVER_SETUP.token} />
      </div>

      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <ExternalLink href={INSTALL_INFO.repo} label="Hermes Agent" />
        <a
          href="/connect"
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[0.74rem] font-medium text-text-primary transition-colors hover:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)] active:scale-[0.98]"
        >
          Already running? Connect
          <ChevronIcon />
        </a>
      </div>
    </div>
  );
}

/* ── State 3: new to Hermes (install path) ───────────────────────────────── */
function NewToHermes() {
  return (
    <div className="flex flex-col gap-4">
      <p className="font-mono-ui text-[0.7rem] leading-relaxed text-text-secondary">
        Battlestation drives the Hermes Agent. Install the CLI and create a Nous
        account first — then come back and stand up a server (the middle option).
      </p>

      <div className="flex flex-col gap-2">
        <StepLabel n={1}>Install the Hermes Agent CLI</StepLabel>
        <CodeBlock command={INSTALL_INFO.unix} />
        <p className="font-mono-ui text-[0.62rem] leading-relaxed text-text-tertiary">
          No browser on the box? Use the skip-browser install:
        </p>
        <CodeBlock command={INSTALL_INFO.skipBrowser} />
      </div>

      <div className="flex flex-col gap-2">
        <StepLabel n={2}>Create your Nous account</StepLabel>
        <ExternalLink href={INSTALL_INFO.signup} label="Sign up at Nous Research" />
      </div>

      <div className="flex flex-col gap-2">
        <StepLabel n={3}>Run setup</StepLabel>
        <CodeBlock command={INSTALL_INFO.setup} />
        <p className="font-mono-ui text-[0.62rem] leading-relaxed text-text-tertiary">
          Authenticates the CLI and writes your config.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <ExternalLink href={INSTALL_INFO.docs} label="Documentation" />
        <ExternalLink href={INSTALL_INFO.repo} label="GitHub" />
      </div>
    </div>
  );
}