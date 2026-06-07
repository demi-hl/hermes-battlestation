"use client";

import { useMemo, useState, type FormEvent, type SVGProps } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePolling } from "@/components/usePolling";
import { relativeTime } from "@/lib/format";
import { haptic } from "@/components/shell/haptics";
import { cn } from "@/lib/utils";
import {
  SectionLabel,
  RefreshButton,
  PaneSkeleton,
  StateCard,
  PullToRefresh,
  RefreshIcon,
} from "./parts";
import { PlusIcon, PlayIcon, TrashIcon } from "./pane-icons";
import { Switch, Segmented, Button } from "@/components/ui";

/* ========================================================================= */
/*  types                                                                     */
/* ========================================================================= */

type McpTransport = "stdio" | "http";

type McpServer = {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
  env: Record<string, string>; // redacted
  toolCount?: number;
};

type McpPayload = {
  servers: McpServer[];
  configPath: string;
};

/* ========================================================================= */
/*  icons                                                                     */
/* ========================================================================= */

type P = SVGProps<SVGSVGElement>;

const MCP_ICON = (p: P) => (
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
    <path d="M4 7h16M4 12h16M4 17h16" />
    <circle cx="8" cy="7" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="8" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="8" cy="17" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);

/* ========================================================================= */
/*  mutation helpers — write to /api/mcp                                     */
/* ========================================================================= */

type MutationResult = {
  ok: boolean;
  output?: string;
  error?: string;
};

async function apiMcpPost(
  payload: Record<string, unknown>,
): Promise<MutationResult> {
  try {
    const res = await fetch("/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let body: { ok?: boolean; output?: string; error?: string } | null = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      return {
        ok: false,
        error: body?.error ?? `request failed (${res.status})`,
        output: body?.output,
      };
    }
    return {
      ok: body?.ok ?? true,
      output: body?.output,
      error: body?.error,
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function apiMcpDelete(name: string): Promise<MutationResult> {
  try {
    const res = await fetch("/api/mcp", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "delete failed");
      return { ok: false, error: text || "delete failed" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/* ========================================================================= */
/*  transport badge                                                          */
/* ========================================================================= */

function TransportBadge({ transport }: { transport: McpTransport }) {
  const isHttp = transport === "http";
  return (
    <span
      className={cn(
        "rounded-full border px-1.5 py-[1px] font-mono-ui text-[0.5rem] uppercase tracking-[0.1em]",
        isHttp
          ? "border-[color-mix(in_srgb,var(--color-info,#7dd3fc)_40%,transparent)] text-[var(--color-info,#7dd3fc)]"
          : "border-[color-mix(in_srgb,var(--color-accent,#a78bfa)_40%,transparent)] text-[var(--color-accent,#a78bfa)]",
      )}
    >
      {transport}
    </span>
  );
}

/* ========================================================================= */
/*  enable / disable toggle                                                  */
/* ========================================================================= */

function McpToggle({
  server,
  onChanged,
}: {
  server: McpServer;
  onChanged: () => void;
}) {
  const [enabled, setEnabled] = useState(server.enabled);
  const [busy, setBusy] = useState(false);

  const handleToggle = async () => {
    if (busy) return;
    haptic(6);
    const next = !enabled;
    setEnabled(next); // optimistic
    setBusy(true);
    const { ok } = await apiMcpPost({
      action: "toggle",
      name: server.name,
      enabled: next,
    });
    if (!ok) setEnabled(!next); // revert on failure
    setBusy(false);
    if (ok) onChanged();
  };

  return (
    <Switch
      checked={enabled}
      onCheckedChange={handleToggle}
      disabled={busy}
      aria-label={enabled ? "Disable server" : "Enable server"}
      className={cn(busy && "opacity-60")}
    />
  );
}

/* ========================================================================= */
/*  server card                                                              */
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

function ServerCard({
  server,
  onChanged,
}: {
  server: McpServer;
  onChanged: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [showOutput, setShowOutput] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const target =
    server.transport === "http"
      ? server.url ?? ""
      : [server.command, ...(server.args ?? [])].filter(Boolean).join(" ");

  const envKeys = Object.keys(server.env ?? {});

  const handleTest = async () => {
    if (testing) return;
    haptic(8);
    setErr(null);
    setTesting(true);
    setShowOutput(true);
    const { ok, output, error } = await apiMcpPost({
      action: "test",
      name: server.name,
    });
    setTestOk(ok);
    setTestOutput(output ?? error ?? (ok ? "connection ok" : "test failed"));
    setTesting(false);
  };

  const handleDelete = async () => {
    if (deleting) return;
    if (!confirmDelete) {
      haptic(8);
      setConfirmDelete(true);
      return;
    }
    haptic(12);
    setErr(null);
    setDeleting(true);
    const { ok, error } = await apiMcpDelete(server.name);
    setDeleting(false);
    if (ok) {
      setConfirmDelete(false);
      onChanged();
    } else {
      setErr(error ?? "delete failed");
    }
  };

  return (
    <motion.li variants={ROW_V}>
      <div
        className="flex flex-col gap-2.5 rounded-[var(--radius-md)] border border-border px-3 py-2.5"
        style={{
          background: "color-mix(in srgb, var(--midground) 3%, transparent)",
        }}
      >
        {/* identity row */}
        <div className="flex items-center gap-3">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-sm)] text-[var(--color-accent,#a78bfa)]">
            <MCP_ICON />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[0.84rem] font-medium text-midground">
                {server.name}
              </span>
              <TransportBadge transport={server.transport} />
              {!server.enabled && (
                <span className="rounded-full border border-border px-1.5 py-[1px] font-mono-ui text-[0.5rem] uppercase tracking-[0.1em] text-text-tertiary">
                  disabled
                </span>
              )}
              {typeof server.toolCount === "number" && (
                <span className="font-mono-ui tabular text-[0.56rem] text-text-tertiary">
                  {server.toolCount} tool{server.toolCount === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate font-mono-ui text-[0.66rem] leading-snug text-text-secondary">
              {target || (
                <span className="text-text-disabled">no endpoint</span>
              )}
            </p>
          </div>

          <McpToggle server={server} onChanged={onChanged} />
        </div>

        {/* env chips */}
        {envKeys.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {envKeys.map((k) => (
              <span
                key={k}
                className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-[1px] font-mono-ui text-[0.54rem] text-text-secondary"
              >
                <span className="text-text-tertiary">{k}</span>
                <span className="text-text-disabled">=</span>
                <span className="text-text-secondary">{server.env[k]}</span>
              </span>
            ))}
          </div>
        )}

        {/* actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-border px-2.5 py-1 font-mono-ui text-[0.62rem] uppercase tracking-[0.08em] text-text-secondary transition-colors",
              testing
                ? "opacity-60"
                : "hover:text-midground hover:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)] active:scale-[0.97]",
            )}
          >
            <span className={testing ? "animate-spin-slow" : ""}>
              {testing ? (
                <RefreshIcon width={12} height={12} />
              ) : (
                <PlayIcon width={12} height={12} />
              )}
            </span>
            {testing ? "Testing…" : "Test"}
          </button>

          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className={cn(
              "ml-auto inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-1 font-mono-ui text-[0.62rem] uppercase tracking-[0.08em] transition-colors",
              confirmDelete
                ? "border-[color-mix(in_srgb,var(--color-destructive,#fb2c36)_50%,transparent)] text-[var(--color-destructive,#fb2c36)]"
                : "border-border text-text-tertiary hover:border-[color-mix(in_srgb,var(--color-destructive,#fb2c36)_40%,transparent)] hover:text-[var(--color-destructive,#fb2c36)]",
              deleting && "opacity-60",
              !deleting && "active:scale-[0.97]",
            )}
          >
            <span className={deleting ? "animate-spin-slow" : ""}>
              {deleting ? (
                <RefreshIcon width={12} height={12} />
              ) : (
                <TrashIcon width={12} height={12} />
              )}
            </span>
            {confirmDelete ? "Confirm?" : "Remove"}
          </button>

          {confirmDelete && !deleting && (
            <button
              type="button"
              onClick={() => {
                haptic(4);
                setConfirmDelete(false);
              }}
              className="inline-flex items-center rounded-[var(--radius-sm)] border border-border px-2.5 py-1 font-mono-ui text-[0.62rem] uppercase tracking-[0.08em] text-text-tertiary transition-colors hover:text-midground active:scale-[0.97]"
            >
              Cancel
            </button>
          )}
        </div>

        {/* test output (expandable) */}
        <AnimatePresence initial={false}>
          {showOutput && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className="rounded-[var(--radius-sm)] border border-border bg-card px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "font-mono-ui text-[0.55rem] uppercase tracking-[0.1em]",
                      testing
                        ? "text-text-tertiary"
                        : testOk
                          ? "text-[var(--color-success,#4ade80)]"
                          : "text-[var(--color-destructive,#fb2c36)]",
                    )}
                  >
                    {testing ? "testing" : testOk ? "ok" : "failed"}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      haptic(4);
                      setShowOutput(false);
                    }}
                    className="ml-auto font-mono-ui text-[0.55rem] uppercase tracking-[0.1em] text-text-tertiary transition-colors hover:text-midground"
                  >
                    hide
                  </button>
                </div>
                <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono-ui text-[0.64rem] leading-relaxed text-text-secondary">
                  {testing ? "Connecting…" : testOutput}
                </pre>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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
/*  add server form                                                          */
/* ========================================================================= */

function parseArgs(raw: string): string[] {
  return raw
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0);
}

function parseEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function AddServerForm({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<McpTransport>("stdio");
  const [command, setCommand] = useState("");
  const [argsRaw, setArgsRaw] = useState("");
  const [url, setUrl] = useState("");
  const [envRaw, setEnvRaw] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid =
    name.trim().length > 0 &&
    (transport === "http" ? url.trim().length > 0 : command.trim().length > 0);

  const reset = () => {
    setName("");
    setTransport("stdio");
    setCommand("");
    setArgsRaw("");
    setUrl("");
    setEnvRaw("");
    setError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || submitting) return;
    haptic(6);
    setSubmitting(true);
    setError(null);

    const env = parseEnv(envRaw);
    const payload: Record<string, unknown> = {
      action: "add",
      name: name.trim(),
      transport,
      env,
    };
    if (transport === "http") {
      payload.url = url.trim();
    } else {
      payload.command = command.trim();
      payload.args = parseArgs(argsRaw);
    }

    const { ok, error: err } = await apiMcpPost(payload);
    setSubmitting(false);
    if (ok) {
      reset();
      setOpen(false);
      onAdded();
    } else {
      setError(err ?? "failed to add server");
    }
  };

  const inputCls =
    "w-full rounded-[var(--radius-sm)] border border-border bg-transparent px-2.5 py-1.5 text-[0.82rem] text-midground outline-none placeholder:text-text-disabled focus:border-[color-mix(in_srgb,var(--midground)_30%,transparent)]";
  const monoInputCls =
    "w-full rounded-[var(--radius-sm)] border border-border bg-transparent px-2.5 py-1.5 font-mono-ui text-[0.8rem] text-midground outline-none placeholder:text-text-disabled focus:border-[color-mix(in_srgb,var(--midground)_30%,transparent)]";
  const labelCls =
    "mb-1 block font-mono-ui text-[0.55rem] uppercase tracking-[0.12em] text-text-tertiary";

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => {
          haptic(8);
          setOpen((o) => !o);
        }}
        className="flex w-full items-center gap-2 rounded-[var(--radius-md)] border border-border px-3 py-2.5 text-left transition-colors active:scale-[0.99]"
        style={{
          background: "color-mix(in srgb, var(--midground) 3%, transparent)",
        }}
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-text-tertiary">
          <PlusIcon width={14} height={14} />
        </span>
        <span className="text-[0.82rem] text-text-secondary">
          {open ? "Cancel" : "Add server"}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.form
            onSubmit={handleSubmit}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-2.5 rounded-[var(--radius-md)] border border-border px-3 py-3">
              {/* name */}
              <div>
                <label className={labelCls}>Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. github"
                  autoComplete="off"
                  spellCheck={false}
                  className={inputCls}
                />
              </div>

              {/* transport toggle */}
              <div>
                <label className={labelCls}>Transport</label>
                <div>
                  <Segmented<McpTransport>
                    size="md"
                    options={[
                      { label: "stdio", value: "stdio" },
                      { label: "http", value: "http" },
                    ]}
                    value={transport}
                    onChange={(t) => {
                      haptic(4);
                      setTransport(t);
                    }}
                  />
                </div>
              </div>

              {/* stdio vs http fields */}
              {transport === "stdio" ? (
                <>
                  <div>
                    <label className={labelCls}>Command</label>
                    <input
                      type="text"
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      placeholder="e.g. npx"
                      autoComplete="off"
                      spellCheck={false}
                      className={monoInputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Args (space-separated)</label>
                    <input
                      type="text"
                      value={argsRaw}
                      onChange={(e) => setArgsRaw(e.target.value)}
                      placeholder="e.g. -y @modelcontextprotocol/server-github"
                      autoComplete="off"
                      spellCheck={false}
                      className={monoInputCls}
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className={labelCls}>URL</label>
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="e.g. https://example.com/mcp"
                    autoComplete="off"
                    spellCheck={false}
                    className={monoInputCls}
                  />
                </div>
              )}

              {/* env */}
              <div>
                <label className={labelCls}>Env (KEY=VALUE per line, optional)</label>
                <textarea
                  value={envRaw}
                  onChange={(e) => setEnvRaw(e.target.value)}
                  placeholder={"GITHUB_TOKEN=ghp_…\nANOTHER_KEY=value"}
                  rows={3}
                  spellCheck={false}
                  className="w-full resize-none rounded-[var(--radius-sm)] border border-border bg-transparent px-2.5 py-1.5 font-mono-ui text-[0.78rem] text-midground outline-none placeholder:text-text-disabled focus:border-[color-mix(in_srgb,var(--midground)_30%,transparent)]"
                />
              </div>

              {error && (
                <p className="font-mono-ui text-[0.62rem] text-[var(--color-destructive,#fb2c36)]">
                  {error}
                </p>
              )}

              <Button type="submit" size="sm" disabled={submitting || !valid}>
                {submitting ? "Adding…" : "Add server"}
              </Button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ========================================================================= */
/*  metric badge                                                             */
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

/* ========================================================================= */
/*  main pane                                                                */
/* ========================================================================= */

export function McpPane() {
  const { data, error, loading, updatedAt, reload } = usePolling<McpPayload>(
    "/api/mcp",
    30_000,
  );

  const servers = data?.servers ?? [];
  const configPath = data?.configPath ?? "~/.hermes/mcp.json";

  const enabledCount = useMemo(
    () => servers.filter((s) => s.enabled).length,
    [servers],
  );

  return (
    <PullToRefresh onRefresh={reload}>
      <div className="px-3 pb-6">
        {/* header */}
        <div className="flex items-center gap-2.5 pt-1">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-border text-midground">
            <MCP_ICON />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="font-mondwest text-display text-[0.92rem] tracking-[0.04em] text-midground">
              MCP Servers
            </h1>
            <p className="truncate font-mono-ui text-[0.66rem] text-text-tertiary">
              model context protocol · endpoints
            </p>
          </div>
          <RefreshButton loading={loading} onClick={reload} />
        </div>

        {/* summary */}
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
          <Metric label="enabled" value={enabledCount} />
          <span className="h-7 w-px bg-border" />
          <Metric label="total" value={servers.length} />
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

        {/* add server form */}
        <AddServerForm onAdded={reload} />

        {/* body */}
        {loading && !data ? (
          <div className="mt-4">
            <PaneSkeleton rows={3} />
          </div>
        ) : error && !data ? (
          <StateCard
            icon={MCP_ICON}
            tone="danger"
            title="MCP unavailable"
            blurb={error ?? "failed to load MCP servers"}
          />
        ) : servers.length === 0 ? (
          <StateCard
            icon={MCP_ICON}
            title="No MCP servers"
            blurb="No MCP servers are configured. Add one above to expose tools to the gateway."
          />
        ) : (
          <div className="mt-4">
            <SectionLabel
              right={
                <span className="font-mono-ui tabular text-[0.62rem] text-text-tertiary">
                  {servers.length} server{servers.length === 1 ? "" : "s"}
                </span>
              }
            >
              Configured Servers
            </SectionLabel>
            <motion.ul
              className="space-y-2.5"
              initial="hidden"
              animate="show"
              variants={{ show: { transition: { staggerChildren: 0.05 } } }}
            >
              {servers.map((server) => (
                <ServerCard
                  key={server.name}
                  server={server}
                  onChanged={reload}
                />
              ))}
            </motion.ul>
          </div>
        )}

        {/* config path + restart note */}
        <div className="mt-5 space-y-1 px-1">
          <p className="font-mono-ui text-[0.6rem] leading-relaxed text-text-tertiary">
            Config:{" "}
            <span className="text-text-secondary">{configPath}</span>
          </p>
          <p className="font-mono-ui text-[0.6rem] leading-relaxed text-text-tertiary">
            Changes apply on the{" "}
            <span className="text-text-secondary">next gateway restart</span>.
          </p>
        </div>
      </div>
    </PullToRefresh>
  );
}
