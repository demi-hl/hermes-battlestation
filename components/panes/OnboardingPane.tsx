"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { usePolling } from "@/components/usePolling";
import { relativeTime } from "@/lib/format";
import { haptic } from "@/components/shell/haptics";
import { cn } from "@/lib/utils";
import { RefreshIcon } from "@/components/panes/pane-icons";
import { ExternalIcon } from "./parts";
import { CheckIcon, KeyIcon } from "@/components/shell/icons";
import { PaneSkeleton, StateCard, SectionLabel, PullToRefresh } from "./parts";
import type { SVGProps } from "react";

/* ========================================================================= */

type OnboardingInstall = {
  unix: string;
  skipBrowser: string;
  setup: string;
  docs: string;
  repo: string;
  signup: string;
};

type OnboardingPayload = {
  installed: boolean;
  binPath: string | null;
  version: string | null;
  loggedIn: boolean;
  providers: string[];
  install: OnboardingInstall;
};

/* ========================================================================= */

type P = SVGProps<SVGSVGElement>;

const GET_ICON = (p: P) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...p}
  >
    <path d="M12 3v10m0 0 4-4m-4 4-4-4" />
    <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </svg>
);

const CopyIcon = (p: P) => (
  <svg
    width={13}
    height={13}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...p}
  >
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const BookIcon = (p: P) => (
  <svg
    width={13}
    height={13}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...p}
  >
    <path d="M4 5a2 2 0 0 1 2-2h6v16H6a2 2 0 0 0-2 2Z" />
    <path d="M20 5a2 2 0 0 0-2-2h-6v16h6a2 2 0 0 1 2 2Z" />
  </svg>
);

const GitHubIcon = (p: P) => (
  <svg
    width={13}
    height={13}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...p}
  >
    <path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />
  </svg>
);

/* ========================================================================= */

const ROW_V = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.28,
      ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
    },
  },
};

/* ========================================================================= */

function CodeBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    haptic(8);
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
      className="group flex w-full items-center gap-2.5 rounded-[var(--radius-md)] border border-border bg-card px-3 py-2.5 text-left transition-colors active:scale-[0.99]"
    >
      <span className="shrink-0 select-none font-mono-ui text-[0.72rem] text-text-tertiary">
        $
      </span>
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono-ui text-[0.72rem] text-midground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {command}
      </code>
      <span
        className={cn(
          "grid h-6 w-6 shrink-0 place-items-center rounded-[var(--radius-sm)] transition-colors",
          copied
            ? "text-[var(--color-success,#4ade80)]"
            : "text-text-tertiary group-hover:text-midground",
        )}
      >
        {copied ? <CheckIcon width={14} height={14} /> : <CopyIcon />}
      </span>
    </button>
  );
}

/* ========================================================================= */

function Step({
  index,
  title,
  done,
  children,
}: {
  index: number;
  title: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.li variants={ROW_V} className="relative flex gap-3">
      {/* number / done badge + connector */}
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "grid h-7 w-7 shrink-0 place-items-center rounded-full border font-mono-ui tabular text-[0.7rem]",
            done
              ? "border-[color-mix(in_srgb,var(--color-success,#4ade80)_45%,transparent)] text-[var(--color-success,#4ade80)]"
              : "border-border text-text-secondary",
          )}
          style={
            done
              ? {
                  background:
                    "color-mix(in srgb, var(--color-success, #4ade80) 12%, transparent)",
                }
              : undefined
          }
        >
          {done ? <CheckIcon width={14} height={14} /> : index}
        </span>
        <span className="mt-1 w-px flex-1 bg-border" aria-hidden />
      </div>

      <div className="min-w-0 flex-1 pb-5">
        <div className="flex items-center gap-2">
          <h3 className="text-[0.84rem] font-medium text-midground">{title}</h3>
          {done && (
            <span className="rounded-full border border-[color-mix(in_srgb,var(--color-success,#4ade80)_40%,transparent)] px-1.5 py-[1px] font-mono-ui text-[0.5rem] uppercase tracking-[0.1em] text-[var(--color-success,#4ade80)]">
              done
            </span>
          )}
        </div>
        <div className="mt-2 space-y-2">{children}</div>
      </div>
    </motion.li>
  );
}

/* ========================================================================= */

function FooterLink({
  href,
  icon: Icon,
  label,
  sub,
}: {
  href: string;
  icon: (p: P) => React.ReactNode;
  label: string;
  sub?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={() => haptic(6)}
      className="flex flex-1 items-center gap-2 rounded-[var(--radius-md)] border border-border px-3 py-2.5 transition-colors hover:bg-[color-mix(in_srgb,var(--midground)_6%,transparent)] active:scale-[0.99]"
    >
      <span className="shrink-0 text-text-tertiary">
        <Icon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.78rem] font-medium text-midground">
          {label}
        </span>
        {sub && (
          <span className="block truncate font-mono-ui text-[0.56rem] uppercase tracking-[0.1em] text-text-tertiary">
            {sub}
          </span>
        )}
      </span>
      <span className="shrink-0 text-text-tertiary">
        <ExternalIcon width={12} height={12} />
      </span>
    </a>
  );
}

/* ========================================================================= */

export function OnboardingPane() {
  const { data, error, loading, updatedAt, reload } =
    usePolling<OnboardingPayload>("/api/onboarding", 30_000);

  const installed = data?.installed ?? false;
  const loggedIn = data?.loggedIn ?? false;
  const providers = data?.providers ?? [];
  const install = data?.install;

  return (
    <PullToRefresh onRefresh={reload}>
      <div className="px-3 pb-6">
        {/* header */}
        <div className="flex items-center gap-2.5 pt-1">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-border text-midground">
            <GET_ICON />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="font-mondwest text-display text-[0.92rem] tracking-[0.04em] text-midground">
              Get Hermes Agent
            </h1>
            <p className="truncate font-mono-ui text-[0.66rem] text-text-tertiary">
              open-source setup
            </p>
          </div>
          <button
            type="button"
            aria-label="Refresh"
            onClick={() => {
              haptic(6);
              reload();
            }}
            className="grid h-8 w-8 place-items-center rounded-full text-text-tertiary transition-colors hover:text-midground active:scale-90"
          >
            <span className={loading ? "animate-spin-slow" : ""}>
              <RefreshIcon width={15} height={15} />
            </span>
          </button>
        </div>

        {/* body states */}
        {loading && !data ? (
          <div className="mt-4">
            <PaneSkeleton rows={3} />
          </div>
        ) : error && !data ? (
          <StateCard
            icon={GET_ICON}
            tone="danger"
            title="Onboarding unavailable"
            blurb={error ?? "failed to load onboarding status"}
          />
        ) : !install ? (
          <StateCard
            icon={GET_ICON}
            title="Nothing to show"
            blurb="The onboarding endpoint returned no install instructions."
          />
        ) : (
          <>
            {/* error banner (partial data) */}
            {error && (
              <p className="mt-2 px-1 font-mono-ui text-[0.64rem] leading-relaxed text-[var(--color-warning,#ffbd38)]">
                {error}
              </p>
            )}

            {/* status header */}
            {installed ? (
              <div
                className="mt-3 flex items-center gap-3 rounded-xl border px-3 py-3"
                style={{
                  borderColor:
                    "color-mix(in srgb, var(--color-success, #4ade80) 40%, transparent)",
                  background:
                    "color-mix(in srgb, var(--color-success, #4ade80) 8%, transparent)",
                }}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--color-success,#4ade80)]">
                  <CheckIcon width={20} height={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[0.84rem] font-medium text-midground">
                      Hermes Agent installed
                    </span>
                    {data?.version && (
                      <span className="rounded-full border border-[color-mix(in_srgb,var(--color-success,#4ade80)_40%,transparent)] px-1.5 py-[1px] font-mono-ui text-[0.56rem] tabular text-[var(--color-success,#4ade80)]">
                        {data.version}
                      </span>
                    )}
                  </div>
                  {data?.binPath && (
                    <p className="mt-0.5 truncate font-mono-ui text-[0.64rem] text-text-tertiary">
                      {data.binPath}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-border px-3 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-midground">
                  <GET_ICON />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="text-[0.84rem] font-medium text-midground">
                    Hermes Agent not installed
                  </span>
                  <p className="mt-0.5 text-[0.7rem] leading-snug text-text-secondary">
                    Follow the steps below to install and get started.
                  </p>
                </div>
              </div>
            )}

            {/* steps */}
            <div className="mt-5">
              <SectionLabel>Get Started</SectionLabel>
              <motion.ol
                className="mt-1 px-1"
                initial="hidden"
                animate="show"
                variants={{ show: { transition: { staggerChildren: 0.04 } } }}
              >
                <Step index={1} title="Install Hermes Agent" done={installed}>
                  <CodeBlock command={install.unix} />
                  <p className="font-mono-ui text-[0.62rem] leading-relaxed text-text-tertiary">
                    No browser? Use{" "}
                    <button
                      type="button"
                      onClick={() => {
                        haptic(6);
                        navigator.clipboard
                          ?.writeText(install.skipBrowser)
                          .catch(() => {});
                      }}
                      className="font-mono-ui text-text-secondary underline decoration-dotted underline-offset-2 transition-colors hover:text-midground"
                    >
                      the skip-browser install
                    </button>{" "}
                    instead.
                  </p>
                </Step>

                <Step index={2} title="Sign up to Nous" done={loggedIn}>
                  <a
                    href={install.signup}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => haptic(8)}
                    className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-border px-3 py-2 text-[0.78rem] font-medium text-midground transition-colors hover:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)] active:scale-[0.98]"
                  >
                    {loggedIn ? "Manage your Nous account" : "Sign up at Nous Research"}
                    <ExternalIcon width={13} height={13} />
                  </a>
                </Step>

                <Step index={3} title="Run setup" done={installed && loggedIn}>
                  <CodeBlock command={install.setup} />
                  <p className="text-[0.68rem] leading-relaxed text-text-tertiary">
                    Authenticates the CLI and writes your config.
                  </p>
                </Step>

                <Step index={4} title="Add a provider key" done={providers.length > 0}>
                  <div className="flex items-center gap-2.5 rounded-[var(--radius-md)] border border-border px-3 py-2.5">
                    <span className="shrink-0 text-text-tertiary">
                      <KeyIcon width={16} height={16} />
                    </span>
                    <p className="min-w-0 flex-1 text-[0.7rem] leading-snug text-text-secondary">
                      Open the{" "}
                      <span className="font-medium text-midground">API Keys</span>{" "}
                      pane to add a provider key and start running agents.
                    </p>
                  </div>
                </Step>
              </motion.ol>
            </div>

            {/* configured providers */}
            {installed && providers.length > 0 && (
              <div className="mt-2">
                <SectionLabel
                  right={
                    <span className="font-mono-ui tabular text-[0.62rem] text-text-tertiary">
                      {providers.length}
                    </span>
                  }
                >
                  Configured Providers
                </SectionLabel>
                <div className="mt-1 flex flex-wrap gap-1.5 px-1">
                  {providers.map((provider) => (
                    <span
                      key={provider}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-mono-ui text-[0.62rem] text-text-secondary"
                      style={{
                        background:
                          "color-mix(in srgb, var(--midground) 4%, transparent)",
                      }}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-[var(--color-success,#4ade80)]"
                        style={{
                          boxShadow: "0 0 5px var(--color-success, #4ade80)",
                        }}
                      />
                      {provider}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* footer links */}
            <div className="mt-6 flex gap-2 border-t border-border pt-4">
              <FooterLink
                href={install.docs}
                icon={BookIcon}
                label="Documentation"
              />
              <FooterLink
                href={install.repo}
                icon={GitHubIcon}
                label="GitHub"
                sub="open source"
              />
            </div>

            <p className="mt-4 px-1 font-mono-ui text-[0.6rem] leading-relaxed text-text-tertiary">
              Source: <span className="text-text-secondary">GET /api/onboarding</span>
              {updatedAt ? ` · ${relativeTime(updatedAt)}` : ""}
            </p>
          </>
        )}
      </div>
    </PullToRefresh>
  );
}
