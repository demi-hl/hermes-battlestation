# PROJECT.md — Locals Only: the Hermes desktop app, mobile-native and better

> NORTH STAR (simplified, authoritative): Build the Hermes desktop agent app — but for mobile, and
> better. Its source is ON DISK at `/usr/local/lib/hermes-agent/web/src/` (42 components, 17 pages,
> theme system, Backdrop). COPY-ADAPT it; do not reinvent. The win is mobile-native (PWA, gestures,
> sheets, safe-areas, one-thumb reach) + the per-repo agent context. Everything else below (Conductor
> 3-column, full IDE, multi-agent selector) is STRETCH for later waves — do NOT let it block shipping
> a faithful, better-on-mobile Hermes app first.

## What v1 actually is (build THIS, ship it, then extend)
A mobile PWA that IS the Hermes desktop app:
1. **Chat** — the primary surface, matching desktop Hermes exactly: instrumented turns, collapsible
   tool-action rows, the bottom status strip (gateway/agents/cron/model/tokens/session). This is the
   conduit that replaces Telegram. Per-repo sessions (`hermes chat --continue lol-<repo> --source locals-only`).
2. **The desktop control surfaces, mobile-native** — port the real pages (they already talk to the
   Hermes daemon, reuse the APIs): Sessions, Skills, Models, Cron, Channels, Logs, System. Start with
   these 7 live; the other 10 desktop pages stub with a designed "coming soon" + SAY SO.
3. **The Hermes look, ported verbatim** — 8 themes, Backdrop, DS keyframes, Collapse font, Hermes Teal.
4. **Better-than-desktop = the mobile layer** — installable PWA, native gestures, haptics, splash,
   60fps, one-thumb reach. The desktop app can't go in your pocket; this does.

## PUBLIC-READY LATER (forward-compat — design for it now, don't build it yet)
PRIORITY: internal use is the ONLY v1 goal. Public-ready is a nice-to-have that must NEVER block or
degrade the internal build. If a forward-compat constraint below makes the internal app slower, uglier,
or later — DROP IT and hardcode for DEMI. Public is a someday-maybe; the working internal tool is the
job. Follow these ONLY where they're free or near-free (no hardcoded paths is just good hygiene anyway);
the moment any of them costs internal quality or time, skip it and SAY SO in the report.
This ships as DEMI's private tool first, and MIGHT go public later: any Hermes user points it
at their own Hermes daemon and gets the same mobile cockpit. We do NOT build multi-tenancy / auth /
billing now — that's premature. We DO avoid the single-user assumptions that would make it a rewrite
later. The discipline (cheap now, expensive to retrofit):
- **No hardcoded identity.** Never bake in "demi-hl", "/home/demi", the Tailscale hostname, wallet
  addresses, or DEMI's repo names. Derive everything at runtime: user from `gh api user`, home from
  `$HOME`/`os.homedir()`, repos by scanning configured roots, daemon URL from config/env. The repo
  list, the team header, paths — all discovered, never literal.
- **Config-driven, not constant-driven.** One config surface (env or a config file) holds: Hermes
  daemon URL, scan roots, fleet node list, default model. A new user changes config, not code. No
  magic paths sprinkled through components.
- **The app is a CLIENT to a Hermes daemon, not coupled to one box.** It already talks to Hermes over
  HTTP/WS — keep that boundary clean. Anyone's daemon (their PC, their Tailscale) is a valid backend.
  Don't reach around the daemon API to touch DEMI's specific filesystem/processes directly.
- **Auth seam, stubbed.** v1 trusts the tailnet (single user, no login). But put the trust check
  behind ONE seam (a middleware / a `getUser()` that today returns the local user) so adding real
  auth later is swapping that one function, not threading sessions through every route. Don't scatter
  "it's always DEMI" assumptions past that seam.
- **Secrets never client-side.** Tokens (`gh`, OAuth, wallet) stay server-side on the daemon host and
  are used by API routes — never shipped to the PWA bundle. This is required for single-user security
  AND mandatory before public. Get it right once.
- **Brand seam.** "Locals Only" + Nous girl is DEMI's skin. Keep brand assets/copy in one place
  (a theme/brand config) so a public build could reskin without touching logic. Low priority, but
  don't hardcode the wordmark into 30 components.
Mark in the verification report which surfaces are still single-user-coupled so the public-readiness
gap is known, not discovered later. Architecture target = "multi-user-ready, single-user-deployed."

## Stretch (later waves — NOT v1, do not block on these)

## The one-line vision
**Locals Only is what you get if a mobile IDE superset and the Hermes desktop app had a baby.**
It does everything a desktop IDE does (edit, run, debug, git, terminal, review), AND everything the
Hermes desktop control plane does (route models, manage cron, channels, sessions, skills, plugins,
MCP, config, providers, analytics, logs), AND the agent-native layer on top (agent is a first-class
editor/operator; N agents build across the fleet while you steer). From your phone. One app. You
control EVERYTHING from here — code and the entire Hermes runtime — not a subset of either.

The bar: Cursor + Conductor + the full Hermes desktop dashboard + Linear's iOS polish, fused into
one PWA with a Hermes agent wired into every surface. If a pane feels like "a website in a frame,"
or if there's a desktop-Hermes control you CAN'T reach from the phone, it's not done.

## The fusion: full Hermes desktop control plane, mobile-native (THE other half)
This is not just an IDE — it is the COMPLETE Hermes desktop app, controllable from mobile. The
desktop dashboard (`/usr/local/lib/hermes-agent/web/src/pages/`) exposes 17 control surfaces; Locals
Only must reach ALL of them (port the real backend calls — these pages already talk to the Hermes
daemon, reuse those APIs, do not rebuild the control logic):
- **Models** — model routing + the model picker (default Opus 4.8), per-session model switch.
- **Providers** — provider config (defaults to anthropic, configurable via env).
- **Cron** — list/create/pause/run scheduled jobs (port ScheduleBuilder). Control automations from the phone.
- **Channels** — gateway/platform wiring (Telegram, etc.) — manage the very conduits this app replaces.
- **Sessions** — browse/resume/search all agent sessions (this is also where per-repo threads live).
- **Skills / Plugins / Bundles** — list, load, run, install, vet — the agent console layer.
- **MCP** — connected MCP servers + their tools.
- **Config / Env** — edit runtime config + env (AutoField-driven forms; guard secrets).
- **Webhooks / Pairing** — event subscriptions + device pairing.
- **Profiles** — switch Hermes profiles.
- **Analytics / Logs / System** — usage, live logs, system health + the SystemActions (restart, etc.).
- **Docs** — in-app Hermes docs.
Implementation note: these desktop pages are React talking to the Hermes daemon over its existing API.
The mobile app reuses those endpoints — it is a mobile FRONT-END to the same daemon, not a reimplementation.
Surface them as either dedicated tabs or a "Hermes" control section reachable from the command palette;
do not bury them. v1 may ship the highest-value ones live (Models, Cron, Channels, Sessions, Skills,
Logs, System) and stub the rest with a designed "coming soon" + SAY SO — but the ARCHITECTURE must treat
"full desktop control plane on mobile" as the target, not an afterthought.

## Why "superset," not "subset" (resolve the old tension)
The v2 brief argued a touch keyboard makes 500-line editing pointless, so it scoped DOWN to a
cockpit. That was the wrong ceiling. The resolution:
- **You rarely hand-type 500 lines — the agent does.** So the editor is not the bottleneck a
  desktop IDE makes it. The mobile constraint disappears when the agent is the primary author.
- **A superset = IDE baseline + agent layer.** Full CodeMirror editing, real terminal, real git,
  real debugger surface WHEN you want them — plus agent-native flows (describe → agent edits →
  you review the diff → ship) that a desktop IDE doesn't have natively.
- So we do NOT cripple any IDE capability. We ADD the agent as the force multiplier on top.

## The four pillars (what makes it a superset)

### 1. Agent is a first-class editor, not a chat sidebar
- From any file/diff, invoke the agent inline: "refactor this," "fix this type error," "add tests."
  The agent edits the file in the active repo's session; you get a diff to review + accept/reject.
- Multi-file agent edits land as a reviewable changeset (like Cursor's composer), not a wall of chat.
- The Chat pane and the Editor are the SAME context — talking about a file and editing it are one flow.

### 2. Full IDE surfaces, touch-native (no capability removed)
- **Editor:** CodeMirror 6, real syntax/LSP-lite, multi-file tabs, find/replace, go-to-symbol.
  Touch-native gestures (swipe between open files, long-press for actions). Save round-trips to disk.
- **Terminal:** xterm.js over PTY, full shell, persistent per-repo cwd. Run builds, watch output.
- **Git/Diff:** stage/unstage/commit/push from mobile, inline diff review, branch switching.
- **Debug surface:** at minimum render running processes + logs; stretch = attach to node --inspect /
  debugpy (skills exist: node-inspect-debugger, python-debugpy). v1 may stub with "coming soon" + SAY SO.
- **Command palette (Cmd-K style):** fuzzy jump to any file, repo, command, skill, pane. The Raycast bar.

### 3. One isolated agent context PER REPO (the killer feature)
Each repo = its own persistent Hermes session, cwd-bound, resumable. Switching repos = switching the
entire IDE context (editor tree, terminal cwd, chat thread, git scope) atomically. This is the thing
no desktop IDE does cleanly and no chat app does at all. (Mechanics unchanged from v2 brief §architecture:
`hermes chat --continue lol-<repo> --source locals-only`, cwd=repo path.)

### 4. Fleet + agent orchestration is IN the IDE
The Fleet pane + team-of-agents board (slice 4) means you watch your fleet build FROM the IDE —
spawn agents, watch them work across PC/PC2/Mac, review their branches, merge. The IDE is also
mission control. A desktop IDE has none of this.

## What "better than the desktop app" means concretely
- **Faster to intent.** Command palette + agent invocation = fewer taps than a desktop IDE's menus.
- **Always with you.** It's a PWA on the home screen, reachable over Tailscale. The desktop app isn't.
- **Agent-parallel.** Desktop IDE = one you editing one file. This = N agents editing N repos while
  you review. The fleet board makes that legible.
- **Themed + alive.** The 8 Hermes themes + signature Backdrop/keyframes — it looks like a flagship,
  not a tool. (Brand/theme/motion specs unchanged from v2 brief — follow them verbatim.)

## Non-negotiables (inherited, still binding)
- Brand = Nous girl icon + blackletter "locals only" / "hermes agent" lockup. Hermes Teal default.
- The 8 desktop themes ported verbatim. Collapse/Nous fonts self-hosted. Backdrop + DS keyframes.
- Premium feel = Linear/Raycast/Cursor bar. 60fps. Native gestures, haptics, skeletons, splash.
- Default model claude-opus-4-8 (provider configurable). Context bar pinned bottom.
- Standalone dir, survives `hermes update`. No em/en dashes in copy. Real data, never fabricated.
- Honest stubs: any IDE surface not finished ships a designed "coming soon" state and is named as
  such in the verification report. Do NOT fake a working debugger/LSP.

## How this changes the slices (delta from v2 brief)
- **Editor slice:** elevate from "read + light-edit" to full IDE editor — multi-file tabs, find/replace,
  agent-inline-edit hook, command palette. Stretch: LSP-lite diagnostics.
- **New cross-cutting:** a **Cmd-K command palette** (fuzzy: files/repos/commands/skills/panes) — owned
  by the polish slice, wired by all.
- **New cross-cutting:** **agent-inline-edit** — invoke agent on a file/selection, get a reviewable diff.
  Owned by the chat slice (it owns the session), surfaced in the editor slice.
- **Diff slice:** elevate from read-only to stage/commit/push.
- Everything else (Repos, Terminal, Fleet+board, Kanban, Tasks&PRs, Automations, Skills, PWA, theme,
  motion, brand) stands as specified in the v2 brief — this doc raises the IDE ceiling, it does not
  rescope those panes.

## THE SUPERSET REFERENCE (Conductor — this is the all-in-one target, build THIS on mobile)
DEMI shared the Conductor desktop layout as the definitive superset reference. The mobile app is this,
all-in-one, on the phone. Three-column desktop layout that COLLAPSES into mobile tabs/sheets:

**LEFT RAIL — workspaces + repos (Conductor-exact):**
- Team header from the authed GitHub user (real `gh api user --jq .login`).
- Nav: Workspaces · Automations · Tasks & PRs · + New Workspace.
- Repo list, each repo a row with an active-workspace count badge — derive from
  the configured project/agent git roots under $HOME, do NOT hardcode.
- Each repo EXPANDS into its branch-workspaces: branch name (feat/video-clip-system, main, etc.) +
  REAL `+adds −dels` diff stats per branch (git --numstat) + type icon. Active workspace highlighted.
- Selecting a workspace sets the ENTIRE app context (chat thread + files + changes + terminal cwd) atomically.

**CENTER — multi-agent chat (the IDE+agent fusion):**
- **Agent selector tabs: Claude · Codex · Copilot** + a "Set Run ⌘G" affordance. The center pane runs the
  chosen agent CLI for the active workspace. (DEMI's stack: Claude Code primary; Codex/Copilot via the
  claude-code/codex/opencode skills. v1 may ship Claude live + stub Codex/Copilot tabs, SAY SO.)
- Chat is instrumented: collapsible tool-action rows, "Sautéed for 7m 5s · 1 shell still running" style
  status lines, background-workflow notices ("Running in background · /workflows to monitor"), "ultracode"
  badge bottom-right of the composer.
- The agent edits the active workspace's files directly; you review in the right column.

**RIGHT — Files / Changes / Review explorer:**
- Tabs: **Files** (file tree of the active workspace) · **Changes** (count badge, the live diff) · **Review**.
- File tree mirrors the active repo. Tapping a file opens it in the editor. Changes tab = the git diff
  to review/stage/commit. Review tab = PR-style review surface.

**BOTTOM STRIP — agent/run instrument panel:**
- Left: `⚡ auto mode on · 1 shell · → for agents · ↓ to manage`.
- The live multi-agent WORKFLOW readout: `bajafish-full-sweep · Multi-agent review ... · 65/66 agents
  done · 9m 32s · 2.3k tokens` with a progress sense. THIS is where the team-of-agents board ties in —
  the bottom strip shows the running workflow, tapping it opens the full Fleet board (slice 4).

**Mobile collapse:** the three columns become: left rail = a slide-in workspace drawer; center chat =
the primary surface; right explorer = a swipe-in panel / Changes sheet. Bottom strip = the pinned
context+workflow bar. Everything reachable in ≤2 taps. Cmd-K palette jumps anywhere.

This Conductor layout + the full Hermes control plane (the 17 desktop pages, above) + the IDE surfaces
= the all-in-one. One app, the phone, controls code AND the entire Hermes/agent runtime.

## DESKTOP HERMES REFERENCE (the chat aesthetic to match — the second screenshot)
DEMI shared a live screenshot of the Hermes desktop agent. The mobile app should feel like its
mobile-native descendant. The real desktop layout:
- **Left sidebar (collapsible):** top search icon; "New session" (+ shortcut chip); "Skills & Tools";
  "Messaging"; "Artifacts"; a "Search sessions..." field; a **PINNED** section; a **SESSIONS** list
  (count badge like "1/2"). Muted gray labels, tiny icons, very low-chrome.
- **Top bar:** active session title with a dropdown chevron ("Duplicate Hermes app permissions entry"),
  right-side icon cluster (audio, settings gear, layout toggle).
- **Chat column (centered, generous margins):** user turns in subtle dark rounded pills; assistant text
  plain on background; inline code as light chips; **collapsible "Tool actions · N steps" rows** with
  faint timing ("6.8s"); a "Thinking" label before reasoning. Markdown-rich, instrumented, calm.
- **Bottom input:** a rounded "Send follow-up" pill, "+" affordance left, mic + stop/send button right.
- **THE SIGNATURE — bottom status strip (port this concept as the mobile context bar):** a single thin
  full-width strip, left→right:
  `⌘ · "Gateway ready" (signal dot) · "Agents N running" · "Cron"` ... then right-aligned:
  `Running 0:56 · 97.7k/1.0M (token meter bar) · 10% · Session 2:03:09 · claude-opus-4-8 · v0.15.1 (+21) · <commit hash>`.
  This is the live instrument panel: gateway health, running-agent count, cron, elapsed run timer,
  token-window meter with %, session duration, active model+provider, version, git sha. The mobile
  context bar (pinned bottom, above tab bar) must surface the mobile-relevant subset of these — active
  repo/branch, model+provider, token meter, agent count, gateway/session status dot — in the SAME
  dense, tabular-mono, low-chrome treatment. This strip is "the Hermes look" as much as the Backdrop.
- **Aesthetic:** near-black teal-tinted ground (Hermes Teal #041c1c), extremely minimal, high info
  density, muted grays, thin weights, mono numerics. Premium through restraint, not ornament.
Match this on mobile, then ADD the IDE + control-plane surfaces the desktop app reaches via its sidebar.

## Acceptance addendum (on top of v2 gate)
- Command palette opens, fuzzy-jumps to a file and a pane (real).
- Agent-inline-edit: invoke on one real file, agent produces a diff, accept writes to disk (one repo
  end-to-end is enough for v1 — SAY SO if only one is wired).
- Editor opens 2+ files as tabs and switches between them.
- Everything in the v2 brief's 10-point gate still holds.
