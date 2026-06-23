"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SVGProps } from "react";
import { motion } from "framer-motion";
import { SendIcon, CloseIcon } from "@/components/shell/icons";
import { SparkIcon, StopIcon } from "./icons";
import { haptic } from "@/components/shell/haptics";
import { cn } from "@/lib/utils";

// Discoverable slash commands. Typing "/" surfaces this menu. Prompt commands
// (compress/summary/cost) are expanded into instructions in useChat.send;
// action commands (new/clear) are intercepted here and run newSession instead.
type SlashCmd = { name: string; desc: string; action?: boolean };
const SLASH_COMMANDS: SlashCmd[] = [
  { name: "task", desc: "File this as a Kanban card", action: true },
  { name: "compress", desc: "Summarize context, free up tokens" },
  { name: "summary", desc: "Recap decisions and open items" },
  { name: "cost", desc: "Token usage this session" },
  { name: "new", desc: "Start a fresh session", action: true },
  { name: "clear", desc: "Clear this conversation", action: true },
];

// Inline mic glyph (same house style as chat/icons.tsx: 24 viewBox,
// currentColor, round caps). Kept local since icons.tsx is owned elsewhere.
function MicIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

// Inline image/attach glyph (same house style). Local to keep icons.tsx clean.
function ImageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="M21 16l-5-5L5 20" />
    </svg>
  );
}

export function Composer({
  onSend,
  onStop,
  onNewSession,
  onTask,
  sending,
  queued,
  onCancelQueued,
  skills,
  onRemoveSkill,
  onOpenSkills,
  contextLabel,
  placeholder,
}: {
  onSend: (text: string, images?: { data: string; mime: string }[]) => void;
  onStop: () => void;
  onNewSession: () => void;
  onTask: (title: string) => void;
  sending: boolean;
  queued: { id: string; text: string }[];
  onCancelQueued: (id: string) => void;
  skills: string[];
  onRemoveSkill: (s: string) => void;
  onOpenSkills: () => void;
  contextLabel: string;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const [images, setImages] = useState<{ id: string; data: string; mime: string }[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Read a File/Blob into a base64 data URL and stage it as a pending image.
  const addFiles = (files: Iterable<File>) => {
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const data = typeof reader.result === "string" ? reader.result : "";
        if (!data) return;
        setImages((prev) =>
          prev.length >= 6
            ? prev
            : [...prev, { id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, data, mime: file.type }],
        );
      };
      reader.readAsDataURL(file);
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imgs = Array.from(e.clipboardData?.files ?? []).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (imgs.length) {
      e.preventDefault();
      haptic(8);
      addFiles(imgs);
    }
  };

  // Slash-command menu: open while the draft is a bare "/word" with no space.
  const slashQuery =
    value.startsWith("/") && !value.includes(" ") ? value.slice(1).toLowerCase() : null;
  const slashMatches =
    slashQuery !== null
      ? SLASH_COMMANDS.filter((c) => c.name.startsWith(slashQuery))
      : [];
  const slashOpen = slashMatches.length > 0;

  // Dictation. Web Speech (desktop Chrome / Safari) is the fast path; the iOS
  // WKWebView (Capacitor) lacks it, so we fall back to MediaRecorder + a
  // server-side faster-whisper transcribe. Either way the text lands in the
  // draft (never auto-sent). MediaRecorder is universal, so the mic ALWAYS shows.
  const [recording, setRecording] = useState(false);
  const recognitionRef = useRef<any>(null);
  const recRef = useRef<MediaRecorder | null>(null);

  const appendTranscript = (transcript: string) => {
    const t = transcript.trim();
    if (!t) return;
    setValue((prev) => (prev ? prev.replace(/\s+$/, "") + " " + t : t));
    requestAnimationFrame(() => taRef.current?.focus());
  };

  // MediaRecorder -> /api/transcribe (faster-whisper on Pop). Second tap stops +
  // sends; a 15s cap auto-stops a forgotten clip.
  const recordAndTranscribe = async () => {
    if (recRef.current && recRef.current.state === "recording") {
      recRef.current.stop();
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setRecording(false);
      return;
    }
    const chunks: BlobPart[] = [];
    const mr = new MediaRecorder(stream);
    recRef.current = mr;
    setRecording(true);
    haptic(8);
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      recRef.current = null;
      setRecording(false);
      const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
      try {
        const res = await fetch("/api/transcribe", { method: "POST", body: blob });
        const body = (await res.json()) as { text?: string };
        if (body.text?.trim()) appendTranscript(body.text);
      } catch {
        /* transcription failed — silently no-op, draft is untouched */
      }
    };
    mr.start();
    setTimeout(() => {
      if (recRef.current && recRef.current.state === "recording") recRef.current.stop();
    }, 15_000);
  };

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {}
      try {
        if (recRef.current && recRef.current.state === "recording") recRef.current.stop();
      } catch {}
    };
  }, []);

  const toggleDictation = () => {
    if (typeof window === "undefined") return;
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    // Stop whatever is active.
    if (recording) {
      try {
        recognitionRef.current?.stop();
      } catch {}
      if (recRef.current && recRef.current.state === "recording") recRef.current.stop();
      return;
    }
    // No Web Speech (iOS WKWebView): record + server-transcribe.
    if (!SR) {
      void recordAndTranscribe();
      return;
    }
    const rec = new SR();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (ev: any) => {
      let transcript = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        transcript += ev.results[i][0].transcript;
      }
      appendTranscript(transcript);
    };
    rec.onerror = () => setRecording(false);
    rec.onend = () => {
      setRecording(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = rec;
    try {
      rec.start();
      setRecording(true);
      haptic(8);
      requestAnimationFrame(() => taRef.current?.focus());
    } catch {
      // Web Speech refused to start (e.g. permissions) — fall back to recorder.
      setRecording(false);
      recognitionRef.current = null;
      void recordAndTranscribe();
    }
  };

  // Prefill from the Tasks home (Suggested chip / voice dictation). Drops the
  // text in and focuses; never auto-sends so the user reviews first. Rides the
  // same window CustomEvent bus as cross-tab nav.
  useEffect(() => {
    const onPrefill = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text;
      if (!text) return;
      setValue((prev) => (prev ? prev + " " + text : text));
      requestAnimationFrame(() => taRef.current?.focus());
    };
    window.addEventListener("lo-prefill", onPrefill as EventListener);
    return () => window.removeEventListener("lo-prefill", onPrefill as EventListener);
  }, []);

  // Auto-grow up to a cap.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, [value]);

  const runCommand = (c: SlashCmd) => {
    haptic(10);
    // /task needs a title — picking it from the menu just primes the input.
    if (c.name === "task") {
      setValue("/task ");
      requestAnimationFrame(() => taRef.current?.focus());
      return;
    }
    setValue("");
    if (c.action) {
      // /new and /clear both reset to a fresh session locally.
      onNewSession();
      return;
    }
    onSend("/" + c.name);
  };

  const submit = () => {
    const t = value.trim();
    if (!t && images.length === 0) return;
    // `/task <title>` files a Kanban card instead of sending a turn.
    if (/^\/task\s+/i.test(t)) {
      const title = t.replace(/^\/task\s+/i, "").trim();
      if (title) {
        haptic([6, 4, 8]);
        onTask(title);
        setValue("");
        setImages([]);
        return;
      }
    }
    // A bare "/cmd" matching a known command runs that command.
    if (t.startsWith("/") && !t.includes(" ") && images.length === 0) {
      const hit = SLASH_COMMANDS.find((c) => c.name === t.slice(1).toLowerCase());
      if (hit) {
        runCommand(hit);
        return;
      }
    }
    haptic([6, 4, 8]);
    onSend(t, images.map(({ data, mime }) => ({ data, mime })));
    setValue("");
    setImages([]);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      // Enter with the menu open picks the top match.
      if (slashOpen) {
        runCommand(slashMatches[0]);
        return;
      }
      submit();
    }
  };

  return (
    <div
      className="border-t border-border px-3 pt-2.5"
      style={{
        // Solid warm near-black band sampled EXACTLY from DEMI's reference
        // (composer band reads (0,0,0)→(16,10,8) brown-black). Opaque + no
        // opacity:0.96 so nothing bleeds through — this is what made the
        // continue overlay read GREEN (teal --background-base at 0.96 over the
        // overlay) while Chat read near-black over the page. Now identical on
        // every chatbox and every renderer (browser + iOS WebView).
        background: "#120c09",
        backdropFilter: "blur(20px) saturate(150%)",
        WebkitBackdropFilter: "blur(20px) saturate(150%)",
        // Sit flush on the keyboard when open (Telegram-style): the home
        // indicator safe area is covered by the keyboard, so collapse it via
        // --kb-open and keep only a small base pad. Falls back to the full safe
        // area when the keyboard is closed.
        paddingBottom: "10px",
      }}
    >
      {queued.length > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          <span className="px-1 font-mono-ui text-[0.56rem] uppercase tracking-wider text-text-tertiary">
            queued · sends after this turn
          </span>
          {queued.map((q) => (
            <motion.div
              key={q.id}
              layout
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-[color-mix(in_srgb,var(--midground)_5%,transparent)] py-1 pl-2.5 pr-1"
            >
              <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--midground)_14%,transparent)] font-mono-ui text-[0.55rem] text-text-tertiary">
                ⋯
              </span>
              <span className="min-w-0 flex-1 truncate text-[0.74rem] text-text-secondary">{q.text}</span>
              <button
                type="button"
                aria-label="Cancel queued message"
                onClick={() => {
                  haptic(6);
                  onCancelQueued(q.id);
                }}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-text-tertiary active:scale-90"
              >
                <CloseIcon width={11} height={11} />
              </button>
            </motion.div>
          ))}
        </div>
      )}

      {skills.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {skills.map((s) => (
            <motion.span
              key={s}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-1 rounded-full border border-border bg-[color-mix(in_srgb,var(--midground)_8%,transparent)] py-0.5 pl-2 pr-1 text-[0.7rem] text-midground"
            >
              <SparkIcon width={11} height={11} className="text-text-tertiary" />
              <span className="font-mono-ui">{s}</span>
              <button
                type="button"
                aria-label={`Remove ${s}`}
                onClick={() => onRemoveSkill(s)}
                className="grid h-6 w-6 place-items-center rounded-full text-text-tertiary active:scale-90"
              >
                <CloseIcon width={10} height={10} />
              </button>
            </motion.span>
          ))}
        </div>
      )}

      {images.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {images.map((img) => (
            <motion.span
              key={img.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="relative h-14 w-14 overflow-hidden rounded-[var(--radius-md)] border border-border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.data} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                aria-label="Remove image"
                onClick={() => {
                  haptic(6);
                  setImages((prev) => prev.filter((i) => i.id !== img.id));
                }}
                className="absolute right-0.5 top-0.5 grid h-7 w-7 place-items-center rounded-full bg-[color-mix(in_srgb,var(--background-base)_80%,transparent)] text-text-secondary backdrop-blur active:scale-90"
              >
                <CloseIcon width={9} height={9} />
              </button>
            </motion.span>
          ))}
        </div>
      )}

      <div className="relative flex items-end gap-2 rounded-[calc(var(--theme-radius)+6px)] border border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)] px-2.5 py-1.5">
        <span className="arc-border opacity-0 transition-opacity focus-within:opacity-100" aria-hidden />
        {slashOpen && (
          <div className="absolute bottom-[calc(100%+8px)] left-0 right-0 z-20 overflow-hidden rounded-[var(--radius-md)] border border-border bg-[var(--background-base)]/95 backdrop-blur-xl">
            {slashMatches.map((c, i) => (
              <button
                key={c.name}
                type="button"
                onClick={() => runCommand(c)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]",
                  i === 0 && "bg-[color-mix(in_srgb,var(--midground)_6%,transparent)]",
                )}
              >
                <span className="font-mono-ui text-[0.78rem] text-midground">/{c.name}</span>
                <span className="truncate text-[0.66rem] text-text-tertiary">{c.desc}</span>
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          aria-label="Attach image"
          onClick={() => {
            haptic(8);
            fileRef.current?.click();
          }}
          className="mb-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-text-tertiary transition-colors active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)] active:text-midground"
        >
          <ImageIcon width={18} height={18} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />

        <button
          type="button"
          aria-label="Skills"
          onClick={() => {
            haptic(8);
            onOpenSkills();
          }}
          className="mb-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-text-tertiary transition-colors active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)] active:text-midground"
        >
          <SparkIcon width={18} height={18} />
        </button>

        <button
          type="button"
          aria-label={recording ? "Stop dictation" : "Dictate"}
          aria-pressed={recording}
          onClick={toggleDictation}
          className={cn(
            "mb-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]",
            recording
              ? "text-[color-mix(in_srgb,var(--color-destructive)_90%,transparent)]"
              : "text-text-tertiary active:text-midground",
          )}
        >
          {recording ? (
            <motion.span
              animate={{ opacity: [1, 0.35, 1], scale: [1, 1.12, 1] }}
              transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
              className="grid place-items-center"
            >
              <MicIcon width={18} height={18} />
            </motion.span>
          ) : (
            <MicIcon width={18} height={18} />
          )}
        </button>
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={() => {
            // iOS keyboard takes a frame to open. Scroll after layout settles.
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                const msgList = document.querySelector("[data-msg-scroll]");
                if (msgList) msgList.scrollTop = msgList.scrollHeight;
              });
            });
          }}
          rows={1}
          inputMode="text"
          placeholder={placeholder ?? `Message ${contextLabel}`}
          className="scrollbar-none max-h-[140px] min-h-[28px] flex-1 resize-none bg-transparent py-1 text-base leading-relaxed text-text-primary outline-none placeholder:text-text-tertiary"
        />

        {sending ? (
          <div className="mb-0.5 flex shrink-0 items-center gap-1.5">
            {(value.trim() || images.length > 0) && (
              <button
                type="button"
                aria-label="Queue message"
                title="Queue — sends when the current turn finishes"
                onClick={submit}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-midground text-background-base transition-all active:scale-90"
              >
                <SendIcon width={15} height={15} />
              </button>
            )}
            <button
              type="button"
              aria-label="Stop"
              onClick={() => {
                haptic(12);
                onStop();
              }}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--color-destructive)_85%,transparent)] text-white transition-transform active:scale-90"
            >
              <StopIcon width={15} height={15} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            aria-label="Send"
            disabled={!value.trim() && images.length === 0}
            onClick={submit}
            className={cn(
              "mb-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full transition-all active:scale-90",
              value.trim() || images.length > 0
                ? "bg-midground text-background-base"
                : "bg-[color-mix(in_srgb,var(--midground)_12%,transparent)] text-text-tertiary",
            )}
          >
            <SendIcon width={15} height={15} />
          </button>
        )}
      </div>
    </div>
  );
}
