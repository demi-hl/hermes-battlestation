"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useMediaQuery } from "@/components/useMediaQuery";
import { AppHeader } from "./AppHeader";
import { ContextBar } from "./ContextBar";
import { BottomTabBar } from "./BottomTabBar";
import { Splash } from "./Splash";
import {
  getTab,
  PRIMARY_TABS,
  SECONDARY_TABS,
  DEFAULT_TAB_ID,
  type TabDef,
  type TabId,
} from "./tabs";
import { haptic } from "./haptics";
import { cn } from "@/lib/utils";
import { IDEShell } from "./ide/IDEShell";
import { SessionReader } from "./SessionReader";

/** Layout heights consumed by the pane padding + chrome. The context bar is
 *  TWO rows (the h-10 model/meter row + the always-visible profile/sessions
 *  row), ~66px total — reserving only the top row let pane content slide under
 *  the bar (audit P1). */
const SHELL_VARS = {
  "--app-header-h": "12px",
  "--app-context-h": "66px",
  "--app-tabbar-h": "54px",
} as CSSProperties;

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
 * active pane with a bottom tab bar (tap-to-switch; no swipe pager yet — see
 * the "MOBILE LAYOUT" note below). On wide screens renders a left sidebar nav
 * + full-width pane, with keyboard shortcuts (Cmd+1–9, Cmd+0 for the last tab).
 */
export function AppShell() {
  const [activeTab, setActiveTab] = useState<TabId>(DEFAULT_TAB_ID);
  const scrollRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // Cross-tab navigation bus (Tasks home → Chat, etc.). Fired via a window
  // CustomEvent so panes never need the shell store wired in. Same pattern as
  // the `lo-compress` action in workspace-context.
  useEffect(() => {
    const onNav = (e: Event) => {
      const id = (e as CustomEvent<{ tab?: TabId }>).detail?.tab;
      if (id) setActiveTab(id);
    };
    window.addEventListener("lo-nav", onNav as EventListener);
    return () => window.removeEventListener("lo-nav", onNav as EventListener);
  }, []);

  // Push deep-link: the service worker posts `lo-push-open` with a threadId when
  // a notification is tapped. Switch to chat and hand the thread id to ChatHub
  // via the existing `lo-open-session` bus. Also honor a `?thread=` cold-open.
  useEffect(() => {
    const openThread = (threadId?: string) => {
      if (!threadId) return;
      setActiveTab("chat");
      window.dispatchEvent(
        new CustomEvent("lo-open-session", { detail: { threadId } }),
      );
    };
    const onSwMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; threadId?: string } | undefined;
      if (data?.type === "lo-push-open") openThread(data.threadId);
    };
    navigator.serviceWorker?.addEventListener("message", onSwMessage);
    // Cold open via deep-link URL (?thread=<id>).
    const url = new URL(window.location.href);
    const t = url.searchParams.get("thread");
    if (t) {
      openThread(t);
      url.searchParams.delete("thread");
      window.history.replaceState({}, "", url.toString());
    }
    return () =>
      navigator.serviceWorker?.removeEventListener("message", onSwMessage);
  }, []);

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
      // A tab tap always leaves the SessionReader (it overlays the active pane
      // but keeps the chrome visible, so its taps must dismiss the reader).
      window.dispatchEvent(new CustomEvent("lo-read-close"));
      if (id === activeTab) {
        scrollRefs.current[id]?.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      setActiveTab(id);
    },
    [activeTab],
  );

  const renderPane = (id: TabId, desktop = false) => {
    const Pane = getTab(id).Pane;
    // Chat owns its own internal scroll + bottom-pinned composer. It only needs
    // to clear the bottom chrome (context bar + tab bar + safe area). The
    // keyboard is handled by the app-shrink in Providers (--app-vh tracks the
    // visible height), so we must NOT also add --keyboard-inset here — that
    // double-counts and floats the composer above the keyboard.
    const isChat = id === "chat";
    const paddingBottom = desktop
      ? "0px"
      : isChat
        ? "calc((var(--app-context-h) + var(--app-tabbar-h) + env(safe-area-inset-bottom)) * (1 - var(--kb-open, 0)))"
        : "calc(var(--app-context-h) + var(--app-tabbar-h) + env(safe-area-inset-bottom) + 8px)";
    return (
      <div
        key={id}
        ref={(el) => {
          scrollRefs.current[id] = el;
        }}
        className="absolute inset-0 overflow-y-auto overscroll-contain"
        style={{
          paddingTop: desktop
            ? "var(--app-header-h)"
            : isChat
              ? "calc(env(safe-area-inset-top) + 6px)"
              : "calc(var(--app-header-h) + env(safe-area-inset-top))",
          paddingBottom,
          WebkitOverflowScrolling: "touch",
          // iOS WKWebView smears composited scroll content (live-session dots,
          // row borders) when momentum-scrolling over the fixed
          // mix-blend-mode:difference Backdrop layers. Isolating the scroller
          // into its own stacking context + GPU layer forces it to repaint
          // independently, killing the smear. No visual change otherwise.
          isolation: "isolate",
          transform: "translateZ(0)",
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
    <>
      <IDEShell />
      <SessionReader />
    </>
  ) : (
    /* ------------------------------------------------
       MOBILE LAYOUT: active pane + bottom tabs (tap to switch).
       NOTE: not a swipe pager — panes change on tab tap only. A finger-tracked
       horizontal pager is a deliberate future feature (gesture conflicts with
       pane scroll + the drag-to-dismiss sheets), not wired here on purpose.
    ------------------------------------------------ */
    <div
      className="relative mx-auto w-full max-w-[560px] overflow-hidden"
      style={{ ...SHELL_VARS, height: "var(--app-vh, 100dvh)" }}
    >
      {activeTab !== "chat" && <AppHeader />}

      <main className="absolute inset-0 overflow-hidden">
        {renderPane(activeTab)}
      </main>

      <div
        className="absolute inset-x-0 bottom-0 z-30 transition-transform duration-200"
        style={{
          transform: "translateY(calc(var(--kb-open, 0) * 100%))",
          willChange: "transform",
          backfaceVisibility: "hidden",
        }}
      >
        <ContextBar />
        <BottomTabBar activeTab={activeTab} onSelect={goTab} />
      </div>

      <Splash />
      <SessionReader />
    </div>
  );
}
