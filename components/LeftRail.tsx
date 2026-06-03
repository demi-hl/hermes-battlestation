"use client";

import clsx from "clsx";
import { RepoList } from "./RepoList";
import {
  CockpitIcon,
  ChatIcon,
  ReposIcon,
  PolyIcon,
  FleetIcon,
  CloseIcon,
  MenuIcon,
} from "./Icons";
import type { ReactNode } from "react";

export type View = "cockpit" | "chat" | "repos" | "polymarket" | "fleet";

const NAV: { view: View; label: string; icon: ReactNode }[] = [
  { view: "cockpit", label: "Cockpit", icon: <CockpitIcon /> },
  { view: "chat", label: "Chat", icon: <ChatIcon /> },
  { view: "repos", label: "Repos", icon: <ReposIcon /> },
  { view: "polymarket", label: "Polymarket", icon: <PolyIcon /> },
  { view: "fleet", label: "Fleet", icon: <FleetIcon /> },
];

export function LeftRail({
  activeView,
  onNav,
  collapsed = false,
  onToggleCollapse,
  onClose,
}: {
  activeView: View;
  onNav: (v: View) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onClose?: () => void;
}) {
  return (
    <nav
      className={clsx(
        "flex h-full flex-col border-r border-line bg-surface/50 backdrop-blur-sm",
        collapsed ? "w-[64px]" : "w-[260px]",
      )}
    >
      <div className="flex items-center gap-2.5 px-4 py-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-[15px] font-black text-bg">
          D
        </span>
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div className="text-[14px] font-bold tracking-wide text-ink">DEMI</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-faint">
              workspace
            </div>
          </div>
        )}
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="ml-auto text-faint hover:text-ink lg:hidden"
          >
            <CloseIcon />
          </button>
        )}
        {onToggleCollapse && !onClose && (
          <button
            onClick={onToggleCollapse}
            aria-label="Collapse rail"
            className={clsx(
              "ml-auto text-faint transition-colors hover:text-accent",
              collapsed && "mx-auto ml-0",
            )}
          >
            <MenuIcon width={16} height={16} />
          </button>
        )}
      </div>

      <ul className={clsx("space-y-0.5", collapsed ? "px-2" : "px-2.5")}>
        {NAV.map((n) => {
          const active = activeView === n.view;
          return (
            <li key={n.view}>
              <button
                onClick={() => onNav(n.view)}
                title={n.label}
                className={clsx(
                  "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
                  collapsed && "justify-center px-0",
                  active
                    ? "bg-accent-soft text-accent"
                    : "text-ink-dim hover:bg-surface-2 hover:text-ink",
                )}
              >
                <span className={active ? "text-accent" : "text-muted"}>{n.icon}</span>
                {!collapsed && <span className="font-medium">{n.label}</span>}
                {!collapsed && active && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {!collapsed && (
        <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-line px-2.5 pt-3 pb-3">
          <RepoList />
        </div>
      )}
    </nav>
  );
}
