"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePolling } from "@/components/usePolling";
import { relativeTime } from "@/lib/format";
import { haptic } from "@/components/shell/haptics";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/components/useMediaQuery";
import type { SkillsPayload, SkillEntry } from "@/lib/chat-types";
import { SearchIcon, RefreshIcon } from "@/components/panes/pane-icons";
import { ChevronRightIcon } from "@/components/shell/icons";
import { Switch } from "@/components/ui";
import {
  SectionLabel,
  PaneSkeleton,
  StateCard,
  PullToRefresh,
} from "./parts";
import type { SVGProps } from "react";

/* ========================================================================= */

type P = SVGProps<SVGSVGElement>;

const SKILL_ICON = (p: P) => (
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
    <path d="M12 3c.5 0 1 .3 1.2.8l1.2 3.2 3.2 1.2c.5.2.8.7.8 1.2s-.3 1-.8 1.2l-3.2 1.2-1.2 3.2c-.2.5-.7.8-1.2.8s-1-.3-1.2-.8L9.6 12 6.4 10.8C5.9 10.6 5.6 10.1 5.6 9.6s.3-1 .8-1.2L9.6 7.2 10.8 4c.2-.5.7-.8 1.2-.8Z" />
  </svg>
);

/* ========================================================================= */

function matchesQuery(skill: SkillEntry, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    skill.name.toLowerCase().includes(q) ||
    skill.description.toLowerCase().includes(q) ||
    skill.category.toLowerCase().includes(q)
  );
}

/* ========================================================================= */

function SkillToggle({ skill }: { skill: SkillEntry }) {
  const [enabled, setEnabled] = useState(skill.enabled);
  const [busy, setBusy] = useState(false);

  const handleToggle = async () => {
    if (busy) return;
    haptic(6);
    const next = !enabled;
    setEnabled(next); // optimistic
    setBusy(true);
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: skill.name, enabled: next }),
      });
      if (!res.ok) setEnabled(!next); // revert on failure
    } catch {
      setEnabled(!next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Switch
      checked={enabled}
      onCheckedChange={handleToggle}
      disabled={busy}
      aria-label={enabled ? "Disable skill" : "Enable skill"}
      className={cn(busy && "opacity-60")}
    />
  );
}

/* ========================================================================= */

const SOURCE_LABEL: Record<string, string> = {
  builtin: "core",
  local: "local",
  hub: "hub",
};

const SOURCE_COLOR: Record<string, string> = {
  builtin: "text-[var(--color-success,#4ade80)]",
  local: "text-[var(--color-warning,#ffbd38)]",
  hub: "text-[var(--color-info,#7dd3fc)]",
};

/* ========================================================================= */

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

function SkillRow({ skill }: { skill: SkillEntry }) {
  return (
    <motion.li variants={ROW_V}>
      <div
        className="flex items-center gap-3 rounded-[var(--radius-md)] border border-border px-3 py-2.5"
        style={{
          background: "color-mix(in srgb, var(--midground) 3%, transparent)",
        }}
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-sm)] text-midground">
          <span className="text-[var(--color-accent,#a78bfa)]">
            <SKILL_ICON />
          </span>
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[0.84rem] font-medium text-midground">
              {skill.name}
            </span>
            {!skill.enabled && (
              <span className="rounded-full border border-border px-1.5 py-[1px] font-mono-ui text-[0.5rem] uppercase tracking-[0.1em] text-text-tertiary">
                disabled
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[0.68rem] leading-snug text-text-secondary">
            {skill.description}
          </p>
        </div>

        <span
          className={cn(
            "shrink-0 font-mono-ui text-[0.56rem] uppercase tracking-[0.08em]",
            SOURCE_COLOR[skill.source] ?? "text-text-tertiary",
          )}
        >
          {SOURCE_LABEL[skill.source] ?? skill.source}
        </span>

        <SkillToggle skill={skill} />
      </div>
    </motion.li>
  );
}

/* ========================================================================= */

function SkillGroupSection({
  category,
  skills,
  open,
  onToggle,
}: {
  category: string;
  skills: SkillEntry[];
  open: boolean;
  onToggle: () => void;
}) {
  const enabledCount = skills.filter((s) => s.enabled).length;

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          haptic(6);
          onToggle();
        }}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-2 text-left transition-colors active:bg-[color-mix(in_srgb,var(--midground)_5%,transparent)]"
      >
        <ChevronRightIcon
          width={12}
          height={12}
          className={cn(
            "shrink-0 text-text-tertiary transition-transform duration-200",
            open && "rotate-90",
          )}
        />
        <span className="font-mondwest text-display text-[0.72rem] tracking-[0.12em] text-text-secondary">
          {category}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <span className="font-mono-ui tabular text-[0.6rem] text-text-tertiary">
            {enabledCount}/{skills.length}
          </span>
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
            <motion.ul
              className="space-y-1.5 px-2 pb-2 pt-1"
              initial="hidden"
              animate="show"
              variants={{ show: { transition: { staggerChildren: 0.025 } } }}
            >
              {skills.map((skill) => (
                <SkillRow key={skill.name} skill={skill} />
              ))}
            </motion.ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ========================================================================= */

export function SkillsPane() {
  const { data, error, loading, updatedAt, reload } =
    usePolling<SkillsPayload>("/api/skills", 30_000);

  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  const groups = useMemo(() => data?.groups ?? [], [data]);
  const total = data?.total ?? 0;
  const cliCount = data?.cliCount ?? 0;

  const filteredGroups = useMemo(() => {
    if (!search) return groups;
    return groups
      .map((g) => ({
        ...g,
        skills: g.skills.filter((s) => matchesQuery(s, search)),
      }))
      .filter((g) => g.skills.length > 0);
  }, [groups, search]);

  const enabledCount = useMemo(
    () => groups.reduce((acc, g) => acc + g.skills.filter((s) => s.enabled).length, 0),
    [groups],
  );

  const toggleGroup = (category: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  // First-load expand: all groups on desktop, just the first group on mobile
  // (a wall of expanded skills hurts hierarchy on a phone — audit P2 #15).
  useEffect(() => {
    if (groups.length === 0) return;
    setExpanded((prev) =>
      prev.size === 0
        ? new Set(
            isDesktop ? groups.map((g) => g.category) : [groups[0].category],
          )
        : prev,
    );
  }, [groups, isDesktop]);

  return (
    <PullToRefresh onRefresh={reload}>
      <div className="px-3 pb-6">
        {/* header */}
        <div className="flex items-center gap-2.5 pt-1">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-border text-midground">
            <SKILL_ICON />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="font-mondwest text-display text-[0.92rem] tracking-[0.04em] text-midground">
              Skills
            </h1>
            <p className="truncate font-mono-ui text-[0.66rem] text-text-tertiary">
              hermes skills · read-only
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

        {/* summary */}
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
          <Metric label="enabled" value={enabledCount} />
          <span className="h-7 w-px bg-border" />
          <Metric label="total" value={total} />
          <span className="ml-auto font-mono-ui text-[0.58rem] text-text-tertiary">
            {updatedAt ? relativeTime(updatedAt) : ""}
          </span>
        </div>

        {/* error banner */}
        {error && data && (
          <p className="mt-2 px-1 font-mono-ui text-[0.64rem] leading-relaxed text-[var(--color-warning,#ffbd38)]">
            {error}
          </p>
        )}

        {/* search */}
        <div className="mt-3 flex items-center gap-2 rounded-[var(--radius-md)] border border-border px-3 py-2">
          <span className="shrink-0 text-text-tertiary">
            <SearchIcon width={14} height={14} />
          </span>
          <input
            type="text"
            placeholder="Search skills..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent text-[0.82rem] text-midground outline-none placeholder:text-text-disabled"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="grid h-9 w-9 place-items-center rounded-full text-text-tertiary transition-colors hover:text-midground"
            >
              <svg
                width={12}
                height={12}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* body */}
        {loading && !data ? (
          <div className="mt-4">
            <PaneSkeleton rows={3} />
          </div>
        ) : error && !data ? (
          <StateCard
            icon={SKILL_ICON}
            tone="danger"
            title="Skills unavailable"
            blurb={error ?? "failed to load skills"}
          />
        ) : groups.length === 0 ? (
          <StateCard
            icon={SKILL_ICON}
            title="No skills installed"
            blurb="hermes skills list returned empty. Install skills with hermes skills install or add them from the Hermes Hub."
          />
        ) : (
          <div className="mt-4">
            <SectionLabel
              right={
                <span className="font-mono-ui tabular text-[0.62rem] text-text-tertiary">
                  {search
                    ? `${filteredGroups.reduce((a, g) => a + g.skills.length, 0)} matches`
                    : `${total} skills`}
                </span>
              }
            >
              {search ? "Filtered Skills" : "Skill Groups"}
            </SectionLabel>

            {filteredGroups.length === 0 ? (
              <p className="px-3 py-6 text-center text-[0.74rem] text-text-tertiary">
                No skills match &ldquo;{search}&rdquo;
              </p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {filteredGroups.map((group) => (
                  <SkillGroupSection
                    key={group.category}
                    category={group.category}
                    skills={group.skills}
                    open={expanded.has(group.category)}
                    onToggle={() => toggleGroup(group.category)}
                  />
                ))}
              </div>
            )}

            <p className="mt-4 px-1 font-mono-ui text-[0.6rem] leading-relaxed text-text-tertiary">
              Read-only view. Source:{" "}
              <span className="text-text-secondary">hermes skills list</span>.
              {cliCount > 0 && (
                <>
                  {" "}
                  CLI reports{" "}
                  <span className="font-mono-ui tabular text-text-secondary">
                    {cliCount}
                  </span>{" "}
                  skill
                  {cliCount === 1 ? "" : "s"} registered.
                </>
              )}
            </p>
          </div>
        )}
      </div>
    </PullToRefresh>
  );
}

/* ========================================================================= */

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
