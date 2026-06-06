"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePolling } from "@/components/usePolling";
import { relativeTime } from "@/lib/format";
import { haptic } from "@/components/shell/haptics";
import { KanbanIcon } from "@/components/shell/icons";
import {
  KANBAN_COLUMNS,
  STATUS_COLOR,
  type KanbanData,
  type KanbanStatus,
  type KanbanTask,
} from "@/lib/kanban/types";
import { KanbanTaskSheet } from "./kanban/KanbanTaskSheet";

function created(task: KanbanTask): string {
  try {
    return relativeTime(new Date(task.created_at * 1000).toISOString());
  } catch {
    return "";
  }
}

function TaskCard({ task, onOpen }: { task: KanbanTask; onOpen: () => void }) {
  const color = STATUS_COLOR[task.status] ?? "#94a3b8";
  return (
    <motion.button
      type="button"
      layout
      onClick={() => {
        haptic(8);
        onOpen();
      }}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="w-full rounded-[var(--radius-md)] border border-border bg-card px-2.5 py-2 text-left transition-colors active:bg-[color-mix(in_srgb,var(--midground)_6%,transparent)]"
    >
      <div className="flex items-start gap-2">
        <span
          className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: color, boxShadow: `0 0 5px ${color}` }}
        />
        <p className="line-clamp-2 flex-1 text-[0.78rem] leading-snug text-midground">
          {task.title}
        </p>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 pl-3.5">
        <span className="font-mono-ui text-[0.56rem] text-text-tertiary">{task.id}</span>
        {task.assignee && (
          <span className="text-[0.58rem] text-text-secondary">@{task.assignee}</span>
        )}
        {task.branch_name && (
          <span className="font-mono-ui truncate text-[0.56rem] text-text-tertiary">
            {task.branch_name}
          </span>
        )}
        <span className="font-mono-ui ml-auto text-[0.54rem] text-text-disabled">
          {created(task)}
        </span>
      </div>
    </motion.button>
  );
}

function Column({
  label,
  color,
  tasks,
  onOpen,
}: {
  label: string;
  color: string;
  tasks: KanbanTask[];
  onOpen: (id: string) => void;
}) {
  return (
    <section className="flex w-[80vw] max-w-[280px] shrink-0 snap-start flex-col lg:w-auto lg:max-w-none lg:flex-1 lg:shrink">
      <header className="mb-2 flex items-center gap-2 px-0.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
        <span className="text-display font-mondwest text-[0.68rem] tracking-[0.12em] text-text-secondary">
          {label}
        </span>
        <span className="font-mono-ui tabular grid h-4 min-w-4 place-items-center rounded-full bg-[color-mix(in_srgb,var(--midground)_12%,transparent)] px-1 text-[0.58rem] text-text-tertiary">
          {tasks.length}
        </span>
      </header>
      <div className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} onOpen={() => onOpen(t.id)} />
          ))}
        </AnimatePresence>
        {tasks.length === 0 && (
          <div className="rounded-[var(--radius-md)] border border-dashed border-border/60 px-3 py-4 text-center text-[0.62rem] text-text-disabled">
            empty
          </div>
        )}
      </div>
    </section>
  );
}

export function KanbanPane() {
  const { data, loading, error, updatedAt } = usePolling<KanbanData>(
    "/api/kanban",
    15_000,
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const tasks = data?.tasks ?? [];
  const byColumn = useMemo(() => {
    return KANBAN_COLUMNS.map((col) => ({
      ...col,
      tasks: tasks.filter((t) => col.statuses.includes(t.status as KanbanStatus)),
    }));
  }, [tasks]);

  const openTask = (id: string) => {
    setOpenId(id);
    setSheetOpen(true);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="pt-1"
    >
      <header className="mb-3 flex items-baseline justify-between px-3">
        <h2 className="text-display font-mondwest text-base tracking-[0.1em] text-midground">
          Kanban
        </h2>
        <span className="font-mono-ui text-[0.56rem] text-text-disabled">
          {data ? `${data.board} · ${tasks.length} task${tasks.length === 1 ? "" : "s"}` : ""}
          {updatedAt ? ` · ${relativeTime(updatedAt)}` : ""}
        </span>
      </header>

      {loading && !data ? (
        <ColumnsSkeleton />
      ) : error && !data ? (
        <p className="px-3 text-[0.7rem] text-[color:var(--color-warning)]">{error}</p>
      ) : tasks.length === 0 ? (
        <EmptyBoard />
      ) : (
        <div className="scrollbar-none flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-2 lg:snap-none lg:items-start lg:overflow-x-visible">
          {byColumn.map((col) => (
            <Column
              key={col.id}
              label={col.label}
              color={STATUS_COLOR[col.statuses[0]] ?? "#94a3b8"}
              tasks={col.tasks}
              onOpen={openTask}
            />
          ))}
        </div>
      )}

      <KanbanTaskSheet
        taskId={openId}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
      />
    </motion.div>
  );
}

function EmptyBoard() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-8 py-16 text-center">
      <span className="relative grid h-16 w-16 place-items-center rounded-[calc(var(--theme-radius)+6px)] text-midground" style={{ background: "color-mix(in srgb, var(--midground) 6%, transparent)" }}>
        <span className="arc-border" aria-hidden />
        <KanbanIcon width={28} height={28} />
      </span>
      <div>
        <h3 className="font-mondwest text-display text-base tracking-wide text-midground">
          Board is clear
        </h3>
        <p className="mx-auto mt-1.5 max-w-[34ch] text-[0.74rem] leading-relaxed text-text-tertiary">
          No tasks on the shared Hermes board right now. New tasks created with
          <span className="font-mono-ui"> hermes kanban create</span> will flow
          into these columns automatically.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {KANBAN_COLUMNS.map((c) => (
          <span
            key={c.id}
            className="font-mono-ui inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[0.56rem] text-text-tertiary"
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: STATUS_COLOR[c.statuses[0]] }}
            />
            {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ColumnsSkeleton() {
  return (
    <div className="scrollbar-none flex gap-3 overflow-hidden px-3">
      {[0, 1, 2].map((col) => (
        <div key={col} className="w-[80vw] max-w-[280px] shrink-0">
          <div className="mb-2 h-3 w-24 animate-pulse rounded bg-[color-mix(in_srgb,var(--midground)_10%,transparent)]" />
          <div className="flex flex-col gap-2">
            {[0, 1].map((c) => (
              <div
                key={c}
                className="h-[64px] animate-pulse rounded-[var(--radius-md)] border border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)]"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
