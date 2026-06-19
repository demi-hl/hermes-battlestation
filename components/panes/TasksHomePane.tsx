"use client";

import { useCallback, useMemo, useRef, useState, type SVGProps } from "react";
import { motion } from "framer-motion";
import { usePolling } from "@/components/usePolling";
import { resolveLane, NODE_META, type FleetAgent, type AgentLane } from "@/lib/fleet/types";
import { haptic } from "@/components/shell/haptics";
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

function navToChat(prefill?: string) {
  window.dispatchEvent(new CustomEvent("lo-nav", { detail: { tab: "chat" } }));
  if (prefill) {
    // Let the tab switch mount the composer, then hand it the text.
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("lo-prefill", { detail: { text: prefill } }));
    }, 60);
  }
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
function MicIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}
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

/* ---- Suggested quick-starts (prefill chat; not fabricated runs) ---- */
const SUGGESTED: { title: string; prompt: string }[] = [
  { title: "Morning digest", prompt: "Give me a tight digest of overnight activity across my repos and the fleet." },
  { title: "Fleet status", prompt: "What is every box in the fleet doing right now? Flag anything stale or degraded." },
  { title: "Open PRs", prompt: "List my open PRs and what each is blocked on." },
  { title: "Draft a post", prompt: "Draft an X post in my voice about what shipped today." },
];

type ViewMode = "activity" | "categories";

export function TasksHomePane() {
  const { data: rawAgents, loading } = usePolling<FleetAgent[]>("/api/fleet/agents", 5_000);
  const [view, setView] = useState<ViewMode>("activity");
  const fileRef = useRef<HTMLInputElement>(null);
  const [listening, setListening] = useState(false);

  const agents = useMemo(
    () => (rawAgents ?? []).map(resolveLane).sort((a, b) => b.lastSignal - a.lastSignal),
    [rawAgents],
  );

  const grouped = useMemo(() => {
    const g: Record<AgentLane, FleetAgent[]> = {
      working: [], verifying: [], spawned: [], blocked: [], done: [],
    };
    for (const a of agents) g[a.lane].push(a);
    return g;
  }, [agents]);

  // Real mic dictation via Web Speech (feature-detected); falls back to opening
  // the chat composer so the button is never a dead-end.
  const onMic = useCallback(() => {
    haptic(8);
    type SR = typeof window & {
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      SpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const w = window as SR;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      navToChat();
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    setListening(true);
    rec.onresult = (e: SpeechRecognitionEventLike) => {
      const text = e.results?.[0]?.[0]?.transcript ?? "";
      setListening(false);
      if (text.trim()) navToChat(text.trim());
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    try {
      rec.start();
    } catch {
      setListening(false);
      navToChat();
    }
  }, []);

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
      { key: "mic", Icon: MicIcon, label: "Voice", on: onMic, active: listening },
      { key: "camera", Icon: CameraIcon, label: "Camera", on: onCamera, active: false },
      { key: "photo", Icon: PhotoIcon, label: "Photo", on: onPhoto, active: false },
      { key: "compose", Icon: ComposeIcon, label: "Compose", on: onCompose, active: false },
    ],
    [onMic, onCamera, onPhoto, onCompose, listening],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col gap-4 px-3 pt-1"
    >
      {/* ---- multi-modal entry row ---- */}
      <div className="rounded-[calc(var(--theme-radius)+8px)] border border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)] p-3">
        <button
          type="button"
          onClick={() => { haptic(8); navToChat(); }}
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

      {/* ---- Suggested ---- */}
      <section>
        <h3 className="mb-2 px-0.5 font-mondwest text-display text-[0.7rem] tracking-[0.14em] text-text-secondary">
          Suggested
        </h3>
        <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 scrollbar-none">
          {SUGGESTED.map((s) => (
            <button
              key={s.title}
              type="button"
              onClick={() => { haptic(6); navToChat(s.prompt); }}
              className="flex w-[150px] shrink-0 flex-col gap-1 rounded-[var(--radius-md)] border border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)] p-3 text-left transition-colors active:bg-[color-mix(in_srgb,var(--midground)_9%,transparent)]"
            >
              <span className="text-[0.8rem] font-medium text-midground">{s.title}</span>
              <span className="line-clamp-2 text-[0.66rem] leading-snug text-text-tertiary">{s.prompt}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ---- Tasks header + view toggle ---- */}
      <section>
        <header className="mb-2.5 flex items-center justify-between">
          <h3 className="font-mondwest text-display text-[0.7rem] tracking-[0.14em] text-text-secondary">
            Tasks
          </h3>
          <div className="flex items-center gap-0.5 rounded-full border border-border p-0.5">
            {(["activity", "categories"] as ViewMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { haptic(4); setView(m); }}
                className={cn(
                  "rounded-full px-2.5 py-1 font-mono-ui text-[0.6rem] tracking-wide transition-colors",
                  view === m ? "bg-midground text-background-base" : "text-text-tertiary",
                )}
              >
                {m === "activity" ? "All Activity" : "Categories"}
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
            {agents.map((a) => <TaskCard key={a.id} agent={a} />)}
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
                    {grouped[lane].map((a) => <TaskCard key={a.id} agent={a} />)}
                  </div>
                </div>
              ))}
          </div>
        )}
      </section>
    </motion.div>
  );
}

function TaskCard({ agent }: { agent: FleetAgent }) {
  const lane = LANE_META[agent.lane];
  const node = NODE_META[agent.node];
  return (
    <button
      type="button"
      onClick={() => { haptic(8); navToChat(); }}
      className="flex w-full flex-col gap-2 rounded-[var(--radius-md)] border border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)] p-3 text-left transition-colors active:bg-[color-mix(in_srgb,var(--midground)_9%,transparent)]"
    >
      <div className="flex items-start gap-2">
        <span
          className="mt-1 h-2 w-2 shrink-0 rounded-full"
          style={{
            background: lane.tone,
            boxShadow: agent.lane === "working" ? `0 0 8px ${lane.tone}` : undefined,
          }}
        />
        <span className="min-w-0 flex-1 truncate text-[0.84rem] font-medium text-text-primary">
          {agent.objective}
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
    </button>
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

/* ---- minimal Web Speech typings (avoid pulling lib.dom.d.ts variance) ---- */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}
