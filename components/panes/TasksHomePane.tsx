"use client";

import { useCallback, useMemo, useRef, useState, type SVGProps } from "react";
import { motion, useMotionValue, useTransform } from "framer-motion";
import { usePolling } from "@/components/usePolling";
import { resolveLane, NODE_META, type FleetAgent, type AgentLane } from "@/lib/fleet/types";
import { haptic } from "@/components/shell/haptics";
import { PullToRefresh } from "./parts";
import { cn } from "@/lib/utils";

/**
 * Tasks-first mobile home (dark-mode "Doit" model). The landing surface is a
 * feed of live agent runs, not a chat box: a multi-modal entry row up top, a
 * Suggested strip, an All Activity / Categories toggle, then the live task
 * cards sourced from /api/fleet/agents. Everything funnels into the Chat tab —
 * the agent is the spine. Cross-tab nav + composer prefill ride the existing
 * window CustomEvent bus (same pattern as `lo-compress`), so the shell store
 * and the swipe pager are untouched.
 */

function navToChat(prefill?: string, fresh?: boolean) {
  window.dispatchEvent(new CustomEvent("lo-nav", { detail: { tab: "chat" } }));
  // "Start a task" opens a brand-new session instead of resuming the active
  // general thread — let the tab switch settle, then fire the reset.
  if (fresh) {
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("lo-new-session"));
    }, 60);
  }
  if (prefill) {
    // Let the tab switch mount the composer, then hand it the text.
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("lo-prefill", { detail: { text: prefill } }));
    }, 60);
  }
}

/** Tap a task → open the real transcript reader. Tasks are keyed by Hermes
 * session id, but most task/session rows do NOT have a resumable Chat thread.
 * `lo-open-session` dead-ends there, so use the full read-only session surface. */
function openTaskSession(sessionId: string, title: string) {
  window.dispatchEvent(
    new CustomEvent("lo-read-session", {
      detail: { profile: "default", id: sessionId, title },
    }),
  );
}

/* ---- lane vocabulary (dark tokens) ---- */
const LANE_META: Record<AgentLane, { label: string; tone: string }> = {
  spawned: { label: "Queued", tone: "var(--text-tertiary)" },
  working: { label: "Working", tone: "var(--color-success, #2dd4bf)" },
  verifying: { label: "Verifying", tone: "var(--color-warning, #f5b54a)" },
  done: { label: "Done", tone: "var(--midground)" },
  blocked: { label: "Blocked", tone: "var(--color-destructive, #f87171)" },
};

function relTime(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/* ---- entry-row icons (local, 24-viewBox stroke = currentColor) ---- */
function CameraIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  );
}
function PhotoIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 16l-5-5L5 20" />
    </svg>
  );
}
function ComposeIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

type ViewMode = "activity" | "categories";

/* ---- Branded home header: Nous mark + greeting + live status ---- */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Burning late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function HomeHeader({ working, total }: { working: number; total: number }) {
  const status =
    working > 0
      ? `${working} agent${working > 1 ? "s" : ""} working`
      : total > 0
        ? `${total} session${total > 1 ? "s" : ""} idle`
        : "fleet quiet";
  return (
    <header className="flex items-center gap-2.5 pt-0.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/nous-icon.svg"
        alt="Nous"
        width={34}
        height={34}
        className="shrink-0 rounded-[var(--radius-md)]"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-mondwest text-display text-[0.95rem] leading-tight tracking-wide text-midground">
          {greeting()}
        </span>
        <span className="flex items-center gap-1.5 font-mono-ui text-[0.6rem] text-text-tertiary">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: working > 0 ? "var(--color-success, #2dd4bf)" : "var(--text-disabled)",
              boxShadow: working > 0 ? "0 0 6px var(--color-success, #2dd4bf)" : undefined,
            }}
          />
          {status}
        </span>
      </div>
    </header>
  );
}

export function TasksHomePane() {
  const { data: rawAgents, loading, reload } = usePolling<FleetAgent[]>("/api/fleet/agents", 5_000);
  const [view, setView] = useState<ViewMode>("activity");
  const fileRef = useRef<HTMLInputElement>(null);
  // Optimistically hide swiped-away (archived) cards; the 5s poll would
  // otherwise re-show them for one cycle before the archive flag lands.
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const archive = useCallback(async (id: string) => {
    setHidden((prev) => new Set(prev).add(id));
    try {
      await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
    } catch {
      // Failed — un-hide so the card returns rather than vanishing silently.
      setHidden((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const agents = useMemo(
    () =>
      (rawAgents ?? [])
        .filter((a) => !hidden.has(a.id))
        .map(resolveLane)
        .sort((a, b) => b.lastSignal - a.lastSignal),
    [rawAgents, hidden],
  );

  const grouped = useMemo(() => {
    const g: Record<AgentLane, FleetAgent[]> = {
      working: [], verifying: [], spawned: [], blocked: [], done: [],
    };
    for (const a of agents) g[a.lane].push(a);
    return g;
  }, [agents]);

  const onPickImage = useCallback((f: File | null) => {
    if (!f) return;
    navToChat(`Re: ${f.name} (image attached) — `);
  }, []);

  const onCamera = useCallback(() => {
    haptic(8);
    fileRef.current?.setAttribute("capture", "environment");
    fileRef.current?.click();
  }, []);

  const onPhoto = useCallback(() => {
    haptic(8);
    fileRef.current?.removeAttribute("capture");
    fileRef.current?.click();
  }, []);

  const onCompose = useCallback(() => {
    haptic(8);
    navToChat();
  }, []);

  const entryButtons = useMemo(
    () => [
      { key: "camera", Icon: CameraIcon, label: "Camera", on: onCamera, active: false },
      { key: "photo", Icon: PhotoIcon, label: "Photo", on: onPhoto, active: false },
      { key: "compose", Icon: ComposeIcon, label: "Compose", on: onCompose, active: false },
    ],
    [onCamera, onPhoto, onCompose],
  );

  return (
    <PullToRefresh onRefresh={reload}>
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col gap-4 px-3 pt-1"
    >
      {/* ---- branded header: Nous mark + greeting + live status ---- */}
      <HomeHeader working={grouped.working.length} total={agents.length} />

      {/* ---- multi-modal entry row ---- */}
      <div className="rounded-[calc(var(--theme-radius)+8px)] border border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)] p-3">
        <button
          type="button"
          onClick={() => { haptic(8); navToChat(undefined, true); }}
          className="flex w-full items-center gap-2 rounded-full border border-border bg-[color-mix(in_srgb,var(--midground)_5%,transparent)] px-3.5 py-2.5 text-left text-text-tertiary transition-colors active:bg-[color-mix(in_srgb,var(--midground)_10%,transparent)]"
        >
          <ComposeIcon className="shrink-0 text-text-tertiary" />
          <span className="text-[0.86rem]">Start a task...</span>
        </button>

        <div className="mt-2.5 flex items-center gap-2">
          {entryButtons.map(({ key, Icon, label, on, active }) => (
            <button
              key={key}
              type="button"
              onClick={on}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 rounded-[var(--radius-md)] border border-border py-2 transition-colors active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]",
                active ? "text-[color:var(--color-destructive,#f87171)] border-[color:var(--color-destructive,#f87171)]" : "text-text-secondary",
              )}
            >
              <Icon />
              <span className="font-mono-ui text-[0.6rem] tracking-wide">{active ? "listening" : label}</span>
            </button>
          ))}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => onPickImage(e.target.files?.[0] ?? null)}
        />
      </div>

      {/* ---- Tasks header + view toggle ---- */}
      <section>
        <header className="mb-2.5 flex items-center justify-between">
          <h3 className="font-mondwest text-display text-[0.7rem] tracking-[0.14em] text-text-secondary">
            Tasks
          </h3>
          <div className="flex items-center gap-3">
            {(["activity", "categories"] as ViewMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { haptic(4); setView(m); }}
                className={cn(
                  "relative pb-0.5 font-mono-ui text-[0.62rem] tracking-wide transition-colors",
                  view === m ? "text-midground" : "text-text-disabled",
                )}
              >
                {m === "activity" ? "All Activity" : "Categories"}
                {view === m && (
                  <span className="absolute inset-x-0 -bottom-0.5 h-[1.5px] rounded-full bg-midground" />
                )}
              </button>
            ))}
          </div>
        </header>

        {loading && !rawAgents ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[72px] animate-pulse rounded-[var(--radius-md)] border border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)]" />
            ))}
          </div>
        ) : agents.length === 0 ? (
          <EmptyTasks />
        ) : view === "activity" ? (
          <div className="flex flex-col gap-2">
            {agents.map((a) => <TaskCard key={a.id} agent={a} onArchive={() => archive(a.id)} />)}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {(["working", "verifying", "spawned", "blocked", "done"] as AgentLane[])
              .filter((lane) => grouped[lane].length > 0)
              .map((lane) => (
                <div key={lane}>
                  <div className="mb-1.5 flex items-center gap-2 px-0.5">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: LANE_META[lane].tone }} />
                    <span className="font-mono-ui text-[0.62rem] uppercase tracking-wide text-text-tertiary">
                      {LANE_META[lane].label}
                    </span>
                    <span className="font-mono-ui text-[0.58rem] text-text-disabled">{grouped[lane].length}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {grouped[lane].map((a) => <TaskCard key={a.id} agent={a} onArchive={() => archive(a.id)} />)}
                  </div>
                </div>
              ))}
          </div>
        )}
      </section>
    </motion.div>
    </PullToRefresh>
  );
}

const SWIPE_COMMIT = 78; // px past which a swipe archives the card

function TaskCard({ agent, onArchive }: { agent: FleetAgent; onArchive: () => void }) {
  const lane = LANE_META[agent.lane];
  const node = NODE_META[agent.node];
  // Hierarchy: a live "working" card is the hero (tinted border + glow + larger
  // title); idle/done cards recede so the eye lands on what is actually active.
  const isLive = agent.lane === "working" || agent.lane === "verifying";
  const isDim = agent.lane === "done" || agent.lane === "spawned";
  // Avoid the flat "subagent session" repetition: prefer a real objective, fall
  // back to the live signal line before the generic title.
  const objective =
    agent.objective && !/^subagent session$/i.test(agent.objective)
      ? agent.objective
      : agent.signal || agent.objective || "session";

  // Swipe-left to archive (reversible — the row's `archived` flag just drops it
  // from the board). Axis-locked to x so the feed still scrolls vertically.
  const x = useMotionValue(0);
  const draggedRef = useRef(false);
  const archiveOpacity = useTransform(x, [-SWIPE_COMMIT, -8, 0], [1, 0.4, 0]);

  return (
    <motion.div layout className="relative">
      {/* archive rail behind the card */}
      <div className="pointer-events-none absolute inset-0 flex items-stretch justify-end overflow-hidden rounded-[var(--radius-md)]">
        <motion.div
          style={{ opacity: archiveOpacity }}
          className="flex w-1/2 items-center justify-end gap-1.5 rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--color-destructive,#f87171)_22%,transparent)] pr-3 font-mono-ui text-[0.62rem] uppercase tracking-wider text-[color:var(--color-destructive,#f87171)]"
        >
          clear <ClearGlyph />
        </motion.div>
      </div>

      <motion.button
        type="button"
        drag="x"
        style={{ x }}
        dragDirectionLock
        dragConstraints={{ left: -140, right: 0 }}
        dragElastic={0.12}
        onDragStart={() => {
          draggedRef.current = false;
        }}
        onDrag={(_, info) => {
          if (Math.abs(info.offset.x) > 6) draggedRef.current = true;
        }}
        onDragEnd={(_, info) => {
          if (info.offset.x <= -SWIPE_COMMIT) {
            haptic(12);
            onArchive();
          }
        }}
        onClick={() => {
          if (draggedRef.current) return; // it was a swipe, not a tap
          haptic(8);
          openTaskSession(agent.id, objective);
        }}
        className={cn(
          "relative flex w-full touch-pan-y flex-col gap-2 rounded-[var(--radius-md)] border p-3 text-left transition-colors",
          isLive
            ? "border-[color-mix(in_srgb,var(--color-success,#2dd4bf)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-success,#2dd4bf)_7%,transparent)] active:bg-[color-mix(in_srgb,var(--color-success,#2dd4bf)_12%,transparent)]"
            : "border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)] active:bg-[color-mix(in_srgb,var(--midground)_9%,transparent)]",
          isDim && "opacity-65",
        )}
      >
        <div className="flex items-start gap-2">
          <span
            className={cn("mt-1 shrink-0 rounded-full", isLive ? "h-2.5 w-2.5" : "h-2 w-2")}
            style={{
              background: lane.tone,
              boxShadow: agent.lane === "working" ? `0 0 8px ${lane.tone}` : undefined,
            }}
          />
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-text-primary",
              isLive ? "text-[0.9rem] font-semibold" : "text-[0.82rem] font-medium",
            )}
          >
            {objective}
          </span>
        </div>
        <div className="flex items-center gap-2 pl-4">
          <span
            className="rounded-full px-1.5 py-0.5 font-mono-ui text-[0.56rem] tracking-wide"
            style={{ color: lane.tone, background: `color-mix(in srgb, ${lane.tone} 12%, transparent)` }}
          >
            {lane.label}
          </span>
          <span
            className="font-mono-ui text-[0.56rem] tracking-wide"
            style={{ color: node.color }}
          >
            {node.label}
          </span>
          <span className="truncate font-mono-ui text-[0.56rem] text-text-tertiary">{agent.signal}</span>
          <span className="ml-auto shrink-0 font-mono-ui text-[0.56rem] text-text-disabled">
            {relTime(agent.lastSignal)}
          </span>
        </div>
      </motion.button>
    </motion.div>
  );
}

function ClearGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
    </svg>
  );
}

function EmptyTasks() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius-md)] border border-dashed border-border px-4 py-8 text-center">
      <span className="text-[0.82rem] text-text-secondary">No active tasks</span>
      <span className="max-w-[240px] text-[0.68rem] leading-snug text-text-tertiary">
        Start one from the bar above. Live agent runs from your fleet show up here as they spawn.
      </span>
    </div>
  );
}
