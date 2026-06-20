"use client";

import { usePolling } from "@/components/usePolling";

interface UsageWindow {
  pct: number | null;
  resetsAt: string | null;
}

interface SubRow {
  label: string;
  email: string | null;
  uuid8: string;
  sub: string | null;
  tier: string | null;
  fiveHour: UsageWindow;
  sevenDay: UsageWindow;
  hasRefresh: boolean;
  status: "ok" | "rate_limited" | "dead" | "no_token";
}

interface ConnRow {
  id: string;
  label: string;
  account: string | null;
  plan: string | null;
  status: "live" | "reauth" | "dead" | "no_token";
  detail: string;
  expiresAt: string | null;
}

interface UsagePayload {
  subs: SubRow[];
  connections: ConnRow[];
  fetchedAt: string;
}

function resetLabel(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  const mins = Math.max(0, Math.round((t - Date.now()) / 60000));
  if (mins < 60) return `resets in ${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `resets in ${h}h ${mins % 60}m`;
  return `resets in ${Math.floor(h / 24)}d ${h % 24}h`;
}

function planLabel(sub: string | null, tier: string | null): string {
  const s = sub === "team" ? "Teams" : sub === "max" ? "Max" : sub ?? "";
  const mult = tier?.match(/(\d+x)/)?.[1] ?? "";
  return [s, mult].filter(Boolean).join(" ");
}

function barColor(pct: number): string {
  if (pct >= 90) return "var(--color-destructive)";
  if (pct >= 70) return "var(--color-warning)";
  return "var(--midground)";
}

function Meter({ label, win }: { label: string; win: UsageWindow }) {
  const pct = win.pct ?? 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="font-mono-ui text-[0.62rem] uppercase tracking-wider text-text-tertiary">
          {label}
        </span>
        <span className="font-mono-ui tabular text-[0.7rem] text-midground">
          {win.pct === null ? "n/a" : `${pct}%`}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--midground)_14%,transparent)]">
        <span
          className="block h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, background: barColor(pct) }}
        />
      </div>
      {win.resetsAt && (
        <span className="font-mono-ui text-[0.56rem] text-text-disabled">
          {resetLabel(win.resetsAt)}
        </span>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: SubRow["status"] }) {
  const map: Record<SubRow["status"], { text: string; color: string }> = {
    ok: { text: "live", color: "var(--color-success)" },
    rate_limited: { text: "rate limited", color: "var(--color-warning)" },
    dead: { text: "dead", color: "var(--color-destructive)" },
    no_token: { text: "no token", color: "var(--color-destructive)" },
  };
  const s = map[status];
  return <Pill text={s.text} color={s.color} />;
}

function ConnPill({ status }: { status: ConnRow["status"] }) {
  const map: Record<ConnRow["status"], { text: string; color: string }> = {
    live: { text: "connected", color: "var(--color-success)" },
    reauth: { text: "re-auth", color: "var(--color-warning)" },
    dead: { text: "dead", color: "var(--color-destructive)" },
    no_token: { text: "no token", color: "var(--color-destructive)" },
  };
  const s = map[status];
  return <Pill text={s.text} color={s.color} />;
}

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 font-mono-ui text-[0.55rem] uppercase tracking-wider"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
      }}
    >
      {text}
    </span>
  );
}

function SubCard({ sub }: { sub: SubRow }) {
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-border bg-[color-mix(in_srgb,var(--midground)_3%,transparent)] p-3">
      <div className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[0.84rem] text-text-primary">{sub.label}</span>
          <span className="font-mono-ui text-[0.6rem] text-text-tertiary">
            {planLabel(sub.sub, sub.tier)} · {sub.uuid8}
            {!sub.hasRefresh && " · no refresh"}
          </span>
          {sub.email && sub.email !== sub.label && (
            <span className="truncate font-mono-ui text-[0.56rem] text-text-disabled">
              {sub.email}
            </span>
          )}
        </span>
        <StatusPill status={sub.status} />
      </div>
      {sub.status === "ok" ? (
        <div className="flex flex-col gap-2.5">
          <Meter label="Session (5h)" win={sub.fiveHour} />
          <Meter label="Week (7d)" win={sub.sevenDay} />
        </div>
      ) : (
        <span className="font-mono-ui text-[0.66rem] text-text-tertiary">
          {sub.status === "rate_limited"
            ? "throttled right now, token still valid"
            : sub.status === "no_token"
              ? "no access token on this box"
              : "token dead, needs re-auth"}
        </span>
      )}
    </div>
  );
}

function ConnCard({ conn }: { conn: ConnRow }) {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-border bg-[color-mix(in_srgb,var(--midground)_3%,transparent)] p-3">
      <div className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[0.84rem] text-text-primary">{conn.label}</span>
          <span className="font-mono-ui text-[0.6rem] text-text-tertiary">
            {[conn.plan, conn.account].filter(Boolean).join(" · ") || "OAuth"}
          </span>
        </span>
        <ConnPill status={conn.status} />
      </div>
      <span className="font-mono-ui text-[0.62rem] text-text-tertiary">
        {conn.detail}
        {" — no plan-usage API, status only"}
      </span>
    </div>
  );
}

export function UsagePane() {
  const { data, error } = usePolling<UsagePayload>("/api/usage", 30_000);
  const subs = data?.subs ?? [];
  const connections = data?.connections ?? [];

  return (
    <div className="flex flex-col gap-5 px-3.5 pb-4 pt-3">
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-mondwest text-display text-base tracking-wide text-midground">
            Subscription limits
          </h2>
          <p className="text-[0.72rem] leading-relaxed text-text-tertiary">
            Live 5h-session and 7-day utilization per Claude sub. This is the plan limit,
            separate from the per-chat context meter in the bottom bar.
          </p>
        </div>

        {error && (
          <p className="rounded-[var(--radius-md)] border border-border px-3 py-2 text-[0.74rem] text-text-tertiary">
            {error}
          </p>
        )}

        {subs.length === 0 && !error ? (
          <p className="px-3 py-6 text-center text-[0.8rem] text-text-tertiary">
            Loading subs...
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {subs.map((s) => (
              <SubCard key={s.uuid8} sub={s} />
            ))}
          </div>
        )}
      </section>

      {connections.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="font-mondwest text-display text-base tracking-wide text-midground">
              Connections
            </h2>
            <p className="text-[0.72rem] leading-relaxed text-text-tertiary">
              Other OAuth agents wired to this box. These plans expose no usage
              API, so it is connection status only — no burn meter.
            </p>
          </div>
          <div className="flex flex-col gap-2.5">
            {connections.map((c) => (
              <ConnCard key={c.id} conn={c} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
