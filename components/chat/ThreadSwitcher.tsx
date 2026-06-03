"use client";

import { useMemo, useState } from "react";
import { Sheet } from "@/components/shell/Sheet";
import { BranchIcon } from "@/components/shell/icons";
import { HomeIcon, SearchIcon, PlusIcon } from "./icons";
import { haptic } from "@/components/shell/haptics";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ChatThread, ChatRepo } from "@/lib/chat-types";

export function ThreadSwitcher({
  open,
  onClose,
  threads,
  repos,
  activeThreadId,
  onSelect,
  onStartRepo,
}: {
  open: boolean;
  onClose: () => void;
  threads: ChatThread[];
  repos: ChatRepo[];
  activeThreadId: string;
  onSelect: (id: string) => void;
  onStartRepo: (repo: ChatRepo) => void;
}) {
  const [q, setQ] = useState("");

  const boundRepoNames = useMemo(
    () => new Set(threads.map((t) => t.repo).filter(Boolean) as string[]),
    [threads],
  );
  const unboundRepos = useMemo(
    () =>
      repos.filter(
        (r) => !boundRepoNames.has(r.name) && r.name.toLowerCase().includes(q.toLowerCase()),
      ),
    [repos, boundRepoNames, q],
  );
  const visibleThreads = useMemo(
    () => threads.filter((t) => t.title.toLowerCase().includes(q.toLowerCase())),
    [threads, q],
  );

  const pick = (id: string) => {
    haptic(10);
    onSelect(id);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Threads">
      <div className="mb-2 flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)] px-2.5 py-1.5">
        <SearchIcon width={15} height={15} className="text-text-tertiary" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search threads and repos"
          className="flex-1 bg-transparent text-[0.85rem] text-text-primary outline-none placeholder:text-text-tertiary"
        />
      </div>

      <ul className="flex flex-col gap-0.5">
        {visibleThreads.map((t) => (
          <ThreadRow
            key={t.id}
            thread={t}
            active={t.id === activeThreadId}
            onClick={() => pick(t.id)}
          />
        ))}
      </ul>

      {unboundRepos.length > 0 && (
        <>
          <p className="px-2 pb-1 pt-3 text-display font-mondwest text-[0.6rem] tracking-[0.18em] text-text-tertiary">
            Bind a repo
          </p>
          <ul className="flex flex-col gap-0.5">
            {unboundRepos.map((r) => (
              <li key={r.name}>
                <button
                  type="button"
                  onClick={() => {
                    haptic(10);
                    onStartRepo(r);
                    onClose();
                  }}
                  className="flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-left transition-colors active:bg-[color-mix(in_srgb,var(--midground)_6%,transparent)]"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-border text-text-tertiary">
                    <PlusIcon width={15} height={15} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[0.86rem] text-text-primary">{r.name}</span>
                    <span className="font-mono-ui truncate text-[0.66rem] text-text-tertiary">
                      {r.branch ?? "no branch"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {visibleThreads.length === 0 && unboundRepos.length === 0 && (
        <p className="px-3 py-6 text-center text-[0.8rem] text-text-tertiary">
          No matches.
        </p>
      )}
    </Sheet>
  );
}

function ThreadRow({
  thread,
  active,
  onClick,
}: {
  thread: ChatThread;
  active: boolean;
  onClick: () => void;
}) {
  const isGeneral = !thread.repo;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "true" : undefined}
        className={cn(
          "relative flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-left transition-colors",
          active
            ? "bg-[color-mix(in_srgb,var(--midground)_10%,transparent)]"
            : "active:bg-[color-mix(in_srgb,var(--midground)_6%,transparent)]",
        )}
      >
        {active && <span className="arc-border" aria-hidden />}
        <span
          className={cn(
            "grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-sm)] border",
            active ? "border-transparent text-midground" : "border-border text-text-tertiary",
          )}
        >
          {isGeneral ? <HomeIcon width={15} height={15} /> : <BranchIcon width={15} height={15} />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[0.88rem] text-text-primary">{thread.title}</span>
          <span className="font-mono-ui truncate text-[0.66rem] text-text-tertiary">
            {thread.messageCount > 0
              ? `${thread.messageCount} msgs${thread.lastActive ? ` · ${relativeTime(new Date(thread.lastActive).toISOString())}` : ""}`
              : isGeneral
                ? "home context"
                : "not started"}
          </span>
        </span>
        {thread.sessionId && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color-mix(in_srgb,var(--color-success)_80%,transparent)]"
            title="session live"
          />
        )}
      </button>
    </li>
  );
}
