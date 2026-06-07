"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { animate, motion, useMotionValue } from "framer-motion";
import { useMediaQuery } from "@/components/useMediaQuery";
import { AppHeader } from "./AppHeader";
import { ContextBar } from "./ContextBar";
import { BottomTabBar } from "./BottomTabBar";
import { Splash } from "./Splash";
import {
  getTab,
  PRIMARY_TAB_IDS,
  PRIMARY_TABS,
  SECONDARY_TABS,
  DEFAULT_TAB_ID,
  type TabDef,
  type TabId,
} from "./tabs";
import { haptic } from "./haptics";
import { cn } from "@/lib/utils";
import { IDEShell } from "./ide/IDEShell";

/** Layout heights consumed by the pane padding + chrome. */
const SHELL_VARS = {
  "--app-header-h": "56px",
  "--app-context-h": "40px",
  "--app-tabbar-h": "58px",
} as CSSProperties;

/** Bool media-query hook — shared SSR-safe impl. */


/** iOS-style decel spring for the snap-back / commit. Tuned to feel like the
 *  UIScrollView paging deceleration in Claude/Codex: firm, slightly
 *  overdamped, no visible bounce on commit. */
const SNAP_SPRING = { type: "spring" as const, stiffness: 520, damping: 44, mass: 0.9 };

/** Rubber-band resistance at the ends (no neighbor to reveal). Matches the
 *  iOS overscroll feel — you can pull, but it fights back ~2.5x harder. */
function rubber(dx: number, width: number) {
  const c = 0.55;
  const r = Math.abs(dx);
  return Math.sign(dx) * ((1 - 1 / (r * c / width + 1)) * width);
}

/**
 * Compact desktop sidebar nav. Shows all tabs (primary + secondary) with
 * icons + labels, collapsible to icon-only. Synced to the same activeTab
 * state as the mobile bottom bar.
 */
function DesktopSidebar({
  activeTab,
  onSelect,
}: {
  activeTab: TabId;
  onSelect: (id: TabId) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const allTabs = useMemo(() => [...PRIMARY_TABS, ...SECONDARY_TABS], []);

  return (
    <nav
      className={cn(
        "flex shrink-0 flex-col border-r border-border bg-surface/60 backdrop-blur-sm transition-[width] duration-200",
        collapsed ? "w-[60px]" : "w-[200px]",
      )}
    >
      {/* Brand + collapse toggle */}
      <div className="flex h-[56px] shrink-0 items-center gap-2 border-b border-border px-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/nous-logo.svg"
          alt="Nous"
          draggable={false}
          className="h-[22px] w-auto shrink-0"
        />
        {!collapsed && (
          <span className="ml-auto font-mondwest text-display text-[0.58rem] tracking-[0.22em] text-text-tertiary">
            battlestation
          </span>
        )}
      </div>

      {/* Tab list */}
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2">
        {allTabs.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelect(tab.id)}
              title={tab.label}
              className={cn(
                "flex w-full shrink-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
                collapsed && "justify-center px-0",
                active
                  ? "bg-[color-mix(in_srgb,var(--midground)_10%,transparent)] text-midground"
                  : "text-text-tertiary hover:bg-[color-mix(in_srgb,var(--midground)_5%,transparent)] hover:text-ink",
              )}
            >
              <tab.Icon
                width={18}
                height={18}
                className={cn(active && "text-midground")}
              />
              {!collapsed && (
                <span className="truncate font-medium">{tab.label}</span>
              )}
              {!collapsed && active && (
                <span className="ml-auto h-[4px] w-[4px] shrink-0 rounded-full bg-midground" />
              )}
            </button>
          );
        })}
      </div>

      {/* Collapse toggle at bottom */}
      <button
        type="button"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        onClick={() => setCollapsed((c) => !c)}
        className={cn(
          "flex shrink-0 items-center justify-center border-t border-border py-2.5 text-[10px] text-faint transition-colors hover:text-ink",
          collapsed ? "" : "gap-1",
        )}
      >
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className={cn("transition-transform", collapsed && "rotate-180")}
        >
          <path d="M15 19l-7-7 7-7" />
        </svg>
        {!collapsed && <span>collapse</span>}
      </button>
    </nav>
  );
}

/**
 * The mobile + desktop app shell. On narrow screens (<1024px) renders the
 * finger-tracked horizontal pager with a bottom tab bar. On wide screens
 * renders a left sidebar nav + full-width pane, with keyboard shortcuts
 * (Cmd+1–9, Cmd+0 for the last tab).
 */
export function AppShell() {
  const [activeTab, setActiveTab] = useState<TabId>(DEFAULT_TAB_ID);
  const scrollRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // ---- keyboard shortcuts (desktop only) ----
  useEffect(() => {
    if (!isDesktop) return;
    const ALL_IDS: TabId[] = [
      "chat",
      "repos",
      "editor",
      "terminal",
      "diff",
      "fleet",
      "kanban",
      "prs",
      "automations",
      "settings",
    ];
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (idx < ALL_IDS.length) {
          setActiveTab(ALL_IDS[idx]);
          scrollRefs.current[ALL_IDS[idx]]?.scrollTo({ top: 0, behavior: "smooth" });
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "0") {
        e.preventDefault();
        setActiveTab("settings");
        scrollRefs.current.settings?.scrollTo({ top: 0, behavior: "smooth" });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isDesktop]);

  const goTab = useCallback(
    (id: TabId) => {
      if (id === activeTab) {
        scrollRefs.current[id]?.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      setActiveTab(id);
    },
    [activeTab],
  );

  // ---- pager state (mobile only) ----
  const trackRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(0);
  const x = useMotionValue(0);
  const [neighbor, setNeighbor] = useState<{ id: TabId; side: 1 | -1 } | null>(null);
  const primaryIndex = PRIMARY_TAB_IDS.indexOf(activeTab);

  useEffect(() => {
    const measure = () => {
      widthRef.current = trackRef.current?.clientWidth ?? window.innerWidth;
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // ---- finger-tracked horizontal drag over the primary ring ----
  const drag = useRef<{
    startX: number;
    startY: number;
    t: number;
    axis: "" | "x" | "y";
    lastX: number;
    lastT: number;
    vx: number;
  } | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const p = e.touches[0];
    drag.current = {
      startX: p.clientX,
      startY: p.clientY,
      t: Date.now(),
      axis: "",
      lastX: p.clientX,
      lastT: Date.now(),
      vx: 0,
    };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const d = drag.current;
    if (!d || primaryIndex === -1) return;
    const p = e.touches[0];
    const dx = p.clientX - d.startX;
    const dy = p.clientY - d.startY;

    // Lock the gesture axis on first meaningful movement.
    if (d.axis === "") {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      d.axis = Math.abs(dx) > Math.abs(dy) * 1.25 ? "x" : "y";
      if (d.axis === "x") haptic(4);
    }
    if (d.axis !== "x") return;

    // Track velocity for the fling decision.
    const now = Date.now();
    const dt = now - d.lastT;
    if (dt > 0) d.vx = (p.clientX - d.lastX) / dt; // px/ms
    d.lastX = p.clientX;
    d.lastT = now;

    const width = widthRef.current || window.innerWidth;
    const side: 1 | -1 = dx < 0 ? 1 : -1; // 1 = reveal next, -1 = reveal prev
    const hasNeighbor = !!PRIMARY_TAB_IDS[primaryIndex + side];

    // Mount the neighbour we're pulling toward.
    if (hasNeighbor) {
      const nid = PRIMARY_TAB_IDS[primaryIndex + side];
      if (!neighbor || neighbor.id !== nid) setNeighbor({ id: nid, side });
      x.set(dx);
    } else {
      if (neighbor) setNeighbor(null);
      x.set(rubber(dx, width)); // edge resistance
    }
  };

  const onTouchEnd = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.axis !== "x" || primaryIndex === -1) {
      animate(x, 0, SNAP_SPRING);
      return;
    }
    const width = widthRef.current || window.innerWidth;
    const dx = x.get();
    const side: 1 | -1 = dx < 0 ? 1 : -1;
    const target = PRIMARY_TAB_IDS[primaryIndex + side];

    // Commit if past 38% of the width OR a decisive fling (> 0.45 px/ms).
    const fling = Math.abs(d.vx) > 0.45;
    const past = Math.abs(dx) > width * 0.38;
    if (target && (past || fling)) {
      haptic(10);
      const toIndex = PRIMARY_TAB_IDS.indexOf(target);
      animate(x, -side * width, {
        ...SNAP_SPRING,
        velocity: d.vx * 1000, // px/ms -> px/s
        onComplete: () => {
          setActiveTab(target);
          setNeighbor(null);
          x.set(0);
        },
      });
      void toIndex;
    } else {
      // Snap back home.
      animate(x, 0, { ...SNAP_SPRING, velocity: d.vx * 1000 });
    }
  };

  const renderPane = (id: TabId, desktop = false) => {
    const Pane = getTab(id).Pane;
    return (
      <div
        ref={(el) => {
          scrollRefs.current[id] = el;
        }}
        className="absolute inset-0 overflow-y-auto overscroll-contain"
        style={{
          paddingTop: desktop
            ? "var(--app-header-h)"
            : "calc(var(--app-header-h) + env(safe-area-inset-top) + 6px)",
          paddingBottom: desktop
            ? "0px"
            : "calc(var(--app-context-h) + var(--app-tabbar-h) + env(safe-area-inset-bottom) + 8px)",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <Pane />
      </div>
    );
  };

  return isDesktop ? (
    /* ------------------------------------------------
       DESKTOP LAYOUT: god-mode IDE (rail + agent spine + source panel)
    ------------------------------------------------ */
    <IDEShell />
  ) : (
    /* ------------------------------------------------
       MOBILE LAYOUT: pager + bottom tabs
    ------------------------------------------------ */
    <div
      className="relative mx-auto h-[100dvh] w-full max-w-[560px] overflow-hidden"
      style={SHELL_VARS}
    >
      <AppHeader />

      <main
        ref={trackRef}
        className="absolute inset-0 overflow-hidden"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {/* Active pane — tracks the finger via x. */}
        <motion.div className="absolute inset-0" style={{ x }}>
          {renderPane(activeTab)}
        </motion.div>

        {/* Neighbour peeks in from the dragged side, offset by ±width. */}
        {neighbor && (
          <motion.div
            className="absolute inset-0"
            style={{ x, left: neighbor.side === 1 ? "100%" : "-100%" }}
          >
            {renderPane(neighbor.id)}
          </motion.div>
        )}
      </main>

      <div className="absolute inset-x-0 bottom-0 z-30">
        <ContextBar />
        <BottomTabBar activeTab={activeTab} onSelect={goTab} />
      </div>

      <Splash />
    </div>
  );
}
