"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Markdown } from "./markdown";
import type { ChatMessage } from "./useChat";
import type { ChatThread } from "@/lib/chat-types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

/** Human elapsed: counts seconds, rolls into `Nm Ss` past a minute. */
function fmtElapsed(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  return secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
}

/** Live wall-clock elapsed since `startTs`, re-rendering once a second while
 *  `active`. Independent of the server status heartbeat (which stops on the
 *  first streamed token), so the timer keeps ticking the whole turn. */
function useLiveElapsed(startTs: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active, startTs]);
  return Math.max(0, now - startTs);
}

export function MessageList({
  messages,
  thread,
  sending,
  onRetry,
}: {
  messages: ChatMessage[];
  thread: ChatThread | null;
  sending: boolean;
  onRetry?: (id: string) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  // True while the user is parked at the bottom — only then do we auto-follow.
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const lastCountRef = useRef(messages.length);

  // Resolve the actual scroll container (the [data-msg-scroll] ancestor) once.
  useLayoutEffect(() => {
    scrollerRef.current =
      endRef.current?.closest<HTMLElement>("[data-msg-scroll]") ?? null;
  }, []);

  // Track how far from the bottom the user is. Within 80px = "stuck".
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      const stuck = dist < 80;
      stickRef.current = stuck;
      setShowJump(!stuck);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Follow new content. A brand-new message (count changed) gets a smooth
  // scroll; in-place streaming updates jump instantly (no smooth-scroll queue
  // stutter). Either way we only move if the user is parked at the bottom.
  useEffect(() => {
    const newTurn = messages.length !== lastCountRef.current;
    lastCountRef.current = messages.length;
    if (!stickRef.current) return;
    endRef.current?.scrollIntoView({
      behavior: newTurn ? "smooth" : "auto",
      block: "end",
    });
  }, [messages]);

  const jumpToLatest = () => {
    stickRef.current = true;
    setShowJump(false);
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  if (!messages.length) {
    return <EmptyThread thread={thread} />;
  }

  return (
    <div className="flex flex-col gap-4 px-3.5 pb-4 pt-2">
      <AnimatePresence initial={false}>
        {messages.map((m) => (
          <motion.div
            key={m.id}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
          >
            {m.role === "user" ? (
              <div className="flex max-w-[86%] flex-col items-end gap-1.5">
                {m.images && m.images.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {m.images.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={src}
                        alt=""
                        className="h-28 w-28 rounded-[calc(var(--theme-radius)+4px)] border border-border object-cover"
                      />
                    ))}
                  </div>
                )}
                {m.text && (
                  <div className="rounded-[calc(var(--theme-radius)+4px)] rounded-br-md border border-border bg-[color-mix(in_srgb,var(--midground)_8%,transparent)] px-3.5 py-2 text-[0.92rem] leading-relaxed text-text-primary">
                    {m.text}
                  </div>
                )}
              </div>
            ) : (
              <AssistantBubble m={m} onRetry={onRetry} />
            )}
          </motion.div>
        ))}
      </AnimatePresence>
      <div ref={endRef} className="h-px" aria-hidden />
      {sending && <span className="sr-only">agent is responding</span>}

      <AnimatePresence>
        {showJump && (
          <motion.button
            type="button"
            aria-label="Jump to latest"
            onClick={jumpToLatest}
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className="fixed bottom-[calc((var(--app-context-h)+var(--app-tabbar-h))*(1-var(--kb-open,0))+env(safe-area-inset-bottom)+118px)] left-1/2 z-20 grid h-9 w-9 -translate-x-1/2 place-items-center rounded-full border border-border bg-[color-mix(in_srgb,var(--background-base)_82%,transparent)] text-midground shadow-lg backdrop-blur"
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

function AssistantBubble({ m, onRetry }: { m: ChatMessage; onRetry?: (id: string) => void }) {
  const hasText = !!m.text;
  const hasTools = !!m.tools?.length;
  // Live timer ticks the whole time the turn is pending — not tied to the
  // server heartbeat (which stops on first token).
  const elapsed = useLiveElapsed(m.ts, !!m.pending);
  // Pure spinner only before any text/tool activity has arrived.
  if (m.pending && !hasText && !hasTools) {
    return <Working elapsedMs={elapsed} note={m.note} />;
  }
  return (
    <div className="w-full max-w-full">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="font-mondwest text-display text-[0.6rem] tracking-[0.18em] text-text-tertiary">
          hermes
        </span>
        {m.pending && (
          <>
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full border border-midground/40 border-t-midground animate-spin-slow"
              style={{ animationDuration: "0.9s" }}
            />
            <span className="font-mono-ui tabular text-[0.6rem] text-text-tertiary">
              {fmtElapsed(elapsed)}
            </span>
          </>
        )}
      </div>

      {hasTools && <ToolTray tools={m.tools!} />}

      {m.error ? (
        m.retry && onRetry ? (
          <button
            type="button"
            onClick={() => onRetry(m.id)}
            className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-destructive)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-destructive)_8%,transparent)] px-3 py-2 text-left text-[0.85rem] text-text-secondary transition-colors active:bg-[color-mix(in_srgb,var(--color-destructive)_14%,transparent)]"
          >
            <span>{m.text || "the turn failed"}</span>
            <span className="flex shrink-0 items-center gap-1 font-mono-ui text-[0.7rem] text-[color:var(--color-destructive)]">
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M3 12a9 9 0 1 0 3-6.7L3 8" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 3v5h5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              retry
            </span>
          </button>
        ) : (
          <div className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-destructive)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-destructive)_8%,transparent)] px-3 py-2 text-[0.85rem] text-text-secondary">
            {m.text || "the turn failed"}
          </div>
        )
      ) : (
        hasText && <Markdown text={m.text} />
      )}
      {m.note && !m.error && (
        <p className="mt-1.5 text-[0.7rem] text-text-tertiary">{m.note}</p>
      )}
    </div>
  );
}

/** Compact live list of tool calls for the turn, with per-call state. */
function ToolTray({ tools }: { tools: NonNullable<ChatMessage["tools"]> }) {
  return (
    <div className="mb-2 flex flex-col gap-1">
      <AnimatePresence initial={false}>
        {tools.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)] px-2.5 py-1.5"
          >
            {t.done ? (
              <span
                aria-hidden
                className={cn(
                  "grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full text-[0.55rem]",
                  t.ok
                    ? "bg-[color-mix(in_srgb,var(--color-success)_22%,transparent)] text-[color:var(--color-success)]"
                    : "bg-[color-mix(in_srgb,var(--color-destructive)_22%,transparent)] text-[color:var(--color-destructive)]",
                )}
              >
                {t.ok ? "✓" : "✕"}
              </span>
            ) : (
              <span
                aria-hidden
                className="h-3.5 w-3.5 shrink-0 rounded-full border border-midground/40 border-t-midground animate-spin-slow"
                style={{ animationDuration: "0.8s" }}
              />
            )}
            <span className="font-mono-ui truncate text-[0.7rem] text-text-secondary">
              {t.name}
            </span>
            {t.title && t.title !== t.name && (
              <span className="font-mono-ui truncate text-[0.64rem] text-text-tertiary">
                {t.title}
              </span>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function Working({ elapsedMs, note }: { elapsedMs: number; note?: string }) {
  return (
    <div className="relative flex w-full items-center gap-2.5 overflow-hidden rounded-[var(--radius-md)] px-1 py-1.5">
      <span
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 rounded-full border border-midground/40 border-t-midground animate-spin-slow"
        style={{ animationDuration: "0.9s" }}
      />
      <span className="font-mono-ui tabular text-[0.78rem] text-text-secondary">
        working {fmtElapsed(elapsedMs)}
      </span>
      <span className="h-3 flex-1 march opacity-40" aria-hidden />
      <span className="font-mono-ui text-[0.68rem] text-text-tertiary">
        {note ?? "thinking"}
      </span>
    </div>
  );
}

function EmptyThread({ thread }: { thread: ChatThread | null }) {
  const bound = thread?.repo;
  return (
    <div className="flex min-h-[40dvh] flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="animate-slide-up">
        <p className="font-mondwest text-display text-base tracking-wide text-midground">
          {bound ? bound : "general thread"}
        </p>
        <div className="mt-2 flex justify-center">
          <Badge tone="secondary">{bound ? "repo-bound" : "home"}</Badge>
        </div>
        <p className="mx-auto mt-2 max-w-[34ch] text-[0.86rem] leading-relaxed text-text-tertiary">
          {bound
            ? `This thread is bound to the ${bound} repo. The agent runs in that working directory with its own persistent context.`
            : "Talk to the Hermes agent. Pick a repo from the thread switcher to bind a per-repo context, or chat here in the general (home) thread."}
        </p>
      </div>
    </div>
  );
}
