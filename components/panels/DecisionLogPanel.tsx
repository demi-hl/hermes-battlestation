"use client";

import { usePolling } from "../usePolling";
import { Panel } from "../Panel";
import { EmptyState, PanelSkeleton } from "../EmptyState";
import { DocIcon } from "../Icons";
import type { DecisionLog } from "@/lib/types";

export function DecisionLogPanel() {
  const { data, loading, updatedAt, reload } = usePolling<DecisionLog>(
    "/api/decisions",
  );

  return (
    <Panel
      title="Vault decision log"
      icon={<DocIcon />}
      updatedAt={updatedAt}
      onReload={reload}
      badge={
        data?.available && data.date ? (
          <span className="font-mono text-[11px] text-ink-dim">{data.date}</span>
        ) : null
      }
    >
      {loading && !data ? (
        <PanelSkeleton />
      ) : !data || !data.available ? (
        <EmptyState title="Decision log unreadable" sub={data?.note ?? undefined} />
      ) : (
        <div className="space-y-3">
          <Feed label="Shipped" items={data.shipped} tone="accent" />
          <Feed label="Decided" items={data.decided} tone="muted" />
        </div>
      )}
    </Panel>
  );
}

function Feed({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone: "accent" | "muted";
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            tone === "accent" ? "bg-accent" : "bg-muted"
          }`}
        />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-dim">
          {label}
        </span>
        <span className="font-mono text-[10.5px] text-faint">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="pl-3.5 text-[12px] text-faint">none recorded</p>
      ) : (
        <ul className="space-y-1 pl-3.5">
          {items.slice(0, 6).map((it, i) => (
            <li
              key={i}
              className="border-l border-line pl-2.5 text-[12px] leading-snug text-ink-dim"
            >
              {it}
            </li>
          ))}
          {items.length > 6 && (
            <li className="pl-2.5 text-[11px] text-faint">
              and {items.length - 6} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
