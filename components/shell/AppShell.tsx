"use client";

import type React from "react";
import { useCallback, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AppHeader } from "./AppHeader";
import { ContextBar } from "./ContextBar";
import { BottomTabBar } from "./BottomTabBar";
import { Splash } from "./Splash";
import {
  TABS,
  getTab,
  PRIMARY_TAB_IDS,
  DEFAULT_TAB_ID,
  type TabId,
} from "./tabs";

/** Layout heights consumed by the pane padding + chrome. */
const SHELL_VARS = {
  "--app-header-h": "56px",
  "--app-context-h": "40px",
  "--app-tabbar-h": "58px",
} as CSSProperties;

const PANE_VARIANTS = {
  enter: (dir: number) => ({ x: dir > 0 ? 26 : -26, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -26 : 26, opacity: 0 }),
};

const TAB_ORDER = TABS.map((t) => t.id);

/**
 * The mobile app shell: frosted header on top, the active pane in the middle
 * (cross-fade / slide on change), and the bottom context bar + tab bar pinned
 * below. Horizontal swipe cycles the primary tabs; the gesture is passive
 * (no preventDefault) so native vertical momentum scroll inside panes is
 * untouched.
 */
export function AppShell() {
  const [activeTab, setActiveTab] = useState<TabId>(DEFAULT_TAB_ID);
  const [dir, setDir] = useState(1);

  const goTab = useCallback(
    (id: TabId) => {
      setActiveTab((prev) => {
        if (id === prev) return prev;
        setDir(TAB_ORDER.indexOf(id) >= TAB_ORDER.indexOf(prev) ? 1 : -1);
        return id;
      });
    },
    [],
  );

  // Passive swipe across the primary tabs.
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const p = e.touches[0];
    touch.current = { x: p.clientX, y: p.clientY, t: Date.now() };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const p = e.changedTouches[0];
    const dx = p.clientX - start.x;
    const dy = p.clientY - start.y;
    const dt = Date.now() - start.t;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.4 || dt > 600)
      return;
    const i = PRIMARY_TAB_IDS.indexOf(activeTab);
    if (i === -1) return; // swipe only cycles primary tabs
    const next = PRIMARY_TAB_IDS[i + (dx < 0 ? 1 : -1)];
    if (next) goTab(next);
  };

  const ActivePane = getTab(activeTab).Pane;

  return (
    <div
      className="relative mx-auto h-[100dvh] w-full max-w-[560px] overflow-hidden"
      style={SHELL_VARS}
    >
      <AppHeader />

      <main
        className="absolute inset-0 overflow-hidden"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <AnimatePresence initial={false} custom={dir}>
          <motion.div
            key={activeTab}
            custom={dir}
            variants={PANE_VARIANTS}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0 overflow-y-auto overscroll-contain"
            style={{
              paddingTop:
                "calc(var(--app-header-h) + env(safe-area-inset-top) + 6px)",
              paddingBottom:
                "calc(var(--app-context-h) + var(--app-tabbar-h) + env(safe-area-inset-bottom) + 8px)",
              WebkitOverflowScrolling: "touch",
            }}
          >
            <ActivePane />
          </motion.div>
        </AnimatePresence>
      </main>

      <div className="absolute inset-x-0 bottom-0 z-30">
        <ContextBar />
        <BottomTabBar activeTab={activeTab} onSelect={goTab} />
      </div>

      <Splash />
    </div>
  );
}
