"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useChat } from "./useChat";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { ThreadSwitcher } from "./ThreadSwitcher";
import { SkillsSheet } from "./SkillsSheet";
import { ChevronDownIcon, HomeIcon, SparkIcon } from "./icons";
import { BranchIcon, PaletteIcon } from "@/components/shell/icons";
import { ThemeSheet } from "@/components/shell/ThemeSwitcher";
import { haptic } from "@/components/shell/haptics";

/**
 * The Chat hub: the primary surface (replaces Telegram). One persistent Hermes
 * session per repo (title `lol-<slug>`, cwd = repo path) plus a general thread.
 * Header = active-thread switcher; center = the streamed conversation; bottom =
 * the composer with skill preloading. Real round-trips to the real agent.
 */
export function ChatHub() {
  const chat = useChat();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [skills, setSkills] = useState<string[]>([]);

  // Open a specific session from another tab (Sessions pane → "open in chat").
  // The Sessions pane fires `lo-nav` to switch to this tab AND `lo-open-session`
  // with the thread id; we select it here. Same window-event bus as lo-prefill.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<{ threadId?: string }>).detail?.threadId;
      if (id) chat.selectThread(id);
    };
    window.addEventListener("lo-open-session", onOpen as EventListener);
    return () =>
      window.removeEventListener("lo-open-session", onOpen as EventListener);
  }, [chat]);

  // "Start a task" on the Tasks home fires `lo-new-session` so the chat opens a
  // fresh session instead of resuming the active general thread.
  useEffect(() => {
    const onNew = () => void chat.newSession();
    window.addEventListener("lo-new-session", onNew as EventListener);
    return () =>
      window.removeEventListener("lo-new-session", onNew as EventListener);
  }, [chat]);

  const toggleSkill = useCallback((name: string) => {
    setSkills((prev) => (prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]));
  }, []);
  const removeSkill = useCallback(
    (name: string) => setSkills((prev) => prev.filter((s) => s !== name)),
    [],
  );
  const loadBundle = useCallback(
    (names: string[]) => setSkills((prev) => Array.from(new Set([...prev, ...names]))),
    [],
  );

  const onSend = useCallback(
    (text: string, images: { data: string; mime: string }[] = []) => {
      void chat.send(text, skills, images);
    },
    [chat, skills],
  );

  // `/task <title>` files a card on the shared Kanban board (the same board the
  // Kanban pane reads) without spending an agent turn. Best-effort: a success
  // double-buzzes, a failure long-buzzes. The card shows on the Kanban pane's
  // next poll.
  const onTask = useCallback((title: string) => {
    void fetch("/api/kanban", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, triage: true }),
    })
      .then((r) => haptic(r.ok ? [6, 30, 6] : 40))
      .catch(() => haptic(40));
  }, []);

  const active = chat.activeThread;
  const title = active?.title ?? "general";
  const isGeneral = !active?.repo;

  return (
    <div className="flex h-full min-h-full flex-col">
      {/* Thread header (the desktop "session title + dropdown" analogue). */}
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-1">
        <button
          type="button"
          onClick={() => {
            haptic(8);
            setSwitcherOpen(true);
          }}
          className="relative flex min-w-0 items-center gap-2 rounded-full border border-border px-2.5 py-1.5 text-left transition-colors active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]"
        >
          <span className="grid h-5 w-5 shrink-0 place-items-center text-text-tertiary">
            {isGeneral ? <HomeIcon width={15} height={15} /> : <BranchIcon width={15} height={15} />}
          </span>
          <span className="truncate font-mondwest text-display text-[0.8rem] tracking-wide text-midground">
            {title}
          </span>
          <ChevronDownIcon width={14} height={14} className="shrink-0 text-text-tertiary" />
        </button>

        <div className="min-w-0 flex-1" />

        <button
          type="button"
          aria-label="Switch theme"
          onClick={() => {
            haptic(8);
            setThemeOpen(true);
          }}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border text-text-secondary transition-colors active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]"
        >
          <PaletteIcon width={16} height={16} />
        </button>

        <button
          type="button"
          aria-label="Skills"
          onClick={() => {
            haptic(8);
            setSkillsOpen(true);
          }}
          className="relative flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1.5 text-text-secondary transition-colors active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]"
        >
          <SparkIcon width={16} height={16} />
          <span className="font-mono-ui text-[0.68rem]">skills</span>
          {skills.length > 0 && (
            <span className="grid h-4 min-w-4 place-items-center rounded-full bg-midground px-1 text-[0.6rem] text-background-base">
              {skills.length}
            </span>
          )}
        </button>
      </div>

      {/* Conversation (internal scroll). */}
      <motion.div
        key={chat.activeThreadId}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-none"
        data-msg-scroll
      >
        {chat.threadsError && (
          <p className="mx-3 mt-2 rounded-[var(--radius-md)] border border-border px-3 py-2 text-[0.74rem] text-text-tertiary">
            {chat.threadsError}
          </p>
        )}
        <MessageList messages={chat.messages} thread={active} sending={chat.sending} onRetry={chat.retry} />
      </motion.div>

      {/* Composer pinned above the context bar. */}
      <div className="shrink-0">
        <Composer
          onSend={onSend}
          onStop={chat.stop}
          onNewSession={chat.newSession}
          onTask={onTask}
          sending={chat.sending}
          skills={skills}
          onRemoveSkill={removeSkill}
          onOpenSkills={() => setSkillsOpen(true)}
          contextLabel={title}
        />
      </div>

      <ThreadSwitcher
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        threads={chat.threads}
        repos={chat.repos}
        activeThreadId={chat.activeThreadId}
        onSelect={chat.selectThread}
        onStartRepo={chat.startRepoThread}
        onNewSession={chat.newSession}
        onCreateBranch={chat.createBranch}
      />
      <SkillsSheet
        open={skillsOpen}
        onClose={() => setSkillsOpen(false)}
        loaded={skills}
        onToggle={toggleSkill}
        onLoadBundle={loadBundle}
      />
      <ThemeSheet open={themeOpen} onClose={() => setThemeOpen(false)} />
    </div>
  );
}
