# Hermes Battlestation

An alternative launcher for your local [Hermes](https://claude-code.nousresearch.com) agent — a
desktop + mobile cockpit for the agent already running on your machine. Chat, repos, fleet, kanban,
terminal, editor, Obsidian vault — all talking to *your* local install, over your own tailnet.
Nothing is sent to a third party.

> One Next.js codebase ships two ways: a downloadable **desktop app** (Electron, boots its own local
> server) and a **mobile app** (Capacitor, reachable over Tailscale).

## Download

Grab the installer for your OS from the [Releases](../../releases) page:

- **Linux** — `.AppImage` (chmod +x and run) or `.deb`
- **macOS** — `.dmg`
- **Windows** — `.exe` (NSIS installer)

Installers are unsigned, so on first launch you may need to allow them past Gatekeeper (macOS:
right-click → Open) or SmartScreen (Windows: More info → Run anyway).

## First run

The app boots a local server and opens a window. Go to **Settings → Setup** and point it at:

- **Hermes binary** — path or name on PATH (default `hermes`)
- **Repo roots** — absolute dirs it scans for git repos (default `$HOME/projects`, `$HOME/agent`)
- **Obsidian vault** — a git-backed vault path (optional)

It auto-detects whether each is wired and shows a green/amber chip. No env files required.

## What's inside

- **Chat** — live token-streaming chat with your agent (ACP), one session per repo.
- **Repos** — your local git repos, each branch/worktree as a workspace. Create git **worktrees**
  in one tap (New Workspace).
- **Fleet** — your other machines' agents: an HTTP agent-up/down probe plus optional read-only
  GPU/CPU telemetry. SSH is locked to a read-only allowlist — the fleet can never open a remote shell.
- **Obsidian** — a shared, git-backed vault that every agent commits notes into. Shows who's writing
  (commit authors), sync state, and a one-tap pull → commit → push.
- **Kanban · Tasks & PRs · Editor · Terminal · Diff · Automations** — the rest of the cockpit.

## Build from source

```bash
npm install
npm run electron:rebuild   # rebuild native addons (node-pty) for Electron
npm run electron:dev       # build + launch the desktop app

# package installers for the current OS:
npm run dist:linux   # or dist:mac / dist:win
```

Config (all optional — the Setup screen writes these, or use env / `.env.local`): see
[`.env.example`](.env.example).

## Mobile

The same server is wrapped by Capacitor for iOS. Point the native shell at your tailnet host via
`CAP_SERVER_URL` and `npm run cap:build`.

## License

MIT
