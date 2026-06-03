// Team-of-Agents board fixture. The board renders off THIS so the slice
// verifies standalone — real orchestrator-registry hookup (per-node ps /
// tasklist ground truth) is an integration-phase task. `/api/fleet/agents`
// serves these rows and the UI labels the board source as "fixture".
//
// Timestamps are derived relative to a passed-in `now` so the stale pulse
// (lastSignal > 90s old) and "started Xm ago" are always demonstrable instead
// of frozen at a build-time instant.

import type { FleetAgent } from "./types";

const SEC = 1000;
const MIN = 60 * SEC;

/**
 * Build the fixture roster relative to `now` (epoch ms).
 *
 * Coverage the board needs to exercise every feature:
 *  - all four lanes + the BLOCKED tray,
 *  - all four nodes (PC/PC2/Mac/VPS) and both billing subs,
 *  - a subagent spawn tree (a parent with children → expandable),
 *  - a STALE agent (lastSignal ~2.4m old, the verify-loop deadlock),
 *  - DONE agents carrying a real commit SHA (the only proof of done).
 */
export function buildFleetAgents(now: number): FleetAgent[] {
  return [
    // PC orchestrator with a forked subagent stack (expandable spawn tree).
    {
      id: "pc-a31f",
      objective: "slice 4 fleet board + kanban",
      node: "PC",
      lane: "working",
      billing: "demi-max",
      children: ["pc-a31f-1", "pc-a31f-2"],
      startedAt: now - 14 * MIN,
      lastSignal: now - 7 * SEC,
      signal: "editing AgentBoard.tsx · framer layout",
      diffStat: { adds: 812, dels: 97 },
      branch: "slice/fleet",
    },
    {
      id: "pc-a31f-1",
      objective: "fleet.mock + API routes",
      node: "PC",
      lane: "working",
      billing: "demi-max",
      parentId: "pc-a31f",
      startedAt: now - 11 * MIN,
      lastSignal: now - 4 * SEC,
      signal: "writing /api/fleet/health",
      diffStat: { adds: 210, dels: 4 },
      branch: "slice/fleet",
    },
    {
      id: "pc-a31f-2",
      objective: "fleet types + chips",
      node: "PC",
      lane: "done",
      billing: "demi-max",
      parentId: "pc-a31f",
      startedAt: now - 13 * MIN,
      lastSignal: now - 6 * MIN,
      signal: "committed",
      diffStat: { adds: 180, dels: 2 },
      branch: "slice/fleet",
      commitSha: "a31f2c0",
    },

    // PC verifying — healthy, mid test run.
    {
      id: "pc-7b02",
      objective: "polymarket neg-risk scanner tuning",
      node: "PC",
      lane: "verifying",
      billing: "demi-max",
      startedAt: now - 26 * MIN,
      lastSignal: now - 19 * SEC,
      signal: "npm test · 42/58 passing",
      diffStat: { adds: 233, dels: 54 },
      branch: "feat/neg-risk-v2",
    },

    // PC verifying — STALE: stuck in the verify loop, no signal ~2.4m.
    {
      id: "pc-5e88",
      objective: "agelesshumans portal a11y pass",
      node: "PC",
      lane: "verifying",
      billing: "demi-max",
      startedAt: now - 33 * MIN,
      lastSignal: now - 144 * SEC,
      signal: "awaiting verify loop",
      diffStat: { adds: 121, dels: 40 },
      branch: "fix/a11y-contrast",
    },

    // PC2 (David's Max) working — amber billing attribution.
    {
      id: "pc2-9c44",
      objective: "remotion clip render dispatch",
      node: "PC2",
      lane: "working",
      billing: "david-max",
      startedAt: now - 9 * MIN,
      lastSignal: now - 5 * SEC,
      signal: "rendering shot 12/30",
    },

    // Mac spawned — just booting its session.
    {
      id: "mac-2d10",
      objective: "x-content-generator thread drafts",
      node: "Mac",
      lane: "spawned",
      billing: "demi-max",
      startedAt: now - 22 * SEC,
      lastSignal: now - 3 * SEC,
      signal: "booting session · loading skills",
    },

    // Mac done — real sha.
    {
      id: "mac-8f21",
      objective: "pokemon-card-agent grading sync",
      node: "Mac",
      lane: "done",
      billing: "demi-max",
      startedAt: now - 41 * MIN,
      lastSignal: now - 70 * SEC,
      signal: "committed",
      diffStat: { adds: 147, dels: 23 },
      branch: "feat/grading-sync",
      commitSha: "9f3c1ab",
    },

    // PC done + pushed — real sha.
    {
      id: "pc-1a07",
      objective: "hl-media feed processor fix",
      node: "PC",
      lane: "done",
      billing: "demi-max",
      startedAt: now - 52 * MIN,
      lastSignal: now - 4 * MIN,
      signal: "committed + pushed",
      diffStat: { adds: 38, dels: 12 },
      branch: "fix/feed-dedupe",
      commitSha: "c20be41",
    },

    // VPS — the live Polymarket bot represented as a fleet agent (billing none).
    {
      id: "vps-bot",
      objective: "polymarket arb bot · live",
      node: "VPS",
      lane: "working",
      billing: "none",
      startedAt: now - 6 * 86_400 * SEC,
      lastSignal: now - 4 * SEC,
      signal: "demi-server online · scanning markets",
    },

    // BLOCKED tray — David's box, GPU OOM.
    {
      id: "pc2-3f55",
      objective: "blender scene bake",
      node: "PC2",
      lane: "blocked",
      billing: "david-max",
      startedAt: now - 17 * MIN,
      lastSignal: now - 31 * SEC,
      signal: "BLOCKED: GPU OOM, awaiting retry",
    },

    // BLOCKED tray — merge conflict.
    {
      id: "pc-bb19",
      objective: "BajaFish full sweep merge",
      node: "PC",
      lane: "blocked",
      billing: "demi-max",
      startedAt: now - 28 * MIN,
      lastSignal: now - 200 * SEC,
      signal: "BLOCKED: conflict in package-lock.json",
      branch: "merge/full-sweep",
    },
  ];
}
