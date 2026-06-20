"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { haptic } from "@/components/shell/haptics";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import { profileTint } from "@/lib/profile-color";
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

// Cross-profile (read-only) browsing shapes — mirror lib/profile-sessions.ts.
interface ProfileInfo {
  name: string;
  count: number;
}
interface ProfileSession {
  id: string;
  title: string | null;
  source: string | null;
  model: string | null;
  messageCount: number;
  lastActive: number | null;
  used: number | null;
}

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

  // Cross-profile browsing. "default" = the rich thread view (resumable in
  // chat). Any other profile = read-only history merged from that profile's
  // own state.db. Profiles + counts come from /api/sessions/all (no param).
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [activeProfile, setActiveProfile] = useState<string>("default");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/sessions/all", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { profiles?: ProfileInfo[] };
        if (body.profiles?.length) setProfiles(body.profiles);
      } catch {
        /* keep just the default chip */
      }
    })();
  }, []);

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

  // Sessions open as a clean collapsed list — tap a row to expand its history.
  // (Previously auto-expanded the first thread, which dumped a transcript at the
  // top of the list and read as clutter.)

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

  // Open a session in the Chat tab: switch tabs + tell ChatHub which thread to
  // select. Same window-event bus as the Tasks-home → Chat jump.
  const openInChat = useCallback((thread: ChatThread) => {
    haptic([6, 4, 8]);
    // Default-list threads run under the "default" profile — switch the active
    // brain to match so the resumed turn uses the same profile as the session.
    window.dispatchEvent(
      new CustomEvent("lo-set-profile", { detail: { profile: "default" } }),
    );
    window.dispatchEvent(
      new CustomEvent("lo-open-session", { detail: { threadId: thread.id } }),
    );
    window.dispatchEvent(new CustomEvent("lo-nav", { detail: { tab: "chat" } }));
  }, []);

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

  const handleRename = useCallback(
    async (thread: ChatThread, title: string) => {
      if (!thread.sessionId) return;
      await fetch(`/api/sessions/${encodeURIComponent(thread.sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      }).catch(() => {});
      load();
    },
    [load],
  );

  const handleDelete = useCallback(
    async (thread: ChatThread) => {
      // Forget the bridge mapping first so the thread can't be resurrected from
      // the bridge map on the next /api/chat/threads fetch, then delete the row.
      await fetch(`/api/chat/threads/forget`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: thread.id }),
      }).catch(() => {});
      if (thread.sessionId) {
        await fetch(`/api/sessions/${encodeURIComponent(thread.sessionId)}`, {
          method: "DELETE",
        }).catch(() => {});
      }
      load();
    },
    [load],
  );

  const handleArchive = useCallback(
    async (thread: ChatThread) => {
      // Same as delete-from-list: drop the bridge mapping so the thread leaves
      // the list, but keep the session row (archived) for history/recovery.
      await fetch(`/api/chat/threads/forget`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: thread.id }),
      }).catch(() => {});
      if (thread.sessionId) {
        await fetch(`/api/sessions/${encodeURIComponent(thread.sessionId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived: true }),
        }).catch(() => {});
      }
      load();
    },
    [load],
  );

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

      {/* Profile filter chips — default (resumable) + every other profile's
          store (read-only history). Only shown when >1 profile exists. */}
      {profiles.length > 1 && (
        <ProfileChips
          profiles={profiles}
          active={activeProfile}
          onSelect={(p) => {
            haptic(6);
            setActiveProfile(p);
            // Tapping a profile here is an explicit intent to use that brain —
            // switch the live active profile to match.
            window.dispatchEvent(
              new CustomEvent("lo-set-profile", { detail: { profile: p } }),
            );
          }}
        />
      )}

      {/* Body: default profile = rich threads; others = read-only history. */}
      {activeProfile === "default" ? (
        <DefaultSessions
          payload={payload}
          error={error}
          filtered={filtered}
          search={search}
          expanded={expanded}
          histories={histories}
          historyLoading={historyLoading}
          toggle={toggle}
          openInChat={openInChat}
          handleRename={handleRename}
          handleDelete={handleDelete}
          handleArchive={handleArchive}
          load={load}
        />
      ) : (
        <ProfileSessions profile={activeProfile} search={search} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile filter chips
// ---------------------------------------------------------------------------

function ProfileChips({
  profiles,
  active,
  onSelect,
}: {
  profiles: ProfileInfo[];
  active: string;
  onSelect: (p: string) => void;
}) {
  return (
    <div
      className="flex gap-1.5 overflow-x-auto border-b border-border px-2 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      // iOS WKWebView smears composited text over the difference-blend Backdrop
      // during momentum scroll — isolating the row into its own stacking context
      // + GPU layer kills the smear (same fix as the pane scroller).
      style={{ isolation: "isolate", transform: "translateZ(0)" }}
    >
      {profiles.map((p) => {
        const on = p.name === active;
        const tint = profileTint(p.name);
        return (
          <button
            key={p.name}
            type="button"
            onClick={() => onSelect(p.name)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.72rem] transition-colors",
              on
                ? "border-transparent bg-midground text-background-base"
                : "border-border text-text-secondary active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]",
            )}
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: tint, boxShadow: on ? "none" : `0 0 4px ${tint}` }}
            />
            <span className="shrink-0 whitespace-nowrap font-mono-ui">{p.name}</span>
            <span
              className={cn(
                "ml-0.5 grid h-4 min-w-[1.1rem] shrink-0 place-items-center rounded-full px-1 font-mono-ui tabular text-[0.58rem] leading-none",
                on ? "bg-background-base/20" : "bg-[color-mix(in_srgb,var(--midground)_10%,transparent)] text-text-tertiary",
              )}
            >
              {p.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Default-profile session list (rich, resumable) — the original body
// ---------------------------------------------------------------------------

function DefaultSessions({
  payload,
  error,
  filtered,
  search,
  expanded,
  histories,
  historyLoading,
  toggle,
  openInChat,
  handleRename,
  handleDelete,
  handleArchive,
  load,
}: {
  payload: ThreadsPayload | null;
  error: string | null;
  filtered: ChatThread[];
  search: string;
  expanded: Set<string>;
  histories: Map<string, ChatMessage[]>;
  historyLoading: Set<string>;
  toggle: (t: ChatThread) => void;
  openInChat: (t: ChatThread) => void;
  handleRename: (t: ChatThread, title: string) => void;
  handleDelete: (t: ChatThread) => void;
  handleArchive: (t: ChatThread) => void;
  load: () => void;
}) {
  return (
    <div className="px-2 pt-1">
      {payload === null && !error ? (
        <Skeleton />
      ) : error && !payload ? (
        <ErrorState message={error} onRetry={load} />
      ) : filtered.length === 0 ? (
        <p className="px-3 py-10 text-center text-sm text-text-tertiary">
          {search ? "No sessions match your search." : "No sessions yet."}
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
              onOpenInChat={() => openInChat(thread)}
              onRename={(title) => handleRename(thread, title)}
              onDelete={() => handleDelete(thread)}
              onArchive={() => handleArchive(thread)}
            />
          ))}
        </motion.ul>
      )}
      {error && payload && (
        <p className="px-3 pt-2 text-[0.66rem] text-text-tertiary">
          Some data may be stale: {error}
        </p>
      )}

      {/* Every session in the store (not just the 2 live chat threads) so any
          session can be archived or permanently deleted from the phone. */}
      <AllSessionsList search={search} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// All-sessions list (full store) — archive + delete any session
// ---------------------------------------------------------------------------

function AllSessionsList({ search }: { search: string }) {
  const [sessions, setSessions] = useState<ProfileSession[] | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions/all?profile=default", {
        cache: "no-store",
      });
      const body = (await res.json()) as { sessions?: ProfileSession[] };
      setSessions(body.sessions ?? []);
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = useCallback(
    async (id: string, kind: "archive" | "delete") => {
      haptic(kind === "delete" ? 12 : 8);
      setBusy((p) => new Set(p).add(id));
      setConfirmId(null);
      // Archive is reversible → optimistic remove. Permanent delete is NOT →
      // keep the row until the server confirms 200, then drop it.
      if (kind === "archive") {
        setSessions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
      }
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
          method: kind === "delete" ? "DELETE" : "PATCH",
          headers:
            kind === "archive"
              ? { "Content-Type": "application/json" }
              : undefined,
          body: kind === "archive" ? JSON.stringify({ archived: true }) : undefined,
        });
        if (kind === "delete") {
          if (res.ok) {
            setSessions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
          } else {
            haptic([8, 6, 12]); // delete failed — row stays put
          }
        }
      } catch {
        load(); // re-show on failure
      } finally {
        setBusy((p) => {
          const n = new Set(p);
          n.delete(id);
          return n;
        });
      }
    },
    [load],
  );

  const filtered = useMemo(() => {
    if (!sessions) return [];
    const q = search.toLowerCase();
    return sessions.filter(
      (s) =>
        (s.title ?? "").toLowerCase().includes(q) ||
        (s.model ?? "").toLowerCase().includes(q),
    );
  }, [sessions, search]);

  if (sessions === null) return null;

  return (
    <div className="mt-4 border-t border-border/60 pt-3">
      <p className="flex items-center justify-between px-1 pb-2 font-mono-ui text-[0.6rem] uppercase tracking-wider text-text-tertiary">
        <span>all sessions · {sessions.length}</span>
        <button
          type="button"
          onClick={() => {
            haptic(6);
            load();
          }}
          className="text-text-tertiary transition-colors active:text-midground"
        >
          refresh
        </button>
      </p>
      {filtered.length === 0 ? (
        <p className="px-3 py-6 text-center text-[0.8rem] text-text-tertiary">
          {search ? "No sessions match your search." : "No sessions."}
        </p>
      ) : (
        <ul className="flex flex-col">
          {filtered.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-border text-text-tertiary">
                <BranchIcon width={14} height={14} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[0.86rem] font-medium text-midground">
                  {s.title?.trim() || "untitled session"}
                </span>
                <span className="flex items-center gap-1.5 font-mono-ui text-[0.66rem] text-text-tertiary">
                  {s.model && (
                    <>
                      <ModelBadge model={s.model} />
                      <span className="text-text-disabled">·</span>
                    </>
                  )}
                  <span>{s.messageCount} msgs</span>
                  {s.lastActive && (
                    <>
                      <span className="text-text-disabled">·</span>
                      <span>
                        {relativeTime(new Date(s.lastActive).toISOString())}
                      </span>
                    </>
                  )}
                </span>
              </span>
              <button
                type="button"
                aria-label="Archive session"
                disabled={busy.has(s.id)}
                onClick={() => act(s.id, "archive")}
                className="shrink-0 rounded-[var(--radius-sm)] px-2 py-1 text-[0.66rem] text-text-tertiary transition-colors active:text-midground disabled:opacity-40"
              >
                archive
              </button>
              {confirmId === s.id ? (
                <button
                  type="button"
                  aria-label="Confirm permanent delete"
                  disabled={busy.has(s.id)}
                  onClick={() => act(s.id, "delete")}
                  className="shrink-0 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--color-destructive)_50%,transparent)] bg-[color-mix(in_srgb,var(--color-destructive)_14%,transparent)] px-2 py-1 text-[0.66rem] font-medium text-[color:var(--color-destructive)] disabled:opacity-40"
                >
                  confirm?
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="Delete session"
                  disabled={busy.has(s.id)}
                  onClick={() => {
                    haptic(8);
                    setConfirmId(s.id);
                  }}
                  className="shrink-0 rounded-[var(--radius-sm)] px-2 py-1 text-[0.66rem] text-text-tertiary transition-colors active:text-[color:var(--color-destructive)] disabled:opacity-40"
                >
                  delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Read-only cross-profile session list
// ---------------------------------------------------------------------------

function ProfileSessions({ profile, search }: { profile: string; search: string }) {
  const [sessions, setSessions] = useState<ProfileSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setSessions(null);
    setError(null);
    setOpenId(null);
    fetch(`/api/sessions/all?profile=${encodeURIComponent(profile)}`, { cache: "no-store" })
      .then((r) => r.json() as Promise<{ sessions?: ProfileSession[]; error?: string }>)
      .then((j) => {
        if (!live) return;
        setSessions(j.sessions ?? []);
        setError(j.error ?? null);
      })
      .catch(() => live && setError("request failed"));
    return () => {
      live = false;
    };
  }, [profile]);

  const filtered = useMemo(() => {
    if (!sessions) return [];
    const q = search.toLowerCase();
    return sessions.filter(
      (s) =>
        (s.title ?? "").toLowerCase().includes(q) ||
        (s.model ?? "").toLowerCase().includes(q),
    );
  }, [sessions, search]);

  if (sessions === null && !error) {
    return (
      <div className="px-2 pt-1">
        <Skeleton />
      </div>
    );
  }

  return (
    <div className="px-2 pt-1">
      <p className="px-1 pb-2 font-mono-ui text-[0.6rem] uppercase tracking-wider text-text-tertiary">
        read-only · {profile} profile history
      </p>
      {filtered.length === 0 ? (
        <p className="px-3 py-10 text-center text-sm text-text-tertiary">
          {search ? "No sessions match your search." : "No sessions in this profile."}
        </p>
      ) : (
        <ul className="flex flex-col">
          {filtered.map((s) => (
            <ProfileSessionRow
              key={s.id}
              profile={profile}
              session={s}
              open={openId === s.id}
              onToggle={() => {
                haptic(6);
                setOpenId((cur) => (cur === s.id ? null : s.id));
              }}
            />
          ))}
        </ul>
      )}
      {error && (
        <p className="px-3 pt-2 text-[0.66rem] text-text-tertiary">{error}</p>
      )}
    </div>
  );
}

function ProfileSessionRow({
  profile,
  session,
  open,
  onToggle,
}: {
  profile: string;
  session: ProfileSession;
  open: boolean;
  onToggle: () => void;
}) {
  const [history, setHistory] = useState<ChatMessage[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || history !== null) return;
    let live = true;
    setLoading(true);
    fetch(
      `/api/sessions/transcript?profile=${encodeURIComponent(profile)}&id=${encodeURIComponent(session.id)}`,
      { cache: "no-store" },
    )
      .then((r) => r.json() as Promise<{ messages?: ChatMessage[] }>)
      .then((j) => live && setHistory(j.messages ?? []))
      .catch(() => live && setHistory([]))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [open, history, profile, session.id]);

  const title = session.title?.trim() || "untitled session";
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2.5 text-left transition-colors active:bg-[color-mix(in_srgb,var(--midground)_5%,transparent)]"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-border text-text-tertiary">
          <BranchIcon width={15} height={15} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[0.92rem] font-medium text-midground">{title}</span>
          <span className="flex items-center gap-1.5 font-mono-ui text-[0.68rem] text-text-tertiary">
            {session.model && (
              <>
                <ModelBadge model={session.model} />
                <span className="text-text-disabled">·</span>
              </>
            )}
            <span>{session.messageCount} msgs</span>
            {session.lastActive && (
              <>
                <span className="text-text-disabled">·</span>
                <span>{relativeTime(new Date(session.lastActive).toISOString())}</span>
              </>
            )}
          </span>
        </span>
        <ChevronRightIcon
          width={14}
          height={14}
          className={cn(
            "shrink-0 text-text-tertiary transition-transform duration-200",
            open && "rotate-90",
          )}
        />
      </button>
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
              {loading ? (
                <div className="flex items-center gap-2 py-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-text-tertiary" />
                  <span className="text-[0.72rem] text-text-tertiary">Loading history…</span>
                </div>
              ) : history && history.length > 0 ? (
                <div className="flex flex-col gap-1">
                  {history.slice(-8).map((msg) => (
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
                      <p className="line-clamp-3">{msg.text}</p>
                    </div>
                  ))}
                  {history.length > 8 && (
                    <p className="text-[0.68rem] text-text-tertiary">
                      +{history.length - 8} earlier messages
                    </p>
                  )}
                </div>
              ) : (
                <p className="py-1 text-[0.72rem] text-text-tertiary">No messages.</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
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
          className="h-full w-full object-contain p-1 opacity-95"
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
  onOpenInChat,
  onRename,
  onDelete,
  onArchive,
}: {
  thread: ChatThread;
  index: number;
  open: boolean;
  history: ChatMessage[] | undefined;
  historyLoading: boolean;
  onToggle: () => void;
  onOpenInChat: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onArchive: () => void;
}) {
  const isGeneral = !thread.repo;
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState(thread.title);
  const [confirmDel, setConfirmDel] = useState(false);
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
              {/* Primary action: jump into this session in the Chat tab. */}
              <button
                type="button"
                onClick={onOpenInChat}
                className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-midground px-3 py-2 text-[0.78rem] font-medium text-background-base transition-transform active:scale-[0.98]"
              >
                Open in chat
                <ChevronRightIcon width={13} height={13} />
              </button>
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

              {/* Action row: rename + delete (only for real sessions) */}
              {thread.sessionId && (
                <div className="mt-2 flex items-center gap-2 border-t border-border/60 pt-2">
                  {renaming ? (
                    <>
                      <input
                        autoFocus
                        value={renameVal}
                        onChange={(e) => setRenameVal(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            onRename(renameVal.trim() || thread.title);
                            setRenaming(false);
                          } else if (e.key === "Escape") {
                            setRenameVal(thread.title);
                            setRenaming(false);
                          }
                        }}
                        className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-border bg-transparent px-2 py-1 text-[0.74rem] text-midground outline-none focus:border-[color-mix(in_srgb,var(--midground)_30%,transparent)]"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          haptic(6);
                          onRename(renameVal.trim() || thread.title);
                          setRenaming(false);
                        }}
                        className="shrink-0 rounded-[var(--radius-sm)] bg-[color-mix(in_srgb,var(--midground)_12%,transparent)] px-2 py-1 text-[0.7rem] text-midground"
                      >
                        save
                      </button>
                      <button
                        type="button"
                        onClick={() => { setRenameVal(thread.title); setRenaming(false); }}
                        className="shrink-0 px-1 text-[0.7rem] text-text-tertiary"
                      >
                        cancel
                      </button>
                    </>
                  ) : confirmDel ? (
                    <>
                      <span className="flex-1 text-[0.7rem] text-text-secondary">Delete this session?</span>
                      <button
                        type="button"
                        onClick={() => { haptic(10); onDelete(); setConfirmDel(false); }}
                        className="shrink-0 rounded-[var(--radius-sm)] bg-[color-mix(in_srgb,var(--color-destructive)_20%,transparent)] px-2 py-1 text-[0.7rem] text-[color:var(--color-destructive)]"
                      >
                        delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDel(false)}
                        className="shrink-0 px-1 text-[0.7rem] text-text-tertiary"
                      >
                        cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => { haptic(4); setRenameVal(thread.title); setRenaming(true); }}
                        className="rounded-[var(--radius-sm)] px-2 py-1 text-[0.7rem] text-text-tertiary transition-colors hover:text-midground"
                      >
                        rename
                      </button>
                      <button
                        type="button"
                        onClick={() => { haptic(6); onArchive(); }}
                        className="rounded-[var(--radius-sm)] px-2 py-1 text-[0.7rem] text-text-tertiary transition-colors hover:text-midground"
                      >
                        archive
                      </button>
                      <button
                        type="button"
                        onClick={() => { haptic(4); setConfirmDel(true); }}
                        className="rounded-[var(--radius-sm)] px-2 py-1 text-[0.7rem] text-text-tertiary transition-colors hover:text-[color:var(--color-destructive)]"
                      >
                        delete
                      </button>
                    </>
                  )}
                </div>
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
