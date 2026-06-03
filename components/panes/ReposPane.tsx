"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useWorkspace } from "@/components/shell/workspace-context";
import { haptic } from "@/components/shell/haptics";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/shell/Sheet";
import {
  ReposIcon,
  BranchIcon,
  ChevronRightIcon,
  ChevronUpDownIcon,
  AutomationIcon,
  PullRequestIcon,
} from "@/components/shell/icons";
import {
  WorktreeIcon,
  DraftDotIcon,
  NewWorkspaceIcon,
  RefreshIcon,
  PlusIcon,
} from "@/components/panes/pane-icons";
import type {
  WorkspacesResponse,
  RepoSummary,
  Workspace,
  DiffStat,
} from "@/lib/workspace-types";

type StatState = DiffStat | "loading" | "error";

export function ReposPane() {
  const { active, setActiveWorkspace } = useWorkspace();
  const [data, setData] = useState<WorkspacesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<Map<string, StatState>>(new Map());
  const [newOpen, setNewOpen] = useState(false);
  const didAutoExpand = useRef(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/workspaces", { cache: "no-store" });
      const body = (await res.json()) as WorkspacesResponse;
      if (!res.ok) throw new Error(body?.error ?? "failed to load workspaces");
      setData(body);
      setError(body.error ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const fetchStat = useCallback(
    async (slug: string, branch: string) => {
      const key = `${slug}:${branch}`;
      setStats((prev) => {
        if (prev.has(key)) return prev;
        const next = new Map(prev);
        next.set(key, "loading");
        return next;
      });
      try {
        const res = await fetch(
          `/api/workspaces/stat?repo=${encodeURIComponent(slug)}&branch=${encodeURIComponent(branch)}`,
          { cache: "no-store" },
        );
        const body = await res.json();
        setStats((prev) => {
          const next = new Map(prev);
          next.set(key, res.ok ? (body as DiffStat) : "error");
          return next;
        });
      } catch {
        setStats((prev) => {
          const next = new Map(prev);
          next.set(key, "error");
          return next;
        });
      }
    },
    [],
  );

  const expandRepo = useCallback(
    (repo: RepoSummary) => {
      for (const ws of repo.workspaces) fetchStat(repo.slug, ws.name);
    },
    [fetchStat],
  );

  const toggle = useCallback(
    (repo: RepoSummary) => {
      haptic(6);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(repo.slug)) {
          next.delete(repo.slug);
        } else {
          next.add(repo.slug);
          expandRepo(repo);
        }
        return next;
      });
    },
    [expandRepo],
  );

  // Auto-expand the active repo (or the first repo) once, so the pattern shows.
  useEffect(() => {
    if (didAutoExpand.current || !data || data.repos.length === 0) return;
    didAutoExpand.current = true;
    const target =
      data.repos.find((r) => r.slug === active?.repo) ?? data.repos[0];
    setExpanded(new Set([target.slug]));
    expandRepo(target);
  }, [data, active, expandRepo]);

  const select = useCallback(
    (repo: RepoSummary, ws: Workspace) => {
      haptic(12);
      setActiveWorkspace({ repo: repo.slug, path: ws.path, branch: ws.name });
    },
    [setActiveWorkspace],
  );

  return (
    <div className="min-h-full pb-4">
      <IdentityHeader login={data?.login ?? null} onRefresh={load} refreshing={refreshing} />
      <NavRow onNewWorkspace={() => setNewOpen(true)} />

      <div className="px-2">
        {data === null && !error ? (
          <RepoSkeleton />
        ) : error && !data ? (
          <ErrorState message={error} onRetry={load} />
        ) : data && data.repos.length === 0 ? (
          <p className="px-3 py-10 text-center text-sm text-text-tertiary">
            No git repositories found under the workspace roots.
          </p>
        ) : (
          <motion.ul layout className="flex flex-col">
            {data?.repos.map((repo, i) => (
              <RepoRow
                key={repo.slug}
                repo={repo}
                index={i}
                open={expanded.has(repo.slug)}
                active={active}
                stats={stats}
                onToggle={() => toggle(repo)}
                onSelect={(ws) => select(repo, ws)}
              />
            ))}
          </motion.ul>
        )}
        {error && data && (
          <p className="px-3 pt-2 text-[0.66rem] text-text-tertiary">
            Some data may be stale: {error}
          </p>
        )}
      </div>

      <NewWorkspaceSheet open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function IdentityHeader({
  login,
  onRefresh,
  refreshing,
}: {
  login: string | null;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-4 pb-3 pt-1">
      <span className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-md)] border border-border">
        <span className="arc-border" aria-hidden />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/nous-logo.svg"
          alt=""
          className="h-full w-full object-cover opacity-95"
        />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-mondwest text-display text-[0.92rem] leading-tight tracking-wide text-midground">
          {login ? login : "locals only"}
        </span>
        <span className="font-mono-ui text-[0.62rem] uppercase tracking-[0.16em] text-text-tertiary">
          hermes agent
        </span>
      </div>
      <button
        type="button"
        aria-label="Refresh workspaces"
        onClick={() => {
          haptic(6);
          onRefresh();
        }}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-text-tertiary transition-colors active:scale-90 active:text-midground"
      >
        <RefreshIcon width={15} height={15} className={refreshing ? "animate-spin-slow" : ""} />
      </button>
      <ChevronUpDownIcon width={14} height={14} className="shrink-0 text-text-tertiary" />
    </div>
  );
}

function NavRow({ onNewWorkspace }: { onNewWorkspace: () => void }) {
  return (
    <div className="border-y border-border px-2 py-1">
      <NavItem icon={<ReposIcon width={16} height={16} />} label="Workspaces" active />
      <NavItem icon={<AutomationIcon width={16} height={16} />} label="Automations" hint="tab" />
      <NavItem icon={<PullRequestIcon width={16} height={16} />} label="Tasks & PRs" hint="tab" />
      <button
        type="button"
        onClick={() => {
          haptic(8);
          onNewWorkspace();
        }}
        className="flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2 text-left text-text-secondary active:bg-[color-mix(in_srgb,var(--midground)_6%,transparent)]"
      >
        <NewWorkspaceIcon width={16} height={16} className="text-text-tertiary" />
        <span className="text-[0.84rem]">New Workspace</span>
        <PlusIcon width={13} height={13} className="ml-auto text-text-tertiary" />
      </button>
    </div>
  );
}

function NavItem({
  icon,
  label,
  active,
  hint,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  hint?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2",
        active
          ? "text-midground"
          : "text-text-secondary",
      )}
    >
      <span className={active ? "text-midground" : "text-text-tertiary"}>{icon}</span>
      <span className="text-[0.84rem]">{label}</span>
      {active && (
        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-midground" />
      )}
      {hint && (
        <span className="ml-auto font-mono-ui text-[0.56rem] uppercase tracking-[0.14em] text-text-disabled">
          {hint}
        </span>
      )}
    </div>
  );
}

const AVATAR_TINTS = [
  "#ffbd38",
  "#34d399",
  "#7dd3fc",
  "#f9a8d4",
  "#c4b5fd",
  "#fca5a5",
  "#fcd34d",
  "#86efac",
];

function tintFor(slug: string): string {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

function monogram(slug: string): string {
  const parts = slug.replace(/[_~]/g, "-").split(/[-.]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return slug.slice(0, 2).toUpperCase();
}

function RepoRow({
  repo,
  index,
  open,
  active,
  stats,
  onToggle,
  onSelect,
}: {
  repo: RepoSummary;
  index: number;
  open: boolean;
  active: { repo: string; branch: string } | null;
  stats: Map<string, StatState>;
  onToggle: () => void;
  onSelect: (ws: Workspace) => void;
}) {
  const tint = tintFor(repo.slug);
  return (
    <li>
      <motion.button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: Math.min(index * 0.025, 0.3), ease: [0.16, 1, 0.3, 1] }}
        className="flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2.5 text-left transition-colors active:bg-[color-mix(in_srgb,var(--midground)_5%,transparent)]"
      >
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-sm)] font-mono-ui text-[0.62rem] font-bold tracking-tight"
          style={{
            color: tint,
            background: `color-mix(in srgb, ${tint} 16%, transparent)`,
            border: `1px solid color-mix(in srgb, ${tint} 30%, transparent)`,
          }}
        >
          {monogram(repo.slug)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.92rem] font-medium text-midground">
            {repo.slug}
          </span>
        </span>
        <span className="shrink-0 font-mono-ui tabular text-[0.72rem] text-text-tertiary">
          {repo.workspaces.length}
        </span>
        <ChevronRightIcon
          width={14}
          height={14}
          className={cn(
            "shrink-0 text-text-tertiary transition-transform duration-200",
            open && "rotate-90",
          )}
        />
      </motion.button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            {repo.workspaces.map((ws) => {
              const isActive =
                active?.repo === repo.slug && active?.branch === ws.name;
              return (
                <WorkspaceRow
                  key={ws.name}
                  ws={ws}
                  base={repo.base}
                  active={isActive}
                  stat={stats.get(`${repo.slug}:${ws.name}`)}
                  onSelect={() => onSelect(ws)}
                />
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </li>
  );
}

function WorkspaceRow({
  ws,
  base,
  active,
  stat,
  onSelect,
}: {
  ws: Workspace;
  base: string | null;
  active: boolean;
  stat: StatState | undefined;
  onSelect: () => void;
}) {
  const TypeIcon =
    ws.type === "worktree" ? WorktreeIcon : ws.isCurrent ? BranchIcon : DraftDotIcon;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active}
        className={cn(
          "relative flex w-full items-center gap-2.5 rounded-[var(--radius-md)] py-2 pl-4 pr-2.5 text-left transition-colors",
          active
            ? "bg-[color-mix(in_srgb,var(--midground)_10%,transparent)]"
            : "active:bg-[color-mix(in_srgb,var(--midground)_5%,transparent)]",
        )}
      >
        {active && <span className="arc-border" aria-hidden />}
        {active && (
          <span
            aria-hidden
            className="absolute left-0 top-1/2 h-5 w-[2.5px] -translate-y-1/2 rounded-full bg-midground"
          />
        )}
        <TypeIcon
          width={14}
          height={14}
          className={cn("shrink-0", active ? "text-midground" : "text-text-tertiary")}
        />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span
            className={cn(
              "truncate font-mono-ui text-[0.78rem]",
              active ? "text-midground" : "text-text-secondary",
            )}
          >
            {ws.name}
          </span>
          {ws.name === base && (
            <span className="shrink-0 rounded-full border border-border px-1.5 text-[0.5rem] uppercase tracking-[0.12em] text-text-disabled">
              base
            </span>
          )}
        </span>
        <DiffStatChip stat={stat} />
      </button>
    </li>
  );
}

function DiffStatChip({ stat }: { stat: StatState | undefined }) {
  if (stat === undefined || stat === "loading") {
    return (
      <span className="h-3 w-14 shrink-0 animate-pulse rounded bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]" />
    );
  }
  if (stat === "error") {
    return <span className="shrink-0 font-mono-ui text-[0.64rem] text-text-disabled">—</span>;
  }
  if (stat.adds === 0 && stat.dels === 0) {
    return (
      <span className="shrink-0 font-mono-ui tabular text-[0.66rem] text-text-disabled">
        no diff
      </span>
    );
  }
  return (
    <span
      className="flex shrink-0 items-center gap-1.5 font-mono-ui tabular text-[0.68rem]"
      title={stat.includesWorking ? "includes uncommitted changes" : undefined}
    >
      <span style={{ color: "var(--color-success)" }}>+{stat.adds}</span>
      <span style={{ color: "var(--color-destructive)" }}>-{stat.dels}</span>
    </span>
  );
}

function NewWorkspaceSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="New Workspace">
      <div className="px-3 pb-3">
        <p className="text-sm leading-relaxed text-text-secondary">
          Creating a workspace will branch or add a git worktree for the selected
          repo and bind it as the active context.
        </p>
        <p className="mt-2 text-[0.72rem] leading-relaxed text-text-tertiary">
          This action is not wired in this slice. Workspace creation writes to
          git and is owned by the integration pass, so it ships as a designed
          state rather than a faked branch.
        </p>
        <span className="mt-3 inline-block font-mono-ui text-[0.6rem] uppercase tracking-[0.16em] text-text-disabled">
          coming soon
        </span>
      </div>
    </Sheet>
  );
}

function RepoSkeleton() {
  return (
    <div className="space-y-1 px-1 pt-2">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2.5 px-1.5 py-2.5">
          <div className="h-7 w-7 animate-pulse rounded-[var(--radius-sm)] bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]" />
          <div
            className="h-3.5 animate-pulse rounded bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]"
            style={{ width: `${40 + ((i * 13) % 40)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-8 py-12 text-center">
      <p className="max-w-[30ch] text-sm text-text-tertiary">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-full border border-border px-4 py-1.5 text-[0.78rem] text-midground active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]"
      >
        Retry
      </button>
    </div>
  );
}
