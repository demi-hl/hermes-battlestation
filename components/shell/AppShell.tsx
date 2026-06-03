"use client";

import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
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
import { haptic } from "./haptics";

/** Layout heights consumed by the pane padding + chrome. */
const SHELL_VARS = {
  "--app-header-h": "56px",
  "--app-context-h": "40px",
  "--app-tabbar-h": "58px",
} as CSSProperties;

/** iOS spring — snappier than the old ease. */
const PANE_SPRING = { type: "spring" as const, stiffness: 380, damping: 38, mass: 0.8 };

const PANE_VARIANTS = {
  enter: (dir: number) => ({ x: dir > 0 ? 24 : -24, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -24 : 24, opacity: 0 }),
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
  const scrollRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const goTab = useCallback(
    (id: TabId) => {
      setActiveTab((prev) => {
        // Double-tap: scroll to top
        if (id === prev) {
          haptic(6);
          const el = scrollRefs.current[id];
          el?.scrollTo({ top: 0, behavior: "smooth" });
          return prev;
        }
        setDir(TAB_ORDER.indexOf(id) >= TAB_ORDER.indexOf(prev) ? 1 : -1);
        return id;
      });
    },
    [],
  );

  // Panes except Chat have a minimal tap-at-bottom area — Chat has its own
  // iframe so it gets a padded wrapper instead.
  const ActivePane = getTab(activeTab).Pane;
  const paneContent =
    activeTab === "chat" ? (
      <div
        ref={(el) => {
          scrollRefs.current[activeTab] = el;
        }}
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
      </div>
    ) : (
      <div
        ref={(el) => {
          scrollRefs.current[activeTab] = el;
        }}
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
      </div>
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
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div
            key={activeTab}
            custom={dir}
            variants={PANE_VARIANTS}
            initial="enter"
            animate="center"
            exit="exit"
            transition={PANE_SPRING}
            className="absolute inset-0"
          >
            {paneContent}
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
