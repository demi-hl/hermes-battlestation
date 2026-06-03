"use client";

import { useState } from "react";
import {
  useWorkspace,
  type AgentStatus,
  type ModelOption,
} from "./workspace-context";
import { Sheet } from "./Sheet";
import { ChevronUpDownIcon, CheckIcon, BranchIcon } from "./icons";
import { haptic } from "./haptics";
import { cn } from "@/lib/utils";

/**
 * Bottom context bar, mirroring the Hermes CLI context bar. Always shows the
 * ACTIVE context so it is never ambiguous what the agent is acting on: bound
 * repo/branch, current model (tap to switch), context-window usage, and a
 * connection status dot. Frosted. Driven by `useWorkspace()` — later slices
 * call `setActiveWorkspace` / `setContextUsage` / `setStatus` to feed it.
 */
export function ContextBar() {
  const { active, model, contextUsage, status } = useWorkspace();
  const [modelOpen, setModelOpen] = useState(false);

  const pct = contextUsage
    ? Math.min(100, Math.round((contextUsage.used / contextUsage.total) * 100))
    : null;

  return (
    <div
      className="flex h-10 items-center gap-2.5 border-t border-border px-3"
      style={{
        background: "color-mix(in srgb, var(--background-base) 70%, transparent)",
        backdropFilter: "blur(18px) saturate(150%)",
        WebkitBackdropFilter: "blur(18px) saturate(150%)",
      }}
    >
      <StatusDot status={status} />

      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {active ? (
          <>
            <span className="truncate text-[0.74rem] text-midground">
              {active.repo}
            </span>
            <BranchIcon
              width={12}
              height={12}
              className="shrink-0 text-text-tertiary"
            />
            <span className="font-mono-ui truncate text-[0.72rem] text-text-tertiary">
              {active.branch}
            </span>
          </>
        ) : (
          <span className="truncate text-[0.74rem] text-text-tertiary">
            general · no workspace bound
          </span>
        )}
      </div>

      {pct !== null && <ContextMeter pct={pct} />}

      <button
        type="button"
        onClick={() => {
          haptic(8);
          setModelOpen(true);
        }}
        aria-label={`Model: ${model.label} on ${model.plan}. Tap to switch.`}
        className="flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-1 text-[0.7rem] text-midground transition-colors active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]"
      >
        <span className="font-mondwest text-display tracking-wide">
          {model.label}
        </span>
        <span className="text-text-tertiary">· {model.plan}</span>
        <ChevronUpDownIcon
          width={12}
          height={12}
          className="text-text-tertiary"
        />
      </button>

      <ModelSheet open={modelOpen} onClose={() => setModelOpen(false)} />
    </div>
  );
}

function StatusDot({ status }: { status: AgentStatus }) {
  const color =
    status === "online"
      ? "var(--color-success)"
      : status === "connecting"
        ? "var(--color-warning)"
        : "var(--color-destructive)";
  return (
    <span
      aria-label={`agent ${status}`}
      title={`agent ${status}`}
      className="relative grid shrink-0 place-items-center"
      style={{ width: 12, height: 12 }}
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          status === "connecting" && "animate-pulse",
        )}
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
    </span>
  );
}

function ContextMeter({ pct }: { pct: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5" title={`context ${pct}%`}>
      <span className="relative h-1.5 w-12 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--midground)_14%,transparent)]">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-midground"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="font-mono-ui tabular text-[0.66rem] text-text-tertiary">
        {pct}%
      </span>
    </span>
  );
}

function ModelSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { models, model, setModel } = useWorkspace();
  return (
    <Sheet open={open} onClose={onClose} title="Model">
      <ul role="listbox" aria-label="Model" className="flex flex-col gap-0.5">
        {models.map((m) => (
          <ModelRow
            key={m.id}
            option={m}
            active={m.id === model.id}
            onSelect={() => {
              haptic(10);
              setModel(m.id);
              onClose();
            }}
          />
        ))}
      </ul>
      <p className="px-3 pt-2 text-[0.68rem] leading-relaxed text-text-tertiary">
        All models run on the Anthropic Max subscription (flat rate). Never
        OpenRouter.
      </p>
    </Sheet>
  );
}

function ModelRow({
  option,
  active,
  onSelect,
}: {
  option: ModelOption;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={active}
        onClick={onSelect}
        className={cn(
          "relative flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-left transition-colors",
          active
            ? "bg-[color-mix(in_srgb,var(--midground)_10%,transparent)]"
            : "active:bg-[color-mix(in_srgb,var(--midground)_6%,transparent)]",
        )}
      >
        {active && (
          <span
            aria-hidden
            className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-midground"
          />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-mondwest text-display text-[0.84rem] tracking-wide text-midground">
            {option.label}
          </span>
          <span className="font-mono-ui text-[0.68rem] text-text-tertiary">
            {option.id} · {option.provider} · {option.plan}
          </span>
        </span>
        <CheckIcon
          width={16}
          height={16}
          className={cn(
            "shrink-0 text-midground transition-opacity",
            active ? "opacity-100" : "opacity-0",
          )}
        />
      </button>
    </li>
  );
}
