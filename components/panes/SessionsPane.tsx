"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { haptic } from "@/components/shell/haptics";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import {
  SearchIcon,
  RefreshIcon,
} from "@/components/panes/pane-icons";
import { ChevronRightIcon } from "@/components/shell/icons";
import { HomeIcon } from "@/components/chat/icons";
import type {
  ChatThread,
  ThreadsPayload,
} from "@/lib/chat-types";
import type { ChatMessage } from "@/components/chat/useChat";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HistoryPayload {
  messages: ChatMessage[];
}

// ---------------------------------------------------------------------------
// Main pane
// ---------------------------------------------------------------------------

export function SessionsPane() {
  const [payload, setPayload] = useState<ThreadsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [histories, setHistories] = useState<Map<string, ChatMessage[]>>(
    new Map(),
  );
  const [historyLoading, setHistoryLoading] = useState<Set<string>>(new Set());
  const didAutoExpand = useRef(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/chat/threads", { cache: "no-store" });
      const body = (await res.json()) as ThreadsPayload;
      if (!res.ok) throw new Error(body?.error ?? "failed to load threads");
      setPayload(body);
      setError(body.error ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Re-fetch every 30 s for real-time context usage.
  useEffect(() => {
    const id = setInterval(() => load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  // Auto-expand the first session once.
  useEffect(() => {
    if (didAutoExpand.current || !payload || payload.threads.length === 0)
      return;
    didAutoExpand.current = true;
    setExpanded(new Set([payload.threads[0].id]));
    fetchHistory(payload.threads[0].id, payload.threads[0].sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload]);

  const fetchHistory = useCallback(
    async (threadId: string, sessionId: string | null) => {
      if (!sessionId) return;
      if (histories.has(threadId)) return;
      setHistoryLoading((prev) => new Set(prev).add(threadId));
      try {
        const res = await fetch(
          `/api/chat/history?repo=${encodeURIComponent(threadId)}`,
          { cache: "no-store" },
        );
        const body = await res.json();
        if (res.ok) {
          setHistories((prev) => {
            const next = new Map(prev);
            next.set(threadId, (body as HistoryPayload).messages);
            return next;
          });
        }
      } catch {
        // silently fail
      } finally {
        setHistoryLoading((prev) => {
          const next = new Set(prev);
          next.delete(threadId);
          return next;
        });
      }
    },
    [histories],
  );

  const toggle = useCallback(
    (thread: ChatThread) => {
      haptic(6);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(thread.id)) {
          next.delete(thread.id);
        } else {
          next.add(thread.id);
          fetchHistory(thread.id, thread.sessionId);
        }
        return next;
      });
    },
    [fetchHistory],
  );

  const filtered = useMemo(() => {
    if (!payload) return [];
    const q = search.toLowerCase();
    return payload.threads.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        (t.model ?? "").toLowerCase().includes(q),
    );
  }, [payload, search]);

  const handleExport = useCallback(() => {
    haptic(8);
    if (!payload) return;
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sessions-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [payload]);

  return (
    <div className="min-h-full pb-4">
      {/* Header */}
      <Header
        refreshing={refreshing}
        onRefresh={load}
        onExport={handleExport}
      />

      {/* Search */}
      <div className="border-b border-border px-2 pb-2 pt-1">
        <SearchBar value={search} onChange={setSearch} />
      </div>

      {/* Session list */}
      <div className="px-2 pt-1">
        {payload === null && !error ? (
          <Skeleton />
        ) : error && !payload ? (
          <ErrorState message={error} onRetry={load} />
        ) : filtered.length === 0 ? (
          <p className="px-3 py-10 text-center text-sm text-text-tertiary">
            {search
              ? "No sessions match your search."
              : "No sessions yet."}
          </p>
        ) : (
          <motion.ul layout className="flex flex-col">
            {filtered.map((thread, i) => (
              <SessionRow
                key={thread.id}
                thread={thread}
                index={i}
                open={expanded.has(thread.id)}
                history={histories.get(thread.id)}
                historyLoading={historyLoading.has(thread.id)}
                onToggle={() => toggle(thread)}
              />
            ))}
          </motion.ul>
        )}
        {error && payload && (
          <p className="px-3 pt-2 text-[0.66rem] text-text-tertiary">
            Some data may be stale: {error}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header({
  refreshing,
  onRefresh,
  onExport,
}: {
  refreshing: boolean;
  onRefresh: () => void;
  onExport: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 pb-3 pt-1">
      <span className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-md)] border border-border">
        <span className="arc-border" aria-hidden />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/nous-logo.svg"
          alt=""
          className="h-full w-full object-cover opacity-95"
        />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-mondwest text-display text-[0.92rem] leading-tight tracking-wide text-midground">
          Sessions
        </span>
        <span className="font-mono-ui text-[0.62rem] uppercase tracking-[0.16em] text-text-tertiary">
          chat threads
        </span>
      </div>
      <button
        type="button"
        aria-label="Export sessions"
        onClick={onExport}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-text-tertiary transition-colors active:scale-90 active:text-midground"
        title="Export as JSON"
      >
        <ExportIcon width={15} height={15} />
      </button>
      <button
        type="button"
        aria-label="Refresh sessions"
        onClick={() => {
          haptic(6);
          onRefresh();
        }}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-text-tertiary transition-colors active:scale-90 active:text-midground"
      >
        <RefreshIcon
          width={15}
          height={15}
          className={refreshing ? "animate-spin-slow" : ""}
        />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search bar
// ---------------------------------------------------------------------------

function SearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)] px-2.5 py-1.5">
      <SearchIcon width={15} height={15} className="text-text-tertiary" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search sessions by name or model…"
        className="flex-1 bg-transparent text-[0.85rem] text-text-primary outline-none placeholder:text-text-tertiary"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="grid h-5 w-5 place-items-center rounded-full text-text-tertiary hover:text-midground"
          aria-label="Clear search"
        >
          <ClearIcon width={14} height={14} />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session row
// ---------------------------------------------------------------------------

function SessionRow({
  thread,
  index,
  open,
  history,
  historyLoading,
  onToggle,
}: {
  thread: ChatThread;
  index: number;
  open: boolean;
  history: ChatMessage[] | undefined;
  historyLoading: boolean;
  onToggle: () => void;
}) {
  const isGeneral = !thread.repo;
  const statusColor = thread.sessionId
    ? "var(--color-success)"
    : "color-mix(in srgb, var(--midground) 20%, transparent)";

  return (
    <li>
      <motion.button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: 0.3,
          delay: Math.min(index * 0.025, 0.3),
          ease: [0.16, 1, 0.3, 1],
        }}
        className="flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2.5 text-left transition-colors active:bg-[color-mix(in_srgb,var(--midground)_5%,transparent)]"
      >
        {/* Avatar */}
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-border text-text-tertiary">
          {isGeneral ? (
            <HomeIcon width={15} height={15} />
          ) : (
            <BranchIcon width={15} height={15} />
          )}
        </span>

        {/* Info */}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <span className="truncate text-[0.92rem] font-medium text-midground">
              {thread.title}
            </span>
            {/* Status dot */}
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: statusColor }}
              title={thread.sessionId ? "session live" : "inactive"}
            />
          </span>
          <span className="flex items-center gap-1.5 font-mono-ui text-[0.68rem] text-text-tertiary">
            {thread.model && (
              <>
                <ModelBadge model={thread.model} />
                <span className="text-text-disabled">·</span>
              </>
            )}
            <span>{thread.messageCount} msgs</span>
            {thread.lastActive && (
              <>
                <span className="text-text-disabled">·</span>
                <span>{relativeTime(new Date(thread.lastActive).toISOString())}</span>
              </>
            )}
          </span>
        </span>

        {/* Context usage bar */}
        {thread.usage && (
          <UsageBadge used={thread.usage.used} total={thread.usage.total} />
        )}

        <ChevronRightIcon
          width={14}
          height={14}
          className={cn(
            "shrink-0 text-text-tertiary transition-transform duration-200",
            open && "rotate-90",
          )}
        />
      </motion.button>

      {/* Expanded history */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="ml-9 border-l border-border pl-3 pb-2">
              {historyLoading ? (
                <div className="flex items-center gap-2 py-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-text-tertiary" />
                  <span className="text-[0.72rem] text-text-tertiary">
                    Loading history…
                  </span>
                </div>
              ) : history && history.length > 0 ? (
                <div className="flex flex-col gap-1">
                  {history.slice(-6).map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        "rounded-[var(--radius-sm)] px-2 py-1 text-[0.76rem] leading-relaxed",
                        msg.role === "user"
                          ? "bg-[color-mix(in_srgb,var(--midground)_6%,transparent)] text-text-secondary"
                          : "text-text-tertiary",
                      )}
                    >
                      <span className="font-mono-ui text-[0.55rem] uppercase tracking-wider text-text-disabled">
                        {msg.role}
                      </span>
                      <p className="line-clamp-2">{msg.text}</p>
                    </div>
                  ))}
                  {history.length > 6 && (
                    <p className="text-[0.68rem] text-text-tertiary">
                      +{history.length - 6} more messages
                    </p>
                  )}
                </div>
              ) : thread.sessionId ? (
                <p className="py-1 text-[0.72rem] text-text-tertiary">
                  No messages yet.
                </p>
              ) : (
                <p className="py-1 text-[0.72rem] text-text-tertiary">
                  Session not yet created.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ModelBadge({ model }: { model: string }) {
  return (
    <span className="rounded-[var(--radius-sm)] bg-[color-mix(in_srgb,var(--midground)_6%,transparent)] px-1 py-[1px] text-[0.6rem] text-text-secondary">
      {model}
    </span>
  );
}

function UsageBadge({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const hue = pct > 80 ? "var(--color-destructive)" : "var(--color-success)";
  return (
    <span
      className="flex shrink-0 items-center gap-1 font-mono-ui tabular text-[0.64rem] text-text-tertiary"
      title={`${Math.round(pct)}% context used (${used.toLocaleString()} / ${total.toLocaleString()} tokens)`}
    >
      <span className="h-1.5 w-8 rounded-full bg-[color-mix(in_srgb,var(--midground)_12%,transparent)]">
        <span
          className="block h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: hue,
          }}
        />
      </span>
      <span>{Math.round(pct)}%</span>
    </span>
  );
}

function BranchIcon({ width, height, className }: SVGProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M6 3v12" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="6" r="3" />
      <path d="M18 9v9" />
      <path d="M6 15a9 9 0 0 0 9-9" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Export icon (downward arrow with a line)
// ---------------------------------------------------------------------------

function ExportIcon({ width, height, className }: SVGProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M12 3v13" />
      <path d="m8 12 4 4 4-4" />
      <path d="M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Clear icon (X)
// ---------------------------------------------------------------------------

function ClearIcon({ width, height, className }: SVGProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M18 6 6 18" />
      <path d="M6 6 18 18" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Loading / error states
// ---------------------------------------------------------------------------

function Skeleton() {
  return (
    <div className="flex flex-col gap-2 px-3 pt-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex animate-pulse items-center gap-3">
          <span className="h-7 w-7 rounded-[var(--radius-sm)] bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]" />
          <div className="flex flex-1 flex-col gap-1">
            <span className="h-4 w-32 rounded bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]" />
            <span className="h-3 w-24 rounded bg-[color-mix(in_srgb,var(--midground)_5%,transparent)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <p className="text-sm text-text-tertiary">{message}</p>
      <button
        type="button"
        onClick={() => {
          haptic(6);
          onRetry();
        }}
        className="rounded-[var(--radius-md)] border border-border px-4 py-1.5 text-[0.82rem] text-text-secondary transition-colors active:bg-[color-mix(in_srgb,var(--midground)_6%,transparent)]"
      >
        Retry
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SVG prop type
// ---------------------------------------------------------------------------

interface SVGProps {
  width?: number;
  height?: number;
  className?: string;
}
