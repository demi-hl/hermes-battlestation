"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Markdown } from "./markdown";
import type { ChatMessage } from "./useChat";
import type { ChatThread } from "@/lib/chat-types";
import { cn } from "@/lib/utils";

export function MessageList({
  messages,
  thread,
  sending,
}: {
  messages: ChatMessage[];
  thread: ChatThread | null;
  sending: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the latest turn in view as it streams.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

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
              <div className="max-w-[86%] rounded-[calc(var(--theme-radius)+4px)] rounded-br-md border border-border bg-[color-mix(in_srgb,var(--midground)_8%,transparent)] px-3.5 py-2 text-[0.92rem] leading-relaxed text-text-primary">
                {m.text}
              </div>
            ) : (
              <AssistantBubble m={m} />
            )}
          </motion.div>
        ))}
      </AnimatePresence>
      <div ref={endRef} className="h-px" aria-hidden />
      {sending && <span className="sr-only">agent is responding</span>}
    </div>
  );
}

function AssistantBubble({ m }: { m: ChatMessage }) {
  if (m.pending) return <Working elapsedMs={m.elapsedMs ?? 0} note={m.note} />;
  return (
    <div className="w-full max-w-full">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="font-mondwest text-display text-[0.6rem] tracking-[0.18em] text-text-tertiary">
          hermes
        </span>
      </div>
      {m.error ? (
        <div className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-destructive)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-destructive)_8%,transparent)] px-3 py-2 text-[0.85rem] text-text-secondary">
          {m.text || "the turn failed"}
        </div>
      ) : (
        <Markdown text={m.text} />
      )}
      {m.note && !m.error && (
        <p className="mt-1.5 text-[0.7rem] text-text-tertiary">{m.note}</p>
      )}
    </div>
  );
}

function Working({ elapsedMs, note }: { elapsedMs: number; note?: string }) {
  const secs = Math.floor(elapsedMs / 1000);
  const label = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
  return (
    <div className="relative flex w-full items-center gap-2.5 overflow-hidden rounded-[var(--radius-md)] px-1 py-1.5">
      <span
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 rounded-full border border-midground/40 border-t-midground animate-spin-slow"
        style={{ animationDuration: "0.9s" }}
      />
      <span className="font-mono-ui tabular text-[0.78rem] text-text-secondary">
        working {label}
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
    <div className="flex min-h-[40dvh] flex-col items-center justify-center gap-4 px-8 text-center">
      <div
        className="relative grid h-16 w-16 place-items-center rounded-[calc(var(--theme-radius)+8px)] text-midground"
        style={{ background: "color-mix(in srgb, var(--midground) 6%, transparent)" }}
      >
        <span className="arc-border" aria-hidden />
        <span className="font-mondwest text-display text-lg">{thread?.repo ? thread.repo.slice(0, 2).toLowerCase() : "n"}</span>
      </div>
      <div className="animate-slide-up">
        <p className="font-mondwest text-display text-base tracking-wide text-midground">
          {bound ? bound : "general thread"}
        </p>
        <p className="mx-auto mt-2 max-w-[34ch] text-[0.86rem] leading-relaxed text-text-tertiary">
          {bound
            ? `This thread is bound to the ${bound} repo. The agent runs in that working directory with its own persistent context.`
            : "Talk to the Hermes agent. Pick a repo from the thread switcher to bind a per-repo context, or chat here in the general (home) thread."}
        </p>
      </div>
    </div>
  );
}
