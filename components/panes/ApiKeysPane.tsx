"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePolling } from "@/components/usePolling";
import { useMediaQuery } from "@/components/useMediaQuery";
import { relativeTime } from "@/lib/format";
import { haptic } from "@/components/shell/haptics";
import { cn } from "@/lib/utils";
import { SearchIcon, RefreshIcon, SaveIcon, TrashIcon } from "@/components/panes/pane-icons";
import { ChevronRightIcon } from "@/components/shell/icons";
import { SectionLabel, PaneSkeleton, StateCard, PullToRefresh } from "./parts";
import type { SVGProps } from "react";

/* ========================================================================= */

type EnvKeyItem = {
  key: string;
  label: string;
  group: string;
  set: boolean;
  preview: string;
  secret?: boolean;
};

type EnvKeysPayload = {
  items: EnvKeyItem[];
  envPath: string;
};

type EnvKeyGroup = {
  group: string;
  items: EnvKeyItem[];
};

/* ========================================================================= */

type P = SVGProps<SVGSVGElement>;

const KEY_ICON = (p: P) => (
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
    <circle cx="8" cy="15" r="4" />
    <path d="M10.8 12.2 21 2M17 6l3 3M14 9l2.5 2.5" />
  </svg>
);

const EyeIcon = (p: P) => (
  <svg
    width={15}
    height={15}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...p}
  >
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon = (p: P) => (
  <svg
    width={15}
    height={15}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...p}
  >
    <path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.3 4.2M6.3 6.3A17.5 17.5 0 0 0 2 12s3.5 7 10 7a10.8 10.8 0 0 0 4.2-.8" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
  </svg>
);

const ShieldIcon = (p: P) => (
  <svg
    width={13}
    height={13}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...p}
  >
    <path d="M12 3 5 6v5c0 4.4 3 8 7 9 4-1 7-4.6 7-9V6Z" />
    <path d="M9.5 12.2 11.3 14l3.4-3.6" />
  </svg>
);

/* ========================================================================= */

// Stable ordering for groups; unknown groups fall to the end alphabetically.
const GROUP_ORDER = [
  "LLM Providers",
  "Image Generation",
  "Video Generation",
  "Audio & Voice",
  "Web & Search",
  "Integrations",
  "Messaging",
  "Other",
];

function groupRank(group: string): number {
  const i = GROUP_ORDER.indexOf(group);
  return i === -1 ? GROUP_ORDER.length : i;
}

/** Bool media-query hook — shared SSR-safe impl, used to default-collapse
 *  groups on small screens. */


function matchesQuery(item: EnvKeyItem, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    item.label.toLowerCase().includes(q) ||
    item.key.toLowerCase().includes(q) ||
    item.group.toLowerCase().includes(q)
  );
}

function buildGroups(items: EnvKeyItem[]): EnvKeyGroup[] {
  const map = new Map<string, EnvKeyItem[]>();
  for (const item of items) {
    const g = item.group || "Other";
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(item);
  }
  return Array.from(map.entries())
    .map(([group, groupItems]) => ({
      group,
      items: groupItems
        .slice()
        .sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => {
      const r = groupRank(a.group) - groupRank(b.group);
      return r !== 0 ? r : a.group.localeCompare(b.group);
    });
}

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

function ApiKeyRow({
  item,
  onChanged,
}: {
  item: EnvKeyItem;
  onChanged: () => void;
}) {
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const busy = saving || deleting;
  const dirty = value.trim().length > 0;

  const handleSave = async () => {
    if (busy || !dirty) return;
    haptic(8);
    setErr(null);
    setSaving(true);
    try {
      const res = await fetch("/api/env-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: item.key, value }),
      });
      if (!res.ok) {
        setErr("save failed");
        return;
      }
      setValue("");
      setReveal(false);
      onChanged();
    } catch {
      setErr("save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (busy) return;
    haptic(12);
    setErr(null);
    setDeleting(true);
    try {
      const res = await fetch("/api/env-keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: item.key }),
      });
      if (!res.ok) {
        setErr("delete failed");
        return;
      }
      onChanged();
    } catch {
      setErr("delete failed");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <motion.li variants={ROW_V}>
      <div
        className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-border px-3 py-2.5"
        style={{
          background: "color-mix(in srgb, var(--midground) 3%, transparent)",
        }}
      >
        {/* identity + current state */}
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[0.84rem] font-medium text-midground">
                {item.label}
              </span>
              {item.set ? (
                <span className="rounded-full border border-[color-mix(in_srgb,var(--color-success,#4ade80)_40%,transparent)] px-1.5 py-[1px] font-mono-ui text-[0.5rem] uppercase tracking-[0.1em] text-[var(--color-success,#4ade80)]">
                  set
                </span>
              ) : (
                <span className="rounded-full border border-border px-1.5 py-[1px] font-mono-ui text-[0.5rem] uppercase tracking-[0.1em] text-text-tertiary">
                  unset
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate font-mono-ui text-[0.66rem] leading-snug">
              {item.set ? (
                <span className="text-text-secondary">{item.preview}</span>
              ) : (
                <span className="text-text-disabled">not set</span>
              )}
            </p>
          </div>
          <span className="shrink-0 font-mono-ui text-[0.52rem] uppercase tracking-[0.08em] text-text-tertiary">
            {item.key}
          </span>
        </div>

        {/* editor row */}
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-card px-2.5 py-1.5">
            <input
              type={reveal ? "text" : "password"}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={item.set ? "Enter new value to update…" : "Enter value…"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
              className="w-full bg-transparent font-mono-ui text-[0.74rem] text-midground outline-none placeholder:text-text-disabled"
            />
            <button
              type="button"
              aria-label={reveal ? "Hide value" : "Reveal value"}
              onClick={() => {
                haptic(4);
                setReveal((r) => !r);
              }}
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-text-tertiary transition-colors hover:text-midground"
            >
              {reveal ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>

          <button
            type="button"
            aria-label="Save key"
            onClick={handleSave}
            disabled={!dirty || busy}
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-border text-text-tertiary transition-colors",
              dirty && !busy
                ? "text-midground hover:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)] active:scale-90"
                : "opacity-50",
            )}
          >
            <span className={saving ? "animate-spin-slow" : ""}>
              {saving ? <RefreshIcon width={15} height={15} /> : <SaveIcon width={15} height={15} />}
            </span>
          </button>

          {item.set && (
            <button
              type="button"
              aria-label="Delete key"
              onClick={handleDelete}
              disabled={busy}
              className={cn(
                "grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-border text-text-tertiary transition-colors",
                !busy
                  ? "hover:border-[color-mix(in_srgb,var(--color-destructive,#fb2c36)_40%,transparent)] hover:text-[var(--color-destructive,#fb2c36)] active:scale-90"
                  : "opacity-50",
              )}
            >
              <span className={deleting ? "animate-spin-slow" : ""}>
                {deleting ? <RefreshIcon width={15} height={15} /> : <TrashIcon width={15} height={15} />}
              </span>
            </button>
          )}
        </div>

        {err && (
          <p className="font-mono-ui text-[0.6rem] text-[var(--color-destructive,#fb2c36)]">
            {err}
          </p>
        )}
      </div>
    </motion.li>
  );
}

/* ========================================================================= */

function ApiKeyGroupSection({
  group,
  items,
  open,
  onToggle,
  onChanged,
}: {
  group: string;
  items: EnvKeyItem[];
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const setCount = items.filter((i) => i.set).length;

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
          {group}
        </span>
        <span className="ml-auto font-mono-ui tabular text-[0.6rem] text-text-tertiary">
          {setCount}/{items.length}
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
              {items.map((item) => (
                <ApiKeyRow key={item.key} item={item} onChanged={onChanged} />
              ))}
            </motion.ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ========================================================================= */

export function ApiKeysPane() {
  const { data, error, loading, updatedAt, reload } = usePolling<EnvKeysPayload>(
    "/api/env-keys",
    30_000,
  );

  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const items = useMemo(() => data?.items ?? [], [data]);
  const envPath = data?.envPath ?? "~/.hermes/.env";

  const groups = useMemo(() => buildGroups(items), [items]);

  const filteredGroups = useMemo(() => {
    if (!search) return groups;
    return groups
      .map((g) => ({ ...g, items: g.items.filter((i) => matchesQuery(i, search)) }))
      .filter((g) => g.items.length > 0);
  }, [groups, search]);

  const setCount = useMemo(() => items.filter((i) => i.set).length, [items]);
  const matchCount = useMemo(
    () => filteredGroups.reduce((a, g) => a + g.items.length, 0),
    [filteredGroups],
  );

  const toggleGroup = (group: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // First-load expand. Desktop: open everything (room to scroll). Mobile: with
  // 8 groups, expand-all is a wall — open only LLM Providers + any group that
  // already has a key set; the rest stay collapsed and one tap away.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current || groups.length === 0) return;
    didInit.current = true;
    if (isDesktop) {
      setExpanded(new Set(groups.map((g) => g.group)));
    } else {
      const open = new Set<string>(["LLM Providers"]);
      for (const g of groups) {
        if (g.items.some((i) => i.set)) open.add(g.group);
      }
      setExpanded(open);
    }
  }, [groups, isDesktop]);

  return (
    <PullToRefresh onRefresh={reload}>
      <div className="px-3 pb-6">
        {/* header */}
        <div className="flex items-center gap-2.5 pt-1">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-border text-midground">
            <KEY_ICON />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="font-mondwest text-display text-[0.92rem] tracking-[0.04em] text-midground">
              API Keys
            </h1>
            <p className="truncate font-mono-ui text-[0.66rem] text-text-tertiary">
              {envPath}
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

        {/* security note */}
        <div
          className="mt-3 flex items-start gap-2 rounded-xl border border-[color-mix(in_srgb,var(--color-warning,#ffbd38)_35%,transparent)] px-3 py-2.5"
          style={{
            background: "color-mix(in srgb, var(--color-warning, #ffbd38) 8%, transparent)",
          }}
        >
          <span className="mt-0.5 shrink-0 text-[var(--color-warning,#ffbd38)]">
            <ShieldIcon />
          </span>
          <p className="text-[0.7rem] leading-relaxed text-text-secondary">
            These are <span className="text-midground">real secrets</span> stored
            in plaintext on this machine at{" "}
            <span className="font-mono-ui text-text-secondary">{envPath}</span>.
            Anyone with access to this device can read them — handle with care.
          </p>
        </div>

        {/* summary */}
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
          <Metric label="set" value={setCount} />
          <span className="h-7 w-px bg-border" />
          <Metric label="total" value={items.length} />
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
            placeholder="Search keys..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent text-[0.82rem] text-midground outline-none placeholder:text-text-disabled"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="grid h-5 w-5 place-items-center rounded-full text-text-tertiary transition-colors hover:text-midground"
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
            <PaneSkeleton rows={4} />
          </div>
        ) : error && !data ? (
          <StateCard
            icon={KEY_ICON}
            tone="danger"
            title="API keys unavailable"
            blurb={error ?? "failed to load env keys"}
          />
        ) : items.length === 0 ? (
          <StateCard
            icon={KEY_ICON}
            title="No keys configured"
            blurb="No known API keys were found. Once defined, they will appear here grouped by provider."
          />
        ) : (
          <div className="mt-4">
            <SectionLabel
              right={
                <span className="font-mono-ui tabular text-[0.62rem] text-text-tertiary">
                  {search ? `${matchCount} matches` : `${items.length} keys`}
                </span>
              }
            >
              {search ? "Filtered Keys" : "Key Groups"}
            </SectionLabel>

            {filteredGroups.length === 0 ? (
              <p className="px-3 py-6 text-center text-[0.74rem] text-text-tertiary">
                No keys match &ldquo;{search}&rdquo;
              </p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {filteredGroups.map((g) => (
                  <ApiKeyGroupSection
                    key={g.group}
                    group={g.group}
                    items={g.items}
                    open={expanded.has(g.group)}
                    onToggle={() => toggleGroup(g.group)}
                    onChanged={reload}
                  />
                ))}
              </div>
            )}

            <p className="mt-4 px-1 font-mono-ui text-[0.6rem] leading-relaxed text-text-tertiary">
              Saving writes to{" "}
              <span className="text-text-secondary">{envPath}</span>. Values are
              never sent back to the browser once stored — only a redacted preview
              is shown.
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
