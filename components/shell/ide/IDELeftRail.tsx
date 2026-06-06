"use client";

import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "@/components/shell/workspace-context";
import { cn } from "@/lib/utils";
import {
  ChatIcon,
  KanbanIcon,
  FleetIcon,
  PullRequestIcon,
  AutomationIcon,
  VaultIcon,
  EditorIcon,
  TerminalIcon,
  DiffIcon,
  SettingsIcon,
  ReposIcon,
  ChevronRightIcon,
  ChevronUpDownIcon,
} from "@/components/shell/icons";
import { BranchIcon } from "@/components/shell/icons";
import type { WorkspacesResponse, RepoSummary, Workspace } from "@/lib/workspace-types";

export type CenterView =
  | "agent"
  | "kanban"
  | "fleet"
  | "prs"
  | "automations"
  | "obsidian"
  | "editor"
  | "terminal"
  | "diff"
  | "settings";

interface NavItemDef {
  id: CenterView;
  label: string;
  Icon: typeof ChatIcon;
}

// Agent is the spine; the rest are the Hermes tabs reachable from the rail.
const NAV: NavItemDef[] = [
  { id: "agent", label: "Agent", Icon: ChatIcon },
  { id: "kanban", label: "Kanban", Icon: KanbanIcon },
  { id: "prs", label: "Tasks & PRs", Icon: PullRequestIcon },
  { id: "fleet", label: "Fleet", Icon: FleetIcon },
  { id: "automations", label: "Automations", Icon: AutomationIcon },
  { id: "obsidian", label: "Obsidian", Icon: VaultIcon },
  { id: "editor", label: "Editor", Icon: EditorIcon },
  { id: "terminal", label: "Terminal", Icon: TerminalIcon },
  { id: "diff", label: "Diff", Icon: DiffIcon },
  { id: "settings", label: "Settings", Icon: SettingsIcon },
];

/**
 * Left rail of the god-mode IDE: brand, the Hermes-tab nav (Agent spine +
 * Kanban/Fleet/etc), and the workspace switcher (repos → branches/worktrees).
 * Selecting a workspace binds the active context, which routes the agent
 * session + source panel to that repo. Selecting a nav item swaps the center.
 */
export function IDELeftRail({
  view,
  onView,
}: {
  view: CenterView;
  onView: (v: CenterView) => void;
}) {
  const { active, setActiveWorkspace } = useWorkspace();
  const [data, setData] = useState<WorkspacesResponse | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/workspaces", { cache: "no-store" });
      if (res.ok) setData((await res.json()) as WorkspacesResponse);
    } catch {
      /* keep prior */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-expand the active repo (or first) once data lands.
  useEffect(() => {
    if (!data || data.repos.length === 0 || expanded.size > 0) return;
    const target =
      data.repos.find((r) => r.slug === active?.repo) ?? data.repos[0];
    setExpanded(new Set([target.slug]));
  }, [data, active, expanded.size]);

  const toggle = (slug: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });

  const pick = (repo: RepoSummary, ws: Workspace) => {
    setActiveWorkspace({ repo: repo.slug, path: ws.path, branch: ws.name });
    if (view !== "agent" && view !== "editor" && view !== "terminal" && view !== "diff") {
      onView("agent");
    }
  };

  return (
    <nav className="flex w-[228px] shrink-0 flex-col border-r border-border bg-surface/60 backdrop-blur-sm">
      {/* Brand */}
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/nous-logo.svg" alt="Nous" draggable={false} className="h-[20px] w-auto" />
        <span className="font-mono-ui text-[0.62rem] uppercase tracking-[0.22em] text-text-tertiary">
          battlestation
        </span>
      </div>

      {/* Hermes-tab nav */}
      <div className="flex flex-col gap-0.5 px-2 py-2">
        {NAV.map((n) => {
          const on = view === n.id;
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => onView(n.id)}
              className={cn(
                "flex items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-1.5 text-left text-[0.8rem] transition-colors",
                on
                  ? "bg-[color-mix(in_srgb,var(--midground)_12%,transparent)] text-midground"
                  : "text-text-secondary hover:text-midground",
              )}
            >
              <n.Icon width={15} height={15} className={on ? "text-midground" : "text-text-tertiary"} />
              <span className="truncate">{n.label}</span>
              {on && <span className="ml-auto h-1 w-1 rounded-full bg-midground" />}
            </button>
          );
        })}
      </div>

      {/* Workspace switcher */}
      <div className="mt-1 flex items-center gap-1.5 border-t border-border px-3 py-2">
        <ReposIcon width={13} height={13} className="text-text-tertiary" />
        <span className="font-mono-ui text-[0.58rem] uppercase tracking-[0.16em] text-text-tertiary">
          Workspaces
        </span>
        <span className="ml-auto font-mono-ui text-[0.56rem] text-text-disabled">
          {data?.repos.length ?? "—"}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3 scrollbar-none">
        {!data ? (
          <div className="space-y-1 px-2 py-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-6 animate-pulse rounded bg-[color-mix(in_srgb,var(--midground)_6%,transparent)]" />
            ))}
          </div>
        ) : (
          data.repos.map((repo) => {
            const open = expanded.has(repo.slug);
            return (
              <div key={repo.slug}>
                <button
                  type="button"
                  onClick={() => toggle(repo.slug)}
                  className="flex w-full items-center gap-1.5 rounded-[var(--radius-md)] px-2 py-1 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--midground)_5%,transparent)]"
                >
                  <ChevronRightIcon
                    width={11}
                    height={11}
                    className={cn("shrink-0 text-text-tertiary transition-transform", open && "rotate-90")}
                  />
                  <span className="min-w-0 flex-1 truncate text-[0.76rem] text-text-secondary">
                    {repo.slug}
                  </span>
                  <span className="font-mono-ui text-[0.56rem] text-text-disabled">
                    {repo.workspaces.length}
                  </span>
                </button>
                {open &&
                  repo.workspaces.map((ws) => {
                    const isActive = active?.repo === repo.slug && active?.branch === ws.name;
                    return (
                      <button
                        key={ws.name}
                        type="button"
                        onClick={() => pick(repo, ws)}
                        className={cn(
                          "relative flex w-full items-center gap-1.5 rounded-[var(--radius-md)] py-1 pl-6 pr-2 text-left transition-colors",
                          isActive
                            ? "bg-[color-mix(in_srgb,var(--midground)_10%,transparent)] text-midground"
                            : "text-text-tertiary hover:text-text-secondary",
                        )}
                      >
                        {isActive && (
                          <span className="absolute left-1.5 top-1/2 h-3.5 w-[2px] -translate-y-1/2 rounded-full bg-midground" />
                        )}
                        <BranchIcon width={11} height={11} className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate font-mono-ui text-[0.68rem]">
                          {ws.name}
                        </span>
                        {ws.type === "worktree" && (
                          <span className="font-mono-ui text-[0.5rem] uppercase text-text-disabled">wt</span>
                        )}
                      </button>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>

      {/* Active workspace footer */}
      <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2">
        <ChevronUpDownIcon width={12} height={12} className="text-text-tertiary" />
        <span className="min-w-0 flex-1 truncate font-mono-ui text-[0.62rem] text-text-secondary">
          {active?.repo ? `${active.repo} · ${active.branch}` : "general"}
        </span>
      </div>
    </nav>
  );
}
