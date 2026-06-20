"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform } from "framer-motion";
import { useWorkspace } from "@/components/shell/workspace-context";
import type { TabId } from "@/components/shell/tabs";
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
  DiffIcon,
} from "@/components/shell/icons";
import {
  WorktreeIcon,
  DraftDotIcon,
  NewWorkspaceIcon,
  RefreshIcon,
  PlusIcon,
} from "@/components/panes/pane-icons";
import { Button } from "@/components/ui";
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
  // Prune safety per "slug:branch": prunable + reason. Fetched on repo expand.
  const [pruneStates, setPruneStates] = useState<
    Map<string, { prunable: boolean; reason: string }>
  >(new Map());
  const [pruned, setPruned] = useState<Set<string>>(new Set());
  const [newOpen, setNewOpen] = useState(false);
  const [newRepo, setNewRepo] = useState<string | null>(null);
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

  const fetchPruneStates = useCallback(async (slug: string) => {
    try {
      const res = await fetch(
        `/api/workspaces/prune-state?repo=${encodeURIComponent(slug)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const body = (await res.json()) as {
        states?: Record<string, { prunable: boolean; reason: string }>;
      };
      if (!body.states) return;
      setPruneStates((prev) => {
        const next = new Map(prev);
        for (const [branch, st] of Object.entries(body.states!)) {
          next.set(`${slug}:${branch}`, st);
        }
        return next;
      });
    } catch {
      /* prune gating just stays unknown → treated as not-prunable */
    }
  }, []);

  const expandRepo = useCallback(
    (repo: RepoSummary) => {
      for (const ws of repo.workspaces) fetchStat(repo.slug, ws.name);
      fetchPruneStates(repo.slug);
    },
    [fetchStat, fetchPruneStates],
  );

  // Prune a workspace entry. Safe path first (force=false); on a 409 (refused
  // because dirty/unmerged) we surface the reason and let the row force-confirm.
  const prune = useCallback(
    async (slug: string, branch: string, force: boolean): Promise<{ ok: boolean; reason?: string }> => {
      try {
        const res = await fetch("/api/workspaces/prune", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ repo: slug, name: branch, force }),
        });
        const body = (await res.json()) as { ok?: boolean; reason?: string; error?: string };
        if (res.ok && body.ok) {
          haptic(18);
          setPruned((prev) => new Set(prev).add(`${slug}:${branch}`));
          return { ok: true };
        }
        return { ok: false, reason: body.reason ?? body.error ?? "prune failed" };
      } catch (e) {
        return { ok: false, reason: (e as Error).message };
      }
    },
    [],
  );

  // Bulk safe-clear: prune every prunable (clean worktree / merged branch)
  // workspace in a repo at once. Protected rows (base, checked-out, dirty,
  // unmerged) are skipped — same safety gate as the per-row swipe. Returns the
  // count cleared so the header can report it.
  const clearRepo = useCallback(
    async (repo: RepoSummary): Promise<number> => {
      const targets = repo.workspaces.filter((ws) => {
        const ps = pruneStates.get(`${repo.slug}:${ws.name}`);
        return ps?.prunable && !pruned.has(`${repo.slug}:${ws.name}`);
      });
      if (targets.length === 0) return 0;
      haptic(18);
      let n = 0;
      for (const ws of targets) {
        const r = await prune(repo.slug, ws.name, false);
        if (r.ok) n++;
      }
      return n;
    },
    [pruneStates, pruned, prune],
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

  // Open a repo's session in Chat. localStorage hands off across the pane
  // remount (mobile unmounts Chat while on Repos); the event covers the
  // already-mounted case. ChatHub materializes/focuses the repo/branch thread.
  const openInChat = useCallback(
    (
      name: string,
      path: string | null,
      branch: string | null,
      base: string | null,
    ) => {
      haptic(12);
      const payload = { name, path, branch, base };
      try {
        localStorage.setItem("lo-pending-repo", JSON.stringify(payload));
      } catch {
        /* private mode / quota; the event path still covers mounted Chat */
      }
      window.dispatchEvent(new CustomEvent("lo-open-repo", { detail: payload }));
      window.dispatchEvent(new CustomEvent("lo-nav", { detail: { tab: "chat" } }));
    },
    [],
  );

  // Tap a branch: open that branch's own session (independent of other branches).
  const select = useCallback(
    (repo: RepoSummary, ws: Workspace) => {
      openInChat(repo.slug, ws.path, ws.name, repo.base);
    },
    [openInChat],
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
                pruneStates={pruneStates}
                pruned={pruned}
                onToggle={() => toggle(repo)}
                onNewBranch={() => {
                  setNewRepo(repo.slug);
                  setNewOpen(true);
                }}
                onSelect={(ws) => select(repo, ws)}
                onPrune={(branch, force) => prune(repo.slug, branch, force)}
                onClearRepo={() => clearRepo(repo)}
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

      <NewWorkspaceSheet
        open={newOpen}
        onClose={() => {
          setNewOpen(false);
          setNewRepo(null);
        }}
        repos={data?.repos ?? []}
        defaultRepo={newRepo ?? active?.repo ?? data?.repos[0]?.slug ?? null}
        onCreated={async (slug, branch, wtPath) => {
          await load();
          setExpanded((prev) => new Set(prev).add(slug));
          const base = data?.repos.find((r) => r.slug === slug)?.base ?? null;
          setActiveWorkspace({ repo: slug, path: wtPath, branch });
          openInChat(slug, wtPath, branch, base);
        }}
      />
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
          className="h-full w-full object-contain p-1 opacity-95"
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
  // Jump to another primary surface. AppShell listens for `lo-nav` and switches
  // the active tab — so these rows act as in-page links, not dead labels.
  const go = (tab: TabId) => {
    haptic(8);
    window.dispatchEvent(new CustomEvent("lo-nav", { detail: { tab } }));
  };
  return (
    <div className="border-y border-border px-2 py-1">
      <NavItem icon={<ReposIcon width={16} height={16} />} label="Workspaces" active />
      <NavItem
        icon={<PullRequestIcon width={16} height={16} />}
        label="Tasks & PRs"
        onClick={() => go("prs")}
      />
      <NavItem
        icon={<DiffIcon width={16} height={16} />}
        label="Diff"
        onClick={() => go("diff")}
      />
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
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <span className={active ? "text-midground" : "text-text-tertiary"}>{icon}</span>
      <span className="text-[0.84rem]">{label}</span>
      {active ? (
        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-midground" />
      ) : (
        <ChevronRightIcon width={14} height={14} className="ml-auto text-text-tertiary" />
      )}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2 text-left text-text-secondary transition-colors active:bg-[color-mix(in_srgb,var(--midground)_6%,transparent)]"
      >
        {inner}
      </button>
    );
  }
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2",
        active ? "text-midground" : "text-text-secondary",
      )}
    >
      {inner}
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
  pruneStates,
  pruned,
  onToggle,
  onNewBranch,
  onSelect,
  onPrune,
  onClearRepo,
}: {
  repo: RepoSummary;
  index: number;
  open: boolean;
  active: { repo: string; branch: string } | null;
  stats: Map<string, StatState>;
  pruneStates: Map<string, { prunable: boolean; reason: string }>;
  pruned: Set<string>;
  onToggle: () => void;
  onNewBranch: () => void;
  onSelect: (ws: Workspace) => void;
  onPrune: (branch: string, force: boolean) => Promise<{ ok: boolean; reason?: string }>;
  onClearRepo: () => Promise<number>;
}) {
  const tint = tintFor(repo.slug);
  return (
    <li>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: Math.min(index * 0.025, 0.3), ease: [0.16, 1, 0.3, 1] }}
        className="flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2.5"
      >
        {/* Name zone: tap to expand/collapse this repo's branch list. To open
            a session, tap a specific branch row below. */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? `Collapse ${repo.slug}` : `Expand ${repo.slug}`}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[var(--radius-md)] text-left transition-colors active:bg-[color-mix(in_srgb,var(--midground)_5%,transparent)]"
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
        </button>

        {/* New branch / worktree for this repo. */}
        <button
          type="button"
          onClick={onNewBranch}
          aria-label={`New branch in ${repo.slug}`}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-text-tertiary transition-colors active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)] active:text-midground"
        >
          <PlusIcon width={14} height={14} />
        </button>

        {/* Expand / collapse the branch list. */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? "Collapse branches" : "Show branches"}
          className="flex shrink-0 items-center gap-1.5 rounded-full px-1.5 py-1 transition-colors active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]"
        >
          <span className="font-mono-ui tabular text-[0.72rem] text-text-tertiary">
            {repo.workspaces.length}
          </span>
          <ChevronRightIcon
            width={14}
            height={14}
            className={cn(
              "text-text-tertiary transition-transform duration-200",
              open && "rotate-90",
            )}
          />
        </button>
      </motion.div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <ClearRow
              repo={repo}
              pruneStates={pruneStates}
              pruned={pruned}
              onClearRepo={onClearRepo}
            />
            {repo.workspaces
              .filter((ws) => !pruned.has(`${repo.slug}:${ws.name}`))
              .map((ws) => {
                const isActive =
                  active?.repo === repo.slug && active?.branch === ws.name;
                const pruneState = pruneStates.get(`${repo.slug}:${ws.name}`);
                return (
                  <WorkspaceRow
                    key={ws.name}
                    ws={ws}
                    base={repo.base}
                    active={isActive}
                    stat={stats.get(`${repo.slug}:${ws.name}`)}
                    pruneState={pruneState}
                    onSelect={() => onSelect(ws)}
                    onPrune={(force) => onPrune(ws.name, force)}
                  />
                );
              })}
          </motion.ul>
        )}
      </AnimatePresence>
    </li>
  );
}

const PRUNE_COMMIT = 78; // px past which a swipe fires the prune

// Bulk-clear header inside an expanded repo. Counts the prunable (clean
// worktree / merged branch) rows and offers a one-tap safe clear with an inline
// confirm. Renders nothing when there's nothing safe to clear.
function ClearRow({
  repo,
  pruneStates,
  pruned,
  onClearRepo,
}: {
  repo: RepoSummary;
  pruneStates: Map<string, { prunable: boolean; reason: string }>;
  pruned: Set<string>;
  onClearRepo: () => Promise<number>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const count = repo.workspaces.filter((ws) => {
    const ps = pruneStates.get(`${repo.slug}:${ws.name}`);
    return ps?.prunable && !pruned.has(`${repo.slug}:${ws.name}`);
  }).length;

  if (count === 0) return null;

  if (confirm) {
    return (
      <li className="flex items-center gap-2 px-2.5 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[0.7rem] text-text-secondary">
          Clear {count} merged / clean {count === 1 ? "entry" : "entries"}?
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onClearRepo();
            setBusy(false);
            setConfirm(false);
          }}
          className="shrink-0 rounded-[var(--radius-sm)] bg-[color-mix(in_srgb,var(--color-destructive)_22%,transparent)] px-2 py-1 text-[0.68rem] text-[color:var(--color-destructive)]"
        >
          {busy ? "clearing…" : "clear"}
        </button>
        <button
          type="button"
          onClick={() => setConfirm(false)}
          className="shrink-0 px-1 text-[0.68rem] text-text-tertiary"
        >
          cancel
        </button>
      </li>
    );
  }

  return (
    <li className="flex justify-end px-2.5 pb-1 pt-0.5">
      <button
        type="button"
        onClick={() => {
          haptic(8);
          setConfirm(true);
        }}
        className="rounded-full border border-border px-2 py-0.5 font-mono-ui text-[0.6rem] text-text-tertiary transition-colors active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)] active:text-midground"
      >
        clear {count} merged
      </button>
    </li>
  );
}

function WorkspaceRow({
  ws,
  base,
  active,
  stat,
  pruneState,
  onSelect,
  onPrune,
}: {
  ws: Workspace;
  base: string | null;
  active: boolean;
  stat: StatState | undefined;
  pruneState: { prunable: boolean; reason: string } | undefined;
  onSelect: () => void;
  onPrune: (force: boolean) => Promise<{ ok: boolean; reason?: string }>;
}) {
  const TypeIcon =
    ws.type === "worktree" ? WorktreeIcon : ws.isCurrent ? BranchIcon : DraftDotIcon;

  // Swipe-left to prune. Only clean worktrees / merged branches are swipeable
  // (pruneState.prunable). Protected (base/checked-out/dirty/unmerged) rows are
  // locked: the swipe is disabled so live work can never be lost. A non-prunable
  // entry that IS removable with force routes through a confirm.
  const prunable = pruneState?.prunable ?? false;
  const locked =
    pruneState?.reason === "base" ||
    pruneState?.reason === "checked out" ||
    active;
  const x = useMotionValue(0);
  const draggedRef = useRef(false);
  const pruneOpacity = useTransform(x, [-PRUNE_COMMIT, -8, 0], [1, 0.4, 0]);
  const [confirmForce, setConfirmForce] = useState(false);
  const [busy, setBusy] = useState(false);

  const fireSafe = async () => {
    if (busy) return;
    setBusy(true);
    const r = await onPrune(false);
    setBusy(false);
    if (!r.ok) {
      // Refused (dirty/unmerged) — offer the force confirm inline.
      haptic(30);
      setConfirmForce(true);
    }
  };

  if (confirmForce) {
    return (
      <li>
        <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-destructive)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-destructive)_8%,transparent)] py-2 pl-4 pr-2.5">
          <span className="min-w-0 flex-1 truncate text-[0.72rem] text-text-secondary">
            Force prune <span className="font-mono-ui text-midground">{ws.name}</span>?{" "}
            {pruneState?.reason ?? "not safe"}
          </span>
          <button
            type="button"
            onClick={async () => {
              haptic(20);
              setBusy(true);
              await onPrune(true);
              setBusy(false);
              setConfirmForce(false);
            }}
            disabled={busy}
            className="shrink-0 rounded-[var(--radius-sm)] bg-[color-mix(in_srgb,var(--color-destructive)_22%,transparent)] px-2 py-1 text-[0.7rem] text-[color:var(--color-destructive)]"
          >
            force
          </button>
          <button
            type="button"
            onClick={() => setConfirmForce(false)}
            className="shrink-0 px-1 text-[0.7rem] text-text-tertiary"
          >
            cancel
          </button>
        </div>
      </li>
    );
  }

  const row = (
    <motion.button
      type="button"
      drag={locked ? false : "x"}
      style={{ x }}
      dragDirectionLock
      dragConstraints={{ left: -140, right: 0 }}
      dragElastic={0.12}
      onDragStart={() => {
        draggedRef.current = false;
      }}
      onDrag={(_, info) => {
        if (Math.abs(info.offset.x) > 6) draggedRef.current = true;
      }}
      onDragEnd={(_, info) => {
        if (locked) return;
        if (info.offset.x <= -PRUNE_COMMIT) {
          haptic(12);
          if (prunable) void fireSafe();
          else setConfirmForce(true); // not safe → straight to force confirm
        }
      }}
      onClick={() => {
        if (draggedRef.current) return;
        onSelect();
      }}
      aria-current={active}
      className={cn(
        "relative flex w-full touch-pan-y items-center gap-2.5 rounded-[var(--radius-md)] py-2 pl-4 pr-2.5 text-left transition-colors",
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
    </motion.button>
  );

  // Locked rows render without the prune rail (no swipe affordance at all).
  if (locked) {
    return <li>{row}</li>;
  }

  return (
    <li className="relative">
      <div className="pointer-events-none absolute inset-0 flex items-stretch justify-end overflow-hidden rounded-[var(--radius-md)]">
        <motion.div
          style={{ opacity: pruneOpacity }}
          className={cn(
            "flex w-1/2 items-center justify-end gap-1.5 rounded-[var(--radius-md)] pr-3 font-mono-ui text-[0.6rem] uppercase tracking-wider",
            prunable
              ? "bg-[color-mix(in_srgb,var(--color-destructive,#f87171)_20%,transparent)] text-[color:var(--color-destructive,#f87171)]"
              : "bg-[color-mix(in_srgb,var(--color-warning,#f5b54a)_20%,transparent)] text-[color:var(--color-warning,#f5b54a)]",
          )}
        >
          {prunable ? "prune" : pruneState?.reason ?? "force?"} <TrashGlyph />
        </motion.div>
      </div>
      {row}
    </li>
  );
}

function TrashGlyph() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
    </svg>
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
  repos,
  defaultRepo,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  repos: RepoSummary[];
  defaultRepo: string | null;
  onCreated: (slug: string, branch: string, path: string) => void;
}) {
  const [slug, setSlug] = useState<string | null>(defaultRepo);
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSlug(defaultRepo);
      setBranch("");
      setErr(null);
    }
  }, [open, defaultRepo]);

  const repo = repos.find((r) => r.slug === slug) ?? null;
  const trimmed = branch.trim();
  const valid = !!slug && trimmed.length > 0 && /^[\w./+@-]+$/.test(trimmed);

  const submit = useCallback(async () => {
    if (!slug || !valid || busy) return;
    setBusy(true);
    setErr(null);
    haptic(12);
    try {
      const res = await fetch("/api/workspaces/worktree", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: slug, branch: trimmed }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "worktree create failed");
      haptic(20);
      onCreated(slug, body.branch as string, body.path as string);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      haptic(30);
    } finally {
      setBusy(false);
    }
  }, [slug, trimmed, valid, busy, onCreated, onClose]);

  return (
    <Sheet open={open} onClose={onClose} title="New Workspace">
      <div className="space-y-4 px-3 pb-3">
        <p className="text-[0.8rem] leading-relaxed text-text-secondary">
          Adds a git worktree for a branch in the selected repo and binds it as
          the active context. The branch is created from the repo base if it
          does not exist, checked out at a sibling worktree path.
        </p>

        <label className="block">
          <span className="mb-1.5 block font-mono-ui text-[0.6rem] uppercase tracking-[0.16em] text-text-tertiary">
            Repository
          </span>
          <select
            value={slug ?? ""}
            onChange={(e) => setSlug(e.target.value || null)}
            className="w-full rounded-[var(--radius-md)] border border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)] px-3 py-2.5 text-[0.84rem] text-midground outline-none focus:border-[color-mix(in_srgb,var(--midground)_30%,transparent)]"
          >
            {repos.length === 0 && <option value="">No repos found</option>}
            {repos.map((r) => (
              <option key={r.slug} value={r.slug}>
                {r.slug}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block font-mono-ui text-[0.6rem] uppercase tracking-[0.16em] text-text-tertiary">
            Branch name
          </span>
          <input
            type="text"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="feat/my-change"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-[var(--radius-md)] border border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)] px-3 py-2.5 font-mono-ui text-[0.82rem] text-midground outline-none placeholder:text-text-disabled focus:border-[color-mix(in_srgb,var(--midground)_30%,transparent)]"
          />
          {repo?.base && (
            <span className="mt-1.5 block font-mono-ui text-[0.62rem] text-text-tertiary">
              from {repo.base}
            </span>
          )}
        </label>

        {err && (
          <p className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-destructive)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-destructive)_8%,transparent)] px-3 py-2 text-[0.72rem] text-[var(--color-destructive)]">
            {err}
          </p>
        )}

        <button
          type="button"
          disabled={!valid || busy}
          onClick={submit}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] px-4 py-2.5 text-[0.84rem] font-medium transition-colors",
            valid && !busy
              ? "bg-midground text-[var(--color-background)] active:scale-[0.98]"
              : "cursor-not-allowed bg-[color-mix(in_srgb,var(--midground)_12%,transparent)] text-text-disabled",
          )}
        >
          {busy ? "Creating worktree…" : "Create worktree"}
        </button>
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
      <Button outlined size="sm" type="button" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
