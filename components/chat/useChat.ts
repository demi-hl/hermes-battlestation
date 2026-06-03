"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "@/components/shell/workspace-context";
import type {
  ChatThread,
  ChatRepo,
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
    const trimmed = msgs.slice(-MAX_KEEP);
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
  const { setActiveWorkspace, setStatus, setContextUsage, active } = useWorkspace();

  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [repos, setRepos] = useState<ChatRepo[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>("general");
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
      setThreads(data.threads ?? []);
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

  // Load the active thread's transcript from local storage on switch.
  useEffect(() => {
    setMessages(loadTranscript(activeThreadId));
  }, [activeThreadId]);

  // Persist on every change.
  useEffect(() => {
    if (messages.length) saveTranscript(activeThreadId, messages);
  }, [messages, activeThreadId]);

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
          branch: repo?.branch ?? "main",
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

  // Start (or focus) a thread for a repo that may not have a session yet.
  const startRepoThread = useCallback((repo: ChatRepo) => {
    setThreads((prev) => {
      const existing = prev.find((t) => t.repo === repo.name);
      if (existing) {
        setActiveThreadId(existing.id);
        return prev;
      }
      const shell = makeRepoThread(repo.name, repo.path, repo.branch);
      setActiveThreadId(shell.id);
      return [...prev, shell];
    });
  }, []);

  const send = useCallback(
    async (text: string, skills: string[] = []) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      // Slash commands: `/compress` → instruction to compress context.
      let message = trimmed;
      if (trimmed.startsWith("/")) {
        const cmd = trimmed.slice(1).toLowerCase();
        const SLASH_MAP: Record<string, string> = {
          compress:
            "Please compress our conversation – summarize all key context, decisions, and active state into a concise summary. Report the total token savings.",
          summary:
            "Please provide a summary of our conversation so far, including all key decisions, context, and open items.",
          clear:
            "Please ignore previous instructions and start fresh. Tell me what context you still have about this session.",
        };
        message = SLASH_MAP[cmd] ?? trimmed;
      }

      const thread = threads.find((t) => t.id === activeThreadId);
      const repo = thread?.repo ?? "general";

      const userMsg: ChatMessage = { id: mkId(), role: "user", text: trimmed, ts: Date.now() };
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
          body: JSON.stringify({ repo, message, skills }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const errTxt = await res.text().catch(() => "");
          patchPending({ pending: false, error: true, text: errTxt || "send failed" });
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
          patchPending({ pending: false, error: true, text: "no response from agent" });
        }
        // Pull fresh thread metadata (message count, new session id, usage).
        void refreshThreads();
      } catch (e) {
        if ((e as Error)?.name === "AbortError") {
          patchPending({ pending: false, error: true, text: "stopped" });
        } else {
          patchPending({
            pending: false,
            error: true,
            text: e instanceof Error ? e.message : "send failed",
          });
        }
      } finally {
        setSending(false);
        setStatus("online");
        abortRef.current = null;
      }
    },
    [sending, threads, activeThreadId, setStatus, setContextUsage, refreshThreads],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

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
    stop,
    refreshThreads,
  };
}

function makeRepoThread(repo: string, cwd: string | null, branch: string | null): ChatThread {
  const slug = repo
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return {
    id: `lol-${slug}`,
    title: repo,
    repo,
    cwd: cwd ?? "",
    sessionTitle: `lol-${slug}`,
    sessionId: null,
    messageCount: 0,
    model: null,
    lastActive: null,
    usage: null,
  };
}
