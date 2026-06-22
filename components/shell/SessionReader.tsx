"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { haptic } from "@/components/shell/haptics";
import { cn } from "@/lib/utils";

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
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
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
      setInput("");
      setSending(false);
      fallbackAttemptedRef.current = false;
      setOpen(true);
    };
    window.addEventListener("lo-read-session", onRead as EventListener);
    return () => window.removeEventListener("lo-read-session", onRead as EventListener);
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

  const send = async () => {
    const text = input.trim();
    if (!text || sending || !meta) return;
    haptic(8);
    const userMsg: Msg = { id: mkId(), role: "user", text, ts: Date.now() };
    const pendingId = mkId();
    const pendingMsg: Msg = { id: pendingId, role: "assistant", text: "", ts: Date.now(), pending: true };
    setMsgs((m) => [...(m ?? []), userMsg, pendingMsg]);
    setInput("");
    setSending(true);

    const patch = (p: Partial<Msg>) =>
      setMsgs((m) => (m ?? []).map((x) => (x.id === pendingId ? { ...x, ...p } : x)));

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/sessions/continue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: meta.id, profile: meta.profile, message: text }),
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

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-x-0 top-0 z-[60] mx-auto flex max-w-[560px] flex-col overflow-hidden bg-[color-mix(in_srgb,var(--background-base)_94%,transparent)] backdrop-blur-xl"
          style={{
            // Pin to the keyboard-aware visible height (--app-vh tracks
            // visualViewport in Providers) instead of inset-0, so the modal
            // shrinks when the iOS keyboard opens and the composer rides above
            // it. inset-0 (100dvh) leaves the composer buried under the keyboard.
            height: "var(--app-vh, 100dvh)",
            paddingTop: "env(safe-area-inset-top)",
            // Only pad the home-indicator gap when the keyboard is CLOSED; when
            // open the keyboard already occupies that space (1 - --kb-open).
            paddingBottom:
              "calc(env(safe-area-inset-bottom) * (1 - var(--kb-open, 0)))",
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
              <span className="truncate text-[0.95rem] font-medium text-midground">{title}</span>
              <span className="font-mono-ui text-[0.62rem] uppercase tracking-wider text-text-tertiary">
                {meta?.profile} · {msgs ? `${msgs.length} messages` : "loading"}
              </span>
            </div>
          </div>

          {/* transcript */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-3 py-3">
            {loading ? (
              <div className="flex items-center gap-2 py-6">
                <span className="h-2 w-2 animate-pulse rounded-full bg-text-tertiary" />
                <span className="text-[0.8rem] text-text-tertiary">Loading transcript…</span>
              </div>
            ) : msgs && msgs.length > 0 ? (
              <div className="flex flex-col gap-2.5 pb-4">
                {msgs.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "rounded-[var(--radius-md)] px-3 py-2.5",
                      m.error
                        ? "bg-[color-mix(in_srgb,var(--color-destructive,#f87171)_12%,transparent)] text-[color:var(--color-destructive,#f87171)]"
                        : m.role === "user"
                          ? "bg-[color-mix(in_srgb,var(--midground)_10%,transparent)] text-text-secondary"
                          : "bg-[color-mix(in_srgb,var(--midground)_4%,transparent)] text-text-tertiary",
                    )}
                  >
                    <span className="font-mono-ui text-[0.56rem] uppercase tracking-wider text-text-disabled">
                      {m.role}
                    </span>
                    {m.pending && !m.text ? (
                      <div className="mt-1 flex items-center gap-2">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-text-tertiary" />
                        <span className="text-[0.8rem] text-text-tertiary">Working…</span>
                      </div>
                    ) : (
                      <p className="mt-1 whitespace-pre-wrap break-words text-[0.84rem] leading-relaxed">
                        {m.text}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-[0.82rem] text-text-tertiary">No messages in this session.</p>
            )}
          </div>

          {/* continue composer */}
          <div className="shrink-0 border-t border-border px-3 py-2.5">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder="Continue this session…"
                disabled={sending}
                className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-[var(--radius-md)] border border-border bg-[color-mix(in_srgb,var(--midground)_5%,transparent)] px-3 py-2 text-[0.85rem] text-midground outline-none placeholder:text-text-disabled focus:border-[color-mix(in_srgb,var(--midground)_30%,transparent)]"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={sending || !input.trim()}
                aria-label="Send"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-midground text-background-base transition-opacity disabled:opacity-40 active:scale-95"
              >
                {sending ? (
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-background-base" />
                ) : (
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
