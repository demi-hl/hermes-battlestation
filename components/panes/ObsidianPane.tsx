"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { haptic } from "@/components/shell/haptics";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RefreshIcon } from "@/components/panes/pane-icons";

interface VaultAuthor {
  name: string;
  commits: number;
  lastIso: string | null;
}
interface VaultCommit {
  sha: string;
  author: string;
  subject: string;
  iso: string;
}
interface VaultStatus {
  configured: boolean;
  isRepo: boolean;
  branch: string | null;
  remote: string | null;
  ahead: number;
  behind: number;
  dirty: number;
  authors: VaultAuthor[];
  recent: VaultCommit[];
  error?: string;
}
interface SyncStep {
  ok: boolean;
  step: "pull" | "commit" | "push";
  message: string;
}

/**
 * Obsidian pane: the shared knowledge vault is a git repo every fleet agent
 * commits notes into and pushes to a common remote. This surface shows the
 * vault's sync state (ahead/behind/dirty), the agents writing to it (commit
 * authors), recent note commits, and a one-tap Sync (pull -> commit -> push).
 */
export function ObsidianPane() {
  const [data, setData] = useState<VaultStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncSteps, setSyncSteps] = useState<SyncStep[] | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/vault", { cache: "no-store" });
      const body = (await res.json()) as VaultStatus;
      setData(body);
      setError(body.error ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncSteps(null);
    haptic(12);
    try {
      const res = await fetch("/api/vault/sync", { method: "POST" });
      const body = await res.json();
      if (body.steps) setSyncSteps(body.steps as SyncStep[]);
      haptic(body.ok ? 20 : 30);
      await load();
    } catch (e) {
      setSyncSteps([{ ok: false, step: "pull", message: (e as Error).message }]);
      haptic(30);
    } finally {
      setSyncing(false);
    }
  }, [syncing, load]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col gap-4 px-3 pb-6 pt-1"
    >
      <Header
        branch={data?.branch ?? null}
        remote={data?.remote ?? null}
        onRefresh={load}
        refreshing={refreshing}
      />

      {error && !data?.isRepo ? (
        <div className="rounded-[var(--radius-lg)] border border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)] px-4 py-6 text-center">
          <p className="text-[0.82rem] text-text-secondary">{error}</p>
          <p className="mt-2 text-[0.7rem] leading-relaxed text-text-tertiary">
            Point the app at a git-backed Obsidian vault by setting
            OBSIDIAN_VAULT_PATH, then init it as a repo with a shared remote so
            every agent can pull and push notes.
          </p>
        </div>
      ) : (
        <>
          <SyncCard
            data={data}
            syncing={syncing}
            onSync={sync}
            steps={syncSteps}
          />
          <AgentsCard authors={data?.authors ?? []} loading={!data} />
          <RecentCard commits={data?.recent ?? []} loading={!data} />
          {error && (
            <p className="px-1 text-[0.66rem] text-text-tertiary">
              Some data may be stale: {error}
            </p>
          )}
        </>
      )}
    </motion.div>
  );
}

function Header({
  branch,
  remote,
  onRefresh,
  refreshing,
}: {
  branch: string | null;
  remote: string | null;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const host = remote
    ? remote.replace(/^https?:\/\//, "").replace(/\.git$/, "")
    : null;
  return (
    <div className="flex items-center gap-3 pt-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-mondwest text-display text-[1rem] leading-tight tracking-wide text-midground">
          Vault
        </span>
        <span className="truncate font-mono-ui text-[0.62rem] text-text-tertiary">
          {host ? host : "shared knowledge base"}
          {branch ? ` · ${branch}` : ""}
        </span>
      </div>
      <button
        type="button"
        aria-label="Refresh vault status"
        onClick={() => {
          haptic(6);
          onRefresh();
        }}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-text-tertiary transition-colors active:scale-90 active:text-midground"
      >
        <RefreshIcon
          width={15}
          height={15}
          className={refreshing ? "animate-spin-slow" : ""}
        />
      </button>
    </div>
  );
}

function SyncCard({
  data,
  syncing,
  onSync,
  steps,
}: {
  data: VaultStatus | null;
  syncing: boolean;
  onSync: () => void;
  steps: SyncStep[] | null;
}) {
  const ahead = data?.ahead ?? 0;
  const behind = data?.behind ?? 0;
  const dirty = data?.dirty ?? 0;
  const clean = ahead === 0 && behind === 0 && dirty === 0;
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)] p-3">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="uncommitted" value={dirty} tone={dirty ? "warn" : "ok"} />
        <Stat label="to push" value={ahead} tone={ahead ? "info" : "ok"} />
        <Stat label="to pull" value={behind} tone={behind ? "info" : "ok"} />
      </div>
      <button
        type="button"
        disabled={syncing}
        onClick={onSync}
        className={cn(
          "mt-3 flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] px-4 py-2.5 text-[0.84rem] font-medium transition-colors",
          syncing
            ? "cursor-wait bg-[color-mix(in_srgb,var(--midground)_12%,transparent)] text-text-disabled"
            : "bg-midground text-[var(--color-background)] active:scale-[0.98]",
        )}
      >
        {syncing
          ? "Syncing…"
          : clean
            ? "Sync (pull · push)"
            : "Sync now (pull · commit · push)"}
      </button>
      {steps && (
        <ul className="mt-2.5 space-y-1">
          {steps.map((s, i) => (
            <li
              key={i}
              className="flex items-center gap-2 font-mono-ui text-[0.66rem]"
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  background: s.ok
                    ? "var(--color-success)"
                    : "var(--color-destructive)",
                }}
              />
              <span className="text-text-tertiary">{s.step}</span>
              <span className="truncate text-text-secondary">{s.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "info";
}) {
  const color =
    tone === "warn"
      ? "var(--color-warning, #f5b54a)"
      : tone === "info"
        ? "var(--color-info, #7dd3fc)"
        : "var(--midground)";
  return (
    <div className="flex flex-col items-center rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--midground)_4%,transparent)] py-2">
      <span
        className="font-mono-ui tabular text-[1.05rem] font-semibold leading-none"
        style={{ color: value ? color : "var(--text-disabled)" }}
      >
        {value}
      </span>
      <span className="mt-1 font-mono-ui text-[0.54rem] uppercase tracking-[0.12em] text-text-tertiary">
        {label}
      </span>
    </div>
  );
}

function AgentsCard({
  authors,
  loading,
}: {
  authors: VaultAuthor[];
  loading: boolean;
}) {
  return (
    <section>
      <SectionLabel>Agents writing to the vault</SectionLabel>
      <div className="rounded-[var(--radius-lg)] border border-border">
        {loading ? (
          <Skeleton rows={3} />
        ) : authors.length === 0 ? (
          <p className="px-3 py-4 text-[0.72rem] text-text-tertiary">
            No commits yet.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {authors.map((a) => (
              <li
                key={a.name}
                className="flex items-center gap-2.5 px-3 py-2.5"
              >
                <span
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full font-mono-ui text-[0.58rem] font-bold"
                  style={{
                    color: tintFor(a.name),
                    background: `color-mix(in srgb, ${tintFor(a.name)} 16%, transparent)`,
                  }}
                >
                  {a.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-[0.8rem] text-midground">
                  {a.name}
                </span>
                {a.lastIso && (
                  <span className="shrink-0 font-mono-ui text-[0.6rem] text-text-tertiary">
                    {relativeTime(a.lastIso)}
                  </span>
                )}
                <span className="shrink-0 font-mono-ui tabular text-[0.66rem] text-text-secondary">
                  {a.commits}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function RecentCard({
  commits,
  loading,
}: {
  commits: VaultCommit[];
  loading: boolean;
}) {
  return (
    <section>
      <SectionLabel>Recent notes</SectionLabel>
      <div className="rounded-[var(--radius-lg)] border border-border">
        {loading ? (
          <Skeleton rows={4} />
        ) : commits.length === 0 ? (
          <p className="px-3 py-4 text-[0.72rem] text-text-tertiary">
            No recent commits.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {commits.map((c) => (
              <li key={c.sha} className="px-3 py-2">
                <p className="truncate text-[0.78rem] text-midground">
                  {c.subject}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 font-mono-ui text-[0.6rem] text-text-tertiary">
                  <span className="text-text-secondary">{c.sha}</span>
                  <span>·</span>
                  <span className="truncate">{c.author}</span>
                  <span>·</span>
                  <span className="shrink-0">{relativeTime(c.iso)}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block px-1 font-mono-ui text-[0.6rem] uppercase tracking-[0.16em] text-text-tertiary">
      {children}
    </span>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-1 p-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-7 animate-pulse rounded bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]"
        />
      ))}
    </div>
  );
}

const TINTS = [
  "#ffbd38",
  "#34d399",
  "#7dd3fc",
  "#f9a8d4",
  "#c4b5fd",
  "#fca5a5",
];
function tintFor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}
