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

## Use it from other devices (mirror your setup)

The cockpit is a **thin client to one backend** — the Hermes box where your repos, sessions,
and `~/.hermes` live. Point any device at that box and you get the *same* profiles and sessions,
mirrored everywhere (the way a mail app shows the same inbox on every device). Nothing is copied
or synced — every device reads the one backend live.

**1. Set an access token on the box** (this is what makes it safe to reach over a network):

```bash
# in the app's environment on the box running it:
BATTLESTATION_TOKEN=$(openssl rand -base64 24)
```

With no token set, the app stays loopback-only with no auth (single-machine mode). The moment a
token is set, every device must present it — unauthenticated requests get a `401` (API) or the
**Connect** screen (pages).

**2. Make the box reachable** — pick one:

| Path | Notes |
|---|---|
| **Tailscale** (recommended) | private mesh, encrypted, no ports exposed publicly |
| **LAN** | same wifi; bind the server to your LAN IP |
| **Cloudflare Tunnel / reverse proxy** | public URL — put auth in front; the token is your floor |

**3. Connect from the device** — open the box's URL (or install the app), and the **Connect**
screen asks for your **Remote URL** + **Access token**. Enter them once; you're in.

### Install on a phone (no developer account, no App Store)

The app is a **PWA** — the zero-friction path for everyone:

1. Open your box's URL in Safari (iOS) or Chrome (Android).
2. Enter your token on the Connect screen.
3. **Share → Add to Home Screen.** It launches fullscreen with an icon, like a native app.

No Xcode, no `$99` developer account, no 7-day sideload expiry. (A native build via Capacitor
exists — `CAP_SERVER_URL` + `npm run cap:build` — and is only worth it if you need native push;
TestFlight is then the easy distribution path, where only *you* need the developer account.)

### Desktop, pointed at a remote box

By default the desktop app boots its own local server. To make it a thin client to a remote box
instead (same as the phone), set `BATTLESTATION_REMOTE_URL=https://your-box:port` — it skips the
local server and loads the remote box, showing the Connect screen for the token.

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
