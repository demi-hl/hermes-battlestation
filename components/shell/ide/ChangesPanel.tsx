"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { FileTree } from "@/components/panes/editor/FileTree";

interface ChangeEntry {
  path: string;
  status: string;
  staged: boolean;
  adds: number | null;
  dels: number | null;
}
interface ChangesResult {
  branch: string | null;
  ahead: number;
  behind: number;
  entries: ChangeEntry[];
}

type Tab = "files" | "changes";

const STATUS_COLOR: Record<string, string> = {
  M: "var(--color-warning)",
  A: "var(--color-success)",
  D: "var(--color-destructive)",
  R: "var(--midground)",
  C: "var(--midground)",
  U: "var(--color-destructive)",
  "?": "var(--text-tertiary)",
};

/**
 * Right-side source-control panel for the IDE shell — Conductor's "Files /
 * Changes" rail. Files = the active repo's file tree; Changes = live
 * `git status` with per-file +/- numstat. Bound to the active workspace; the
 * agent (center spine) is what mutates the repo, this panel reflects it.
 */
export function ChangesPanel({
  repo,
  onOpenFile,
  activePath,
}: {
  repo: string | null;
  onOpenFile: (path: string, name: string) => void;
  activePath: string | null;
}) {
  const [tab, setTab] = useState<Tab>("changes");
  const [data, setData] = useState<ChangesResult | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!repo) {
      setData(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/changes?repo=${encodeURIComponent(repo)}`, {
        cache: "no-store",
      });
      setData(res.ok ? ((await res.json()) as ChangesResult) : null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [repo]);

  // Poll changes every 5s so the panel tracks what the agent does to the repo.
  useEffect(() => {
    if (tab !== "changes") return;
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load, tab]);

  const count = data?.entries.length ?? 0;

  return (
    <div className="flex h-full flex-col border-l border-border bg-surface/40">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <TabBtn active={tab === "files"} onClick={() => setTab("files")}>
          Files
        </TabBtn>
        <TabBtn active={tab === "changes"} onClick={() => setTab("changes")}>
          Changes
          {count > 0 && (
            <span className="ml-1 rounded-full bg-[color-mix(in_srgb,var(--midground)_16%,transparent)] px-1 font-mono-ui text-[0.56rem] text-text-secondary">
              {count}
            </span>
          )}
        </TabBtn>
        <div className="flex-1" />
        {data?.branch && (
          <span className="font-mono-ui truncate text-[0.56rem] text-text-tertiary">
            {data.branch}
            {data.ahead ? ` ↑${data.ahead}` : ""}
            {data.behind ? ` ↓${data.behind}` : ""}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-none">
        {!repo ? (
          <p className="px-3 py-8 text-center text-[0.72rem] text-text-tertiary">
            Pick a workspace to see its files and changes.
          </p>
        ) : tab === "files" ? (
          <FileTree repo={repo} activePath={activePath} onOpenFile={onOpenFile} />
        ) : loading && !data ? (
          <p className="px-3 py-6 text-[0.7rem] text-text-tertiary">loading…</p>
        ) : count === 0 ? (
          <p className="px-3 py-8 text-center text-[0.72rem] text-text-tertiary">
            Working tree clean.
          </p>
        ) : (
          <ul className="px-1 py-1">
            {data!.entries.map((e) => (
              <li key={e.path}>
                <button
                  type="button"
                  onClick={() => onOpenFile(e.path, e.path.split("/").pop() ?? e.path)}
                  className={cn(
                    "group flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2 py-1 text-left transition-colors",
                    activePath === e.path
                      ? "bg-[color-mix(in_srgb,var(--midground)_10%,transparent)]"
                      : "active:bg-[color-mix(in_srgb,var(--midground)_5%,transparent)]",
                  )}
                >
                  <span
                    className="grid h-4 w-4 shrink-0 place-items-center rounded-[3px] font-mono-ui text-[0.6rem] font-bold"
                    style={{
                      color: STATUS_COLOR[e.status] ?? "var(--text-tertiary)",
                      background: `color-mix(in srgb, ${STATUS_COLOR[e.status] ?? "var(--text-tertiary)"} 14%, transparent)`,
                    }}
                    title={e.staged ? "staged" : "unstaged"}
                  >
                    {e.status}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono-ui text-[0.7rem] text-text-secondary group-hover:text-midground">
                    {e.path}
                  </span>
                  {(e.adds != null || e.dels != null) && (
                    <span className="font-mono-ui tabular shrink-0 text-[0.6rem]">
                      {e.adds ? (
                        <span style={{ color: "var(--color-success)" }}>+{e.adds}</span>
                      ) : null}{" "}
                      {e.dels ? (
                        <span style={{ color: "var(--color-destructive)" }}>−{e.dels}</span>
                      ) : null}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center rounded-[var(--radius-md)] px-2 py-1 text-[0.68rem] transition-colors",
        active
          ? "bg-[color-mix(in_srgb,var(--midground)_10%,transparent)] text-midground"
          : "text-text-tertiary hover:text-text-secondary",
      )}
    >
      {children}
    </button>
  );
}
