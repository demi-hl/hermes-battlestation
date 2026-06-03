"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { haptic } from "@/components/shell/haptics";
import { ChevronRightIcon } from "@/components/shell/icons";
import {
  FolderIcon,
  FolderOpenIcon,
  FileIcon,
  RefreshIcon,
} from "@/components/panes/pane-icons";
import type { TreeEntry } from "@/lib/workspace-types";

interface FileTreeProps {
  repo: string;
  activePath: string | null;
  onOpenFile: (path: string, name: string) => void;
}

async function fetchDir(repo: string, path: string): Promise<TreeEntry[]> {
  const res = await fetch(
    `/api/files/tree?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(path)}`,
    { cache: "no-store" },
  );
  if (!res.ok) return [];
  const body = (await res.json()) as { entries?: TreeEntry[] };
  return body.entries ?? [];
}

export function FileTree({ repo, activePath, onOpenFile }: FileTreeProps) {
  const [root, setRoot] = useState<TreeEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const entries = await fetchDir(repo, "");
    setRoot(entries);
    setLoading(false);
  }, [repo]);

  useEffect(() => {
    setRoot(null);
    load();
  }, [load]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-display font-mondwest text-[0.64rem] tracking-[0.16em] text-text-tertiary">
          Files
        </span>
        <button
          type="button"
          aria-label="Reload file tree"
          onClick={() => {
            haptic(6);
            load();
          }}
          className="grid h-6 w-6 place-items-center rounded-full text-text-tertiary transition-colors active:scale-90 active:text-midground"
        >
          <RefreshIcon width={13} height={13} className={loading ? "animate-spin-slow" : ""} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-3 scrollbar-none">
        {root === null ? (
          <TreeSkeleton />
        ) : root.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-text-tertiary">
            Empty repository.
          </p>
        ) : (
          root.map((entry) => (
            <TreeNode
              key={entry.path}
              repo={repo}
              entry={entry}
              depth={0}
              activePath={activePath}
              onOpenFile={onOpenFile}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TreeNode({
  repo,
  entry,
  depth,
  activePath,
  onOpenFile,
}: {
  repo: string;
  entry: TreeEntry;
  depth: number;
  activePath: string | null;
  onOpenFile: (path: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<TreeEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const isActive = entry.type === "file" && entry.path === activePath;

  const toggle = useCallback(async () => {
    haptic(5);
    if (entry.type === "file") {
      onOpenFile(entry.path, entry.name);
      return;
    }
    const next = !open;
    setOpen(next);
    if (next && children === null) {
      setLoading(true);
      setChildren(await fetchDir(repo, entry.path));
      setLoading(false);
    }
  }, [entry, open, children, repo, onOpenFile]);

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={entry.type === "dir" ? open : undefined}
        className={cn(
          "group relative flex w-full items-center gap-1.5 rounded-[var(--radius-md)] py-[5px] pr-2 text-left transition-colors",
          isActive
            ? "bg-[color-mix(in_srgb,var(--midground)_10%,transparent)] text-midground"
            : "text-text-secondary active:bg-[color-mix(in_srgb,var(--midground)_5%,transparent)]",
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {isActive && (
          <span
            aria-hidden
            className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-midground"
          />
        )}
        {entry.type === "dir" ? (
          <ChevronRightIcon
            width={12}
            height={12}
            className={cn(
              "shrink-0 text-text-tertiary transition-transform duration-200",
              open && "rotate-90",
            )}
          />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {entry.type === "dir" ? (
          open ? (
            <FolderOpenIcon width={15} height={15} className="shrink-0 text-text-tertiary" />
          ) : (
            <FolderIcon width={15} height={15} className="shrink-0 text-text-tertiary" />
          )
        ) : (
          <FileIcon
            width={14}
            height={14}
            className={cn("shrink-0", isActive ? "text-midground" : "text-text-tertiary")}
          />
        )}
        <span className="truncate text-[0.8rem]">{entry.name}</span>
      </button>

      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18 }}
        >
          {loading && children === null ? (
            <p
              className="py-1 text-[0.7rem] text-text-tertiary"
              style={{ paddingLeft: `${8 + (depth + 1) * 14 + 14}px` }}
            >
              loading...
            </p>
          ) : (
            children?.map((child) => (
              <TreeNode
                key={child.path}
                repo={repo}
                entry={child}
                depth={depth + 1}
                activePath={activePath}
                onOpenFile={onOpenFile}
              />
            ))
          )}
        </motion.div>
      )}
    </div>
  );
}

function TreeSkeleton() {
  return (
    <div className="space-y-1.5 px-3 py-3">
      {[0.9, 0.6, 0.75, 0.5, 0.8, 0.65, 0.7].map((w, i) => (
        <div
          key={i}
          className="h-3.5 animate-pulse rounded bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]"
          style={{ width: `${w * 100}%` }}
        />
      ))}
    </div>
  );
}
