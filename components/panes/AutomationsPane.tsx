"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePolling } from "@/components/usePolling";
import { Sheet } from "@/components/shell/Sheet";
import { haptic } from "@/components/shell/haptics";
import { ChevronRightIcon } from "@/components/shell/icons";
import { relativeTime } from "@/lib/format";
import type { Automation, AutomationsPayload } from "@/lib/prs";
import {
  Dot,
  Badge,
  SectionLabel,
  RefreshButton,
  PaneSkeleton,
  StateCard,
  PullToRefresh,
  BoltIcon,
  ClockIcon,
  ScriptIcon,
  SendPlaneIcon,
  type Tone,
} from "./parts";

/* future-aware relative time: "in 2h" / "3d ago". */
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
  if (fmt === "now") return "now";
  return diff >= 0 ? `in ${fmt}` : `${fmt} ago`;
}

function jobTone(job: Automation): Tone {
  if (!job.active) return "paused";
  if (job.lastStatus && job.lastStatus.toLowerCase() !== "ok") return "fail";
  return "active";
}

function modeShort(mode: string | null): string {
  if (!mode) return "";
  return mode.startsWith("no-agent") ? "no-agent" : "agent";
}

function deliverShort(deliver: string | null): string | null {
  if (!deliver) return null;
  return deliver.split(":")[0]; // "telegram:-100...:110" → "telegram"
}

export function AutomationsPane() {
  const { data, error, loading, updatedAt, reload } = usePolling<AutomationsPayload>(
    "/api/automations",
    30_000,
  );
  const [open, setOpen] = useState<Automation | null>(null);

  const jobs = data?.jobs ?? [];
  const activeCount = jobs.filter((j) => j.active).length;
  const unavailable = data ? !data.available : false;

  return (
    <>
      <PullToRefresh onRefresh={reload}>
        <div className="px-3 pb-6">
          {/* header */}
          <div className="flex items-center gap-2.5 pt-1">
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-border text-midground">
              <BoltIcon width={17} height={17} />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="font-mondwest text-display text-[0.92rem] tracking-[0.04em] text-midground">
                Automations
              </h1>
              <p className="truncate font-mono-ui text-[0.66rem] text-text-tertiary">
                hermes cron · read-only
              </p>
            </div>
            <RefreshButton loading={loading} onClick={reload} />
          </div>

          {/* summary */}
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
            <Metric label="scheduled" value={jobs.length} />
            <span className="h-7 w-px bg-border" />
            <Metric label="active" value={activeCount} />
            <span className="ml-auto font-mono-ui text-[0.58rem] text-text-tertiary">
              {updatedAt ? relativeTime(updatedAt) : ""}
            </span>
          </div>

          {/* body */}
          {loading && !data ? (
            <div className="mt-3">
              <PaneSkeleton rows={3} />
            </div>
          ) : error || unavailable ? (
            <StateCard
              icon={BoltIcon}
              tone="danger"
              title="Scheduler unavailable"
              blurb={error ?? data?.note ?? "hermes cron list returned nothing"}
            />
          ) : jobs.length === 0 ? (
            <StateCard
              icon={ClockIcon}
              title="No scheduled jobs"
              blurb="Nothing runs on its own right now. Cron jobs created on the box will show up here."
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
                  <JobRow
                    key={job.id}
                    job={job}
                    onOpen={() => {
                      haptic(8);
                      setOpen(job);
                    }}
                  />
                ))}
              </motion.ul>
              <p className="mt-4 px-1 font-mono-ui text-[0.6rem] leading-relaxed text-text-tertiary">
                Read-only view. Source: <span className="text-text-secondary">hermes cron list</span>.
                Create / pause from the box or the Hermes desktop control plane.
              </p>
            </div>
          )}
        </div>
      </PullToRefresh>

      <JobDetailSheet job={open} onClose={() => setOpen(null)} />
    </>
  );
}

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

const ROW_V = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
  },
};

function JobRow({ job, onOpen }: { job: Automation; onOpen: () => void }) {
  const deliver = deliverShort(job.deliver);
  return (
    <motion.li variants={ROW_V}>
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full items-center gap-3 rounded-xl border border-border px-3 py-3 text-left transition-colors active:scale-[0.99] hover:border-[color-mix(in_srgb,var(--midground)_28%,transparent)]"
        style={{ background: "color-mix(in srgb, var(--midground) 3%, transparent)" }}
      >
        <Dot tone={jobTone(job)} title={job.active ? "active" : "paused"} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[0.88rem] text-midground">{job.name}</span>
            {!job.active && <Badge>paused</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded-md border border-border px-1.5 py-[1px] font-mono-ui text-[0.6rem] text-text-secondary">
              {job.schedule || "not set"}
            </span>
            {deliver && (
              <span className="inline-flex items-center gap-1 font-mono-ui text-[0.58rem] text-text-tertiary">
                <SendPlaneIcon width={10} height={10} />
                {deliver}
              </span>
            )}
            {job.mode && <Badge>{modeShort(job.mode)}</Badge>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="font-mono-ui text-[0.6rem] text-text-secondary">
            {whenLabel(job.nextRun)}
          </span>
          <span className="font-mono-ui text-[0.55rem] text-text-tertiary">
            {job.lastStatus ? `last ${job.lastStatus}` : "no runs"}
          </span>
        </div>
        <span className="text-text-tertiary transition-transform group-active:translate-x-0.5">
          <ChevronRightIcon width={15} height={15} />
        </span>
      </button>
    </motion.li>
  );
}

/* ---- detail sheet ------------------------------------------------------- */
function JobDetailSheet({ job, onClose }: { job: Automation | null; onClose: () => void }) {
  return (
    <Sheet open={!!job} onClose={onClose} title={job ? job.name : undefined}>
      <AnimatePresence mode="wait">
        {job && (
          <motion.div
            key={job.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="px-2 pb-2"
          >
            <div className="flex items-center gap-2 px-1">
              <Dot tone={jobTone(job)} />
              <span className="font-mono-ui text-[0.66rem] text-text-tertiary">{job.id}</span>
              <Badge tone={job.active ? "ok" : "muted"} className="ml-auto">
                {job.active ? "active" : "paused"}
              </Badge>
            </div>

            <dl className="mt-3 space-y-1.5">
              <Field icon={<ClockIcon width={13} height={13} />} label="schedule" value={job.schedule} mono />
              <Field label="repeat" value={job.repeat ?? "not set"} mono />
              <Field label="next run" value={fmtAbs(job.nextRun)} mono sub={whenLabel(job.nextRun)} />
              <Field
                label="last run"
                value={fmtAbs(job.lastRun)}
                mono
                sub={job.lastStatus ? `status ${job.lastStatus}` : "never run"}
                subTone={job.lastStatus && job.lastStatus.toLowerCase() !== "ok" ? "danger" : "muted"}
              />
              <Field
                icon={<SendPlaneIcon width={12} height={12} />}
                label="deliver"
                value={job.deliver ?? "not set"}
                mono
              />
              <Field
                icon={<ScriptIcon width={12} height={12} />}
                label="script"
                value={job.script ?? "not set"}
                mono
              />
              <Field label="mode" value={job.mode ?? "not set"} />
            </dl>
          </motion.div>
        )}
      </AnimatePresence>
    </Sheet>
  );
}

function fmtAbs(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Compact local stamp, no dashes in the visible separator style.
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Field({
  icon,
  label,
  value,
  sub,
  subTone = "muted",
  mono,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  subTone?: "muted" | "danger";
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border px-3 py-2">
      <span className="mt-0.5 flex w-20 shrink-0 items-center gap-1.5 font-mono-ui text-[0.58rem] uppercase tracking-[0.1em] text-text-tertiary">
        {icon}
        {label}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={
            "break-words text-[0.8rem] text-midground" + (mono ? " font-mono-ui" : "")
          }
        >
          {value}
        </p>
        {sub && (
          <p
            className={
              "mt-0.5 font-mono-ui text-[0.6rem] " +
              (subTone === "danger"
                ? "text-[var(--color-destructive,#fb2c36)]"
                : "text-text-tertiary")
            }
          >
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}
