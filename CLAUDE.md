# Hermes Battlestation — project context

One Next.js codebase shipping three surfaces: a downloadable **desktop app** (Electron
standalone server), a **mobile PWA** (Capacitor), and a **Hermes dashboard**. A god-mode
multi-pane Control Center with the Hermes agent as the spine.

Repo: `demi-hl/hermes-battlestation`. App name: **Hermes Battlestation**.

## Architecture

- **One Next.js app**, three delivery targets from the same `app/` tree.
- **Desktop**: `electron/main.cjs` boots the bundled `.next/standalone` server as a child
  process, then loads it in a BrowserWindow, and spawns a local `hermes` process. Window is
  gated on `ready-to-show` (no white launch flash); Linux uses `frame:true`.
- **Mobile**: `components/shell/AppShell.tsx` splits on `useMediaQuery("(min-width:1024px)")`
  — desktop → `ide/IDEShell.tsx` (sidebar + panes), mobile → finger-tracked swipe pager +
  `BottomTabBar`. PWA manifest at `public/manifest.webmanifest` + `public/sw.js`.
- **Background**: the "alive" `components/shell/Backdrop.tsx` (filler-bg WebP + warm-glow
  vignette, per-theme difference blend) is mounted in `app/layout.tsx`. Do NOT paint an
  opaque background over it in IDEShell — that regression hid it once.

## Panes / API routes

Each pane in `components/panes/*Pane.tsx` is backed by an `app/api/<name>/route.ts`. Panes
poll via `components/usePolling.ts` (tolerates both `{data,fetchedAt}` envelope and bare
payload). Live panes: Sessions, Cron, Skills, Config, API Keys, Analytics, MCP, OpenRouter,
Fleet, Kanban, Tasks/PRs, Obsidian, Editor, Terminal, Diff.

## Hard rules

- **Billing-safe**: the apply-pipeline must NEVER touch `config.yaml`'s `model` block (would
  reroute the flat-rate Max sub to metered OpenRouter). It writes its own
  `battlestation-pipeline.json`.
- **Secrets**: `.env*.local` + `~/.hermes/.env` are gitignored; only `.env.example` (blank
  template) is tracked. Personal runtime config lives OUTSIDE git and is loaded at runtime by
  `electron/main.cjs` (`loadUserEnv()` runs first, real env wins). Secret-scan before every
  commit. No OAuth/Max tells in code.
- **Fleet → Agents**: PC1 is the first-class agent node; CCMB/PC2/VPS are peer fleet nodes.
  Fleet telemetry is read-only via `sshReadOnly()`.
- **No fabricated data**: ground OpenRouter free-models live; exclude meta-routers
  (`~author/`, `openrouter/auto`, `-1` pricing) from stage-picks.

## Build

- `npm run build` → Next production build.
- `node scripts/prepare-standalone.cjs` → bundles next-server runtime + node-pty + static +
  public into `.next/standalone`. REQUIRED before packaging — Turbopack drops app-route
  runtime files otherwise (the packaging trap).
- `npm run dist:linux` → AppImage + deb. macOS DMG / Windows NSIS can only build on their own
  OS via `.github/workflows/release.yml` on a `v*` tag.
- **Verify packaging against the BUNDLED standalone server, not the source server** — it's the
  only way to catch the dropped-runtime trap. Boot `.next/standalone/server.js` and curl the
  API routes.

## Conventions

See the repo `AGENTS.md` (Hermes) for TypeScript style: nanostores for shared state,
`useStore` in components, thin route roots, table-driven mapping, interfaces for public props.
