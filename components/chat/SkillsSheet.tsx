"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet } from "@/components/shell/Sheet";
import { CheckIcon } from "@/components/shell/icons";
import { SearchIcon, SparkIcon } from "./icons";
import { haptic } from "@/components/shell/haptics";
import { cn } from "@/lib/utils";
import type { SkillsPayload, SkillEntry } from "@/lib/chat-types";

// Module-level cache so reopening the sheet does not refetch the 100+ skill set.
let cache: SkillsPayload | null = null;

export function SkillsSheet({
  open,
  onClose,
  loaded,
  onToggle,
  onLoadBundle,
}: {
  open: boolean;
  onClose: () => void;
  loaded: string[];
  onToggle: (name: string) => void;
  onLoadBundle: (skills: string[]) => void;
}) {
  const [data, setData] = useState<SkillsPayload | null>(cache);
  const [loading, setLoading] = useState(!cache);
  const [q, setQ] = useState("");
  const fetched = useRef(false);

  useEffect(() => {
    if (!open || fetched.current || cache) return;
    fetched.current = true;
    setLoading(true);
    fetch("/api/skills", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: SkillsPayload) => {
        cache = d;
        setData(d);
      })
      .catch(() => setData({ groups: [], bundles: [], total: 0, cliCount: 0, fetchedAt: "" }))
      .finally(() => setLoading(false));
  }, [open]);

  const loadedSet = useMemo(() => new Set(loaded), [loaded]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.groups
      .map((g) => ({
        category: g.category,
        skills: needle
          ? g.skills.filter(
              (s) =>
                s.name.toLowerCase().includes(needle) ||
                s.description.toLowerCase().includes(needle),
            )
          : g.skills,
      }))
      .filter((g) => g.skills.length > 0);
  }, [data, q]);

  return (
    <Sheet open={open} onClose={onClose} title="Skills" className="max-h-[88dvh]">
      <div className="mb-2 flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)] px-2.5 py-1.5">
        <SearchIcon width={15} height={15} className="text-text-tertiary" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search skills"
          className="flex-1 bg-transparent text-[0.85rem] text-text-primary outline-none placeholder:text-text-tertiary"
        />
      </div>

      {loading && <SkillsSkeleton />}

      {!loading && data && (
        <>
          {data.bundles.length > 0 && q.trim() === "" && (
            <div className="mb-2">
              <p className="px-2 pb-1 pt-1 text-display font-mondwest text-[0.6rem] tracking-[0.18em] text-text-tertiary">
                Bundles
              </p>
              <div className="flex flex-wrap gap-1.5 px-1">
                {data.bundles.map((b) => (
                  <button
                    key={b.name}
                    type="button"
                    onClick={() => {
                      haptic(10);
                      onLoadBundle(b.skills);
                    }}
                    className="rounded-full border border-border px-2.5 py-1 text-[0.72rem] text-midground active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]"
                  >
                    {b.name} · {b.skills.length}
                  </button>
                ))}
              </div>
            </div>
          )}

          {filtered.map((g) => (
            <div key={g.category} className="mb-1">
              <p className="sticky top-0 z-[1] bg-[color-mix(in_srgb,var(--background-base)_82%,transparent)] px-2 py-1 text-display font-mondwest text-[0.6rem] tracking-[0.18em] text-text-tertiary backdrop-blur">
                {g.category}
              </p>
              <ul className="flex flex-col">
                {g.skills.map((s) => (
                  <SkillRow
                    key={s.name}
                    skill={s}
                    loaded={loadedSet.has(s.name)}
                    onToggle={() => {
                      haptic(8);
                      onToggle(s.name);
                    }}
                  />
                ))}
              </ul>
            </div>
          ))}

          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-[0.8rem] text-text-tertiary">
              No skills match.
            </p>
          )}

          <p className="px-3 pb-1 pt-2 text-[0.66rem] leading-relaxed text-text-tertiary">
            {data.total} skills from the on-disk registry · cross-checked with{" "}
            <span className="font-mono-ui">hermes skills list</span>
            {data.cliCount ? ` (${data.cliCount} rows)` : ""}. Loading a skill preloads it into this
            thread on your next message.
          </p>
        </>
      )}
    </Sheet>
  );
}

function SkillRow({
  skill,
  loaded,
  onToggle,
}: {
  skill: SkillEntry;
  loaded: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex w-full items-start gap-3 rounded-[var(--radius-md)] px-2.5 py-2 text-left transition-colors",
          loaded
            ? "bg-[color-mix(in_srgb,var(--midground)_9%,transparent)]"
            : "active:bg-[color-mix(in_srgb,var(--midground)_5%,transparent)]",
        )}
      >
        <span
          className={cn(
            "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-[var(--radius-sm)] border transition-colors",
            loaded ? "border-transparent bg-midground text-background-base" : "border-border text-text-tertiary",
          )}
        >
          {loaded ? <CheckIcon width={13} height={13} /> : <SparkIcon width={12} height={12} />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-mono-ui text-[0.8rem] text-text-primary">{skill.name}</span>
            {!skill.enabled && (
              <span className="rounded-full border border-border px-1 text-[0.55rem] uppercase tracking-wide text-text-tertiary">
                off
              </span>
            )}
          </span>
          {skill.description && (
            <span className="line-clamp-2 text-[0.72rem] leading-snug text-text-tertiary">
              {skill.description}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

function SkillsSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-1 py-2">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-6 w-6 shrink-0 rounded-[var(--radius-sm)] bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 w-1/3 rounded-full bg-[color-mix(in_srgb,var(--midground)_10%,transparent)]" />
            <div className="h-2 w-2/3 rounded-full bg-[color-mix(in_srgb,var(--midground)_6%,transparent)]" />
          </div>
        </div>
      ))}
    </div>
  );
}
