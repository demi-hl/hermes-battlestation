"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePolling } from "@/components/usePolling";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import type { VersionsPayload, BoxVersions } from "@/app/api/fleet/versions/route";

type UpdateState =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "done"; from: string | null; to: string | null; bumped: boolean }
  | { phase: "error"; message: string };

function BoxRow({
  box,
  onUpdate,
  state,
}: {
  box: BoxVersions;
  onUpdate: (key: string) => void;
  state: UpdateState;
}) {
  const running = state.phase === "running";
  return (
    <div className="flex items-center gap-2.5 rounded-[var(--radius-md)] border border-border bg-card px-2.5 py-2">
      <span
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          box.reachable ? "bg-[var(--color-success)]" : "bg-[var(--color-destructive)]",
        )}
      />
      <div className="min-w-0 flex-1">
        <span className="block truncate text-[0.76rem] text-midground">{box.label}</span>
        <span className="font-mono-ui block truncate text-[0.58rem] text-text-tertiary">
          {box.reachable
            ? `CC ${box.claudeCode ?? "—"}${box.hermes ? ` · HM ${box.hermes}` : ""}`
            : box.error ?? "unreachable"}
        </span>
      </div>

      {state.phase === "done" ? (
        <span
          className="font-mono-ui shrink-0 text-[0.58rem]"
          style={{ color: state.bumped ? "var(--color-success)" : "var(--color-text-tertiary)" }}
        >
          {state.bumped ? `→ ${state.to}` : "current"}
        </span>
      ) : state.phase === "error" ? (
        <span className="font-mono-ui shrink-0 text-[0.56rem] text-[color:var(--color-warning)]">
          failed
        </span>
      ) : box.reachable && box.claudeCode ? (
        <button
          type="button"
          disabled={running || !box.claudeUpdateAvailable}
          onClick={() => onUpdate(box.key)}
          className={cn(
            "font-mono-ui shrink-0 rounded-full border px-2 py-0.5 text-[0.58rem] transition-colors",
            box.claudeUpdateAvailable
              ? "border-[color:var(--color-warning)] text-[color:var(--color-warning)] active:bg-[color-mix(in_srgb,var(--color-warning)_15%,transparent)]"
              : "border-border text-text-disabled",
            running && "opacity-60",
          )}
        >
          {running ? "updating…" : box.claudeUpdateAvailable ? "update" : "up to date"}
        </button>
      ) : null}
    </div>
  );
}

export function VersionsCard() {
  const { data, loading, updatedAt, reload } = usePolling<VersionsPayload>(
    "/api/fleet/versions",
    60_000,
  );
  const [states, setStates] = useState<Record<string, UpdateState>>({});

  const runUpdate = async (key: string) => {
    setStates((s) => ({ ...s, [key]: { phase: "running" } }));
    try {
      const res = await fetch("/api/fleet/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ box: key }),
      });
      const j = await res.json();
      if (j.ok) {
        setStates((s) => ({
          ...s,
          [key]: { phase: "done", from: j.fromVersion, to: j.toVersion, bumped: j.bumped },
        }));
        // Re-pull versions so the row reflects the new installed version.
        setTimeout(() => reload?.(), 1500);
      } else {
        setStates((s) => ({ ...s, [key]: { phase: "error", message: j.error ?? "failed" } }));
      }
    } catch (e) {
      setStates((s) => ({
        ...s,
        [key]: { phase: "error", message: e instanceof Error ? e.message : "failed" },
      }));
    }
  };

  const updatable = data?.boxes.filter((b) => b.claudeUpdateAvailable).length ?? 0;

  return (
    <section className="px-3 pt-1">
      <header className="mb-2 flex items-baseline justify-between">
        <h3 className="text-display font-mondwest text-[0.72rem] tracking-[0.14em] text-text-secondary">
          Toolchain versions
        </h3>
        <span className="font-mono-ui text-[0.56rem] text-text-disabled">
          {data?.claudeLatest ? `CC latest ${data.claudeLatest}` : ""}
          {updatedAt ? ` · ${relativeTime(updatedAt)}` : ""}
        </span>
      </header>

      {updatable > 0 && (
        <p className="mb-2 font-mono-ui text-[0.6rem] text-[color:var(--color-warning)]">
          {updatable} box{updatable === 1 ? "" : "es"} can update Claude Code
        </p>
      )}

      {loading && !data ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[44px] animate-pulse rounded-[var(--radius-md)] border border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)]"
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {data?.boxes.map((box) => (
              <motion.div key={box.key} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <BoxRow
                  box={box}
                  onUpdate={runUpdate}
                  state={states[box.key] ?? { phase: "idle" }}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}
