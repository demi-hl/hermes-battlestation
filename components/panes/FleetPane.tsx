"use client";

import { motion } from "framer-motion";
import { FleetHealthStrip } from "./fleet/FleetHealthStrip";
import { VersionsCard } from "./fleet/VersionsCard";

/** Fleet pane: live fleet health, Polymarket PM2 panel, and toolchain version
 *  manager (Claude Code / Hermes update across boxes). No mock data. */
export function FleetPane() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col gap-4 pt-1"
    >
      <FleetHealthStrip />
      <div className="mx-3 border-t border-border/60" />
      <VersionsCard />
    </motion.div>
  );
}