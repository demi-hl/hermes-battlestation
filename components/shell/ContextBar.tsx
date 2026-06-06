"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useWorkspace,
  type AgentStatus,
  type ModelOption,
  repoLetters,
} from "./workspace-context";
import type { AgentProfile } from "@/lib/workspace-types";
import { Sheet } from "./Sheet";
import { RepoAvatarBadge } from "./repo-avatar";
import { ChevronUpDownIcon, CheckIcon, BranchIcon, CompressIcon, ChevronDownIcon } from "./icons";
import { haptic } from "./haptics";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";

/** How long to show a notification before auto-dismiss. */
const NOTIF_DURATION = 6000;

/**
 * Bottom context bar — always shows model name + context meter + compress.
 * Collapsable to show active sessions, notification badges, and profile.
 * All the info you need to know when to compress.
 */
export function ContextBar() {
  const {
    active, model, contextUsage, status, barCollapsed, setBarCollapsed,
    activeSessions, profiles, activeProfile, setActiveProfile,
    notifications, dismissNotification, compress, repoAvatars,
  } = useWorkspace();

  const [profileOpen, setProfileOpen] = useState(false);

  const pct = contextUsage
    ? Math.min(100, Math.round((contextUsage.used / contextUsage.total) * 100))
    : null;

  return (
    <>
      {/* Notification toasts — float above the bar */}
      <div className="fixed bottom-[calc(40px+env(safe-area-inset-bottom)+8px)] inset-x-4 z-50 flex flex-col gap-1.5 pointer-events-none">
        <AnimatePresence>
          {notifications.map((n) => (
            <NotifToast key={n.id} n={n} onDismiss={() => dismissNotification(n.id)} />
          ))}
        </AnimatePresence>
      </div>

      <div
        className="flex flex-col border-t border-border"
        style={{
          background: "color-mix(in srgb, var(--background-base) 70%, transparent)",
          backdropFilter: "blur(18px) saturate(150%)",
          WebkitBackdropFilter: "blur(18px) saturate(150%)",
        }}
      >
        {/* ---- Always-visible top row: model + meter + compress + collapse toggle ---- */}
        <div className="flex h-10 items-center gap-2 px-3">
          <StatusDot status={status} />

          {/* Active workspace / repo */}
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {active ? (
              <>
                <RepoAvatarBadge
                  letters={repoAvatars[active.repo]?.letters ?? repoLetters(active.repo)}
                  imageUrl={repoAvatars[active.repo]?.imageUrl}
                  size={16}
                />
                <span className="truncate text-[0.74rem] text-midground">
                  {active.repo}
                </span>
                <BranchIcon width={12} height={12} className="shrink-0 text-text-tertiary" />
                <span className="font-mono-ui truncate text-[0.72rem] text-text-tertiary">
                  {active.branch}
                </span>
              </>
            ) : (
              <span className="truncate text-[0.74rem] text-text-tertiary">
                general · no workspace bound
              </span>
            )}
          </div>

          {/* Context meter + compress */}
          {pct !== null && (
            <>
              <button
                type="button"
                onClick={compress}
                title="Compress context (Ctrl+Shift+C)"
                className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[0.65rem] text-text-tertiary transition-colors hover:text-midground active:scale-90"
              >
                <CompressIcon width={13} height={13} />
              </button>
              <ContextMeter pct={pct} />
            </>
          )}

          {/* Model name */}
          <button
            type="button"
            onClick={() => { haptic(8); setProfileOpen(true); }}
            aria-label={`Model: ${model.label}. Profile: ${activeProfile?.label ?? "default"}. Tap to switch.`}
            className="flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-1 text-[0.7rem] text-midground transition-colors active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]"
          >
            <span className="font-mondwest text-display tracking-wide">{model.label}</span>
            <ChevronUpDownIcon width={12} height={12} className="text-text-tertiary" />
          </button>

          {/* Active sessions dot badge */}
          {activeSessions.length > 0 && (
            <span className="flex shrink-0 items-center justify-center h-4 min-w-[16px] rounded-full bg-midground/20 px-1 font-mono-ui text-[0.55rem] text-midground">
              {activeSessions.length}
            </span>
          )}

          {/* Collapse toggle */}
          <button
            type="button"
            onClick={() => setBarCollapsed(!barCollapsed)}
            aria-label={barCollapsed ? "Expand" : "Collapse"}
            className="flex shrink-0 items-center gap-0.5 text-[0.6rem] text-text-disabled transition-colors hover:text-text-tertiary"
          >
            <ChevronDownIcon
              width={12}
              height={12}
              className={cn("transition-transform", barCollapsed ? "" : "rotate-180")}
            />
          </button>
        </div>

        {/* ---- Collapsable section: active sessions + profile info ---- */}
        <AnimatePresence>
          {!barCollapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeInOut" }}
              className="overflow-hidden border-t border-border/50"
            >
              <div className="flex items-center gap-3 px-3 py-1.5">
                {/* Profile */}
                <span className="flex shrink-0 items-center gap-1 rounded-full border border-border/60 px-2 py-0.5">
                  <span className="font-mono-ui text-[0.55rem] uppercase tracking-wider text-text-tertiary">
                    profile
                  </span>
                  <span className="font-mono-ui text-[0.6rem] text-midground">
                    {activeProfile?.label ?? "default"}
                  </span>
                </span>

                {/* Active sessions */}
                {activeSessions.length > 0 && (
                  <div className="flex flex-1 items-center gap-1.5 overflow-x-auto scrollbar-none">
                    <span className="shrink-0 font-mono-ui text-[0.52rem] uppercase tracking-wider text-text-tertiary">
                      sessions
                    </span>
                    {activeSessions.slice(0, 5).map((s) => (
                      <span
                        key={s.repo}
                        className="flex shrink-0 items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--midground)_18%,transparent)] px-1.5 py-0.5"
                      >
                        <RepoAvatarBadge
                          letters={repoAvatars[s.repo]?.letters ?? repoLetters(s.repo)}
                          imageUrl={repoAvatars[s.repo]?.imageUrl}
                          size={12}
                        />
                        <span className="font-mono-ui text-[0.55rem] text-text-secondary">
                          {s.repo}
                        </span>
                        {s.sessionId && (
                          <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-success)]" />
                        )}
                      </span>
                    ))}
                    {activeSessions.length > 5 && (
                      <span className="font-mono-ui text-[0.55rem] text-text-disabled">
                        +{activeSessions.length - 5}
                      </span>
                    )}
                  </div>
                )}

                {/* Last-used model info */}
                <span className="shrink-0 font-mono-ui tabular text-[0.55rem] text-text-disabled">
                  {model.id} · {model.provider}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Profile + model sheet */}
      <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} />
    </>
  );
}

function NotifToast({
  n,
  onDismiss,
}: {
  n: { id: string; repo: string; branch: string; type: string; ts: number };
  onDismiss: () => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(onDismiss, NOTIF_DURATION);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [onDismiss]);

  const icon = n.type === "started" ? "●" : n.type === "completed" ? "✓" : "✕";
  const label = n.type === "started" ? "session started" : n.type === "completed" ? "done" : "error";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="pointer-events-auto mx-auto flex max-w-sm items-center gap-2 rounded-lg border border-border bg-[color-mix(in_srgb,var(--background-base)_88%,transparent)] px-3 py-2 shadow-lg backdrop-blur"
    >
      <span className={cn(
        "h-2 w-2 shrink-0 rounded-full",
        n.type === "started" ? "bg-[color:var(--color-info)]" :
        n.type === "completed" ? "bg-[color:var(--color-success)]" : "bg-[color:var(--color-destructive)]"
      )} />
      <span className="font-mono-ui text-[0.65rem] text-text-secondary">
        <strong className="text-midground">{n.repo}</strong> {n.branch && <>{n.branch} — </>}{label}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-auto shrink-0 text-[0.6rem] text-text-disabled hover:text-text-tertiary"
      >
        ×
      </button>
    </motion.div>
  );
}

function StatusDot({ status }: { status: AgentStatus }) {
  const color =
    status === "online"
      ? "var(--color-success)"
      : status === "connecting"
        ? "var(--color-warning)"
        : "var(--color-destructive)";
  return (
    <span
      aria-label={`agent ${status}`}
      title={`agent ${status}`}
      className="relative grid shrink-0 place-items-center"
      style={{ width: 12, height: 12 }}
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          status === "connecting" && "animate-pulse",
        )}
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
    </span>
  );
}

function ContextMeter({ pct }: { pct: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5" title={`context ${pct}%`}>
      <span className="relative h-1.5 w-12 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--midground)_14%,transparent)]">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-midground"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="font-mono-ui tabular text-[0.66rem] text-text-tertiary">{pct}%</span>
    </span>
  );
}

function ProfileSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { models, model, setModel, profiles, activeProfile, setActiveProfile } = useWorkspace();

  return (
    <Sheet open={open} onClose={onClose} title="Model & Profile" className="max-h-[90dvh]">
      {/* Profiles */}
      <div className="px-1 pb-2">
        <span className="mb-1 block font-mono-ui text-[0.55rem] uppercase tracking-wider text-text-tertiary">
          Profiles
        </span>
        <div className="flex flex-col gap-0.5">
          {profiles.map((p) => (
            <ProfileRow
              key={p.id}
              profile={p}
              active={p.id === activeProfile?.id}
              onSelect={() => {
                haptic(10);
                setActiveProfile(p.id);
              }}
            />
          ))}
        </div>
      </div>

      {/* All models */}
      <div className="border-t border-border px-1 pt-2">
        <span className="mb-1 block font-mono-ui text-[0.55rem] uppercase tracking-wider text-text-tertiary">
          Models
        </span>
        <div className="flex flex-col gap-0.5">
          {models.map((m) => (
            <ModelRow
              key={m.id}
              option={m}
              active={m.id === model.id}
              onSelect={() => {
                haptic(10);
                setModel(m.id);
              }}
            />
          ))}
        </div>
      </div>

      {/* Usage info */}
      <UsageFooter />
    </Sheet>
  );
}

function ProfileRow({
  profile,
  active,
  onSelect,
}: {
  profile: AgentProfile;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-left transition-colors",
        active ? "bg-[color-mix(in_srgb,var(--midground)_10%,transparent)]" : "active:bg-[color-mix(in_srgb,var(--midground)_6%,transparent)]",
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-midground" />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-mondwest text-display text-[0.84rem] tracking-wide text-midground">
          {profile.label}
        </span>
        <span className="font-mono-ui text-[0.68rem] text-text-tertiary">
          {profile.model} · {profile.provider}
        </span>
      </span>
      <CheckIcon width={16} height={16} className={cn("shrink-0 text-midground transition-opacity", active ? "opacity-100" : "opacity-0")} />
    </button>
  );
}

function ModelRow({
  option,
  active,
  onSelect,
}: {
  option: ModelOption;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onSelect}
      className={cn(
        "relative flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-left transition-colors",
        active ? "bg-[color-mix(in_srgb,var(--midground)_10%,transparent)]" : "active:bg-[color-mix(in_srgb,var(--midground)_6%,transparent)]",
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-midground" />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-mondwest text-display text-[0.84rem] tracking-wide text-midground">
          {option.label}
        </span>
        <span className="font-mono-ui text-[0.68rem] text-text-tertiary">
          {option.id} · {option.provider}
        </span>
      </span>
      <CheckIcon width={16} height={16} className={cn("shrink-0 text-midground transition-opacity", active ? "opacity-100" : "opacity-0")} />
    </button>
  );
}

function UsageFooter() {
  const { contextUsage } = useWorkspace();
  const pct = contextUsage
    ? Math.min(100, Math.round((contextUsage.used / contextUsage.total) * 100))
    : null;

  if (!pct) return null;

  return (
    <div className="mt-3 border-t border-border px-1 pt-2 pb-1">
      <div className="flex items-center justify-between">
        <span className="font-mono-ui text-[0.55rem] uppercase tracking-wider text-text-tertiary">
          context window
        </span>
        <span className="font-mono-ui tabular text-[0.6rem] text-text-disabled">
          {contextUsage ? `${contextUsage.used.toLocaleString()} / ${contextUsage.total.toLocaleString()}` : ""}
        </span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--midground)_14%,transparent)]">
        <span
          className="block h-full rounded-full bg-midground transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-0.5 flex justify-between">
        <span className="font-mono-ui tabular text-[0.55rem] text-text-tertiary">{pct}% full</span>
        {pct > 70 && (
          <span className="font-mono-ui text-[0.55rem] text-[color:var(--color-warning)]">consider compressing</span>
        )}
      </div>
    </div>
  );
}
