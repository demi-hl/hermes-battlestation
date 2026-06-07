"use client";

import { useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePolling } from "@/components/usePolling";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { haptic } from "@/components/shell/haptics";
import type { CronList, CronJob } from "@/lib/types";
import {
  Dot,
  Badge,
  SectionLabel,
  RefreshButton,
  PaneSkeleton,
  StateCard,
  PullToRefresh,
  ClockIcon,
  BoltIcon,
} from "./parts";
import { PlusIcon } from "./pane-icons";
import { Switch, Button } from "@/components/ui";

/* ======================================================================== */
/*  helpers                                                                 */
/* ======================================================================== */

/** Future / past relative label: "in 2h", "3d ago", "not scheduled". */
function whenLabel(iso: string | null): string {
  if (!iso) return "not scheduled";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = t - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const fmt =
    mins < 1
      ? "now"
      : mins < 60
        ? `${mins}m`
        : mins < 1440
          ? `${Math.round(mins / 60)}h`
          : `${Math.round(mins / 1440)}d`;
  if (fmt === "now") return diff >= 0 ? "now" : "just now";
  return diff >= 0 ? `in ${fmt}` : `${fmt} ago`;
}

/** Absolute local stamp: "Jan 5, 10:30 AM". */
function fmtAbs(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function jobTone(job: CronJob): "active" | "paused" | "fail" {
  if (!job.enabled) return "paused";
  if (job.lastStatus && job.lastStatus.toLowerCase() !== "ok") return "fail";
  return "active";
}

/* ======================================================================== */
/*  mutation helpers — POST to the dashboard                                */
/* ======================================================================== */

async function apiCronAction(
  action: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "unknown error");
      return { ok: false, error: text };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/* ======================================================================== */
/*  Toggle                                                                  */
/* ======================================================================== */

function CronToggle({
  job,
  onToggle,
}: {
  job: CronJob;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const [toggling, setToggling] = useState(false);

  const handleToggle = async () => {
    haptic(6);
    setToggling(true);
    const action = job.enabled ? "pause" : "resume";
    const { ok } = await apiCronAction(action, { id: job.id });
    if (ok) onToggle(job.id, !job.enabled);
    setToggling(false);
  };

  return (
    <Switch
      checked={job.enabled}
      onCheckedChange={handleToggle}
      disabled={toggling}
      aria-label={job.enabled ? "Pause job" : "Resume job"}
      className={cn(toggling && "opacity-40")}
    />
  );
}

/* ======================================================================== */
/*  Trigger now                                                             */
/* ======================================================================== */

function TriggerButton({ job }: { job: CronJob }) {
  const [running, setRunning] = useState(false);

  const handleTrigger = async () => {
    haptic(8);
    setRunning(true);
    await apiCronAction("trigger", { id: job.id });
    // Don't reset — let the next poll reflect the change.
    setTimeout(() => setRunning(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleTrigger}
      disabled={running || !job.enabled}
      title="Trigger now"
      className={cn(
        "grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors",
        "text-text-tertiary hover:text-midground active:scale-90",
        running && "animate-spin-slow text-[var(--color-info,#7dd3fc)]",
        (!job.enabled || running) && "opacity-40",
      )}
    >
      <BoltIcon width={13} height={13} />
    </button>
  );
}

/* ======================================================================== */
/*  Row                                                                     */
/* ======================================================================== */

const ROW_V = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.28,
      ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
    },
  },
};

function CronRow({
  job,
  onToggle,
}: {
  job: CronJob;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  return (
    <motion.li variants={ROW_V}>
      <div
        className="flex items-center gap-3 rounded-[var(--radius-md)] border border-border px-3 py-2.5"
        style={{
          background: "color-mix(in srgb, var(--midground) 3%, transparent)",
        }}
      >
        <Dot tone={jobTone(job)} title={job.enabled ? "enabled" : "disabled"} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[0.84rem] font-medium text-midground">
              {job.name}
            </span>
            {!job.enabled && (
              <span className="rounded-full border border-border px-1.5 py-[1px] font-mono-ui text-[0.5rem] uppercase tracking-[0.1em] text-text-tertiary">
                disabled
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded-md border border-border px-1.5 py-[1px] font-mono-ui text-[0.6rem] text-text-secondary">
              {job.schedule || "not set"}
            </span>
            <span className="font-mono-ui text-[0.55rem] text-text-tertiary">
              {job.lastStatus ? `last ${job.lastStatus}` : "no runs"}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="font-mono-ui text-[0.58rem] text-text-secondary">
            {whenLabel(job.nextRunAt)}
          </span>
          <span className="font-mono-ui text-[0.52rem] text-text-tertiary">
            {fmtAbs(job.nextRunAt)}
          </span>
        </div>

        <TriggerButton job={job} />
        <CronToggle job={job} onToggle={onToggle} />
      </div>
    </motion.li>
  );
}

/* ======================================================================== */
/*  Create form                                                             */
/* ======================================================================== */

function CreateForm({ onCreate }: { onCreate: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState("");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !schedule.trim()) return;
    haptic(6);
    setSubmitting(true);
    setError(null);
    const { ok, error: err } = await apiCronAction("create", {
      name: name.trim(),
      schedule: schedule.trim(),
      prompt: prompt.trim() || undefined,
    });
    setSubmitting(false);
    if (ok) {
      setName("");
      setSchedule("");
      setPrompt("");
      setOpen(false);
      onCreate();
    } else {
      setError(err ?? "failed to create job");
    }
  };

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => {
          haptic(8);
          setOpen((o) => !o);
        }}
        className="flex w-full items-center gap-2 rounded-[var(--radius-md)] border border-border px-3 py-2.5 text-left transition-colors active:scale-[0.99]"
        style={{
          background: "color-mix(in srgb, var(--midground) 3%, transparent)",
        }}
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-text-tertiary">
          <PlusIcon width={14} height={14} />
        </span>
        <span className="text-[0.82rem] text-text-secondary">
          {open ? "Cancel" : "New cron job"}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.form
            onSubmit={handleSubmit}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-2.5 rounded-[var(--radius-md)] border border-border px-3 py-3">
              <div>
                <label className="mb-1 block font-mono-ui text-[0.55rem] uppercase tracking-[0.12em] text-text-tertiary">
                  Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. daily-summary"
                  className="w-full rounded-[var(--radius-sm)] border border-border bg-transparent px-2.5 py-1.5 text-[0.82rem] text-midground outline-none placeholder:text-text-disabled focus:border-[color-mix(in_srgb,var(--midground)_30%,transparent)]"
                />
              </div>
              <div>
                <label className="mb-1 block font-mono-ui text-[0.55rem] uppercase tracking-[0.12em] text-text-tertiary">
                  Schedule (cron expression)
                </label>
                <input
                  type="text"
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                  placeholder="e.g. 0 9 * * *"
                  className="w-full rounded-[var(--radius-sm)] border border-border bg-transparent px-2.5 py-1.5 font-mono-ui text-[0.8rem] text-midground outline-none placeholder:text-text-disabled focus:border-[color-mix(in_srgb,var(--midground)_30%,transparent)]"
                />
              </div>
              <div>
                <label className="mb-1 block font-mono-ui text-[0.55rem] uppercase tracking-[0.12em] text-text-tertiary">
                  Prompt (optional)
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="What should this job do?"
                  rows={3}
                  className="w-full resize-none rounded-[var(--radius-sm)] border border-border bg-transparent px-2.5 py-1.5 text-[0.8rem] text-midground outline-none placeholder:text-text-disabled focus:border-[color-mix(in_srgb,var(--midground)_30%,transparent)]"
                />
              </div>
              {error && (
                <p className="font-mono-ui text-[0.62rem] text-[var(--color-destructive,#fb2c36)]">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                size="sm"
                disabled={submitting || !name.trim() || !schedule.trim()}
              >
                {submitting ? "Creating…" : "Create"}
              </Button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ======================================================================== */
/*  Metric badge                                                            */
/* ======================================================================== */

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <span className="font-mono-ui tabular text-base leading-none text-midground">
        {value}
      </span>
      <span className="font-mono-ui text-[0.55rem] uppercase tracking-[0.12em] text-text-tertiary">
        {label}
      </span>
    </div>
  );
}

/* ======================================================================== */
/*  Main pane                                                               */
/* ======================================================================== */

export function CronPane() {
  const { data, error, loading, updatedAt, reload } =
    usePolling<CronList>("/api/cron", 30_000);

  const jobs = data?.jobs ?? [];
  const enabledCount = jobs.filter((j) => j.enabled).length;
  const unavailable = data ? !data.available : false;

  /** Local optimistic toggle. */
  const handleToggle = (id: string, enabled: boolean) => {
    haptic(6);
    reload();
  };

  return (
    <PullToRefresh onRefresh={reload}>
      <div className="px-3 pb-6">
        {/* header */}
        <div className="flex items-center gap-2.5 pt-1">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-border text-midground">
            <ClockIcon width={17} height={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="font-mondwest text-display text-[0.92rem] tracking-[0.04em] text-midground">
              Cron Jobs
            </h1>
            <p className="truncate font-mono-ui text-[0.66rem] text-text-tertiary">
              hermes cron · scheduled tasks
            </p>
          </div>
          <RefreshButton loading={loading} onClick={reload} />
        </div>

        {/* summary */}
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
          <Metric label="scheduled" value={jobs.length} />
          <span className="h-7 w-px bg-border" />
          <Metric label="enabled" value={enabledCount} />
          <span className="ml-auto font-mono-ui text-[0.58rem] text-text-tertiary">
            {updatedAt ? relativeTime(updatedAt) : ""}
          </span>
        </div>

        {/* body */}
        {loading && !data ? (
          <div className="mt-3">
            <PaneSkeleton rows={4} />
          </div>
        ) : error || unavailable ? (
          <StateCard
            icon={ClockIcon}
            tone="danger"
            title="Cron unavailable"
            blurb={error ?? data?.note ?? "dashboard not running"}
          />
        ) : jobs.length === 0 ? (
          <StateCard
            icon={ClockIcon}
            title="No cron jobs"
            blurb="No jobs are scheduled. Create one below."
          />
        ) : (
          <div className="mt-4">
            <SectionLabel
              right={
                <span className="font-mono-ui tabular text-[0.62rem] text-text-tertiary">
                  {jobs.length}
                </span>
              }
            >
              Scheduled Jobs
            </SectionLabel>
            <motion.ul
              className="space-y-2.5"
              initial="hidden"
              animate="show"
              variants={{ show: { transition: { staggerChildren: 0.05 } } }}
            >
              {jobs.map((job) => (
                <CronRow key={job.id || job.name} job={job} onToggle={handleToggle} />
              ))}
            </motion.ul>
          </div>
        )}

        {/* always-visible create form */}
        <CreateForm onCreate={reload} />
      </div>
    </PullToRefresh>
  );
}
