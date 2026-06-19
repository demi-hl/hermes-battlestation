"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { SendIcon, CloseIcon } from "@/components/shell/icons";
import { SparkIcon, StopIcon } from "./icons";
import { haptic } from "@/components/shell/haptics";
import { cn } from "@/lib/utils";

export function Composer({
  onSend,
  onStop,
  sending,
  skills,
  onRemoveSkill,
  onOpenSkills,
  contextLabel,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  sending: boolean;
  skills: string[];
  onRemoveSkill: (s: string) => void;
  onOpenSkills: () => void;
  contextLabel: string;
}) {
  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

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

  const submit = () => {
    const t = value.trim();
    if (!t || sending) return;
    haptic([6, 4, 8]);
    onSend(t);
    setValue("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      className="border-t border-border px-3 pt-2.5"
      style={{
        background: "var(--background-base)",
        opacity: 0.96,
        backdropFilter: "blur(20px) saturate(150%)",
        WebkitBackdropFilter: "blur(20px) saturate(150%)",
        paddingBottom: "10px",
      }}
    >
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
                className="grid h-4 w-4 place-items-center rounded-full text-text-tertiary active:scale-90"
              >
                <CloseIcon width={10} height={10} />
              </button>
            </motion.span>
          ))}
        </div>
      )}

      <div className="relative flex items-end gap-2 rounded-[calc(var(--theme-radius)+6px)] border border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)] px-2.5 py-1.5">
        <span className="arc-border opacity-0 transition-opacity focus-within:opacity-100" aria-hidden />
        <button
          type="button"
          aria-label="Skills"
          onClick={() => {
            haptic(8);
            onOpenSkills();
          }}
          className="mb-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-text-tertiary transition-colors active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)] active:text-midground"
        >
          <SparkIcon width={18} height={18} />
        </button>

        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
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
          placeholder={`Message ${contextLabel}`}
          className="scrollbar-none max-h-[140px] min-h-[28px] flex-1 resize-none bg-transparent py-1 text-base leading-relaxed text-text-primary outline-none placeholder:text-text-tertiary"
        />

        {sending ? (
          <button
            type="button"
            aria-label="Stop"
            onClick={() => {
              haptic(12);
              onStop();
            }}
            className="mb-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--color-destructive)_85%,transparent)] text-white transition-transform active:scale-90"
          >
            <StopIcon width={15} height={15} />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Send"
            disabled={!value.trim()}
            onClick={submit}
            className={cn(
              "mb-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full transition-all active:scale-90",
              value.trim()
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
