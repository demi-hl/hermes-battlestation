# Hermes Battlestation

An alternative launcher for your local [Hermes](https://claude-code.nousresearch.com) agent — a
desktop + mobile cockpit for the agent already running on your machine. Chat, repos, fleet, kanban,
terminal, editor, Obsidian vault — all talking to *your* local install, over your own tailnet.
Nothing is sent to a third party.

> One Next.js codebase ships two ways: a downloadable **desktop app** (Electron, boots its own local
> server) and a **mobile app** (Capacitor, reachable over Tailscale).

## Have a Hermes agent? Just tell it.

The fastest way in: paste this to your own Hermes and it does the whole install + Tailscale + pairing.

```
Install Hermes Battlestation and make it reachable from my phone over Tailscale.

1. Clone git@github.com:demi-hl/hermes-battlestation.git (or git pull if I
   already have it), cd into it, run npm install.
2. Make sure Tailscale is running on this box: tailscale up
3. Run: npm run serve:vps
   (it builds, mints an access token, installs a reboot-proof service,
   fronts it with tailscale serve for real TLS, and prints a QR + login link)
4. Show me the QR code and login link so I can open it on my phone.

Notes for you, the agent:
- Need Node 18+ and Tailscale installed on this box first.
- For tokenless pairing on a private tailnet, run: npm run serve:vps -- --trust-tailnet
- Do NOT use --funnel unless I explicitly want this on the public internet
  (Battlestation is god-mode: shell, secrets, fleet — treat it like SSH).
- My phone must be on the SAME Tailscale account to scan the QR.
```

Two things only you can do (your agent can't): sign into **Tailscale** once (`tailscale up` opens a
browser login; put the Tailscale app on your phone, same account), and have **Node 18+** on the box.
Everything else the one command handles — see [Fastest path](#fastest-path--one-command-headless-box--vps) below.

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

> **Already use the stock `hermes dashboard`?** There's nothing to migrate. Battlestation reads the
> exact same `~/.hermes` (sessions, config, API keys) — your existing agent and history are just
> *there* the moment it opens. It's a richer 25-pane cockpit over the same backend, not a separate
> app to move into. (Note: the stock dashboard and Battlestation are different UIs — the mobile app
> pairs with Battlestation, not the stock dashboard.)

> **The agent is god-mode** — terminal, fleet control, your billing, every session. Treat reaching
> it like SSH access, not a website. That's why the recommended path keeps it off the public
> internet entirely.

### Fastest path — one command (headless box / VPS)

On the box, from the repo:

```bash
npm run serve:vps
```

That single command: builds the standalone server if needed, mints an access token if you don't
have one, installs a **reboot-proof** `systemd --user` service on `127.0.0.1:9119`, fronts it with
`tailscale serve` (real TLS, tailnet-only), then prints a **QR code + one-tap login link**. Scan
the QR with a phone on the same tailnet — you're in. No manual token copy, no nginx/caddy/certbot.

```bash
npm run serve:vps -- --funnel          # expose publicly via Tailscale Funnel (off-tailnet devices)
npm run serve:vps -- --trust-tailnet   # tokenless: trust any tailnet peer (private tailnet only)
npm run serve:vps -- --no-ts           # LAN-only, skip Tailscale
npm run pair                           # reprint the QR + link anytime
```

> `--trust-tailnet` drops the token entirely and trusts the verified Tailscale identity of whoever's
> on your tailnet. It is **off by default**, refuses to run with `--funnel` (Funnel is public), and
> only honors a real `Tailscale-User-Login` from a tailnet IP. Use it only on a tailnet you control.

The rest of this section explains the same steps done by hand — reach for it if you're not using
the one-command path.

**1. Set an access token on the box** (this is what makes it safe to reach over a network):

```bash
# easiest — prints the token, or mints + saves a strong one if none exists:
npm run token
# (npm run token -- --new  rotates it)

# or set your own by hand:
BATTLESTATION_TOKEN=$(openssl rand -base64 24)
```

With no token set, the app stays loopback-only with no auth (single-machine mode). The moment a
token is set, every device must present it — unauthenticated requests get a `401` (API) or the
**Connect** screen (pages).

> The **desktop app mints this token for you** on first launch and saves it to its env file — so a
> Mac running the `.dmg` is ready to pair a phone with no manual setup; find it under **Settings**.
> You only need the `openssl` line above for a headless/server box with no desktop app.

**Or sign in with Nous — no token to share.** If the box has a Nous OAuth client configured
(`BATTLESTATION_OAUTH_CLIENT_ID`), the **Connect** screen shows a **Sign in with Nous** button:
sign in with your existing Nous account instead of pasting a token. Both paths work side by side —
the token is the fallback when OAuth isn't configured, and loopback stays open either way.

**2. Make the box reachable — use [Tailscale](https://tailscale.com) (recommended).** It's a
free private mesh VPN; your phone reaches the box directly, and the box is *never* exposed to the
public internet — no open ports, no public URL for anyone to find or brute-force.

```bash
# on the box:
tailscale up
tailscale serve --bg 9119          # front the app on your tailnet with real TLS
```

Then install Tailscale on the phone (App Store / Play Store) and sign into the **same account**.
That's the only setup — one app, one sign-in, done.

**3. Connect from the device** — open the box's tailnet URL (e.g.
`https://your-box.tail-xxxx.ts.net`). The **Connect** screen asks for your **Access token** (leave
Remote URL blank — you opened the box directly). Enter it once; you're in. Or use **Link a device**
(below) to skip typing entirely.

<details>
<summary>Other reachability paths (advanced)</summary>

| Path | Need a VPN? | Tradeoff |
|---|---|---|
| **Tailscale** (recommended) | yes (1-tap app) | private mesh, nothing exposed publicly |
| **LAN** | no | free, but only works on your home wifi |
| **Cloudflare Tunnel / reverse proxy** | no | public URL, works anywhere — but puts the agent on the open internet behind only the token. Accept the exposure before choosing this. |

</details>

### Link a device (no typing)

Already signed in on one device (or running the desktop app)? Open
**Settings → Link a device** — it shows a QR plus one-tap **Copy access token** /
**Copy login link** buttons. Three ways to use it:

- **Scan the QR** with a new phone's camera → opens the app already signed in.
- **Copy token** → paste into the app's Connect screen on the new device.
- **Copy login link** → open it on any device that can reach the box.

Same model as WhatsApp Web: the device you're already on hands credentials to the
new one. The desktop app (which auto-mints a token on first launch) is the easiest
place to grab the token to pair your first phone.

> The very first device can't use the QR (there'd be no signed-in device to show it) — type the
> token once on the Connect screen, or have the box owner hand you a QR out-of-band. A QR carries
> full credentials, so only share it with **your own** devices.

### Install on a phone (no developer account, no App Store)

The app is a **PWA** — the zero-friction path for everyone:

1. Open your box's URL in Safari (iOS) or Chrome (Android).
2. Enter your token on the Connect screen (or scan a Link-a-device QR).
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

## Troubleshooting

**macOS: "Hermes Battlestation is damaged and can't be opened" / the `.dmg` won't open.**
The installers are **unsigned**, so macOS quarantines them and reports a misleading "damaged" error.
It is not corrupt. Either right-click the app/dmg → **Open** (instead of double-click), or strip the
quarantine flag from a terminal:

```bash
xattr -cr ~/Downloads/Hermes-Battlestation-*.dmg     # then open it
# or, after dragging the app to /Applications:
xattr -cr "/Applications/Hermes Battlestation.app"
```

**"Processor mismatch" / the app won't run on this machine (Intel Mac, Raspberry Pi, any ARM box).**
The prebuilt installers are **architecture-specific**: the macOS `.dmg` is **Apple Silicon (arm64)**
and the Linux `.AppImage`/`.deb` are **x64**. They will not run on a mismatched CPU (an Intel Mac, an
ARM SBC like a Raspberry Pi, etc.).

You don't need the packaged desktop app. Battlestation's server is **plain Node — it runs on any
architecture**. Run it directly on the box (this is the recommended path for a Pi / headless server /
the machine where Hermes already lives):

```bash
git clone https://github.com/demi-hl/hermes-battlestation && cd hermes-battlestation
npm install
npm run serve:vps      # builds, mints a token, installs the service, tailscale serve, prints a QR
```

Then open the printed link (or scan the QR) from any device on your tailnet — Mac, phone, anything.
No DMG, no AppImage, no arch matching. See [Fastest path](#fastest-path--one-command-headless-box--vps).

## License

MIT
