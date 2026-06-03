"use client";

import { useEffect, useState } from "react";
import { Sheet } from "@/components/shell/Sheet";
import type { ApiEnvelope } from "@/lib/types";
import {
  STATUS_COLOR,
  type KanbanStatus,
  type KanbanTaskDetail,
} from "@/lib/kanban/types";

function StatusPill({ status }: { status: KanbanStatus }) {
  const color = STATUS_COLOR[status] ?? "#94a3b8";
  return (
    <span
      className="font-mono-ui inline-flex items-center rounded-full px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.08em]"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 32%, transparent)`,
      }}
    >
      {status}
    </span>
  );
}

function tsLabel(unixSec?: number | null): string | null {
  if (!unixSec) return null;
  try {
    return new Date(unixSec * 1000).toLocaleString();
  } catch {
    return null;
  }
}

export function KanbanTaskSheet({
  taskId,
  open,
  onClose,
}: {
  taskId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<KanbanTaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !taskId) return;
    let alive = true;
    setLoading(true);
    setDetail(null);
    setError(null);
    fetch(`/api/kanban/${taskId}`, { cache: "no-store" })
      .then((r) => r.json() as Promise<ApiEnvelope<KanbanTaskDetail>>)
      .then((j) => {
        if (!alive) return;
        setDetail(j.data);
        setError(j.error ?? null);
      })
      .catch(() => alive && setError("request failed"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, taskId]);

  const task = detail?.task;

  return (
    <Sheet open={open} onClose={onClose} title="Task">
      {loading && (
        <div className="space-y-2 px-2 py-3">
          <div className="h-4 w-2/3 animate-pulse rounded bg-[color-mix(in_srgb,var(--midground)_10%,transparent)]" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]" />
        </div>
      )}

      {error && !task && (
        <p className="px-2 py-3 text-[0.72rem] text-[color:var(--color-warning)]">
          {error}
        </p>
      )}

      {task && (
        <div className="px-2 pb-2">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 text-[0.95rem] leading-snug text-midground">
              {task.title}
            </h3>
            <StatusPill status={task.status} />
          </div>
          <p className="font-mono-ui mt-1 text-[0.6rem] text-text-tertiary">
            {task.id}
            {task.created_by ? ` · by ${task.created_by}` : ""}
          </p>

          {task.body && (
            <p className="mt-3 whitespace-pre-wrap text-[0.78rem] leading-relaxed text-text-secondary">
              {task.body}
            </p>
          )}

          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[0.66rem]">
            <Meta label="assignee" value={task.assignee ?? "unassigned"} />
            <Meta label="workspace" value={task.workspace_kind} />
            {task.branch_name && <Meta label="branch" value={task.branch_name} mono />}
            <Meta label="priority" value={String(task.priority)} />
            {tsLabel(task.created_at) && <Meta label="created" value={tsLabel(task.created_at)!} />}
            {tsLabel(task.started_at) && <Meta label="started" value={tsLabel(task.started_at)!} />}
            {tsLabel(task.completed_at) && (
              <Meta label="completed" value={tsLabel(task.completed_at)!} />
            )}
          </dl>

          {task.skills.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {task.skills.map((s) => (
                <span
                  key={s}
                  className="font-mono-ui rounded-full border border-border px-1.5 py-0.5 text-[0.58rem] text-text-tertiary"
                >
                  {s}
                </span>
              ))}
            </div>
          )}

          {detail?.comments && detail.comments.length > 0 && (
            <Section title={`Comments · ${detail.comments.length}`}>
              {detail.comments.map((c, i) => (
                <div key={i} className="rounded-[var(--radius-sm)] border border-border/60 px-2 py-1.5">
                  <span className="font-mono-ui text-[0.58rem] text-text-tertiary">
                    {c.author ?? "system"}
                  </span>
                  <p className="text-[0.72rem] text-text-secondary">{c.body}</p>
                </div>
              ))}
            </Section>
          )}

          {detail?.events && detail.events.length > 0 && (
            <Section title="Activity">
              <ol className="relative ml-1.5 border-l border-border/60 pl-3">
                {detail.events.map((e, i) => (
                  <li key={i} className="relative pb-2 last:pb-0">
                    <span className="absolute -left-[17px] top-1 h-1.5 w-1.5 rounded-full bg-[color-mix(in_srgb,var(--midground)_40%,transparent)]" />
                    <span className="font-mono-ui text-[0.62rem] text-midground">{e.kind}</span>
                    <span className="font-mono-ui ml-2 text-[0.56rem] text-text-disabled">
                      {tsLabel(e.created_at) ?? ""}
                    </span>
                  </li>
                ))}
              </ol>
            </Section>
          )}
        </div>
      )}
    </Sheet>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="font-mono-ui text-[0.54rem] uppercase tracking-[0.1em] text-text-disabled">
        {label}
      </span>
      <span className={mono ? "font-mono-ui text-text-secondary" : "text-text-secondary"}>
        {value}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <h4 className="text-display font-mondwest mb-1.5 text-[0.62rem] tracking-[0.12em] text-text-tertiary">
        {title}
      </h4>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}
