"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { usePolling } from "@/components/usePolling";
import { relativeTime } from "@/lib/format";
import { haptic } from "@/components/shell/haptics";
import { cn } from "@/lib/utils";
import { RefreshIcon } from "@/components/panes/pane-icons";
import { SectionLabel, PaneSkeleton, StateCard, PullToRefresh } from "./parts";
import type { SVGProps } from "react";

/* ========================================================================= */

type P = SVGProps<SVGSVGElement>;

const ANALYTICS_ICON = (p: P) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...p}
  >
    <path d="M3 3v18h18" />
    <rect x="7" y="11" width="3" height="6" rx="0.5" />
    <rect x="12.5" y="7" width="3" height="10" rx="0.5" />
    <rect x="18" y="13" width="3" height="4" rx="0.5" />
  </svg>
);

/* ========================================================================= */

type AnalyticsTotals = {
  sessions: number;
  in: number;
  out: number;
  cacheR: number;
  cacheW: number;
  cost: number;
  msgs: number;
};

type DailyPoint = {
  date: string;
  sessions: number;
  in: number;
  out: number;
  cost: number;
};

type ModelRow = {
  model: string;
  sessions: number;
  in: number;
  out: number;
  cost: number;
};

type SourceRow = {
  source: string;
  sessions: number;
};

type AnalyticsPayload = {
  days: number;
  totals: AnalyticsTotals;
  daily: DailyPoint[];
  models: ModelRow[];
  sources: SourceRow[];
};

/* ========================================================================= */

const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];

const IN_COLOR = "var(--color-info, #7dd3fc)";
const OUT_COLOR = "var(--color-accent-bar, #a78bfa)";

const fmtNum = (n: number): string => Math.round(n ?? 0).toLocaleString();
const fmtCost = (n: number): string => `$${(n ?? 0).toFixed(2)}`;

/** Short, locale-aware month/day label from an ISO-ish date string. */
function dayLabel(date: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ========================================================================= */

const SECTION_V = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.3,
      ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
    },
  },
};

/* ========================================================================= */

export function AnalyticsPane() {
  const [days, setDays] = useState<Period>(30);
  const { data, error, loading, updatedAt, reload } =
    usePolling<AnalyticsPayload>(`/api/analytics?days=${days}`, 60_000);

  const totals = data?.totals;
  const daily = data?.daily ?? [];
  const models = data?.models ?? [];
  const sources = data?.sources ?? [];
  const totalTokens = (totals?.in ?? 0) + (totals?.out ?? 0);

  const pickPeriod = (p: Period) => {
    if (p === days) return;
    haptic(6);
    setDays(p);
  };

  return (
    <PullToRefresh onRefresh={reload}>
      <div className="px-3 pb-6">
        {/* header */}
        <div className="flex items-center gap-2.5 pt-1">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-border text-midground">
            <ANALYTICS_ICON />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="font-mondwest text-display text-[0.92rem] tracking-[0.04em] text-midground">
              Analytics
            </h1>
            <p className="truncate font-mono-ui text-[0.66rem] text-text-tertiary">
              usage · last {days} days
            </p>
          </div>
          <button
            type="button"
            aria-label="Refresh"
            onClick={() => {
              haptic(6);
              reload();
            }}
            className="grid h-8 w-8 place-items-center rounded-full text-text-tertiary transition-colors hover:text-midground active:scale-90"
          >
            <span className={loading ? "animate-spin-slow" : ""}>
              <RefreshIcon width={15} height={15} />
            </span>
          </button>
        </div>

        {/* period selector */}
        <div className="mt-3 flex items-center gap-1 rounded-[var(--radius-md)] border border-border p-1">
          {PERIODS.map((p) => {
            const active = p === days;
            return (
              <button
                key={p}
                type="button"
                onClick={() => pickPeriod(p)}
                aria-pressed={active}
                className={cn(
                  "flex-1 rounded-[var(--radius-sm)] py-1.5 text-center font-mono-ui text-[0.7rem] tracking-[0.06em] transition-colors",
                  active
                    ? "text-midground"
                    : "text-text-tertiary hover:text-text-secondary",
                )}
                style={
                  active
                    ? {
                        background:
                          "color-mix(in srgb, var(--midground) 12%, transparent)",
                      }
                    : undefined
                }
              >
                {p}d
              </button>
            );
          })}
          <span className="ml-1 mr-1.5 shrink-0 font-mono-ui text-[0.56rem] text-text-tertiary">
            {updatedAt ? relativeTime(updatedAt) : ""}
          </span>
        </div>

        {/* error banner (soft, when we still have data) */}
        {error && data && (
          <p className="mt-2 px-1 font-mono-ui text-[0.64rem] leading-relaxed text-[var(--color-warning,#ffbd38)]">
            {error}
          </p>
        )}

        {/* body */}
        {loading && !data ? (
          <div className="mt-4">
            <PaneSkeleton rows={4} />
          </div>
        ) : error && !data ? (
          <StateCard
            icon={ANALYTICS_ICON}
            tone="danger"
            title="Analytics unavailable"
            blurb={error ?? "failed to load analytics"}
          />
        ) : !totals ? (
          <StateCard
            icon={ANALYTICS_ICON}
            title="No usage yet"
            blurb="No analytics recorded for this period. Run some sessions and check back."
          />
        ) : (
          <>
            {/* summary cards */}
            <motion.div
              variants={SECTION_V}
              initial="hidden"
              animate="show"
              className="mt-4 grid grid-cols-2 gap-2"
            >
              <SummaryCard label="total tokens" value={fmtNum(totalTokens)} />
              <SummaryCard label="total cost" value={fmtCost(totals.cost)} />
              <SummaryCard label="sessions" value={fmtNum(totals.sessions)} />
              <SummaryCard label="messages" value={fmtNum(totals.msgs)} />
              <SummaryCard label="cache read" value={fmtNum(totals.cacheR)} />
              <SummaryCard label="cache write" value={fmtNum(totals.cacheW)} />
            </motion.div>

            {/* token split caption */}
            <div className="mt-2 flex items-center gap-3 px-1 font-mono-ui text-[0.6rem] text-text-tertiary">
              <LegendDot color={IN_COLOR} />
              <span>
                in{" "}
                <span className="tabular text-text-secondary">
                  {fmtNum(totals.in)}
                </span>
              </span>
              <LegendDot color={OUT_COLOR} />
              <span>
                out{" "}
                <span className="tabular text-text-secondary">
                  {fmtNum(totals.out)}
                </span>
              </span>
            </div>

            {/* daily chart */}
            <motion.div variants={SECTION_V} initial="hidden" animate="show">
              <SectionLabel
                right={
                  <span className="font-mono-ui tabular text-[0.62rem] text-text-tertiary">
                    {daily.length} days
                  </span>
                }
              >
                Daily Tokens
              </SectionLabel>
              <DailyChart daily={daily} />
            </motion.div>

            {/* per-model breakdown */}
            <motion.div variants={SECTION_V} initial="hidden" animate="show">
              <SectionLabel
                right={
                  <span className="font-mono-ui tabular text-[0.62rem] text-text-tertiary">
                    {models.length} models
                  </span>
                }
              >
                By Model
              </SectionLabel>
              <ModelTable models={models} />
            </motion.div>

            {/* per-source breakdown */}
            <motion.div variants={SECTION_V} initial="hidden" animate="show">
              <SectionLabel
                right={
                  <span className="font-mono-ui tabular text-[0.62rem] text-text-tertiary">
                    {sources.length} sources
                  </span>
                }
              >
                By Source
              </SectionLabel>
              <SourceList sources={sources} />
            </motion.div>
          </>
        )}
      </div>
    </PullToRefresh>
  );
}

/* ========================================================================= */

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-border bg-card px-3 py-2.5">
      <span className="block font-mono-ui text-[0.54rem] uppercase tracking-[0.12em] text-text-tertiary">
        {label}
      </span>
      <span className="mt-1.5 block font-mono-ui tabular text-[1.05rem] leading-none text-midground">
        {value}
      </span>
    </div>
  );
}

function LegendDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-[2px]"
      style={{ background: color }}
      aria-hidden
    />
  );
}

/* ========================================================================= */

function DailyChart({ daily }: { daily: DailyPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const max = useMemo(
    () => Math.max(1, ...daily.map((d) => d.in + d.out)),
    [daily],
  );

  if (daily.length === 0) {
    return (
      <p className="px-3 py-8 text-center text-[0.74rem] text-text-tertiary">
        No daily data for this period.
      </p>
    );
  }

  const active = hover != null ? daily[hover] : null;

  return (
    <div className="rounded-[var(--radius-md)] border border-border bg-card px-3 pb-2.5 pt-3">
      {/* hover readout / default summary */}
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="font-mono-ui text-[0.62rem] text-text-secondary">
          {active ? dayLabel(active.date) : "tokens / day"}
        </span>
        <span className="font-mono-ui tabular text-[0.6rem] text-text-tertiary">
          {active ? (
            <>
              <span style={{ color: IN_COLOR }}>{fmtNum(active.in)}</span>
              {" + "}
              <span style={{ color: OUT_COLOR }}>{fmtNum(active.out)}</span>
              {" = "}
              <span className="text-midground">
                {fmtNum(active.in + active.out)}
              </span>
            </>
          ) : (
            `peak ${fmtNum(max)}`
          )}
        </span>
      </div>

      {/* bars */}
      <div
        className="flex h-[140px] items-end gap-[3px]"
        onMouseLeave={() => setHover(null)}
      >
        {daily.map((d, i) => {
          const total = d.in + d.out;
          const totalPct = Math.max(2, (total / max) * 100);
          const inPct = total > 0 ? (d.in / total) * 100 : 0;
          const outPct = total > 0 ? (d.out / total) * 100 : 100;
          const dim = hover != null && hover !== i;
          return (
            <button
              type="button"
              key={`${d.date}-${i}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onClick={() => {
                haptic(4);
                setHover(i);
              }}
              title={`${dayLabel(d.date)} — in ${fmtNum(d.in)} · out ${fmtNum(
                d.out,
              )} · ${fmtNum(total)} total`}
              aria-label={`${dayLabel(d.date)}: ${fmtNum(total)} tokens`}
              className="group flex h-full flex-1 cursor-pointer flex-col justify-end outline-none"
            >
              <span
                className="flex w-full flex-col overflow-hidden rounded-t-[2px] transition-opacity duration-150"
                style={{ height: `${totalPct}%`, opacity: dim ? 0.4 : 1 }}
              >
                {/* out on top */}
                <span
                  style={{ height: `${outPct}%`, background: OUT_COLOR }}
                />
                {/* in on bottom */}
                <span style={{ height: `${inPct}%`, background: IN_COLOR }} />
              </span>
            </button>
          );
        })}
      </div>

      {/* x-axis ends */}
      {daily.length > 1 && (
        <div className="mt-1.5 flex items-center justify-between font-mono-ui text-[0.54rem] text-text-tertiary">
          <span>{dayLabel(daily[0].date)}</span>
          <span>{dayLabel(daily[daily.length - 1].date)}</span>
        </div>
      )}
    </div>
  );
}

/* ========================================================================= */

function ModelTable({ models }: { models: ModelRow[] }) {
  if (models.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-[0.74rem] text-text-tertiary">
        No model usage for this period.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-border bg-card">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 font-mono-ui text-[0.52rem] uppercase tracking-[0.1em] text-text-tertiary">
        <span className="min-w-0 flex-1">model</span>
        <span className="w-9 shrink-0 text-right">ses</span>
        <span className="w-14 shrink-0 text-right">in</span>
        <span className="w-14 shrink-0 text-right">out</span>
        <span className="w-12 shrink-0 text-right">cost</span>
      </div>
      <ul>
        {models.map((m, i) => (
          <li
            key={`${m.model}-${i}`}
            className={cn(
              "flex items-center gap-2 px-3 py-2",
              i > 0 && "border-t border-border",
            )}
          >
            <span className="min-w-0 flex-1 truncate text-[0.76rem] text-midground">
              {m.model}
            </span>
            <span className="w-9 shrink-0 text-right font-mono-ui tabular text-[0.66rem] text-text-secondary">
              {fmtNum(m.sessions)}
            </span>
            <span
              className="w-14 shrink-0 text-right font-mono-ui tabular text-[0.66rem]"
              style={{ color: IN_COLOR }}
            >
              {fmtNum(m.in)}
            </span>
            <span
              className="w-14 shrink-0 text-right font-mono-ui tabular text-[0.66rem]"
              style={{ color: OUT_COLOR }}
            >
              {fmtNum(m.out)}
            </span>
            <span className="w-12 shrink-0 text-right font-mono-ui tabular text-[0.66rem] text-midground">
              {fmtCost(m.cost)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ========================================================================= */

function SourceList({ sources }: { sources: SourceRow[] }) {
  if (sources.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-[0.74rem] text-text-tertiary">
        No source data for this period.
      </p>
    );
  }

  const maxSessions = Math.max(1, ...sources.map((s) => s.sessions));

  return (
    <div className="flex flex-col gap-1.5">
      {sources.map((s, i) => {
        const pct = Math.max(3, (s.sessions / maxSessions) * 100);
        return (
          <div
            key={`${s.source}-${i}`}
            className="relative flex items-center justify-between gap-3 overflow-hidden rounded-[var(--radius-md)] border border-border bg-card px-3 py-2"
          >
            <span
              className="absolute inset-y-0 left-0 rounded-[var(--radius-md)]"
              style={{
                width: `${pct}%`,
                background:
                  "color-mix(in srgb, var(--midground) 7%, transparent)",
              }}
              aria-hidden
            />
            <span className="relative z-10 min-w-0 truncate text-[0.78rem] text-midground">
              {s.source}
            </span>
            <span className="relative z-10 shrink-0 font-mono-ui tabular text-[0.68rem] text-text-secondary">
              {fmtNum(s.sessions)}
              <span className="ml-1 text-text-tertiary">
                {s.sessions === 1 ? "session" : "sessions"}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
