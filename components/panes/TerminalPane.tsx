"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { useWorkspace } from "@/components/shell/workspace-context";
import { haptic } from "@/components/shell/haptics";
import { cn } from "@/lib/utils";
import { TerminalIcon, BranchIcon } from "@/components/shell/icons";
import { RefreshIcon } from "@/components/panes/pane-icons";

type Status = "connecting" | "live" | "exited" | "error";

const XTerm = dynamic(
  () => import("./terminal/XTerm").then((m) => m.XTerm),
  {
    ssr: false,
    loading: () => <TerminalSkeleton />,
  },
);

/**
 * Full shell for the active repo's working directory. xterm.js over a real PTY
 * (node-pty) on the server; the session persists per repo so switching tabs and
 * coming back resumes the same shell with its scrollback. No active workspace
 * binds a general shell in $HOME.
 */
export function TerminalPane() {
  const { active } = useWorkspace();
  const repo = active?.repo ?? "general";
  const bound = !!active;

  const [status, setStatus] = useState<Status>("connecting");
  // Bumping the key remounts XTerm (used by Restart after a kill).
  const [gen, setGen] = useState(0);

  const restart = useCallback(async () => {
    haptic(10);
    await fetch("/api/terminal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo, kill: true }),
    }).catch(() => {});
    setGen((g) => g + 1);
  }, [repo]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-3">
      <div className="flex items-center gap-2 py-2">
        <TerminalIcon width={16} height={16} className="shrink-0 text-text-tertiary" />
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {bound ? (
            <>
              <span className="truncate text-[0.78rem] text-midground">{repo}</span>
              <BranchIcon width={11} height={11} className="shrink-0 text-text-tertiary" />
              <span className="truncate font-mono-ui text-[0.72rem] text-text-tertiary">
                {active!.branch}
              </span>
            </>
          ) : (
            <span className="truncate font-mono-ui text-[0.74rem] text-text-tertiary">
              general · $HOME
            </span>
          )}
        </div>

        <StatusPill status={status} />

        <button
          type="button"
          aria-label="Restart shell"
          onClick={restart}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-md)] text-text-secondary transition-colors active:scale-90 active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]"
        >
          <RefreshIcon width={15} height={15} />
        </button>
      </div>

      <div
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden rounded-[var(--radius-lg)] border border-border p-2",
        )}
        style={{
          background: "color-mix(in srgb, var(--background-base) 55%, transparent)",
        }}
      >
        {status === "live" && <span className="arc-border" aria-hidden />}
        <XTerm key={`${repo}:${gen}`} repo={repo} onStatus={setStatus} />
      </div>

      <p className="px-1 py-1.5 text-center text-[0.62rem] text-text-tertiary">
        Live PTY · tap to focus · the shell keeps running when you switch tabs
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  const map: Record<Status, { label: string; color: string; pulse?: boolean }> = {
    connecting: { label: "connecting", color: "var(--color-warning)", pulse: true },
    live: { label: "live", color: "var(--color-success)" },
    exited: { label: "exited", color: "var(--color-text-tertiary)" },
    error: { label: "retrying", color: "var(--color-destructive)", pulse: true },
  };
  const s = map[status];
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-1">
      <span
        className={cn("h-2 w-2 rounded-full", s.pulse && "animate-pulse")}
        style={{ background: s.color, boxShadow: `0 0 8px ${s.color}` }}
      />
      <span className="font-mono-ui text-[0.6rem] uppercase tracking-[0.14em] text-text-tertiary">
        {s.label}
      </span>
    </span>
  );
}

function TerminalSkeleton() {
  return (
    <div className="space-y-2 p-2 font-mono-ui">
      {[0.5, 0.8, 0.35, 0.65, 0.45].map((w, i) => (
        <div
          key={i}
          className="h-3 animate-pulse rounded bg-[color-mix(in_srgb,var(--midground)_7%,transparent)]"
          style={{ width: `${w * 100}%` }}
        />
      ))}
    </div>
  );
}
