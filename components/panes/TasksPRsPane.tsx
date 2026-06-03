"use client";

import { useEffect, useMemo, useState, type SVGProps } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePolling } from "@/components/usePolling";
import { useWorkspace } from "@/components/shell/workspace-context";
import { Sheet } from "@/components/shell/Sheet";
import { haptic } from "@/components/shell/haptics";
import { BranchIcon } from "@/components/shell/icons";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  PrsPayload,
  PrItem,
  RepoPRs,
  IssueItem,
  PrDetail,
  CiState,
  ReviewState,
} from "@/lib/prs";
import type { ApiEnvelope } from "@/lib/types";
import {
  Dot,
  Badge,
  DiffStat,
  SectionLabel,
  RefreshButton,
  PaneSkeleton,
  StateCard,
  PullToRefresh,
  IssueIcon,
  ExternalIcon,
  ClockIcon,
  type Tone,
} from "./parts";

/* ---- small inline marks not in the shared icon set --------------------- */
const GitHubMark = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" aria-hidden {...p}>
    <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49l-.01-1.9c-2.78.62-3.37-1.21-3.37-1.21-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.94.86.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05a9.3 9.3 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.91l-.01 2.83c0 .27.18.6.69.49A10.26 10.26 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z" />
  </svg>
);

/* ---- ci / review presentation ------------------------------------------ */
function ciTone(ci: CiState): Tone {
  return ci === "pass" ? "pass" : ci === "fail" ? "fail" : ci === "pending" ? "pending" : "none";
}
const CI_LABEL: Record<CiState, string> = {
  pass: "checks passing",
  fail: "checks failing",
  pending: "checks running",
  none: "no checks",
};
function ReviewBadge({ review }: { review: ReviewState }) {
  if (review === "approved") return <Badge tone="ok">approved</Badge>;
  if (review === "changes_requested") return <Badge tone="danger">changes</Badge>;
  if (review === "review_required") return <Badge tone="warn">review</Badge>;
  return null;
}

/* ===========================================================================
   Pane
   =========================================================================== */
export function TasksPRsPane() {
  const { active } = useWorkspace();
  const canScope = !!active?.path;
  const [scope, setScope] = useState<"all" | "active">("all");
  const effectiveScope = canScope ? scope : "all";

  const url =
    effectiveScope === "active" && active?.path
      ? `/api/prs?path=${encodeURIComponent(active.path)}`
      : "/api/prs";

  const { data, error, loading, updatedAt, reload } = usePolling<PrsPayload>(url, 30_000);
  const [openPr, setOpenPr] = useState<{ fullName: string; number: number } | null>(null);

  const repos = data?.repos ?? [];
  const issues = data?.issues ?? [];
  const hasPrs = repos.some((r) => r.prs.length > 0);

  return (
    <>
      <PullToRefresh onRefresh={reload}>
        <div className="px-3 pb-4">
          <Header
            login={data?.login ?? null}
            loading={loading}
            onReload={reload}
            canScope={canScope}
            scope={effectiveScope}
            onScope={setScope}
            activeRepo={active?.repo}
          />

          <Summary
            data={data}
            updatedAt={updatedAt}
          />

          {loading && !data ? (
            <div className="mt-3">
              <PaneSkeleton rows={4} />
            </div>
          ) : error ? (
            <StateCard
              icon={IssueIcon}
              tone="danger"
              title="Could not reach GitHub"
              blurb={error}
            />
          ) : (
            <>
              {/* Pull requests */}
              <div className="mt-4">
                <SectionLabel right={<CountChip n={data?.totalPrs ?? 0} />}>
                  Open Pull Requests
                </SectionLabel>
                {hasPrs ? (
                  <div className="space-y-4">
                    {repos
                      .filter((r) => r.prs.length > 0)
                      .map((group) => (
                        <RepoGroup
                          key={group.fullName}
                          group={group}
                          highlight={group.repo === active?.repo}
                          onOpen={(n) => {
                            haptic(8);
                            setOpenPr({ fullName: group.fullName, number: n });
                          }}
                        />
                      ))}
                  </div>
                ) : (
                  <StateCard
                    icon={GitHubMark}
                    title="No open pull requests"
                    blurb={
                      effectiveScope === "active"
                        ? "This repo has no open PRs right now."
                        : `Scanned ${data?.scannedCount ?? 0} of your repos. Nothing open to review.`
                    }
                  />
                )}
              </div>

              {/* Assigned issues */}
              <div className="mt-5">
                <SectionLabel right={<CountChip n={issues.length} />}>
                  Assigned to You
                </SectionLabel>
                {issues.length > 0 ? (
                  <ul className="space-y-2">
                    {issues.map((i) => (
                      <IssueRow key={`${i.repo}#${i.number}`} issue={i} />
                    ))}
                  </ul>
                ) : (
                  <p className="px-1 pb-2 text-[0.78rem] text-text-tertiary">
                    No open issues assigned to you.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </PullToRefresh>

      <PrDetailSheet
        target={openPr}
        onClose={() => setOpenPr(null)}
      />
    </>
  );
}

/* ---- header ------------------------------------------------------------- */
function Header({
  login,
  loading,
  onReload,
  canScope,
  scope,
  onScope,
  activeRepo,
}: {
  login: string | null;
  loading: boolean;
  onReload: () => void;
  canScope: boolean;
  scope: "all" | "active";
  onScope: (s: "all" | "active") => void;
  activeRepo?: string;
}) {
  return (
    <div className="pt-1">
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-xl border border-border text-midground">
          <GitHubMark />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-mondwest text-display text-[0.92rem] tracking-[0.04em] text-midground">
            Tasks &amp; PRs
          </h1>
          <p className="truncate font-mono-ui text-[0.66rem] text-text-tertiary">
            {login ? `@${login}` : "github"}
          </p>
        </div>
        <RefreshButton loading={loading} onClick={onReload} />
      </div>

      {canScope && (
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl border border-border p-1">
          <ScopeTab active={scope === "active"} onClick={() => onScope("active")}>
            {activeRepo ?? "This repo"}
          </ScopeTab>
          <ScopeTab active={scope === "all"} onClick={() => onScope("all")}>
            All repos
          </ScopeTab>
        </div>
      )}
    </div>
  );
}

function ScopeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic(6);
        onClick();
      }}
      className={cn(
        "relative truncate rounded-lg px-2 py-1.5 text-center text-[0.72rem] transition-colors active:scale-[0.98]",
        active ? "text-background-base" : "text-text-tertiary",
      )}
    >
      {active && (
        <motion.span
          layoutId="prs-scope"
          className="absolute inset-0 rounded-lg bg-midground"
          transition={{ type: "spring", stiffness: 420, damping: 36 }}
        />
      )}
      <span className="relative font-mono-ui">{children}</span>
    </button>
  );
}

/* ---- summary strip ------------------------------------------------------ */
function Summary({
  data,
  updatedAt,
}: {
  data: PrsPayload | null;
  updatedAt: string | null;
}) {
  return (
    <div className="mt-3 flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
      <Metric label="open prs" value={data?.totalPrs ?? 0} />
      <Divider />
      <Metric label="repos" value={data?.repos.filter((r) => r.prs.length).length ?? 0} />
      <Divider />
      <Metric label="issues" value={data?.issues.length ?? 0} />
      <span className="ml-auto font-mono-ui text-[0.58rem] text-text-tertiary">
        {updatedAt ? relativeTime(updatedAt) : ""}
      </span>
    </div>
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
function Divider() {
  return <span className="h-7 w-px bg-border" />;
}
function CountChip({ n }: { n: number }) {
  return (
    <span className="font-mono-ui tabular text-[0.62rem] text-text-tertiary">{n}</span>
  );
}

/* ---- repo group + pr rows ----------------------------------------------- */
const LIST_V = {
  show: { transition: { staggerChildren: 0.035 } },
};
const ROW_V = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
  },
};

function RepoGroup({
  group,
  highlight,
  onOpen,
}: {
  group: RepoPRs;
  highlight: boolean;
  onOpen: (n: number) => void;
}) {
  return (
    <div className="relative">
      <div className="mb-1.5 flex items-center gap-2 px-1">
        <span className="text-text-tertiary">
          <BranchIcon width={14} height={14} />
        </span>
        <span className="truncate font-mono-ui text-[0.78rem] text-midground">
          {group.fullName}
        </span>
        <Badge tone="accent">{group.prs.length}</Badge>
        {highlight && <Badge tone="ok">active</Badge>}
      </div>
      <motion.ul
        className={cn(
          "relative space-y-2 rounded-2xl",
          highlight && "p-1",
        )}
        variants={LIST_V}
        initial="hidden"
        animate="show"
      >
        {highlight && <span className="arc-border" aria-hidden />}
        {group.prs.map((pr) => (
          <PrRow key={pr.number} pr={pr} onOpen={() => onOpen(pr.number)} />
        ))}
      </motion.ul>
    </div>
  );
}

function PrRow({ pr, onOpen }: { pr: PrItem; onOpen: () => void }) {
  return (
    <motion.li variants={ROW_V}>
      <button
        type="button"
        onClick={onOpen}
        className="group w-full rounded-xl border border-border px-3 py-2.5 text-left transition-colors active:scale-[0.99] hover:border-[color-mix(in_srgb,var(--midground)_28%,transparent)]"
        style={{ background: "color-mix(in srgb, var(--midground) 3%, transparent)" }}
      >
        <div className="flex items-start gap-3">
          <span className="mt-1.5">
            <Dot tone={ciTone(pr.ci)} title={CI_LABEL[pr.ci]} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-mono-ui text-[0.66rem] text-text-tertiary">
                #{pr.number}
              </span>
              {pr.isDraft && <Badge>draft</Badge>}
              <ReviewBadge review={pr.review} />
            </div>
            <p className="mt-0.5 line-clamp-2 text-[0.86rem] leading-snug text-midground">
              {pr.title}
            </p>
            <div className="mt-1 flex items-center gap-1.5 font-mono-ui text-[0.62rem] text-text-tertiary">
              <span className="truncate">{pr.headRef}</span>
              <span className="opacity-60">&rarr;</span>
              <span className="truncate opacity-80">{pr.baseRef}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <DiffStat adds={pr.additions} dels={pr.deletions} />
            <span className="font-mono-ui text-[0.58rem] text-text-tertiary">
              {relativeTime(pr.updatedAt)}
            </span>
          </div>
        </div>
      </button>
    </motion.li>
  );
}

function IssueRow({ issue }: { issue: IssueItem }) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <a
        href={issue.url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5 transition-colors active:scale-[0.99]"
      >
        <span className="text-[var(--color-warning,#ffbd38)]">
          <IssueIcon width={16} height={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.84rem] text-midground">{issue.title}</p>
          <p className="truncate font-mono-ui text-[0.62rem] text-text-tertiary">
            {issue.repo} #{issue.number}
          </p>
        </div>
        <ExternalIcon width={14} height={14} />
      </a>
    </motion.li>
  );
}

/* ===========================================================================
   PR detail sheet, gh pr view, read-only review surface.
   =========================================================================== */
function usePrDetail(target: { fullName: string; number: number } | null) {
  const [detail, setDetail] = useState<PrDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!target) {
      setDetail(null);
      setError(null);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    setDetail(null);
    const u = `/api/prs/detail?repo=${encodeURIComponent(target.fullName)}&number=${target.number}`;
    fetch(u, { cache: "no-store" })
      .then((r) => r.json() as Promise<ApiEnvelope<PrDetail>>)
      .then((j) => {
        if (!live) return;
        setDetail(j.data);
        setError(j.error ?? null);
      })
      .catch(() => live && setError("request failed"))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [target?.fullName, target?.number]);

  return { detail, error, loading };
}

function PrDetailSheet({
  target,
  onClose,
}: {
  target: { fullName: string; number: number } | null;
  onClose: () => void;
}) {
  const { detail, error, loading } = usePrDetail(target);

  return (
    <Sheet
      open={!!target}
      onClose={onClose}
      title={target ? `${target.fullName} #${target.number}` : undefined}
    >
      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-3 px-2 py-3"
          >
            <PaneSkeleton rows={3} />
          </motion.div>
        ) : error || !detail ? (
          <motion.p
            key="err"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="px-3 py-8 text-center text-[0.82rem] text-text-tertiary"
          >
            {error ?? "Could not load this pull request."}
          </motion.p>
        ) : (
          <DetailBody key="body" detail={detail} />
        )}
      </AnimatePresence>
    </Sheet>
  );
}

function DetailBody({ detail }: { detail: PrDetail }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="px-2 pb-2"
    >
      <div className="flex items-start gap-2.5 px-1">
        <span className="mt-1">
          <Dot tone={ciTone(detail.ci)} title={CI_LABEL[detail.ci]} />
        </span>
        <h2 className="flex-1 text-[1rem] font-medium leading-snug text-midground">
          {detail.title}
        </h2>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 px-1">
        <Badge tone={detail.state === "OPEN" ? "ok" : "muted"}>{detail.state}</Badge>
        {detail.isDraft && <Badge>draft</Badge>}
        <ReviewBadge review={detail.review} />
        <Badge tone={detail.ci === "fail" ? "danger" : detail.ci === "pass" ? "ok" : "muted"}>
          {CI_LABEL[detail.ci]}
        </Badge>
      </div>

      {/* stat grid */}
      <div className="mt-3 grid grid-cols-2 gap-2 px-1">
        <StatCell label="diff">
          <DiffStat adds={detail.additions} dels={detail.deletions} />
        </StatCell>
        <StatCell label="files">{detail.changedFiles}</StatCell>
        <StatCell label="commits">{detail.commits}</StatCell>
        <StatCell label="branch">
          <span className="truncate font-mono-ui text-[0.66rem]">
            {detail.headRef} &rarr; {detail.baseRef}
          </span>
        </StatCell>
      </div>

      {/* checks */}
      {detail.checks.length > 0 && (
        <div className="mt-3 px-1">
          <SectionLabel>Checks</SectionLabel>
          <ul className="space-y-1">
            {detail.checks.map((c, i) => (
              <li key={i} className="flex items-center gap-2 py-0.5">
                <Dot tone={ciTone(c.state)} />
                <span className="truncate font-mono-ui text-[0.7rem] text-text-secondary">
                  {c.name}
                </span>
                <span className="ml-auto font-mono-ui text-[0.6rem] text-text-tertiary">
                  {c.state}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* meta */}
      <div className="mt-3 flex items-center gap-2 px-1 font-mono-ui text-[0.62rem] text-text-tertiary">
        <ClockIcon width={12} height={12} />
        <span>
          {detail.author ? `@${detail.author} · ` : ""}opened {relativeTime(detail.createdAt)} · updated{" "}
          {relativeTime(detail.updatedAt)}
        </span>
      </div>

      {/* body */}
      {detail.body.trim() && (
        <div className="mt-3 px-1">
          <SectionLabel>Description</SectionLabel>
          <pre className="max-h-[34dvh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-border bg-[color-mix(in_srgb,var(--midground)_3%,transparent)] p-3 font-mono-ui text-[0.72rem] leading-relaxed text-text-secondary">
            {detail.body.trim()}
          </pre>
        </div>
      )}

      <a
        href={detail.url}
        target="_blank"
        rel="noreferrer"
        onClick={() => haptic(8)}
        className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-border py-3 text-[0.8rem] text-midground transition-colors active:scale-[0.99]"
        style={{ background: "color-mix(in srgb, var(--midground) 5%, transparent)" }}
      >
        <ExternalIcon width={15} height={15} />
        Open on GitHub
      </a>
    </motion.div>
  );
}

function StatCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border px-3 py-2">
      <span className="font-mono-ui text-[0.55rem] uppercase tracking-[0.12em] text-text-tertiary">
        {label}
      </span>
      <span className="truncate text-[0.86rem] text-midground">{children}</span>
    </div>
  );
}
