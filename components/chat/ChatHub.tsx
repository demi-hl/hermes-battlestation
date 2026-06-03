"use client";

import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { useChat } from "./useChat";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { ThreadSwitcher } from "./ThreadSwitcher";
import { SkillsSheet } from "./SkillsSheet";
import { ChevronDownIcon, HomeIcon, SparkIcon } from "./icons";
import { BranchIcon } from "@/components/shell/icons";
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
  const [skills, setSkills] = useState<string[]>([]);

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
    (text: string) => {
      void chat.send(text, skills);
    },
    [chat, skills],
  );

  const active = chat.activeThread;
  const title = active?.title ?? "general";
  const isGeneral = !active?.repo;

  return (
    <div className="flex h-full min-h-full flex-col">
      {/* Thread header (the desktop "session title + dropdown" analogue). */}
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2">
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
        <MessageList messages={chat.messages} thread={active} sending={chat.sending} />
      </motion.div>

      {/* Composer pinned above the context bar. */}
      <div className="shrink-0">
        <Composer
          onSend={onSend}
          onStop={chat.stop}
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
      />
      <SkillsSheet
        open={skillsOpen}
        onClose={() => setSkillsOpen(false)}
        loaded={skills}
        onToggle={toggleSkill}
        onLoadBundle={loadBundle}
      />
    </div>
  );
}
