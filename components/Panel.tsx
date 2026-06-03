"use client";

import type { ReactNode } from "react";
import clsx from "clsx";
import { RefreshIcon } from "./Icons";
import { relativeTime } from "@/lib/format";

export function StatusDot({
  tone,
  pulse,
}: {
  tone: "up" | "down" | "warn" | "idle";
  pulse?: boolean;
}) {
  const color =
    tone === "up"
      ? "bg-up"
      : tone === "down"
        ? "bg-down"
        : tone === "warn"
          ? "bg-warn"
          : "bg-faint";
  return (
    <span className="relative inline-flex h-2 w-2">
      {pulse && tone === "up" && (
        <span
          className={clsx(
            "absolute inline-flex h-full w-full rounded-full opacity-60",
            color,
            "animate-ping",
          )}
        />
      )}
      <span className={clsx("relative inline-flex h-2 w-2 rounded-full", color)} />
    </span>
  );
}

export function Panel({
  id,
  title,
  icon,
  badge,
  updatedAt,
  onReload,
  children,
  className,
}: {
  id?: string;
  title: string;
  icon?: ReactNode;
  badge?: ReactNode;
  updatedAt?: string | null;
  onReload?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={clsx(
        "relative z-[1] rounded-xl border border-line bg-surface/70 backdrop-blur-sm",
        "shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset]",
        className,
      )}
    >
      <header className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        {icon && <span className="text-accent/90">{icon}</span>}
        <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.13em] text-ink-dim">
          {title}
        </h2>
        <div className="ml-auto flex items-center gap-2">
          {badge}
          {onReload && (
            <button
              onClick={onReload}
              aria-label="Refresh"
              className="text-faint transition-colors hover:text-accent"
            >
              <RefreshIcon />
            </button>
          )}
        </div>
      </header>
      <div className="px-3.5 py-3">{children}</div>
      {updatedAt && (
        <div className="px-3.5 pb-2.5 text-[10.5px] font-mono text-faint">
          updated {relativeTime(updatedAt)}
        </div>
      )}
    </section>
  );
}
