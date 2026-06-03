"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  PRIMARY_TABS,
  SECONDARY_TABS,
  type TabDef,
  type TabId,
} from "./tabs";
import { MoreIcon } from "./icons";
import { Sheet } from "./Sheet";
import { haptic } from "./haptics";
import { cn } from "@/lib/utils";

/**
 * Bottom tab bar (mobile nav). Renders the primary tabs plus a "More" entry
 * that opens a sheet for the rest. Active tab uses the theme's midground accent
 * with a shared-layout sliding indicator. Frosted, safe-area aware, haptic on
 * tap.
 */
export function BottomTabBar({
  activeTab,
  onSelect,
}: {
  activeTab: TabId;
  onSelect: (id: TabId) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = SECONDARY_TABS.some((t) => t.id === activeTab);

  const select = (id: TabId) => {
    haptic(10);
    onSelect(id);
  };

  return (
    <nav
      aria-label="Primary"
      className="border-t border-border"
      style={{
        background: "color-mix(in srgb, var(--background-base) 72%, transparent)",
        backdropFilter: "blur(22px) saturate(160%)",
        WebkitBackdropFilter: "blur(22px) saturate(160%)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <ul className="flex h-[58px] items-stretch">
        {PRIMARY_TABS.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            active={activeTab === tab.id}
            onClick={() => select(tab.id)}
          />
        ))}

        <li className="flex-1">
          <button
            type="button"
            aria-label="More tabs"
            aria-expanded={moreOpen}
            onClick={() => {
              haptic(10);
              setMoreOpen(true);
            }}
            className={cn(
              "relative flex h-full w-full flex-col items-center justify-center gap-1 transition-colors",
              moreActive ? "text-midground" : "text-text-tertiary",
            )}
          >
            {moreActive && <ActiveIndicator />}
            <MoreIcon width={21} height={21} />
            <span className="font-mono-ui text-[0.58rem] tracking-wide">
              More
            </span>
          </button>
        </li>
      </ul>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div className="grid grid-cols-3 gap-2 p-1.5">
          {SECONDARY_TABS.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  haptic(10);
                  onSelect(tab.id);
                  setMoreOpen(false);
                }}
                className={cn(
                  "flex aspect-square flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border transition-colors",
                  active
                    ? "border-transparent bg-[color-mix(in_srgb,var(--midground)_12%,transparent)] text-midground"
                    : "border-border text-text-secondary active:bg-[color-mix(in_srgb,var(--midground)_6%,transparent)]",
                )}
              >
                <tab.Icon width={24} height={24} />
                <span className="font-mondwest text-display text-[0.66rem] tracking-wide">
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </Sheet>
    </nav>
  );
}

function TabButton({
  tab,
  active,
  onClick,
}: {
  tab: TabDef;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li className="flex-1">
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        aria-label={tab.label}
        onClick={onClick}
        className={cn(
          "relative flex h-full w-full flex-col items-center justify-center gap-1 transition-colors",
          active ? "text-midground" : "text-text-tertiary",
        )}
      >
        {active && <ActiveIndicator />}
        <motion.span
          animate={{ scale: active ? 1.04 : 1, y: active ? -1 : 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 30 }}
          className="relative z-[1]"
        >
          <tab.Icon width={21} height={21} />
        </motion.span>
        <span className="relative z-[1] font-mono-ui text-[0.58rem] tracking-wide">
          {tab.shortLabel}
        </span>
      </button>
    </li>
  );
}

/** Shared-layout sliding highlight + a top accent tick. */
function ActiveIndicator() {
  return (
    <>
      <motion.span
        layoutId="tab-indicator"
        transition={{ type: "spring", stiffness: 480, damping: 38 }}
        aria-hidden
        className="absolute inset-x-2 top-1.5 bottom-1.5 rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--midground)_10%,transparent)]"
      />
      <motion.span
        layoutId="tab-tick"
        transition={{ type: "spring", stiffness: 480, damping: 38 }}
        aria-hidden
        className="absolute top-0 h-[2px] w-7 rounded-full bg-midground"
        style={{ boxShadow: "0 0 10px var(--midground)" }}
      />
    </>
  );
}
