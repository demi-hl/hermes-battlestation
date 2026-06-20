"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "@/components/shell/workspace-context";
import type {
  ChatThread,
  ChatRepo,
  ChatImage,
  ChatStreamEvent,
  ThreadsPayload,
} from "@/lib/chat-types";

export interface ToolActivity {
  id: string;
  name: string;
  title: string;
  done: boolean;
  ok: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  ts: number;
  /** Assistant placeholder while the turn streams. */
  pending?: boolean;
  error?: boolean;
  /** Live elapsed time shown on the pending bubble. */
  elapsedMs?: number;
  note?: string;
  /** Streaming reasoning text (ACP agent_thought_chunk). */
  thought?: string;
  /** Live tool-call activity for this turn. */
  tools?: ToolActivity[];
  /** Image attachments shown as thumbnails on a user bubble (data URLs). */
  images?: string[];
  /** On a failed assistant bubble: the payload to resend on retry tap. */
  retry?: { text: string; skills: string[]; images: string[] };
}

const TRANSCRIPT_PREFIX = "lo-chat:v1:";
const MAX_KEEP = 200;

function loadTranscript(threadId: string): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(TRANSCRIPT_PREFIX + threadId);
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

function saveTranscript(threadId: string, msgs: ChatMessage[]) {
  if (typeof window === "undefined") return;
  try {
    // Drop base64 image payloads before persisting — a single photo can exceed
    // the ~5MB localStorage quota and silently fail the whole save. The live
    // session keeps the thumbnails in memory; on reload the bubble just renders
    // without them (the durable transcript is the backend's job anyway).
    const trimmed = msgs.slice(-MAX_KEEP).map((m) =>
      m.images ? { ...m, images: undefined } : m,
    );
    window.localStorage.setItem(TRANSCRIPT_PREFIX + threadId, JSON.stringify(trimmed));
  } catch {
    /* quota / disabled storage — transcript is best-effort */
  }
}

let _idc = 0;
function mkId(): string {
  _idc += 1;
  return `m${Date.now().toString(36)}_${_idc}`;
}

export function useChat() {
  const { setActiveWorkspace, setStatus, setContextUsage, active, model, activeProfile } = useWorkspace();

  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [repos, setRepos] = useState<ChatRepo[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>(() => {
    if (typeof window === "undefined") return "general";
    return localStorage.getItem("lo-active-thread") ?? "general";
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [threadsError, setThreadsError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const syncedRepoRef = useRef<string | null>(null);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? null,
    [threads, activeThreadId],
  );

  const refreshThreads = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/threads", { cache: "no-store" });
      const data = (await res.json()) as ThreadsPayload;
      // Merge, don't replace: keep locally-created shells (a repo thread opened
      // from the Repos pane before it has a backend session) that the backend
      // doesn't yet know about, so a mount-time refresh can't clobber the
      // thread we just navigated into.
      setThreads((prev) => {
        const backend = data.threads ?? [];
        const backendIds = new Set(backend.map((t) => t.id));
        const shells = prev.filter(
          (t) => !backendIds.has(t.id) && t.sessionId == null && !!t.repo,
        );
        return [...backend, ...shells];
      });
      setRepos(data.repos ?? []);
      setThreadsError(data.error ?? null);
    } catch (e) {
      setThreadsError(e instanceof Error ? e.message : "failed to load threads");
    } finally {
      setLoadingThreads(false);
    }
  }, []);

  useEffect(() => {
    void refreshThreads();
  }, [refreshThreads]);

  // Load the active thread's transcript from local storage on switch (instant
  // paint), then hydrate from backend truth (the real shared session in
  // state.db) so history is correct on any device, including a fresh one whose
  // localStorage is empty.
  useEffect(() => {
    setMessages(loadTranscript(activeThreadId));
    if (typeof window !== "undefined") {
      localStorage.setItem("lo-active-thread", activeThreadId);
    }
  }, [activeThreadId]);

  useEffect(() => {
    let cancelled = false;
    const thread = threads.find((t) => t.id === activeThreadId);
    const repo = thread?.repo ?? "general";
    const branch = thread?.branch ?? null;
    // Only hydrate threads that have a real backend session already.
    if (thread && thread.sessionId == null && thread.messageCount === 0) return;
    (async () => {
      try {
        const qs = new URLSearchParams({ repo });
        if (branch) qs.set("branch", branch);
        const res = await fetch(
          `/api/chat/history?${qs.toString()}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { messages?: ChatMessage[] };
        if (cancelled || !data.messages) return;
        // Replace cache with backend truth, but never clobber an in-flight turn
        // (a pending assistant bubble not yet persisted server-side).
        setMessages((prev) => {
          const hasPending = prev.some((m) => m.pending);
          if (hasPending) return prev;
          if (!data.messages!.length) return prev; // keep cache if backend empty
          return data.messages!;
        });
      } catch {
        /* offline / backend unreachable — keep the localStorage paint */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeThreadId, threads]);

  // Persist on every change.
  useEffect(() => {
    if (messages.length) saveTranscript(activeThreadId, messages);
  }, [messages, activeThreadId]);

  // DURABLE TURNS — foreground re-sync. A turn keeps running on the host when
  // the app is backgrounded (the send route no longer cancels on disconnect),
  // so on return we re-pull the active thread's transcript from state.db to show
  // a turn that completed while away. Guarded: skip if a stream is live locally
  // (abortRef set) so we never clobber an in-flight turn.
  useEffect(() => {
    const onForeground = () => {
      if (document.visibilityState !== "visible") return;
      if (abortRef.current) return; // a live stream owns the messages
      const thread = threads.find((t) => t.id === activeThreadId);
      const repo = thread?.repo ?? "general";
      const branch = thread?.branch ?? null;
      const qs = new URLSearchParams({ repo });
      if (branch) qs.set("branch", branch);
      fetch(`/api/chat/history?${qs.toString()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { messages?: ChatMessage[] } | null) => {
          if (!data?.messages?.length) return;
          setMessages((prev) => {
            if (prev.some((m) => m.pending)) return prev; // never clobber live
            // Backend has more (the away-turn landed) or we were showing a
            // dropped-connection error bubble → adopt backend truth.
            const staleError = prev.some((m) => m.error);
            if (data.messages!.length >= prev.length || staleError) {
              return data.messages!;
            }
            return prev;
          });
        })
        .catch(() => {});
      void refreshThreads();
    };
    document.addEventListener("visibilitychange", onForeground);
    return () => document.removeEventListener("visibilitychange", onForeground);
  }, [activeThreadId, threads, refreshThreads]);

  // Drive the bottom ContextBar from the active thread.
  const bindWorkspace = useCallback(
    (thread: ChatThread | null) => {
      if (!thread || !thread.repo) {
        setActiveWorkspace(null);
      } else {
        const repo = repos.find((r) => r.name === thread.repo);
        setActiveWorkspace({
          repo: thread.repo,
          path: thread.cwd,
          branch: thread.branch ?? repo?.branch ?? "main",
        });
      }
      setContextUsage(thread?.usage ?? null);
    },
    [repos, setActiveWorkspace, setContextUsage],
  );

  useEffect(() => {
    bindWorkspace(activeThread);
    if (activeThread?.repo) syncedRepoRef.current = activeThread.repo;
  }, [activeThread, bindWorkspace]);

  // React to an external workspace selection (e.g. the Repos pane in slice 3
  // calling setActiveWorkspace) by switching the chat thread to that repo.
  useEffect(() => {
    const repo = active?.repo ?? null;
    if (!repo || repo === syncedRepoRef.current) return;
    const existing = threads.find((t) => t.repo === repo);
    if (existing) {
      syncedRepoRef.current = repo;
      setActiveThreadId(existing.id);
    } else if (active) {
      // No session yet for this repo: materialize a thread shell so chat can
      // bind + spawn it on first message.
      const shell = makeRepoThread(repo, active.path ?? null, active.branch);
      syncedRepoRef.current = repo;
      setThreads((prev) => (prev.some((t) => t.id === shell.id) ? prev : [...prev, shell]));
      setActiveThreadId(shell.id);
    }
  }, [active, threads]);

  const selectThread = useCallback((id: string) => {
    abortRef.current?.abort();
    setActiveThreadId(id);
  }, []);

  // Start (or focus) a thread for a repo/branch that may not have a session yet.
  const startRepoThread = useCallback(
    (repo: ChatRepo & { branch?: string | null; base?: string | null }) => {
      const shell = makeRepoThread(
        repo.name,
        repo.path,
        repo.branch ?? null,
        repo.base ?? null,
      );
      setThreads((prev) => {
        const existing = prev.find((t) => t.id === shell.id);
        if (existing) {
          setActiveThreadId(existing.id);
          return prev;
        }
        setActiveThreadId(shell.id);
        return [...prev, shell];
      });
    },
    [],
  );

  // Open a repo's session from another surface (the Repos pane). On mobile the
  // Chat pane is unmounted while you're on Repos, so a plain window event would
  // fire into the void before ChatHub mounts. We hand off via localStorage
  // (consumed on mount, below) AND a live event (for the already-mounted case).
  useEffect(() => {
    const open = (r: {
      name: string;
      path?: string | null;
      branch?: string | null;
      base?: string | null;
    }) => {
      if (!r?.name) return;
      startRepoThread({
        name: r.name,
        path: r.path ?? "",
        branch: r.branch ?? null,
        base: r.base ?? null,
      });
    };
    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem("lo-pending-repo");
        if (raw) {
          localStorage.removeItem("lo-pending-repo");
          open(JSON.parse(raw));
        }
      } catch {
        /* malformed handoff; ignore */
      }
    }
    const onEvt = (e: Event) => open((e as CustomEvent).detail);
    window.addEventListener("lo-open-repo", onEvt as EventListener);
    return () => window.removeEventListener("lo-open-repo", onEvt as EventListener);
  }, [startRepoThread]);

  const send = useCallback(
    async (text: string, skills: string[] = [], images: ChatImage[] = []) => {
      const trimmed = text.trim();
      if ((!trimmed && images.length === 0) || sending) return;

      // Slash commands: `/compress` → instruction to compress context.
      let message = trimmed;
      if (trimmed.startsWith("/")) {
        const cmd = trimmed.slice(1).toLowerCase();
        const SLASH_MAP: Record<string, string> = {
          compress:
            "Please compress our conversation – summarize all key context, decisions, and active state into a concise summary. Report the total token savings.",
          summary:
            "Please provide a summary of our conversation so far, including all key decisions, context, and open items.",
          cost:
            "Report this session's token usage and approximate cost so far — prompt tokens, completion tokens, and total.",
        };
        message = SLASH_MAP[cmd] ?? trimmed;
      }

      const thread = threads.find((t) => t.id === activeThreadId);
      const repo = thread?.repo ?? "general";
      const branch = thread?.branch ?? null;

      // Snapshot the exact send payload so a failed turn can be resent verbatim
      // (the composer has already been cleared by the caller).
      const retryPayload = {
        text: trimmed,
        skills,
        images: images.map((im) => im.data),
      };

      const userMsg: ChatMessage = {
        id: mkId(),
        role: "user",
        text: trimmed,
        ts: Date.now(),
        ...(images.length ? { images: images.map((im) => im.data) } : {}),
      };
      const pendingMsg: ChatMessage = {
        id: mkId(),
        role: "assistant",
        text: "",
        ts: Date.now(),
        pending: true,
        elapsedMs: 0,
      };
      setMessages((m) => [...m, userMsg, pendingMsg]);
      setSending(true);
      setStatus("connecting");

      const patchPending = (patch: Partial<ChatMessage>) =>
        setMessages((m) => m.map((x) => (x.id === pendingMsg.id ? { ...x, ...patch } : x)));

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        const res = await fetch("/api/chat/send", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ repo, branch, message, skills, images, profile: activeProfile?.id ?? "default", model: model.id, provider: model.provider }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const errTxt = await res.text().catch(() => "");
          patchPending({ pending: false, error: true, text: errTxt || "send failed", retry: retryPayload });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let got = false;

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            let ev: ChatStreamEvent;
            try {
              ev = JSON.parse(line) as ChatStreamEvent;
            } catch {
              continue;
            }
            if (ev.type === "status") {
              patchPending({ elapsedMs: ev.elapsedMs, note: ev.note });
            } else if (ev.type === "delta") {
              got = true;
              // Append streamed text; clear the pending spinner on first token.
              setMessages((m) =>
                m.map((x) =>
                  x.id === pendingMsg.id
                    ? { ...x, pending: false, text: x.text + ev.text }
                    : x,
                ),
              );
            } else if (ev.type === "thought") {
              setMessages((m) =>
                m.map((x) =>
                  x.id === pendingMsg.id
                    ? { ...x, thought: (x.thought ?? "") + ev.text }
                    : x,
                ),
              );
            } else if (ev.type === "tool") {
              setMessages((m) =>
                m.map((x) => {
                  if (x.id !== pendingMsg.id) return x;
                  const tools = x.tools ? [...x.tools] : [];
                  const i = tools.findIndex((t) => t.id === ev.id);
                  if (ev.phase === "start") {
                    if (i === -1)
                      tools.push({
                        id: ev.id,
                        name: ev.name,
                        title: ev.title,
                        done: false,
                        ok: false,
                      });
                  } else if (i !== -1) {
                    tools[i] = { ...tools[i], done: true, ok: ev.ok };
                  }
                  return { ...x, tools };
                }),
              );
            } else if (ev.type === "message") {
              got = true;
              patchPending({ pending: false, text: ev.text, error: false });
            } else if (ev.type === "usage") {
              setContextUsage({ used: ev.used, total: ev.total });
            } else if (ev.type === "error") {
              got = true;
              patchPending({ pending: false, error: true, text: ev.error });
            }
            // "session" + "done" carry no UI text change here.
          }
        }
        if (!got) {
          patchPending({ pending: false, error: true, text: "no response from agent", retry: retryPayload });
        }
        // Pull fresh thread metadata (message count, new session id, usage).
        void refreshThreads();
      } catch (e) {
        if ((e as Error)?.name === "AbortError") {
          patchPending({ pending: false, error: true, text: "stopped" });
        } else {
          // A thrown fetch (vs an HTTP error) means the connection dropped —
          // classically when iOS backgrounds the app mid-turn. WKWebView's raw
          // string is "Load failed"; show a human message + a retry tap.
          const raw = e instanceof Error ? e.message : "";
          const lost = !raw || /load failed|network|fetch|connection/i.test(raw);
          patchPending({
            pending: false,
            error: true,
            text: lost ? "connection lost — tap to retry" : raw,
            retry: retryPayload,
          });
        }
      } finally {
        setSending(false);
        setStatus("online");
        abortRef.current = null;
      }
    },
    [sending, threads, activeThreadId, setStatus, setContextUsage, refreshThreads, model, activeProfile],
  );

  const stop = useCallback(() => {
    // Two-part stop: abort the HTTP stream locally AND tell the agent to cancel
    // the turn server-side (the fetch-abort alone leaves the ACP turn running).
    abortRef.current?.abort();
    const thread = threads.find((t) => t.id === activeThreadId);
    const repo = thread?.repo ?? "general";
    void fetch("/api/chat/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo }),
    }).catch(() => {
      /* best-effort: local abort already happened */
    });
  }, [threads, activeThreadId]);

  // Start a brand new session for the active thread's repo, discarding the
  // current transcript binding so the next turn opens a fresh agent session.
  const newSession = useCallback(async () => {
    const thread = threads.find((t) => t.id === activeThreadId);
    const repo = thread?.repo ?? "general";
    try {
      await fetch("/api/chat/new-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo }),
      });
    } catch {
      /* the session is created lazily on next prompt anyway */
    }
    // Clear the local transcript for this thread so the new session starts clean.
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(TRANSCRIPT_PREFIX + activeThreadId);
    }
    setMessages([]);
    void refreshThreads();
  }, [threads, activeThreadId, refreshThreads]);

  // Retry a failed turn: drop the errored assistant bubble + its user message,
  // then resend the captured payload. Used by the "tap to retry" affordance on a
  // failed bubble (genuine errors, or a dropped connection where the turn didn't
  // actually land server-side).
  const retry = useCallback(
    (msgId: string) => {
      const failed = messages.find((m) => m.id === msgId);
      if (!failed?.retry) return;
      const payload = failed.retry;
      const idx = messages.findIndex((m) => m.id === msgId);
      // Strip the errored assistant bubble and the immediately-preceding user
      // bubble (the one being resent) so we don't duplicate it.
      setMessages((m) => {
        const userIdx = idx > 0 && m[idx - 1]?.role === "user" ? idx - 1 : idx;
        return m.filter((_, i) => i !== idx && i !== userIdx);
      });
      const imgs = payload.images.map((data) => ({ data, mime: "image/png" }));
      void send(payload.text, payload.skills, imgs);
    },
    [messages, send],
  );

  // Create a git branch in the active thread's repo (no-op for general).
  const createBranch = useCallback(
    async (branch: string): Promise<{ ok: boolean; error?: string }> => {
      const thread = threads.find((t) => t.id === activeThreadId);
      const repo = thread?.repo;
      if (!repo) return { ok: false, error: "bind a repo first" };
      try {
        const res = await fetch("/api/git/branch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ repo, branch }),
        });
        const data = (await res.json()) as { ok: boolean; error?: string };
        if (data.ok) void refreshThreads();
        return data;
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "branch failed" };
      }
    },
    [threads, activeThreadId, refreshThreads],
  );

  return {
    threads,
    repos,
    activeThread,
    activeThreadId,
    messages,
    sending,
    loadingThreads,
    threadsError,
    selectThread,
    startRepoThread,
    send,
    retry,
    stop,
    newSession,
    createBranch,
    refreshThreads,
  };
}

function makeRepoThread(
  repo: string,
  cwd: string | null,
  branch: string | null,
  base?: string | null,
): ChatThread {
  const slug = repo
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // A specific (non-base) branch gets its own session id + title so branches
  // run independently; the base branch collapses to the plain repo session.
  const isBranch = !!branch && (!base || branch !== base);
  const branchSlug = (branch ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const title = isBranch ? `lol-${slug}__${branchSlug}` : `lol-${slug}`;
  return {
    id: title,
    title: isBranch ? `${repo} · ${branch}` : repo,
    repo,
    branch: branch ?? null,
    cwd: cwd ?? "",
    sessionTitle: title,
    sessionId: null,
    messageCount: 0,
    model: null,
    lastActive: null,
    usage: null,
  };
}
