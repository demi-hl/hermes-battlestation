"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { haptic } from "@/components/shell/haptics";
import { cn } from "@/lib/utils";
import {
  CpuIcon,
  CheckIcon,
  ChevronDownIcon,
} from "@/components/shell/icons";
import { SectionLabel, PaneSkeleton, StateCard } from "./parts";

/* ========================================================================= */

interface RuntimeConfig {
  model: { default: string; provider: string; base_url: string };
  approvals: { mode: string };
  agent: { reasoning_effort: string; max_turns: number };
  display: {
    busy_input_mode: string;
    tui_status_indicator: string;
    tool_progress: string;
    background_process_notifications: string;
    runtime_footer_enabled: boolean;
  };
  skills: {
    write_approval: boolean;
    guard_agent_created: boolean;
    creation_nudge_interval: number;
    disabled: string[];
  };
  curator: {
    enabled: boolean;
    consolidate: boolean;
    prune_builtins: boolean;
    interval_hours: number;
    stale_after_days: number;
    archive_after_days: number;
  };
}

interface ModelOption {
  id: string;
  label: string;
  provider?: string;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface SelectOption {
  value: string;
  label: string;
}

const APPROVAL_MODES: SelectOption[] = [
  { value: "manual", label: "Manual" },
  { value: "smart", label: "Smart" },
  { value: "off", label: "Off" },
];

const REASONING_EFFORTS: SelectOption[] = [
  { value: "none", label: "None" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "X-High" },
];

const BUSY_INPUT_MODES: SelectOption[] = [
  { value: "interrupt", label: "Interrupt" },
  { value: "queue", label: "Queue" },
  { value: "steer", label: "Steer" },
];

const INDICATOR_STYLES: SelectOption[] = [
  { value: "kaomoji", label: "Kaomoji" },
  { value: "emoji", label: "Emoji" },
  { value: "unicode", label: "Unicode" },
  { value: "ascii", label: "ASCII" },
];

const TOOL_PROGRESS_MODES: SelectOption[] = [
  { value: "none", label: "None" },
  { value: "off", label: "Off" },
  { value: "new", label: "New tools" },
  { value: "all", label: "All tools" },
  { value: "verbose", label: "Verbose" },
];

const BACKGROUND_NOTIFY_MODES: SelectOption[] = [
  { value: "all", label: "All" },
  { value: "result", label: "Result" },
  { value: "error", label: "Errors only" },
  { value: "off", label: "Off" },
];

/* ========================================================================= */

async function postConfig(key: string, value: string | number | boolean): Promise<void> {
  const res = await fetch("/api/runtime-config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
  if (!res.ok) throw new Error(`save failed (${res.status})`);
}

/** Per-field save lifecycle. Returns whether the save succeeded. */
function useFieldSave(configKey: string) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(
    async (value: string | number | boolean): Promise<boolean> => {
      if (timer.current) clearTimeout(timer.current);
      setStatus("saving");
      haptic(6);
      try {
        await postConfig(configKey, value);
        setStatus("saved");
        haptic(12);
        timer.current = setTimeout(() => setStatus("idle"), 1800);
        return true;
      } catch {
        setStatus("error");
        haptic(30);
        timer.current = setTimeout(() => setStatus("idle"), 2600);
        return false;
      }
    },
    [configKey],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { status, save };
}

/* ========================================================================= */

function SaveIndicator({ status }: { status: SaveStatus }) {
  return (
    <AnimatePresence mode="wait">
      {status !== "idle" && (
        <motion.span
          key={status}
          initial={{ opacity: 0, y: -2 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -2 }}
          transition={{ duration: 0.18 }}
          className={cn(
            "flex items-center gap-1 font-mono-ui text-[0.56rem] uppercase tracking-[0.12em]",
            status === "saving" && "text-text-tertiary",
            status === "saved" && "text-[var(--color-success,#4ade80)]",
            status === "error" && "text-[var(--color-destructive,#fb2c36)]",
          )}
        >
          {status === "saving" && "saving…"}
          {status === "saved" && (
            <>
              <CheckIcon width={11} height={11} /> saved
            </>
          )}
          {status === "error" && "error"}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/* ========================================================================= */

function FieldShell({
  label,
  hint,
  status,
  children,
}: {
  label: string;
  hint?: string;
  status: SaveStatus;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-2">
        <span className="font-mono-ui text-[0.6rem] uppercase tracking-[0.14em] text-text-tertiary">
          {label}
        </span>
        {hint && <span className="text-[0.6rem] text-text-disabled">· {hint}</span>}
        <span className="ml-auto flex h-3 items-center">
          <SaveIndicator status={status} />
        </span>
      </span>
      {children}
    </label>
  );
}

const INPUT_CLASS =
  "w-full rounded-[var(--radius-md)] border border-border bg-[color-mix(in_srgb,var(--midground)_4%,transparent)] px-3 py-2 font-mono-ui text-[0.8rem] text-midground outline-none placeholder:text-text-disabled focus:border-[color-mix(in_srgb,var(--midground)_30%,transparent)]";

/* ========================================================================= */

function TextField({
  configKey,
  label,
  hint,
  placeholder,
  initial,
}: {
  configKey: string;
  label: string;
  hint?: string;
  placeholder?: string;
  initial: string;
}) {
  const { status, save } = useFieldSave(configKey);
  const [value, setValue] = useState(initial);
  const baseline = useRef(initial);
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    baseline.current = initial;
    setValue(initial);
  }

  const commit = async () => {
    const next = value.trim();
    if (next === baseline.current.trim()) return;
    if (await save(next)) baseline.current = next;
  };

  return (
    <FieldShell label={label} hint={hint} status={status}>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        placeholder={placeholder}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className={INPUT_CLASS}
      />
    </FieldShell>
  );
}

function NumberField({
  configKey,
  label,
  hint,
  initial,
  min,
}: {
  configKey: string;
  label: string;
  hint?: string;
  initial: number;
  min?: number;
}) {
  const { status, save } = useFieldSave(configKey);
  const [value, setValue] = useState(String(initial ?? ""));
  const baseline = useRef(String(initial ?? ""));
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    const s = String(initial ?? "");
    baseline.current = s;
    setValue(s);
  }

  const commit = async () => {
    const trimmed = value.trim();
    if (trimmed === baseline.current.trim()) return;
    const num = Number(trimmed);
    if (trimmed === "" || Number.isNaN(num)) {
      setValue(baseline.current); // revert invalid input
      return;
    }
    if (await save(num)) baseline.current = String(num);
  };

  return (
    <FieldShell label={label} hint={hint} status={status}>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className={INPUT_CLASS}
      />
    </FieldShell>
  );
}

function SelectField({
  configKey,
  label,
  hint,
  initial,
  options,
}: {
  configKey: string;
  label: string;
  hint?: string;
  initial: string;
  options: SelectOption[];
}) {
  const { status, save } = useFieldSave(configKey);
  const [value, setValue] = useState(initial);
  const baseline = useRef(initial);
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    baseline.current = initial;
    setValue(initial);
  }

  const onChange = async (next: string) => {
    setValue(next); // optimistic
    if (next === baseline.current) return;
    if (await save(next)) baseline.current = next;
    else setValue(baseline.current); // revert on failure
  };

  return (
    <FieldShell label={label} hint={hint} status={status}>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(INPUT_CLASS, "cursor-pointer appearance-none pr-9")}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDownIcon
          width={14}
          height={14}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary"
        />
      </div>
    </FieldShell>
  );
}

function BooleanField({
  configKey,
  label,
  hint,
  initial,
}: {
  configKey: string;
  label: string;
  hint?: string;
  initial: boolean;
}) {
  const { status, save } = useFieldSave(configKey);
  const [value, setValue] = useState(initial);
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setValue(initial);
  }

  const onToggle = async () => {
    const next = !value;
    setValue(next);
    if (!(await save(next))) setValue(value);
  };

  return (
    <FieldShell label={label} hint={hint} status={status}>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={value}
        className={cn(
          INPUT_CLASS,
          "flex items-center justify-between text-left transition-colors",
          value &&
            "border-[color-mix(in_srgb,var(--color-success,#4ade80)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-success,#4ade80)_10%,transparent)]",
        )}
      >
        <span>{value ? "Enabled" : "Disabled"}</span>
        <span
          className={cn(
            "relative h-5 w-9 rounded-full border border-border transition-colors",
            value &&
              "border-[color:var(--color-success,#4ade80)] bg-[color-mix(in_srgb,var(--color-success,#4ade80)_16%,transparent)]",
          )}
        >
          <span
            className={cn(
              "absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-text-tertiary transition-transform",
              value ? "translate-x-4 bg-[color:var(--color-success,#4ade80)]" : "translate-x-1",
            )}
          />
        </span>
      </button>
    </FieldShell>
  );
}

/* ========================================================================= */

export function RuntimeConfigPane() {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [configPath, setConfigPath] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfgRes, modelsRes] = await Promise.all([
        fetch("/api/runtime-config", { cache: "no-store" }),
        fetch("/api/models", { cache: "no-store" }),
      ]);
      if (!cfgRes.ok) throw new Error("failed to load runtime config");
      const cfgJson = await cfgRes.json();
      setConfig(cfgJson.config);
      setConfigPath(cfgJson.configPath ?? "");
      if (modelsRes.ok) {
        const m = await modelsRes.json();
        setModels(Array.isArray(m.models) ? m.models : []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Model dropdown options — guarantee the current default is selectable even
  // if it is missing from /api/models.
  const modelOptions: SelectOption[] = (() => {
    const opts = models.map((m) => ({ value: m.id, label: m.label || m.id }));
    const current = config?.model.default;
    if (current && !opts.some((o) => o.value === current)) {
      opts.unshift({ value: current, label: current });
    }
    return opts;
  })();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="mx-auto flex min-h-full w-full max-w-[520px] flex-col gap-6 px-5 pb-8 pt-2"
    >
      {/* header */}
      <div className="flex items-center gap-2.5 pt-1">
        <span className="grid h-9 w-9 place-items-center rounded-xl border border-border text-midground">
          <CpuIcon width={17} height={17} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-mondwest text-display text-[0.92rem] tracking-[0.04em] text-midground">
            Runtime Config
          </h1>
          <p className="truncate font-mono-ui text-[0.66rem] text-text-tertiary">
            hermes runtime defaults
          </p>
        </div>
      </div>

      {/* applies-to-new-sessions note */}
      <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-warning,#ffbd38)_36%,transparent)] bg-[color-mix(in_srgb,var(--color-warning,#ffbd38)_8%,transparent)] px-3 py-2">
        <span
          className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: "var(--color-warning, #ffbd38)" }}
        />
        <p className="text-[0.72rem] leading-relaxed text-text-secondary">
          Changes apply to{" "}
          <span className="text-midground">new sessions</span> — running sessions
          keep their current settings.
        </p>
      </div>

      {loading && !config ? (
        <PaneSkeleton rows={4} />
      ) : error && !config ? (
        <StateCard
          icon={CpuIcon}
          tone="danger"
          title="Config unavailable"
          blurb={error}
        />
      ) : config ? (
        <>
          {error && (
            <p className="px-1 font-mono-ui text-[0.64rem] leading-relaxed text-[var(--color-warning,#ffbd38)]">
              {error}
            </p>
          )}

          {/* Model */}
          <section className="flex flex-col gap-3">
            <SectionLabel>Model</SectionLabel>
            <SelectField
              configKey="model.default"
              label="Default model"
              initial={config.model.default}
              options={
                modelOptions.length > 0
                  ? modelOptions
                  : [
                      {
                        value: config.model.default,
                        label: config.model.default || "—",
                      },
                    ]
              }
            />
            <TextField
              configKey="model.provider"
              label="Provider"
              initial={config.model.provider}
              placeholder="anthropic"
            />
            <TextField
              configKey="model.base_url"
              label="Base URL"
              hint="leave empty for default"
              initial={config.model.base_url}
              placeholder="https://api.example.com"
            />
          </section>

          {/* Approvals */}
          <section className="flex flex-col gap-3">
            <SectionLabel>Approvals</SectionLabel>
            <SelectField
              configKey="approvals.mode"
              label="Mode"
              initial={config.approvals.mode}
              options={APPROVAL_MODES}
            />
          </section>

          {/* Agent */}
          <section className="flex flex-col gap-3">
            <SectionLabel>Agent</SectionLabel>
            <SelectField
              configKey="agent.reasoning_effort"
              label="Reasoning effort"
              initial={config.agent.reasoning_effort}
              options={REASONING_EFFORTS}
            />
            <NumberField
              configKey="agent.max_turns"
              label="Max turns"
              initial={config.agent.max_turns}
              min={1}
            />
          </section>

          {/* Display */}
          <section className="flex flex-col gap-3">
            <SectionLabel>Display</SectionLabel>
            <SelectField
              configKey="display.busy_input_mode"
              label="Busy input"
              hint="Enter while agent works"
              initial={config.display.busy_input_mode}
              options={BUSY_INPUT_MODES}
            />
            <SelectField
              configKey="display.tui_status_indicator"
              label="Indicator"
              hint="CLI busy style"
              initial={config.display.tui_status_indicator}
              options={INDICATOR_STYLES}
            />
            <SelectField
              configKey="display.tool_progress"
              label="Tool progress"
              hint="gateway updates"
              initial={config.display.tool_progress}
              options={TOOL_PROGRESS_MODES}
            />
            <SelectField
              configKey="display.background_process_notifications"
              label="Background notifications"
              initial={config.display.background_process_notifications}
              options={BACKGROUND_NOTIFY_MODES}
            />
            <BooleanField
              configKey="display.runtime_footer.enabled"
              label="Runtime footer"
              hint="final reply metadata"
              initial={config.display.runtime_footer_enabled}
            />
          </section>

          {/* Skills */}
          <section className="flex flex-col gap-3">
            <SectionLabel>Skills</SectionLabel>
            <BooleanField
              configKey="skills.write_approval"
              label="Write approval"
              hint="ask before saving skills"
              initial={config.skills.write_approval}
            />
            <BooleanField
              configKey="skills.guard_agent_created"
              label="Guard agent-created"
              hint="protect generated skills"
              initial={config.skills.guard_agent_created}
            />
            <NumberField
              configKey="skills.creation_nudge_interval"
              label="Nudge interval"
              hint="turns between save prompts"
              initial={config.skills.creation_nudge_interval}
              min={1}
            />
            <div className="rounded-[var(--radius-md)] border border-border px-3 py-2">
              <div className="font-mono-ui text-[0.6rem] uppercase tracking-[0.14em] text-text-tertiary">
                Disabled skills
              </div>
              <div className="mt-1 font-mono-ui text-[0.74rem] text-text-secondary">
                {config.skills.disabled.length} hidden from auto-load
              </div>
            </div>
          </section>

          {/* Curator */}
          <section className="flex flex-col gap-3">
            <SectionLabel>Curator</SectionLabel>
            <BooleanField
              configKey="curator.enabled"
              label="Enabled"
              hint="skill maintenance"
              initial={config.curator.enabled}
            />
            <BooleanField
              configKey="curator.consolidate"
              label="Consolidate"
              initial={config.curator.consolidate}
            />
            <BooleanField
              configKey="curator.prune_builtins"
              label="Prune builtins"
              initial={config.curator.prune_builtins}
            />
            <NumberField
              configKey="curator.interval_hours"
              label="Interval hours"
              initial={config.curator.interval_hours}
              min={1}
            />
            <NumberField
              configKey="curator.stale_after_days"
              label="Stale after days"
              initial={config.curator.stale_after_days}
              min={1}
            />
            <NumberField
              configKey="curator.archive_after_days"
              label="Archive after days"
              initial={config.curator.archive_after_days}
              min={1}
            />
          </section>

          {/* config path */}
          {configPath && (
            <div className="mt-1 flex flex-col gap-1 border-t border-border pt-3">
              <span className="font-mono-ui text-[0.56rem] uppercase tracking-[0.14em] text-text-tertiary">
                Config path
              </span>
              <code className="break-all font-mono-ui text-[0.66rem] leading-relaxed text-text-secondary">
                {configPath}
              </code>
            </div>
          )}
        </>
      ) : null}
    </motion.div>
  );
}
