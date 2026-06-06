"use client";

import { usePolling } from "./usePolling";
import { ExternalIcon } from "./Icons";
import { EmptyState } from "./EmptyState";
import { relativeTime } from "@/lib/format";
import type { Repo } from "@/lib/types";

export function RepoList() {
  const { data, loading, error } = usePolling<Repo[]>("/api/repos", 60_000);

  return (
    <div id="leftrail-repos" className="flex min-h-0 flex-1 flex-col rounded-lg">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.15em] text-faint">
          Repos
        </span>
        {data && (
          <span className="font-mono text-[10px] text-faint">{data.length} repos</span>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
        {loading && !data ? (
          <div className="space-y-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-9 animate-pulse rounded-md bg-line" />
            ))}
          </div>
        ) : !data || data.length === 0 ? (
          <EmptyState title="No repos" sub={error ?? "gh repo list returned nothing"} />
        ) : (
          data.map((r) => (
            <a
              key={r.name}
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className="group block rounded-md border border-transparent px-2.5 py-1.5 transition-colors hover:border-line hover:bg-surface-2"
              title={r.description ?? r.name}
            >
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[12.5px] font-medium text-ink-dim group-hover:text-accent">
                  {r.name}
                </span>
                <ExternalIcon className="ml-auto shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[10.5px] text-faint">
                  {r.description || "no description"}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[9.5px] text-faint">
                  {relativeTime(r.pushedAt)}
                </span>
              </div>
            </a>
          ))
        )}
      </div>
    </div>
  );
}
