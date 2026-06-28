"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useWorkspace,
  type AgentStatus,
  type ModelOption,
  repoLetters,
} from "./workspace-context";
import type { AgentProfile } from "@/lib/workspace-types";
import { Sheet } from "./Sheet";
import { RepoAvatarBadge } from "./repo-avatar";
import { ChevronUpDownIcon, CheckIcon, BranchIcon, CompressIcon } from "./icons";
import { haptic } from "./haptics";
import { usePush } from "./usePush";
import { cn } from "@/lib/utils";
import { profileTint } from "@/lib/profile-color";
import { PetSprite, usePet, type Pet, type PetState } from "@/lib/pet";
import { usePolling } from "@/components/usePolling";
import type { FleetAgent } from "@/lib/fleet/types";
import { AnimatePresence, motion } from "framer-motion";

/** How long to show a notification before auto-dismiss. */
const NOTIF_DURATION = 6000;

/** Bucket models by provider for the picker, preserving the route's order
 *  (default provider leads). Falls back to the raw provider id when the human
 *  label is absent. */
function groupModels(models: ModelOption[]): [string, ModelOption[]][] {
  const order: string[] = [];
  const byLabel = new Map<string, ModelOption[]>();
  for (const m of models) {
    const label = m.providerLabel ?? m.provider;
    if (!byLabel.has(label)) {
      byLabel.set(label, []);
      order.push(label);
    }
    byLabel.get(label)!.push(m);
  }
  return order.map((label) => [label, byLabel.get(label)!]);
}

/**
 * Bottom context bar — always shows model name + context meter + compress.
 * Collapsable to show active sessions, notification badges, and profile.
 * All the info you need to know when to compress.
 */
export function ContextBar() {
  const {
    active, model, contextUsage, status,
    profiles, activeProfile, setActiveProfile,
    notifications, dismissNotification, compress, repoAvatars,
    turnStartedAt,
  } = useWorkspace();

  const [sheet, setSheet] = useState<"model" | "profile" | "effort" | null>(null);
  const { pet, resolved: petResolved } = usePet();
  const [petBeat, setPetBeat] = useState<PetState | null>(null);

  // Chat streams fire short activity beats so the mobile/PWA shell can use the
  // full petdex atlas (run/review/done/error), not just a faster idle loop.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onPetState = (event: Event) => {
      const detail = (event as CustomEvent<{ state?: PetState; ms?: number }>).detail;
      if (!detail?.state) return;
      setPetBeat(detail.state);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setPetBeat(null), detail.ms ?? 1400);
    };
    window.addEventListener("lo-pet-state", onPetState as EventListener);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("lo-pet-state", onPetState as EventListener);
    };
  }, []);

  // Gateway turn fallback — `turnStartedAt` only fires for turns driven through
  // the app's OWN chat box (useChat). When you drive Hermes from Telegram/CLI
  // and watch the app as a dashboard, that signal never fires. Poll the gateway
  // busy flag (active_agents > 0, true for every entry point) and synthesize a
  // start on the false→true edge, so the timer + glow light up for external
  // turns too. Honest by construction: we clock from when the app first OBSERVES
  // the turn, never a fabricated start time.
  const gatewayTurn = usePolling<{ busy: boolean }>("/api/gateway/turn", 2000);
  const gatewayBusy = gatewayTurn.data?.busy === true;
  const [gatewayTurnStart, setGatewayTurnStart] = useState<number | null>(null);
  useEffect(() => {
    setGatewayTurnStart((prev) => {
      if (gatewayBusy) return prev ?? Date.now(); // false→true edge anchors start
      return null; // turn ended → clear
    });
  }, [gatewayBusy]);

  // Effective turn start: an in-app turn wins (exact start), else the
  // gateway-observed start. Drives the timer, glow, and pet run pose alike.
  const effectiveTurnStart = turnStartedAt ?? gatewayTurnStart;

  // Live turn timer — ticks m:ss while a turn is running so you can SEE the
  // agent is thinking. Cleared (null) when idle. 1s cadence is enough; we round
  // down so it reads like a stopwatch.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (effectiveTurnStart == null) return;
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [effectiveTurnStart]);
  const elapsed =
    effectiveTurnStart != null ? Math.max(0, Math.floor((nowMs - effectiveTurnStart) / 1000)) : null;
  const elapsedLabel =
    elapsed != null ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}` : null;


  // Live active-agent count — same source + lanes as the desktop status bar
  // (working + spawned). Surfaced as a tappable "# N" badge that jumps to the
  // Tasks board so the active sessions are one tap away.
  const agents = usePolling<FleetAgent[]>("/api/fleet/agents", 10_000);
  const fleetSessions = (agents.data ?? []).filter(
    (a) => a.lane === "working" || a.lane === "spawned",
  ).length;
  // A live local turn IS an active session. The fleet poll (python+sqlite, 10s
  // cadence) returns data:[] on its own timeout and drops long turns past the
  // 120s message-freshness window — both read "0 sessions" while this turn's
  // timer is visibly running. Floor at 1 whenever a turn is in flight.
  const sessionCount = Math.max(fleetSessions, effectiveTurnStart != null ? 1 : 0);
  const goSessions = useCallback(() => {
    haptic(8);
    window.dispatchEvent(new CustomEvent("lo-nav", { detail: { tab: "sessions" } }));
  }, []);

  // Two fixed rows, always shown (no collapse). Panes pad by --app-context-h;
  // pin it to the full two-row height.
  useEffect(() => {
    document.documentElement.style.setProperty("--app-context-h", "66px");
  }, []);

  // Current global reasoning effort — surfaced as a tappable chip in the bar so
  // it's one tap (not buried in the sheet). Re-read when the sheet closes, since
  // the sheet's EffortSection may have just changed it.
  const [effort, setEffort] = useState<string | null>(null);
  const loadEffort = useCallback(() => {
    fetch("/api/effort", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ effort?: string }>)
      .then((j) => { if (j.effort) setEffort(j.effort); })
      .catch(() => {});
  }, []);
  useEffect(() => { loadEffort(); }, [loadEffort]);

  const pct = contextUsage
    ? Math.min(100, Math.round((contextUsage.used / contextUsage.total) * 100))
    : null;
  const petState: PetState = petBeat ?? (effectiveTurnStart != null ? "run" : "idle");

  return (
    <>
      {/* Notification toasts — float above the bar */}
      <div className="fixed bottom-[calc(40px+env(safe-area-inset-bottom)+8px)] inset-x-4 z-50 flex flex-col gap-1.5 pointer-events-none">
        <AnimatePresence>
          {notifications.map((n) => (
            <NotifToast key={n.id} n={n} pet={pet} onDismiss={() => dismissNotification(n.id)} />
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
        {/* ---- Top row: full repo/branch tree name + model + effort ---- */}
        <div className="flex h-10 items-center gap-2 px-3">
          <StatusDot status={status} />

          {/* Active workspace / repo — gets the full row width so the whole
              tree name is readable (meter moved to the row below). */}
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

          {/* Model name — tap to switch the per-turn model */}
          <button
            type="button"
            onClick={() => { haptic(8); setSheet("model"); }}
            aria-label={`Model: ${model.label}. Tap to switch model.`}
            className="flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-1 text-[0.7rem] text-midground transition-colors active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]"
          >
            <span className="font-mondwest text-display tracking-wide">{model.label}</span>
            <ChevronUpDownIcon width={12} height={12} className="text-text-tertiary" />
          </button>

          {/* Effort chip — current reasoning effort; tap opens the sheet's
              effort selector. One tap instead of digging into the sheet. */}
          {effort && (
            <button
              type="button"
              onClick={() => { haptic(8); setSheet("effort"); }}
              aria-label={`Reasoning effort: ${effort}. Tap to change.`}
              title={`Reasoning effort: ${effort}`}
              className="flex shrink-0 items-center rounded-full border border-border px-1.5 py-1 font-mono-ui text-[0.55rem] uppercase tracking-wider text-text-tertiary transition-colors active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]"
            >
              {effort}
            </button>
          )}
        </div>

        {/* ---- Second row: profile · context meter · sessions ---- */}
        <div className="border-t border-border/50">
          <div className="flex items-center gap-2 px-3 py-1.5">
            {/* Profile — tap to switch the brain that runs your turns */}
            <button
              type="button"
              onClick={() => { haptic(8); setSheet("profile"); }}
              aria-label={`Profile: ${activeProfile?.label ?? "default"}. Tap to switch.`}
              className="flex shrink-0 items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 transition-colors active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]"
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  background: profileTint(activeProfile?.id ?? "default"),
                  boxShadow: `0 0 5px ${profileTint(activeProfile?.id ?? "default")}`,
                }}
              />
              <span className="font-mono-ui text-[0.6rem] uppercase tracking-wider text-text-tertiary">
                profile
              </span>
              <span className="font-mono-ui text-[0.66rem] text-midground">
                {activeProfile?.label ?? "default"}
              </span>
              {elapsedLabel && (
                <span
                  className="flex items-center gap-1 font-mono-ui tabular text-[0.62rem] text-[color:var(--color-success)]"
                  title="agent is thinking"
                >
                  <motion.span
                    aria-hidden
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
                    className="h-1 w-1 rounded-full"
                    style={{ background: "var(--color-success)" }}
                  />
                  {elapsedLabel}
                </span>
              )}
              <ChevronUpDownIcon width={10} height={10} className="text-text-tertiary" />
            </button>

            {/* Pet marker — the sprite sits next to the profile and is ALWAYS
                shown (quiet when idle). The running timer + green glow appear
                ONLY while an agent turn is in flight (effectiveTurnStart != null
                — an in-app chat turn OR a gateway turn from Telegram/CLI/cron):
                the label counts the live agent runtime (`elapsedLabel`) and the
                sprite gets its success drop-shadow. Idle = sprite only, no
                clock, no glow. Hold the marker blank until the sprite resolves
                so we never flash a bare dot before it loads in. */}
            <span
              className="flex shrink-0 items-center gap-1.5 font-mono-ui tabular text-[0.62rem] text-text-tertiary"
              title={
                effectiveTurnStart != null
                  ? pet.enabled ? `${pet.label} · agent working` : "agent working"
                  : pet.enabled ? pet.label : "idle"
              }
            >
              {petResolved ? (
                <PetSprite
                  pet={pet}
                  active={effectiveTurnStart != null}
                  state={petState}
                  className={cn("h-4 w-4 shrink-0", pet.enabled && "scale-[1.35]")}
                  style={
                    effectiveTurnStart != null
                      ? { filter: "drop-shadow(0 0 4px color-mix(in srgb, var(--color-success) 55%, transparent))" }
                      : undefined
                  }
                />
              ) : (
                <span aria-hidden className="h-4 w-4 shrink-0" />
              )}
              {elapsedLabel && (
                <span className="text-[color:var(--color-success)]">{elapsedLabel}</span>
              )}
            </span>

            <div className="min-w-0 flex-1" />

            {/* Context meter + compress — dropped below so the tree name has the
                full top row. */}
            {pct !== null && (
              <>
                <button
                  type="button"
                  onClick={compress}
                  title="Compress context (Ctrl+Shift+C)"
                  className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[0.65rem] text-text-tertiary transition-colors hover:text-midground active:scale-90"
                >
                  <CompressIcon width={13} height={13} />
                </button>
                <ContextMeter pct={pct} />
              </>
            )}

            {/* Sessions — arrows + live count; tap to open the Sessions list. */}
            <button
              type="button"
              onClick={goSessions}
              aria-label={`${sessionCount} active sessions. Tap to view.`}
              title={`${sessionCount} active sessions`}
              className="flex shrink-0 items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 font-mono-ui text-[0.62rem] text-text-tertiary transition-colors active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]"
            >
              <ChevronUpDownIcon width={11} height={11} className="text-text-tertiary" />
              <span className="tabular text-midground">{sessionCount}</span>
              <span>{sessionCount === 1 ? "session" : "sessions"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Model / Profile sheet — left chip focuses profiles, right chip focuses models */}
      <ProfileSheet
        open={sheet !== null}
        focus={sheet ?? "profile"}
        onClose={() => { setSheet(null); loadEffort(); }}
      />
    </>
  );
}

function NotifToast({
  n,
  pet,
  onDismiss,
}: {
  n: { id: string; repo: string; branch: string; type: string; ts: number };
  pet: Pet;
  onDismiss: () => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(onDismiss, NOTIF_DURATION);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [onDismiss]);

  const icon = n.type === "started" ? "●" : n.type === "completed" ? "✓" : "✕";
  const label = n.type === "started" ? "session started" : n.type === "completed" ? "done" : "error";
  const toastPetState: PetState = n.type === "completed" ? "jump" : n.type === "error" ? "failed" : "run";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="pointer-events-auto mx-auto flex max-w-sm items-center gap-2 rounded-lg border border-border bg-[color-mix(in_srgb,var(--background-base)_88%,transparent)] px-3 py-2 shadow-lg backdrop-blur"
    >
      {pet.enabled ? (
        <PetSprite pet={pet} state={toastPetState} active={n.type === "started"} className="h-7 w-7 shrink-0 scale-125" />
      ) : (
        <span className={cn(
          "grid h-5 w-5 shrink-0 place-items-center rounded-full text-[0.62rem] font-bold",
          n.type === "started" ? "bg-[color:var(--color-info)] text-background-base" :
          n.type === "completed" ? "bg-[color:var(--color-success)] text-background-base" : "bg-[color:var(--color-destructive)] text-background-base"
        )}>{icon}</span>
      )}
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
  focus,
  onClose,
}: {
  open: boolean;
  focus: "model" | "profile" | "effort";
  onClose: () => void;
}) {
  const { models, model, setModel, profiles, activeProfile, setActiveProfile } = useWorkspace();
  const push = usePush();

  const ProfilesSection = (
    <div className="px-1 pb-2">
      <span className="mb-1 block text-center font-mono-ui text-[0.55rem] uppercase tracking-wider text-text-tertiary">
        Profiles · the brain that runs your turns
      </span>
      <div className="flex flex-col gap-0.5">
        {profiles.map((p) => (
          <Fragment key={p.id}>
            <ProfileRow
              profile={p}
              active={p.id === activeProfile?.id}
              onSelect={() => {
                haptic(10);
                setActiveProfile(p.id);
              }}
            />
            {p.id === activeProfile?.id && <ProfileEffort profile={p} />}
          </Fragment>
        ))}
      </div>
    </div>
  );

  const ModelsSection = (
    <div className="px-1 pb-2">
      <span className="mb-1 block font-mono-ui text-[0.55rem] uppercase tracking-wider text-text-tertiary">
        Models · per-turn override
      </span>
      <div className="flex flex-col gap-2">
        {groupModels(models).map(([providerLabel, group]) => (
          <div key={providerLabel} className="flex flex-col gap-0.5">
            <span className="px-3 pb-0.5 pt-1 font-mono-ui text-[0.66rem] uppercase tracking-[0.14em] text-text-tertiary">
              {providerLabel}
            </span>
            {group.map((m) => (
              <ModelRow
                key={`${m.provider}:${m.id}`}
                option={m}
                active={m.id === model.id}
                onSelect={() => {
                  haptic(10);
                  setModel(m.id);
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );

  // Effort lives PER-PROFILE (inline under the active profile row), not as a
  // separate global block — the old global EffortSection wrote the same
  // config.yaml agent.reasoning_effort key as the default profile's chips, so
  // it was a duplicate control. Tapping the effort OR profile chip now leads
  // with the profiles section (active profile's effort chips show inline).
  const sections =
    focus === "model"
      ? [ModelsSection, ProfilesSection]
      : [ProfilesSection];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={focus === "model" ? "Model" : focus === "effort" ? "Effort" : "Profile"}
      className="max-h-[90dvh]"
    >
      {/* Notifications toggle — only when the platform supports web push. */}
      {push.supported && (
        <div className="mb-2 flex items-center justify-between rounded-[var(--radius-md)] border border-border px-3 py-2">
          <span className="flex flex-col">
            <span className="text-[0.8rem] text-text-primary">Push notifications</span>
            <span className="font-mono-ui text-[0.6rem] text-text-tertiary">
              {push.enabled ? "on · turns ping this device" : "off"}
            </span>
          </span>
          <button
            type="button"
            disabled={push.enabled}
            onClick={() => {
              haptic(10);
              void push.enable();
            }}
            className={cn(
              "shrink-0 rounded-full px-3 py-1 text-[0.72rem] transition-colors",
              push.enabled
                ? "bg-[color-mix(in_srgb,var(--color-success)_20%,transparent)] text-[color:var(--color-success)]"
                : "bg-midground text-background-base active:scale-95",
            )}
          >
            {push.enabled ? "Enabled" : push.permission === "denied" ? "Blocked" : "Enable"}
          </button>
        </div>
      )}

      {sections.map((section, i) => (
        <div key={i} className={i > 0 ? "border-t border-border pt-2" : undefined}>
          {section}
        </div>
      ))}

      {/* Usage info */}
      <UsageFooter />
    </Sheet>
  );
}

const EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh"] as const;
type EffortLevel = (typeof EFFORT_LEVELS)[number];

function EffortSection() {
  const [effort, setEffort] = useState<EffortLevel | null>(null);
  const [saving, setSaving] = useState<EffortLevel | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/effort", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ effort?: string }>)
      .then((j) => {
        if (live && j.effort && (EFFORT_LEVELS as readonly string[]).includes(j.effort)) {
          setEffort(j.effort as EffortLevel);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const select = async (next: EffortLevel) => {
    if (next === effort || saving) return;
    haptic(10);
    setSaving(next);
    try {
      const res = await fetch("/api/effort", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ effort: next }),
      });
      if (res.ok) setEffort(next);
    } catch {
      /* leave current */
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="px-1 pb-2">
      <span className="mb-1.5 block font-mono-ui text-[0.55rem] uppercase tracking-wider text-text-tertiary">
        Reasoning effort · how hard the agent thinks
      </span>
      <div className="grid grid-cols-5 gap-1">
        {EFFORT_LEVELS.map((lvl) => {
          const on = lvl === effort;
          const busy = saving === lvl;
          return (
            <button
              key={lvl}
              type="button"
              onClick={() => select(lvl)}
              aria-pressed={on}
              className={cn(
                "rounded-[var(--radius-md)] border px-1 py-2.5 text-center font-mono-ui text-[0.66rem] transition-colors",
                on
                  ? "border-transparent bg-midground text-background-base"
                  : "border-border text-text-secondary active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]",
                busy && "opacity-60",
              )}
            >
              {lvl}
            </button>
          );
        })}
      </div>
      <span className="mt-1 block font-mono-ui text-[0.55rem] text-text-disabled">
        applies to the next turn (brains respawn)
      </span>
    </div>
  );
}

/** Per-profile reasoning effort. Writes the profile's own
 *  agent.reasoning_effort via POST /api/profiles (the billing-safe agent block,
 *  never the model block). Seeds from the profile's live config value. */
function ProfileEffort({ profile }: { profile: AgentProfile }) {
  const [effort, setEffort] = useState<string>(profile.effort ?? "");
  const [saving, setSaving] = useState<string | null>(null);

  const select = async (next: string) => {
    if (next === effort || saving) return;
    haptic(10);
    setSaving(next || "auto");
    try {
      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile: profile.id, effort: next }),
      });
      if (res.ok) setEffort(next);
    } catch {
      /* leave current */
    } finally {
      setSaving(null);
    }
  };

  // "auto" = clear the override (config default). The 5 explicit levels follow.
  // Short labels so all 6 chips fit grid-cols-6 in max-w-sm without colliding.
  const SHORT: Record<string, string> = {
    minimal: "min",
    low: "low",
    medium: "med",
    high: "high",
    xhigh: "xhi",
  };
  const CHIPS: { value: string; label: string }[] = [
    { value: "", label: "auto" },
    ...EFFORT_LEVELS.map((lvl) => ({ value: lvl, label: SHORT[lvl] ?? lvl })),
  ];

  return (
    <div className="mx-auto mb-1 w-full max-w-sm px-3 pb-1">
      <span className="mb-1 block text-center font-mono-ui text-[0.5rem] uppercase tracking-wider text-text-tertiary">
        effort · {profile.label}
      </span>
      <div className="grid grid-cols-6 gap-1">
        {CHIPS.map((chip) => {
          const on = chip.value === effort;
          const busy = saving === (chip.value || "auto");
          return (
            <button
              key={chip.value || "auto"}
              type="button"
              onClick={() => select(chip.value)}
              aria-pressed={on}
              className={cn(
                "rounded-[var(--radius-md)] border px-1 py-2 text-center font-mono-ui text-[0.58rem] transition-colors",
                on
                  ? "border-transparent bg-midground text-background-base"
                  : "border-border text-text-secondary active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]",
                busy && "opacity-60",
              )}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
    </div>
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
      <span
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full font-mono-ui text-[0.6rem] font-bold"
        style={{
          color: profileTint(profile.id),
          background: `color-mix(in srgb, ${profileTint(profile.id)} 16%, transparent)`,
          border: `1px solid color-mix(in srgb, ${profileTint(profile.id)} 30%, transparent)`,
        }}
      >
        {profile.label.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase()}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-mondwest text-display text-[0.84rem] tracking-wide text-midground">
          {profile.label}
        </span>
        <span className="font-mono-ui text-[0.62rem] uppercase tracking-wider text-text-tertiary">
          {profile.provider}
        </span>
      </span>
      {/* Model — right-aligned, the consistent right-hand column across rows. */}
      <span className="shrink-0 text-right font-mono-ui text-[0.68rem] text-text-secondary">
        {profile.model}
      </span>
      {profile.provider !== "anthropic" && (
        <span className="shrink-0 rounded-full border border-[color-mix(in_srgb,var(--color-warning)_50%,transparent)] px-1.5 py-0.5 font-mono-ui text-[0.5rem] uppercase tracking-wider text-[color:var(--color-warning)]">
          metered
        </span>
      )}
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
        <span className="font-mono-ui text-[0.68rem] text-text-tertiary truncate">
          {option.id}
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
        <span className="font-mono-ui text-[0.62rem] uppercase tracking-wider text-text-tertiary">
          context window
        </span>
        <span className="font-mono-ui tabular text-[0.64rem] text-text-tertiary">
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
        <span className="font-mono-ui tabular text-[0.62rem] text-text-tertiary">{pct}% full</span>
        {pct > 70 && (
          <span className="font-mono-ui text-[0.62rem] text-[color:var(--color-warning)]">consider compressing</span>
        )}
      </div>
    </div>
  );
}
