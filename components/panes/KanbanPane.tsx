"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform } from "framer-motion";
import { usePolling, useEventStream } from "@/components/usePolling";
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
import { Button } from "@/components/ui";
import { PullToRefresh } from "./parts";

function created(task: KanbanTask): string {
  try {
    return relativeTime(new Date(task.created_at * 1000).toISOString());
  } catch {
    return "";
  }
}

const SWIPE_COMMIT = 110; // px past which a swipe fires its action (deliberate, not a graze)

function TrashGlyph() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
    </svg>
  );
}

function PushGlyph() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/**
 * One task card. Swipe LEFT past the threshold archives it (reversible remove);
 * for blocked tasks, swipe RIGHT past the threshold pushes it back to ready.
 * Tapping (no horizontal travel) opens the detail sheet. Drag is axis-locked to
 * x so the column still scrolls vertically.
 */
function TaskCard({
  task,
  onOpen,
  onArchive,
  onPush,
}: {
  task: KanbanTask;
  onOpen: () => void;
  onArchive: () => void;
  onPush?: () => void;
}) {
  const color = STATUS_COLOR[task.status] ?? "#94a3b8";
  const canPush = !!onPush;
  const x = useMotionValue(0);
  const draggedRef = useRef(false);

  // Reveal each action background only as the card slides off it.
  const archiveOpacity = useTransform(x, [-SWIPE_COMMIT, -8, 0], [1, 0.4, 0]);
  const pushOpacity = useTransform(x, [0, 8, SWIPE_COMMIT], [0, 0.4, 1]);

  return (
    <motion.div layout className="relative">
      {/* action rails behind the card */}
      <div className="pointer-events-none absolute inset-0 flex items-stretch justify-between overflow-hidden rounded-[var(--radius-md)]">
        {canPush ? (
          <motion.div
            style={{ opacity: pushOpacity }}
            className="flex w-1/2 items-center gap-1.5 rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--color-success)_22%,transparent)] pl-3 text-[0.62rem] font-mono-ui uppercase tracking-wider text-[color:var(--color-success)]"
          >
            <PushGlyph /> ready
          </motion.div>
        ) : (
          <span />
        )}
        <motion.div
          style={{ opacity: archiveOpacity }}
          className="flex w-1/2 items-center justify-end gap-1.5 rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--color-destructive)_22%,transparent)] pr-3 text-[0.62rem] font-mono-ui uppercase tracking-wider text-[color:var(--color-destructive)]"
        >
          archive <TrashGlyph />
        </motion.div>
      </div>

      <motion.button
        type="button"
        drag="x"
        style={{ x }}
        dragDirectionLock
        dragConstraints={{ left: canPush ? -140 : -140, right: canPush ? 140 : 0 }}
        dragElastic={0.12}
        onDragStart={() => { draggedRef.current = false; }}
        onDrag={(_, info) => {
          if (Math.abs(info.offset.x) > 6) draggedRef.current = true;
        }}
        onDragEnd={(_, info) => {
          if (info.offset.x <= -SWIPE_COMMIT) {
            haptic(12);
            onArchive();
          } else if (canPush && info.offset.x >= SWIPE_COMMIT) {
            haptic(12);
            onPush?.();
          }
        }}
        onClick={() => {
          if (draggedRef.current) return; // it was a swipe, not a tap
          haptic(8);
          onOpen();
        }}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full touch-pan-y rounded-[var(--radius-md)] border border-border bg-card px-2.5 py-2 text-left transition-colors active:bg-[color-mix(in_srgb,var(--midground)_6%,transparent)]"
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
          <span className="font-mono-ui text-[0.62rem] text-text-tertiary">{task.id}</span>
          {task.assignee && (
            <span className="text-[0.62rem] text-text-secondary">@{task.assignee}</span>
          )}
          {task.branch_name && (
            <span className="font-mono-ui truncate text-[0.62rem] text-text-tertiary">
              {task.branch_name}
            </span>
          )}
          <span className="font-mono-ui ml-auto text-[0.6rem] text-text-tertiary">
            {created(task)}
          </span>
        </div>
      </motion.button>
    </motion.div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function ExpandableRow({
  label,
  color,
  tasks,
  onOpen,
  onArchive,
  onPush,
  isBlocked,
  defaultOpen,
}: {
  label: string;
  color: string;
  tasks: KanbanTask[];
  onOpen: (id: string) => void;
  onArchive: (id: string) => void;
  onPush: (id: string) => void;
  isBlocked: boolean;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-[var(--radius-md)] border border-border bg-[color-mix(in_srgb,var(--midground)_3%,transparent)]">
      <button
        type="button"
        onClick={() => {
          haptic(6);
          setOpen((o) => !o);
        }}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors active:bg-[color-mix(in_srgb,var(--midground)_6%,transparent)]"
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
        <span className="text-display font-mondwest text-[0.7rem] tracking-[0.12em] text-text-secondary">
          {label}
        </span>
        <span className="font-mono-ui tabular grid h-4 min-w-4 place-items-center rounded-full bg-[color-mix(in_srgb,var(--midground)_12%,transparent)] px-1 text-[0.58rem] text-text-tertiary">
          {tasks.length}
        </span>
        <span className="ml-auto text-text-tertiary">
          <ChevronIcon open={open} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-2 px-2.5 pb-2.5">
              <AnimatePresence initial={false}>
                {tasks.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    onOpen={() => onOpen(t.id)}
                    onArchive={() => onArchive(t.id)}
                    onPush={isBlocked ? () => onPush(t.id) : undefined}
                  />
                ))}
              </AnimatePresence>
              {tasks.length === 0 && (
                <div className="rounded-[var(--radius-md)] border border-dashed border-border/60 px-3 py-3 text-center text-[0.62rem] text-text-disabled">
                  empty
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

export function KanbanPane() {
  const { data, loading, error, updatedAt, reload } = usePolling<KanbanData>(
    "/api/kanban",
    5_000,
  );
  // Real-time fast path: the server pushes a "changed" event the instant the
  // board DB moves; reload() pulls fresh data immediately. The 5s poll above is
  // the fallback and is untouched, so the board still works if SSE drops.
  useEventStream("/api/kanban/stream", reload);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formStatus, setFormStatus] = useState<KanbanStatus>("todo");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // ids with an in-flight mutation — optimistically hidden until reload
  const [pending, setPending] = useState<Set<string>>(new Set());

  // auto-dismiss the form when data refresh brings the new card in
  const prevCountRef = useRef(0);
  useEffect(() => {
    if (data && data.tasks.length > prevCountRef.current && prevCountRef.current !== 0) {
      setShowForm(false);
    }
    prevCountRef.current = data?.tasks.length ?? 0;
  }, [data]);

  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  const byColumn = useMemo(() => {
    const visible = tasks.filter((t) => !pending.has(t.id));
    return KANBAN_COLUMNS.map((col) => ({
      ...col,
      tasks: visible.filter((t) => col.statuses.includes(t.status as KanbanStatus)),
    }));
  }, [tasks, pending]);

  const openTask = (id: string) => {
    setOpenId(id);
    setSheetOpen(true);
  };

  // Optimistically drop/restage a card, then fire the real CLI verb. On failure
  // we reload to snap back to server truth (the card reappears in its lane).
  const mutate = useCallback(
    async (id: string, action: "archive" | "unblock" | "promote") => {
      setPending((prev) => new Set(prev).add(id));
      try {
        const res = await fetch(`/api/kanban/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) throw new Error(await res.text());
      } catch {
        // swallow — reload restores the true state below
      } finally {
        reload();
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [reload],
  );

  const createTask = useCallback(async () => {
    const title = formTitle.trim();
    if (!title) return;
    setCreating(true);
    setCreateError(null);
    haptic(12);
    try {
      const body = formBody.trim() || undefined;
      const res = await fetch("/api/kanban", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, body, status: formStatus }),
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      setFormTitle("");
      setFormBody("");
      reload();
    } catch (e) {
      // Keep the form open + show the failure so the draft isn't lost silently.
      haptic([8, 6, 12]);
      setCreateError(e instanceof Error ? e.message.slice(0, 160) : "create failed");
    } finally {
      setCreating(false);
    }
  }, [formTitle, formBody, formStatus, reload]);

  const resetForm = () => {
    setShowForm(false);
    setFormTitle("");
    setFormBody("");
    setFormStatus("todo");
    setCreateError(null);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="pt-1"
    >
      <header className="mb-3 flex items-center gap-3 px-3">
        <span className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-md)] border border-border text-midground">
          <span className="arc-border" aria-hidden />
          <KanbanIcon width={18} height={18} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="text-display font-mondwest text-base leading-tight tracking-[0.1em] text-midground">
            Kanban
          </h2>
          <span className="font-mono-ui text-[0.62rem] text-text-tertiary">
            {data ? `${data.board} · ${tasks.length} task${tasks.length === 1 ? "" : "s"}` : ""}
            {updatedAt ? ` · ${relativeTime(updatedAt)}` : ""}
          </span>
        </div>
      </header>

      {/* ── quick-create form ── */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden px-3"
          >
            <div className="mb-3 rounded-[var(--radius-md)] border border-border bg-card p-3">
              <input
                type="text"
                placeholder="Task title…"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                className="mb-2 w-full rounded-[var(--radius-sm)] border border-border bg-[color-mix(in_srgb,var(--midground)_6%,transparent)] px-2.5 py-1.5 text-[0.78rem] text-midground outline-none placeholder:text-text-disabled focus:border-[color-mix(in_srgb,var(--accent)_60%,transparent)]"
                autoFocus
              />
              <textarea
                placeholder="Optional body…"
                value={formBody}
                onChange={(e) => setFormBody(e.target.value)}
                rows={2}
                className="mb-2 w-full resize-none rounded-[var(--radius-sm)] border border-border bg-[color-mix(in_srgb,var(--midground)_6%,transparent)] px-2.5 py-1.5 text-[0.72rem] text-midground outline-none placeholder:text-text-disabled focus:border-[color-mix(in_srgb,var(--accent)_60%,transparent)]"
              />
              <div className="flex items-center justify-between gap-2">
                <select
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value as KanbanStatus)}
                  className="rounded-[var(--radius-sm)] border border-border bg-[color-mix(in_srgb,var(--midground)_6%,transparent)] px-2 py-1 text-[0.7rem] text-midground outline-none focus:border-[color-mix(in_srgb,var(--accent)_60%,transparent)]"
                >
                  {KANBAN_COLUMNS.flatMap((col) =>
                    col.statuses.map((s) => (
                      <option key={s} value={s}>
                        {col.label} — {s}
                      </option>
                    )),
                  )}
                </select>
                <div className="flex items-center gap-1.5">
                  <Button ghost size="sm" type="button" onClick={resetForm}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    disabled={!formTitle.trim() || creating}
                    onClick={createTask}
                  >
                    {creating ? "Creating…" : "Create"}
                  </Button>
                </div>
              </div>
              {createError && (
                <p className="mt-2 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--color-destructive)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-destructive)_10%,transparent)] px-2.5 py-1.5 text-[0.68rem] text-[color:var(--color-destructive)]">
                  Create failed: {createError}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── floating + button ── */}
      <div className="relative">
        {!showForm && (
          <motion.button
            type="button"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => {
              haptic(6);
              setShowForm(true);
            }}
            className="absolute -top-1 right-3 z-10 grid h-7 w-7 place-items-center rounded-full bg-[var(--accent)] text-sm text-white shadow-lg transition-transform active:scale-90"
            aria-label="Create task"
          >
            +
          </motion.button>
        )}
      </div>

      {loading && !data ? (
        <ColumnsSkeleton />
      ) : error && !data ? (
        <p className="px-3 text-[0.7rem] text-[color:var(--color-warning)]">{error}</p>
      ) : tasks.length === 0 ? (
        <EmptyBoard />
      ) : (
        <div className="flex flex-col gap-2 px-3 pb-2">
          {byColumn.map((col) => (
            <ExpandableRow
              key={col.id}
              label={col.label}
              color={STATUS_COLOR[col.statuses[0]] ?? "#94a3b8"}
              tasks={col.tasks}
              onOpen={openTask}
              onArchive={(id) => mutate(id, "archive")}
              onPush={(id) => mutate(id, "unblock")}
              isBlocked={col.id === "blocked"}
              defaultOpen={col.tasks.length > 0}
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
