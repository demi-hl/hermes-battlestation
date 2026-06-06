"use client";

import { useCallback, useState } from "react";
import clsx from "clsx";
import { LeftRail, type View } from "./LeftRail";
import { ChatPane } from "./ChatPane";
import { MenuIcon } from "./Icons";
import { PolymarketPanel } from "./panels/PolymarketPanel";
import { FleetPanel } from "./panels/FleetPanel";
import { ActiveBuildsPanel } from "./panels/ActiveBuildsPanel";
import { DecisionLogPanel } from "./panels/DecisionLogPanel";
import { CaptureInboxPanel } from "./panels/CaptureInboxPanel";
import { CronPanel } from "./panels/CronPanel";

function focusEl(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.setAttribute("data-focus", "true");
  window.setTimeout(() => el.removeAttribute("data-focus"), 1400);
}

export function Shell() {
  const [view, setView] = useState<View>("cockpit");
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const nav = useCallback((v: View) => {
    setView(v);
    const isMobile =
      typeof window !== "undefined" && window.innerWidth < 1024;
    if (v === "repos") {
      if (isMobile) {
        setDrawer(true);
      } else {
        setCollapsed(false);
        requestAnimationFrame(() => focusEl("leftrail-repos"));
      }
      return;
    }
    setDrawer(false);
    requestAnimationFrame(() => {
      if (v === "polymarket") focusEl("panel-polymarket");
      else if (v === "fleet") focusEl("panel-fleet");
    });
  }, []);

  const chatOnly = view === "chat";

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* mobile top bar */}
      <header className="z-10 flex items-center gap-3 border-b border-line bg-surface/70 px-4 py-3 backdrop-blur-sm lg:hidden">
        <button
          onClick={() => setDrawer(true)}
          aria-label="Open menu"
          className="text-ink-dim hover:text-accent"
        >
          <MenuIcon />
        </button>
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-[12px] font-black text-bg">
          D
        </span>
        <span className="text-[13px] font-bold tracking-wide text-ink">DEMI</span>
        <span className="ml-auto text-[10.5px] uppercase tracking-[0.18em] text-faint">
          {view}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* desktop static rail */}
        <div className="hidden lg:block">
          <LeftRail
            activeView={view}
            onNav={nav}
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed((c) => !c)}
          />
        </div>

        {/* main: chat + right panels */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          <div
            className={clsx(
              "flex flex-col lg:h-auto lg:min-h-0 lg:flex-1",
              chatOnly
                ? "min-h-0 flex-1"
                : "h-[56vh] shrink-0 lg:shrink",
            )}
          >
            <ChatPane />
          </div>

          {!chatOnly && (
            <aside className="flex flex-col gap-3 p-3 lg:w-[400px] lg:shrink-0 lg:overflow-y-auto lg:border-l lg:border-line xl:w-[440px]">
              <PolymarketPanel />
              <FleetPanel />
              <ActiveBuildsPanel />
              <DecisionLogPanel />
              <CaptureInboxPanel />
              <CronPanel />
              <div className="px-1 pb-1 pt-1 text-center font-mono text-[10px] text-faint">
                cockpit polls every 30s · server side reads only
              </div>
            </aside>
          )}
        </main>
      </div>

      {/* mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setDrawer(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[280px] max-w-[82vw] shadow-2xl">
            <LeftRail
              activeView={view}
              onNav={nav}
              onClose={() => setDrawer(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
