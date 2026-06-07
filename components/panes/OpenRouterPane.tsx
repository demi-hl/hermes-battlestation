"use client";

import { useEffect, useMemo, useState, type SVGProps } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePolling } from "@/components/usePolling";
import { relativeTime } from "@/lib/format";
import { haptic } from "@/components/shell/haptics";
import { cn } from "@/lib/utils";
import {
  SectionLabel,
  PaneSkeleton,
  StateCard,
  PullToRefresh,
  Badge,
  RefreshButton,
} from "./parts";
import { SearchIcon } from "@/components/panes/pane-icons";
import { Button } from "@/components/ui";

/* ========================================================================= */

type Mode = "cheapest" | "free" | "premium";

interface PickedModel {
  id: string;
  name: string;
  ctx: number;
  perM: number;
  priceIn: number;
  priceOut: number;
  free: boolean;
  router: boolean;
  reasoning: boolean;
  tools: boolean;
  inputs: string[];
  outputs: string[];
}

interface Stage {
  stage: string;
  label: string;
  blurb: string;
  picks: Record<Mode, PickedModel | null>;
}

interface Campaign {
  name: string;
  vendor: string;
  blurb: string;
  models: string[];
}

interface FreeModel extends PickedModel {
  created: number;
}

interface CatalogModel {
  id: string;
  ctx: number;
  perM: number;
  free: boolean;
  reasoning: boolean;
  tools: boolean;
  inputs: string[];
  outputs: string[];
}

interface SavedPipeline {
  mode: Mode;
  stages: Partial<Record<string, string>>;
  savedAt: string;
}

interface OpenRouterPayload {
  source: "live" | "cache" | "offline";
  counts: { total: number; free: number; reasoning: number; imageOut: number; vision: number };
  health: { reachable: boolean; latencyMs: number | null; status: string };
  pipeline: Stage[];
  modes: Record<Mode, { resolved: number; perMTotal: number; note: string }>;
  campaigns: Campaign[];
  freeModels: FreeModel[];
  catalog: CatalogModel[];
  saved: SavedPipeline | null;
}

/** Per-day usage rollup from /api/analytics (subset we need). */
interface AnalyticsPayload {
  totals: { cost: number; sessions: number; in: number; out: number };
  models: { model: string; cost: number; sessions: number }[];
}

/* ========================================================================= */

type P = SVGProps<SVGSVGElement>;
const sx = (p: P) => ({
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...p,
});

const RouterIcon = (p: P) => (
  <svg {...sx(p)}>
    <rect x="3" y="14" width="18" height="7" rx="2" />
    <path d="M7 14V8a5 5 0 0 1 10 0v6M7 17.5h.01M11 17.5h.01" />
  </svg>
);
const BrainIcon = (p: P) => (
  <svg {...sx(p)}>
    <path d="M9 3a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8A3 3 0 0 0 7 17a3 3 0 0 0 5 1 3 3 0 0 0 5-1 3 3 0 0 0 2-5.2A3 3 0 0 0 18 6a3 3 0 0 0-3-3 3 3 0 0 0-3 1.5A3 3 0 0 0 9 3Z" />
    <path d="M12 5.5v13" />
  </svg>
);
const PenIcon = (p: P) => (
  <svg {...sx(p)}>
    <path d="M12 19l7-7 3 3-7 7-3-3ZM18 13l-1.5-1.5M2 22l1.2-4.4L14 6.8l3 3L6.4 20.8 2 22Z" />
  </svg>
);
const ImageIcon = (p: P) => (
  <svg {...sx(p)}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.6" />
    <path d="m21 15-5-5L5 21" />
  </svg>
);
const EyeScanIcon = (p: P) => (
  <svg {...sx(p)}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const SparkIcon = (p: P) => (
  <svg {...sx(p)}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
  </svg>
);

const STAGE_ICON: Record<string, (p: P) => React.ReactNode> = {
  reasoning: BrainIcon,
  image_prompt: PenIcon,
  image_gen: ImageIcon,
  vision: EyeScanIcon,
};

/* ========================================================================= */

const MODES: { id: Mode; label: string; blurb: string }[] = [
  { id: "cheapest", label: "Cheapest", blurb: "lowest paid" },
  { id: "free", label: "Free", blurb: "$0 only" },
  { id: "premium", label: "Premium", blurb: "flagship" },
];

function fmtCtx(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function fmtPrice(p: PickedModel): string {
  if (p.free) return "FREE";
  if (p.perM < 0.01) return "<$0.01/M";
  if (p.perM < 1) return `$${p.perM.toFixed(2)}/M`;
  return `$${p.perM.toFixed(p.perM < 100 ? 1 : 0)}/M`;
}

/* ========================================================================= */

function StageCard({
  stage,
  mode,
  last,
}: {
  stage: Stage;
  mode: Mode;
  last: boolean;
}) {
  const pick = stage.picks[mode];
  const Icon = STAGE_ICON[stage.stage] ?? SparkIcon;

  return (
    <div className="relative pl-9">
      {/* rail + node */}
      <span
        className="absolute left-3 top-1 grid h-6 w-6 -translate-x-1/2 place-items-center rounded-full border text-midground"
        style={{
          background: "color-mix(in srgb, var(--midground) 8%, var(--color-background))",
          borderColor: "color-mix(in srgb, var(--midground) 28%, transparent)",
        }}
      >
        <Icon width={13} height={13} />
      </span>
      {!last && (
        <span
          className="absolute left-3 top-7 bottom-[-14px] w-px -translate-x-1/2"
          style={{ background: "color-mix(in srgb, var(--midground) 18%, transparent)" }}
          aria-hidden
        />
      )}

      <div
        className="rounded-[var(--radius-md)] border border-border px-3 py-2.5"
        style={{ background: "color-mix(in srgb, var(--midground) 3%, transparent)" }}
      >
        <div className="flex items-center gap-2">
          <span className="font-mondwest text-display text-[0.74rem] tracking-[0.06em] text-midground">
            {stage.label}
          </span>
          {pick?.reasoning && <Badge tone="accent">reason</Badge>}
          {pick && pick.outputs.includes("image") && <Badge tone="accent">img-out</Badge>}
        </div>
        <p className="mt-0.5 text-[0.68rem] leading-snug text-text-tertiary">{stage.blurb}</p>

        <AnimatePresence mode="wait" initial={false}>
          {pick ? (
            <motion.div
              key={`${mode}-${pick.id}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="mt-2 flex items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-card px-2.5 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate font-mono-ui text-[0.72rem] text-midground">
                {pick.id}
              </span>
              <span className="shrink-0 font-mono-ui text-[0.58rem] text-text-tertiary">
                {fmtCtx(pick.ctx)}
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-full border px-1.5 py-[1px] font-mono-ui text-[0.55rem] uppercase tracking-[0.06em]",
                  pick.free
                    ? "border-[color-mix(in_srgb,var(--color-success,#4ade80)_40%,transparent)] text-[var(--color-success,#4ade80)]"
                    : "border-border text-text-secondary",
                )}
              >
                {fmtPrice(pick)}
              </span>
            </motion.div>
          ) : (
            <motion.div
              key={`${mode}-none`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="mt-2 rounded-[var(--radius-sm)] border border-dashed border-border px-2.5 py-1.5 font-mono-ui text-[0.66rem] text-text-disabled"
            >
              no {mode === "free" ? "free" : ""} model qualifies for this stage
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ========================================================================= */

export function OpenRouterPane() {
  const { data, error, loading, updatedAt, reload } = usePolling<OpenRouterPayload>(
    "/api/openrouter",
    5 * 60_000,
  );
  const { data: analytics } = usePolling<AnalyticsPayload>("/api/analytics?days=30", 60_000);

  const [mode, setMode] = useState<Mode>("cheapest");
  const [search, setSearch] = useState("");
  const [applying, setApplying] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const counts = data?.counts;
  const pipeline = data?.pipeline ?? [];
  const modeInfo = data?.modes?.[mode];
  const campaigns = data?.campaigns ?? [];
  const freeModels = data?.freeModels ?? [];
  const catalog = data?.catalog ?? [];
  const health = data?.health;
  const saved = data?.saved;

  // sync mode to the saved pipeline once it loads
  useEffect(() => {
    if (saved?.mode) setMode(saved.mode);
    if (saved?.savedAt) setSavedAt(saved.savedAt);
  }, [saved?.savedAt, saved?.mode]);

  const modeCost = useMemo(() => {
    if (!modeInfo) return null;
    if (mode === "free") return "$0 · rate-limited";
    return `~$${modeInfo.perMTotal.toFixed(modeInfo.perMTotal < 10 ? 2 : 0)}/M blended`;
  }, [modeInfo, mode]);

  // OpenRouter spend = sum of analytics cost for models whose id contains "/"
  // (the OpenRouter slug shape provider/model). The agent's own runs show up as
  // bare "claude-*" model names and are excluded — this is OR metered spend only.
  const orSpend = useMemo(() => {
    if (!analytics?.models) return null;
    const or = analytics.models.filter((m) => m.model.includes("/"));
    const cost = or.reduce((a, m) => a + (m.cost || 0), 0);
    const sessions = or.reduce((a, m) => a + (m.sessions || 0), 0);
    return { cost, sessions, models: or.length };
  }, [analytics]);

  // estimate per-run pipeline cost: blended $/M * an assumed 8K-token run/stage.
  const RUN_TOKENS = 8000;
  const runEstimate = useMemo(() => {
    if (!modeInfo) return null;
    return (modeInfo.perMTotal * RUN_TOKENS) / 1_000_000;
  }, [modeInfo]);

  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return catalog.filter((m) => m.id.toLowerCase().includes(q)).slice(0, 40);
  }, [catalog, search]);

  const applyPipeline = async () => {
    if (applying || !modeInfo) return;
    haptic(12);
    setApplying(true);
    try {
      const stages: Record<string, string> = {};
      for (const st of pipeline) {
        const pick = st.picks[mode];
        if (pick) stages[st.stage] = pick.id;
      }
      const res = await fetch("/api/openrouter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply", mode, stages }),
      });
      if (res.ok) {
        const j = await res.json();
        setSavedAt(j.saved?.savedAt ?? new Date().toISOString());
        haptic(20);
      }
    } catch {
      /* ignore */
    } finally {
      setApplying(false);
    }
  };

  const clearPipeline = async () => {
    if (applying) return;
    haptic(8);
    setApplying(true);
    try {
      await fetch("/api/openrouter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      setSavedAt(null);
    } catch {
      /* ignore */
    } finally {
      setApplying(false);
    }
  };

  return (
    <PullToRefresh onRefresh={reload}>
      <div className="px-3 pb-6">
        {/* header */}
        <div className="flex items-center gap-2.5 pt-1">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-border text-midground">
            <RouterIcon />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="font-mondwest text-display text-[0.92rem] tracking-[0.04em] text-midground">
              OpenRouter
            </h1>
            <p className="truncate font-mono-ui text-[0.66rem] text-text-tertiary">
              {counts
                ? `${counts.total} models · ${counts.free} free`
                : "live model catalog"}
            </p>
          </div>
          {data?.source && (
            <Badge tone={data.source === "live" ? "ok" : data.source === "cache" ? "warn" : "danger"}>
              {data.source}
            </Badge>
          )}
          <RefreshButton loading={loading} onClick={() => { haptic(6); reload(); }} />
        </div>

        {error && data && (
          <p className="mt-2 px-1 font-mono-ui text-[0.64rem] text-[var(--color-warning,#ffbd38)]">
            {error}
          </p>
        )}

        {/* health / latency strip */}
        {health && (
          <div className="mt-3 flex items-center gap-2 rounded-[var(--radius-md)] border border-border px-3 py-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                background: health.reachable
                  ? "var(--color-success,#4ade80)"
                  : health.status === "cached"
                  ? "var(--color-warning,#ffbd38)"
                  : "var(--color-destructive,#fb2c36)",
                boxShadow: health.reachable ? "0 0 7px var(--color-success,#4ade80)" : "none",
              }}
            />
            <span className="font-mondwest text-display text-[0.66rem] uppercase tracking-[0.1em] text-midground">
              {health.status}
            </span>
            <span className="ml-auto font-mono-ui text-[0.62rem] text-text-tertiary">
              {health.latencyMs != null ? `${health.latencyMs}ms` : "no live round-trip"}
            </span>
            {orSpend != null && (
              <>
                <span className="h-3 w-px bg-border" />
                <span
                  className="font-mono-ui text-[0.62rem]"
                  style={{ color: orSpend.cost > 0 ? "var(--color-warning,#ffbd38)" : "var(--text-tertiary)" }}
                  title="OpenRouter metered spend, last 30d (excludes Max-OAuth runs)"
                >
                  ${orSpend.cost.toFixed(2)} 30d
                </span>
              </>
            )}
          </div>
        )}

        {/* body states */}
        {loading && !data ? (
          <div className="mt-4"><PaneSkeleton rows={5} /></div>
        ) : error && !data ? (
          <StateCard icon={RouterIcon} tone="danger" title="OpenRouter unavailable" blurb={error} />
        ) : data?.source === "offline" ? (
          <StateCard
            icon={RouterIcon}
            tone="danger"
            title="No catalog"
            blurb="Couldn't reach OpenRouter and no cache exists yet. Check the connection and refresh."
          />
        ) : (
          <>
            {/* mode selector */}
            <div className="mt-4">
              <SectionLabel right={modeCost ? (
                <span className="font-mono-ui text-[0.6rem] text-text-tertiary">{modeCost}</span>
              ) : null}>
                Cost Mode
              </SectionLabel>
              <div className="flex gap-1.5 rounded-[var(--radius-md)] border border-border p-1">
                {MODES.map((m) => {
                  const active = m.id === mode;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => { haptic(6); setMode(m.id); }}
                      className={cn(
                        "relative flex flex-1 flex-col items-center rounded-[var(--radius-sm)] px-2 py-1.5 transition-colors",
                        active ? "text-[var(--color-background)]" : "text-text-secondary hover:text-midground",
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId="or-mode-pill"
                          className="absolute inset-0 rounded-[var(--radius-sm)] bg-midground"
                          transition={{ type: "spring", stiffness: 480, damping: 38 }}
                        />
                      )}
                      <span className="relative font-mondwest text-display text-[0.7rem] tracking-[0.04em]">
                        {m.label}
                      </span>
                      <span className="relative font-mono-ui text-[0.52rem] uppercase tracking-[0.08em] opacity-70">
                        {m.blurb}
                      </span>
                    </button>
                  );
                })}
              </div>
              {modeInfo && (
                <p className="mt-1.5 px-1 text-[0.66rem] leading-snug text-text-tertiary">
                  {modeInfo.note}
                </p>
              )}
            </div>

            {/* pipeline */}
            <div className="mt-4">
              <SectionLabel right={
                <span className="font-mono-ui text-[0.6rem] text-text-tertiary">
                  {modeInfo ? `${modeInfo.resolved}/${pipeline.length} stages` : ""}
                </span>
              }>
                Generation Pipeline
              </SectionLabel>
              <div className="flex flex-col gap-3.5 pt-1">
                {pipeline.map((st, i) => (
                  <StageCard key={st.stage} stage={st} mode={mode} last={i === pipeline.length - 1} />
                ))}
              </div>

              {/* apply / clear — writes battlestation-pipeline.json only,
                  NEVER Hermes' model config (no metered-billing repoint). */}
              <div className="mt-3 flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={applyPipeline}
                  disabled={applying}
                  prefix={<SparkIcon width={14} height={14} />}
                  className="flex-1 justify-center"
                >
                  {savedAt ? "Update pipeline" : "Apply pipeline"}
                </Button>
                {savedAt && (
                  <Button
                    ghost
                    size="sm"
                    type="button"
                    onClick={clearPipeline}
                    disabled={applying}
                  >
                    Clear
                  </Button>
                )}
              </div>
              <div className="mt-1.5 flex items-center justify-between px-1">
                <span className="font-mono-ui text-[0.58rem] leading-snug text-text-tertiary">
                  {runEstimate != null && mode !== "free"
                    ? `≈ $${runEstimate.toFixed(4)} / run (4×8K tok)`
                    : mode === "free"
                    ? "free run — rate-limited"
                    : ""}
                </span>
                <span className="font-mono-ui text-[0.56rem] text-text-tertiary">
                  {savedAt ? `saved ${relativeTime(savedAt)}` : "not applied"}
                </span>
              </div>
              <p className="mt-1 px-1 font-mono-ui text-[0.55rem] leading-relaxed text-text-disabled">
                Saved as a preference (battlestation-pipeline.json). Does not change which model Hermes&apos; own agent runs.
              </p>
            </div>

            {/* model search across the full catalog */}
            <div className="mt-5">
              <SectionLabel right={
                <span className="font-mono-ui text-[0.6rem] text-text-tertiary">
                  {counts ? `${catalog.length} indexed` : ""}
                </span>
              }>
                Search All Models
              </SectionLabel>
              <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border px-3 py-2">
                <SearchIcon width={14} height={14} className="shrink-0 text-text-tertiary" />
                <input
                  type="text"
                  placeholder="grok, qwen, gemini, free…"
                  value={search}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-transparent font-mono-ui text-[0.74rem] text-midground outline-none placeholder:text-text-disabled"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="shrink-0 font-mono-ui text-[0.6rem] text-text-tertiary hover:text-midground"
                  >
                    clear
                  </button>
                )}
              </div>
              {search && (
                <ul className="mt-2 flex flex-col gap-1">
                  {filteredCatalog.length === 0 ? (
                    <li className="px-2 py-3 text-center font-mono-ui text-[0.66rem] text-text-tertiary">
                      no model matches &ldquo;{search}&rdquo;
                    </li>
                  ) : (
                    filteredCatalog.map((m) => (
                      <li
                        key={m.id}
                        className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-border px-2.5 py-1.5"
                        style={{ background: "color-mix(in srgb, var(--midground) 2.5%, transparent)" }}
                      >
                        <span className="min-w-0 flex-1 truncate font-mono-ui text-[0.7rem] text-midground">
                          {m.id}
                        </span>
                        {m.reasoning && <Badge tone="accent">R</Badge>}
                        {m.outputs.includes("image") && <Badge tone="accent">img</Badge>}
                        <span className="shrink-0 font-mono-ui text-[0.56rem] text-text-tertiary">
                          {fmtCtx(m.ctx)}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 font-mono-ui text-[0.56rem]",
                            m.free ? "text-[var(--color-success,#4ade80)]" : "text-text-secondary",
                          )}
                        >
                          {m.free ? "FREE" : m.perM < 0.01 ? "<$.01" : `$${m.perM.toFixed(m.perM < 100 ? 1 : 0)}`}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>

            {/* campaigns */}
            {campaigns.length > 0 && (
              <div className="mt-5">
                <SectionLabel>Active Free Campaigns</SectionLabel>
                <div className="flex flex-col gap-2">
                  {campaigns.map((c) => (
                    <div
                      key={c.name}
                      className="rounded-[var(--radius-md)] border px-3 py-2.5"
                      style={{
                        borderColor: "color-mix(in srgb, var(--color-success,#4ade80) 35%, transparent)",
                        background: "color-mix(in srgb, var(--color-success,#4ade80) 7%, transparent)",
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <SparkIcon width={14} height={14} className="text-[var(--color-success,#4ade80)]" />
                        <span className="font-mondwest text-display text-[0.76rem] tracking-[0.04em] text-midground">
                          {c.name}
                        </span>
                        <Badge tone="ok" className="ml-auto">{c.models.length}</Badge>
                      </div>
                      <p className="mt-1 text-[0.68rem] leading-snug text-text-secondary">{c.blurb}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {c.models.slice(0, 6).map((id) => (
                          <span
                            key={id}
                            className="truncate rounded-full border border-border bg-card px-1.5 py-[1px] font-mono-ui text-[0.56rem] text-text-tertiary"
                          >
                            {id.replace(/:free$/, "").split("/").pop()}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* newest free models */}
            <div className="mt-5">
              <SectionLabel right={
                <span className="font-mono-ui text-[0.6rem] text-text-tertiary">
                  {freeModels.length} shown
                </span>
              }>
                Newest Free Models
              </SectionLabel>
              <ul className="flex flex-col gap-1.5">
                {freeModels.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-border px-2.5 py-1.5"
                    style={{ background: "color-mix(in srgb, var(--midground) 2.5%, transparent)" }}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono-ui text-[0.7rem] text-midground">
                      {m.id.replace(/:free$/, "")}
                    </span>
                    {m.reasoning && <Badge tone="accent">R</Badge>}
                    {m.tools && <Badge tone="muted">T</Badge>}
                    {m.inputs.some((x) => x !== "text") && <Badge tone="muted">multi</Badge>}
                    <span className="shrink-0 font-mono-ui text-[0.56rem] text-text-tertiary">
                      {fmtCtx(m.ctx)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="mt-4 px-1 font-mono-ui text-[0.6rem] leading-relaxed text-text-tertiary">
              Live from openrouter.ai/api/v1/models{updatedAt ? ` · ${relativeTime(updatedAt)}` : ""}.
              Free models are rate-limited and prompts may be used for training — never send private data.
            </p>
          </>
        )}
      </div>
    </PullToRefresh>
  );
}
