"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/shell/workspace-context";
import { DiffIcon } from "@/components/shell/icons";

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
interface FileDiff {
  path: string;
  staged: boolean;
  patch: string;
  binary: boolean;
}

const STATUS_COLOR: Record<string, string> = {
  M: "var(--color-warning)",
  A: "var(--color-success)",
  D: "var(--color-destructive)",
  R: "var(--midground)",
  C: "var(--midground)",
  U: "var(--color-destructive)",
  "?": "var(--text-tertiary)",
};

type Line = { kind: "add" | "del" | "hunk" | "meta" | "ctx"; text: string };

// Classify each unified-diff line for coloring. Cheap, prefix-driven.
function parsePatch(patch: string): Line[] {
  const out: Line[] = [];
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) out.push({ kind: "hunk", text: raw });
    else if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("diff ") || raw.startsWith("index ") || raw.startsWith("new file") || raw.startsWith("deleted file") || raw.startsWith("similarity ") || raw.startsWith("rename "))
      out.push({ kind: "meta", text: raw });
    else if (raw.startsWith("+")) out.push({ kind: "add", text: raw });
    else if (raw.startsWith("-")) out.push({ kind: "del", text: raw });
    else out.push({ kind: "ctx", text: raw });
  }
  return out;
}

const LINE_STYLE: Record<Line["kind"], string> = {
  add: "text-[var(--color-success)] bg-[color-mix(in_srgb,var(--color-success)_8%,transparent)]",
  del: "text-[var(--color-destructive)] bg-[color-mix(in_srgb,var(--color-destructive)_8%,transparent)]",
  hunk: "text-midground bg-[color-mix(in_srgb,var(--midground)_10%,transparent)]",
  meta: "text-text-tertiary",
  ctx: "text-text-secondary",
};

/** Read-only `git diff` review view for the active repo: changed-file list on
 *  the left, colored unified hunks on the right. Built for steering, not
 *  editing — the agent mutates the repo, this reflects it. */
export function DiffPane() {
  const { active } = useWorkspace();
  const repo = active?.repo ?? null;

  const [changes, setChanges] = useState<ChangesResult | null>(null);
  const [selected, setSelected] = useState<ChangeEntry | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);

  const loadChanges = useCallback(async () => {
    if (!repo) {
      setChanges(null);
      return;
    }
    try {
      const res = await fetch(`/api/changes?repo=${encodeURIComponent(repo)}`, {
        cache: "no-store",
      });
      setChanges(res.ok ? ((await res.json()) as ChangesResult) : null);
    } catch {
      setChanges(null);
    }
  }, [repo]);

  // Poll the change list every 5s so it tracks what the agent does.
  useEffect(() => {
    loadChanges();
    const id = setInterval(loadChanges, 5000);
    return () => clearInterval(id);
  }, [loadChanges]);

  // Auto-select the first entry when the list loads and nothing is picked.
  useEffect(() => {
    if (!selected && changes?.entries.length) setSelected(changes.entries[0]);
    // Drop selection if the file is no longer changed.
    if (selected && changes && !changes.entries.some((e) => e.path === selected.path && e.staged === selected.staged))
      setSelected(changes.entries[0] ?? null);
  }, [changes, selected]);

  // Fetch the diff text for the selected file.
  useEffect(() => {
    if (!repo || !selected) {
      setDiff(null);
      return;
    }
    let alive = true;
    setLoadingDiff(true);
    const q = new URLSearchParams({
      repo,
      path: selected.path,
      staged: selected.staged ? "1" : "0",
    });
    fetch(`/api/changes/diff?${q}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: FileDiff | null) => alive && setDiff(d))
      .catch(() => alive && setDiff(null))
      .finally(() => alive && setLoadingDiff(false));
    return () => {
      alive = false;
    };
  }, [repo, selected]);

  const lines = useMemo(() => (diff?.patch ? parsePatch(diff.patch) : []), [diff]);
  const count = changes?.entries.length ?? 0;

  if (!repo) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div className="max-w-sm">
          <DiffIcon className="mx-auto mb-3 h-7 w-7 text-text-tertiary" />
          <p className="text-[0.78rem] text-text-secondary">
            Pick a workspace to review its git changes.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Left: changed-file list */}
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-border">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <DiffIcon className="h-3.5 w-3.5 text-midground" />
          <span className="text-[0.72rem] font-medium text-midground">Changes</span>
          {count > 0 && (
            <span className="rounded-full bg-[color-mix(in_srgb,var(--midground)_16%,transparent)] px-1.5 font-mono-ui text-[0.56rem] text-text-secondary">
              {count}
            </span>
          )}
          <div className="flex-1" />
          {changes?.branch && (
            <span className="font-mono-ui truncate text-[0.56rem] text-text-tertiary">
              {changes.branch}
            </span>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-none px-1 py-1">
          {count === 0 ? (
            <p className="px-2 py-8 text-center text-[0.72rem] text-text-tertiary">
              Working tree clean.
            </p>
          ) : (
            <ul>
              {changes!.entries.map((e) => {
                const isSel = selected?.path === e.path && selected?.staged === e.staged;
                return (
                  <li key={`${e.staged ? "s" : "u"}:${e.path}`}>
                    <button
                      type="button"
                      onClick={() => setSelected(e)}
                      className={cn(
                        "group flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2 py-1 text-left transition-colors",
                        isSel
                          ? "bg-[color-mix(in_srgb,var(--midground)_12%,transparent)]"
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
                      {(e.adds || e.dels) && (
                        <span className="font-mono-ui tabular shrink-0 text-[0.58rem]">
                          {e.adds ? <span style={{ color: "var(--color-success)" }}>+{e.adds}</span> : null}{" "}
                          {e.dels ? <span style={{ color: "var(--color-destructive)" }}>−{e.dels}</span> : null}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* Right: unified diff for the selected file */}
      <section className="flex min-w-0 flex-1 flex-col">
        {selected && (
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <span className="min-w-0 flex-1 truncate font-mono-ui text-[0.72rem] text-midground">
              {selected.path}
            </span>
            <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 font-mono-ui text-[0.56rem] text-text-tertiary">
              {selected.staged ? "staged" : "unstaged"}
            </span>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto scrollbar-none">
          {loadingDiff && !diff ? (
            <p className="px-3 py-6 text-[0.7rem] text-text-tertiary">loading diff…</p>
          ) : diff?.binary ? (
            <p className="px-3 py-8 text-center text-[0.72rem] text-text-tertiary">
              Binary file — no text diff.
            </p>
          ) : lines.length === 0 ? (
            <p className="px-3 py-8 text-center text-[0.72rem] text-text-tertiary">
              {count === 0 ? "Nothing to review." : "No diff for this file."}
            </p>
          ) : (
            <pre className="min-w-full font-mono-ui text-[0.7rem] leading-[1.5]">
              {lines.map((l, i) => (
                <div
                  key={i}
                  className={cn("whitespace-pre px-3", LINE_STYLE[l.kind])}
                >
                  {l.text || " "}
                </div>
              ))}
            </pre>
          )}
        </div>
      </section>
    </div>
  );
}
