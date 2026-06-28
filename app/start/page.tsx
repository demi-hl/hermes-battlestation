"use client";

import { useState, type SVGProps } from "react";
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

const CHOICES: {
  id: Choice;
  icon: (p: P) => React.ReactNode;
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

function StepLabel({ n, children }: { n: number; children: React.ReactNode }) {
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

export default function StartPage() {
  const [open, setOpen] = useState<Choice | null>(null);

  return (
    <main className="relative flex min-h-dvh w-full flex-col items-center px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <img src="/nous-logo.svg" alt="Nous" className="h-7 w-7" />
        <span className="font-mondwest text-lg tracking-[0.2em] text-text-primary">
          BATTLESTATION
        </span>
      </div>

      <div className="flex w-full max-w-md flex-col gap-2">
        <h1 className="font-mondwest text-xl tracking-wide text-text-primary">
          Welcome to Hermes Battlestation
        </h1>
        <p className="font-mono-ui text-[0.72rem] leading-relaxed text-text-tertiary">
          A cockpit for your own Hermes agent. The app is a thin client — it
          loads from a Battlestation server running on a box you control. Pick
          where you are and we&apos;ll take it from there.
        </p>
      </div>

      <div className="mt-6 flex w-full max-w-md flex-col gap-3">
        {CHOICES.map((c) => {
          const isOpen = open === c.id;
          return (
            <div
              key={c.id}
              className="overflow-hidden rounded-2xl border border-border bg-[color-mix(in_srgb,var(--background-base)_72%,transparent)] backdrop-blur-sm"
            >
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : c.id)}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--midground)_4%,transparent)]"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border text-midground">
                  <c.icon />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.84rem] font-medium text-text-primary">
                    {c.title}
                  </span>
                  <span className="mt-0.5 block font-mono-ui text-[0.64rem] leading-snug text-text-tertiary">
                    {c.blurb}
                  </span>
                </span>
                <span
                  className={`shrink-0 text-text-tertiary transition-transform ${
                    isOpen ? "rotate-90" : ""
                  }`}
                >
                  <ChevronIcon />
                </span>
              </button>

              {isOpen && (
                <div className="border-t border-border px-4 py-4">
                  {c.id === "have-server" && <HaveServer />}
                  {c.id === "have-box" && <HaveBox />}
                  {c.id === "new" && <NewToHermes />}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-8 max-w-md text-center font-mono-ui text-[0.6rem] leading-relaxed text-text-tertiary">
        The access token always lives on the server — the box mints it, this app
        only consumes it. Nothing personal is baked into the public build.
      </p>
    </main>
  );
}

/* ── State 1: already has a running server ───────────────────────────────── */
function HaveServer() {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono-ui text-[0.7rem] leading-relaxed text-text-secondary">
        Great — head to Connect and enter your box&apos;s URL (its Tailscale
        Serve / HTTPS address) and access token. Already signed in elsewhere?
        Use <span className="text-text-primary">Sign in with Nous</span> there
        instead.
      </p>
      <a
        href="/connect"
        className="inline-flex items-center justify-center gap-2 rounded-full bg-midground px-4 py-2.5 text-[0.82rem] font-medium text-background-base transition-opacity hover:opacity-90"
      >
        Connect to my server
        <ChevronIcon />
      </a>
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
