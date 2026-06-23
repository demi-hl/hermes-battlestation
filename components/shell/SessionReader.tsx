"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { haptic } from "@/components/shell/haptics";
import { Composer } from "@/components/chat/Composer";
import { MessageList } from "@/components/chat/MessageList";
import type { ChatMessage } from "@/components/chat/useChat";

interface Msg {
  id: string;
  role: "user" | "assistant";
  text: string;
  ts: number;
  pending?: boolean;
  error?: boolean;
}

interface StreamEvent {
  type: string;
  text?: string;
  error?: string;
}

let _idc = 0;
const mkId = () => `sr${Date.now().toString(36)}_${++_idc}`;

/**
 * Global full-screen session reader + resume. ANY session (default/cron/
 * telegram/CLI) opens here as a full scrollable transcript, AND can be
 * CONTINUED: the composer posts to /api/sessions/continue, which loads the
 * exact Hermes session via the ACP bridge (`session/load`) and streams a real
 * agent turn back. This is the true resume path — not the repo/branch-keyed
 * /api/chat/send, which can't reach a telegram/cron session. Fired by
 * `lo-read-session` { profile, id, title }. Sessions rows + Tasks cards open it.
 */
export function SessionReader() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState<string>("");
  const [meta, setMeta] = useState<{ profile: string; id: string } | null>(null);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [queued, setQueued] = useState<{ id: string; text: string; images?: { data: string; mime: string }[] }[]>([]);
  const fallbackAttemptedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const onRead = (e: Event) => {
      const d = (e as CustomEvent<{ profile?: string; id?: string; title?: string }>).detail;
      if (!d?.id) return;
      haptic(8);
      abortRef.current?.abort();
      setTitle(d.title || "session");
      setMeta({ profile: d.profile || "default", id: d.id });
      setMsgs(null);
      setSending(false);
      setQueued([]);
      fallbackAttemptedRef.current = false;
      setOpen(true);
    };
    window.addEventListener("lo-read-session", onRead as EventListener);
    // Tapping a bottom tab (or any cross-tab nav) should leave the reader and
    // land on that tab — the chrome stays visible behind the reader, so its
    // taps must close this. lo-read-close is fired by the tab bar; lo-nav by
    // the ContextBar / panes.
    const onClose = () => setOpen(false);
    window.addEventListener("lo-read-close", onClose);
    window.addEventListener("lo-nav", onClose);
    return () => {
      window.removeEventListener("lo-read-session", onRead as EventListener);
      window.removeEventListener("lo-read-close", onClose);
      window.removeEventListener("lo-nav", onClose);
    };
  }, []);

  useEffect(() => {
    if (!open || !meta || msgs !== null) return;
    let live = true;
    setLoading(true);
    const normalizeTitle = (s: string) =>
      s
        .toLowerCase()
        .replace(/\s+#\d+\s*$/, "")
        .replace(/\s+/g, " ")
        .trim();
    fetch(
      `/api/sessions/transcript?profile=${encodeURIComponent(meta.profile)}&id=${encodeURIComponent(meta.id)}`,
      { cache: "no-store" },
    )
      .then((r) => r.json() as Promise<{ messages?: Msg[] }>)
      .then(async (j) => {
        const next = j.messages ?? [];
        if (live && next.length === 0 && !fallbackAttemptedRef.current && title.trim()) {
          // Task cards can point at stub run ids with 0 messages ("... #2").
          // Fall back to the newest non-empty session with the same base title.
          fallbackAttemptedRef.current = true;
          const base = normalizeTitle(title);
          const r = await fetch(
            `/api/sessions/all?profile=${encodeURIComponent(meta.profile)}`,
            { cache: "no-store" },
          ).catch(() => null);
          const all = (await r?.json().catch(() => null)) as
            | { sessions?: Array<{ id: string; title?: string | null; messageCount?: number }> }
            | null;
          const candidate = all?.sessions?.find(
            (s) =>
              s.id !== meta.id &&
              (s.messageCount ?? 0) > 0 &&
              normalizeTitle(s.title || "") === base,
          );
          if (candidate?.id && live) {
            setTitle(candidate.title || title);
            setMeta({ profile: meta.profile, id: candidate.id });
            setMsgs(null);
            return;
          }
        }
        if (live) setMsgs(next);
      })
      .catch(() => live && setMsgs([]))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [open, meta, msgs, title]);

  // Auto-scroll to bottom as messages grow / stream.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  // lock body scroll while open; Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => {
    haptic(6);
    abortRef.current?.abort();
    setOpen(false);
  };

  // The actual streamed turn. Guarded by `sending` via enqueue/drain below.
  const runTurn = async (text: string, images?: { data: string; mime: string }[]) => {
    const trimmed = text.trim();
    if ((!trimmed && !(images && images.length)) || !meta) return;
    haptic(8);
    const userMsg: Msg = { id: mkId(), role: "user", text: trimmed, ts: Date.now() };
    const pendingId = mkId();
    const pendingMsg: Msg = { id: pendingId, role: "assistant", text: "", ts: Date.now(), pending: true };
    setMsgs((m) => [...(m ?? []), userMsg, pendingMsg]);
    setSending(true);

    const patch = (p: Partial<Msg>) =>
      setMsgs((m) => (m ?? []).map((x) => (x.id === pendingId ? { ...x, ...p } : x)));

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/sessions/continue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: meta.id, profile: meta.profile, message: trimmed, images }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.text().catch(() => "");
        patch({ pending: false, error: true, text: err || "send failed" });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: StreamEvent;
          try {
            ev = JSON.parse(line) as StreamEvent;
          } catch {
            continue;
          }
          if (ev.type === "delta" && ev.text) {
            patch({ pending: false });
            setMsgs((m) =>
              (m ?? []).map((x) => (x.id === pendingId ? { ...x, text: x.text + ev.text } : x)),
            );
          } else if (ev.type === "message" && ev.text) {
            patch({ pending: false, text: ev.text });
          } else if (ev.type === "error") {
            patch({ pending: false, error: true, text: ev.error || "agent error" });
          }
        }
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        patch({ pending: false, error: true, text: "connection dropped" });
      }
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  };

  // Queue a follow-up while a turn runs; send immediately when idle (mirrors the
  // Chat tab's enqueue → FIFO drain).
  const enqueue = (text: string, images?: { data: string; mime: string }[]) => {
    const trimmed = text.trim();
    if (!trimmed && !(images && images.length)) return;
    if (!sending) {
      void runTurn(text, images);
      return;
    }
    setQueued((q) => [...q, { id: mkId(), text: trimmed, images }]);
  };
  const cancelQueued = (id: string) => setQueued((q) => q.filter((m) => m.id !== id));

  // Stop: abort the local stream AND tell the host to cancel the turn server-side.
  const stop = () => {
    abortRef.current?.abort();
    if (meta) {
      void fetch("/api/sessions/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: meta.id, profile: meta.profile }),
      }).catch(() => {});
    }
  };

  // Drain: when a turn finishes and items are waiting, fire the next (one at a time).
  useEffect(() => {
    if (sending || queued.length === 0) return;
    const [next, ...rest] = queued;
    setQueued(rest);
    void runTurn(next.text, next.images);
  }, [sending, queued]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-x-0 top-0 z-[40] mx-auto flex max-w-[560px] flex-col overflow-hidden backdrop-blur-xl"
          style={{
            // Translucent veil — let the app's green Backdrop show THROUGH like
            // the Chat tab does (ChatHub paints no opaque bg). A solid base here
            // regressed to near-black and killed the themed green (the exact
            // "do not paint opaque over the Backdrop" trap in CLAUDE.md). The
            // blur + low-alpha tint separates the reader from the pane beneath
            // without hiding the theme.
            background: "color-mix(in srgb, var(--background-base) 62%, transparent)",
            // Stop ABOVE the bottom chrome (context bar + tab bar) so it stays
            // visible — the reader should feel like the Chat tab, not a full
            // takeover. When the keyboard opens the chrome translates away
            // (--kb-open→1), so the subtraction collapses to 0 and the reader
            // extends full-height with the composer riding above the keyboard.
            height:
              "calc(var(--app-vh, 100dvh) - (var(--app-context-h) + var(--app-tabbar-h) + env(safe-area-inset-bottom)) * (1 - var(--kb-open, 0)))",
            paddingTop: "env(safe-area-inset-top)",
          }}
        >
          {/* header */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-3">
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-md)] border border-border text-midground active:scale-95"
            >
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-mondwest text-display text-[0.9rem] tracking-wide text-midground">{title}</span>
              <span className="font-mono-ui text-[0.62rem] uppercase tracking-wider text-text-tertiary">
                {meta?.profile} · {msgs ? `${msgs.length} messages` : "loading"}
              </span>
            </div>
          </div>

          {/* transcript — the SAME MessageList as the Chat tab (bubbles,
              markdown, hermes label, tool tray) so the theme matches exactly. */}
          <div
            ref={scrollRef}
            data-msg-scroll
            className="flex-1 overflow-y-auto overscroll-contain"
          >
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-6">
                <span className="h-2 w-2 animate-pulse rounded-full bg-text-tertiary" />
                <span className="text-[0.8rem] text-text-tertiary">Loading transcript…</span>
              </div>
            ) : msgs && msgs.length > 0 ? (
              <MessageList
                messages={msgs as ChatMessage[]}
                thread={null}
                sending={sending}
              />
            ) : (
              <p className="py-8 text-center text-[0.82rem] text-text-tertiary">No messages in this session.</p>
            )}
          </div>

          {/* continue composer — the SAME Composer as the Chat tab */}
          <Composer
            onSend={(text, images) => enqueue(text, images)}
            onStop={stop}
            onNewSession={close}
            onTask={() => {}}
            sending={sending}
            queued={queued.map((q) => ({ id: q.id, text: q.text }))}
            onCancelQueued={cancelQueued}
            skills={[]}
            onRemoveSkill={() => {}}
            onOpenSkills={() => {}}
            contextLabel={title}
            placeholder="Continue session"
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
