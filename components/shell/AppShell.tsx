"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { animate, motion, useMotionValue } from "framer-motion";
import { AppHeader } from "./AppHeader";
import { ContextBar } from "./ContextBar";
import { BottomTabBar } from "./BottomTabBar";
import { Splash } from "./Splash";
import {
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
 * The mobile app shell. The middle region is a finger-tracked horizontal pager
 * over the primary tabs: during a horizontal drag the active pane follows your
 * thumb 1:1, the neighbouring pane peeks in from the side, and on release we
 * commit or snap back based on distance + fling velocity — the same model as
 * the Claude / Codex iOS apps. Secondary tabs (reached via More) are not in the
 * swipe ring, so landing on one just renders without a neighbour.
 */
export function AppShell() {
  const [activeTab, setActiveTab] = useState<TabId>(DEFAULT_TAB_ID);
  const scrollRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Pager geometry + live drag transform.
  const trackRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(0);
  const x = useMotionValue(0);

  // The neighbour we reveal during an in-flight drag (null = none mounted).
  const [neighbor, setNeighbor] = useState<{ id: TabId; side: 1 | -1 } | null>(
    null,
  );

  useEffect(() => {
    const measure = () => {
      widthRef.current = trackRef.current?.clientWidth ?? window.innerWidth;
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const primaryIndex = PRIMARY_TAB_IDS.indexOf(activeTab);

  const commitTo = useCallback(
    (id: TabId) => {
      const width = widthRef.current || window.innerWidth;
      const toIndex = PRIMARY_TAB_IDS.indexOf(id);
      const side = toIndex > primaryIndex ? 1 : -1;
      // Animate the current pane fully off, then swap state and reset.
      animate(x, -side * width, {
        ...SNAP_SPRING,
        onComplete: () => {
          setActiveTab(id);
          setNeighbor(null);
          x.set(0);
        },
      });
    },
    [primaryIndex, x],
  );

  const goTab = useCallback(
    (id: TabId) => {
      if (id === activeTab) {
        // Double-tap on the live tab: scroll its pane to top.
        haptic(6);
        scrollRefs.current[id]?.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      // Tab-bar taps are instant (no pager animation) — matches the native
      // tab bar, where only swipes animate laterally.
      setNeighbor(null);
      x.set(0);
      setActiveTab(id);
    },
    [activeTab, x],
  );

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

  const renderPane = (id: TabId) => {
    const Pane = getTab(id).Pane;
    return (
      <div
        ref={(el) => {
          scrollRefs.current[id] = el;
        }}
        className="absolute inset-0 overflow-y-auto overscroll-contain"
        style={{
          paddingTop: "calc(var(--app-header-h) + env(safe-area-inset-top) + 6px)",
          paddingBottom:
            "calc(var(--app-context-h) + var(--app-tabbar-h) + env(safe-area-inset-bottom) + 8px)",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <Pane />
      </div>
    );
  };

  return (
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
