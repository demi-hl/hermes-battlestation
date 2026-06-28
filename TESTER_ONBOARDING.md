# Connect your phone to your Hermes agent (Battlestation)

Battlestation is a mobile cockpit for **your own** Hermes agent — chat, repos,
fleet, kanban, terminal, editor, from your phone. The iOS app is a thin client:
it connects to a Hermes box **you** run. Your token only ever talks to your box.

There are two halves: **run the server on your box**, then **pair your phone**.

---

## 1. Run Battlestation on your box

Your phone needs a Battlestation server to connect to. Plain `hermes dashboard`
is NOT enough — it doesn't serve the pairing screen. On the box that runs your
Hermes agent:

```bash
git clone https://github.com/demi-hl/hermes-battlestation
cd hermes-battlestation        # (this repo: demi-workspace)
npm install
npm run serve:vps              # builds, mints a token, starts on :9119, prints a QR
```

`serve:vps` is idempotent and reboot-proof (installs a user service). It also sets
up Tailscale so your phone can reach the box from anywhere. Re-run it any time.

> Already running the desktop DMG? It's the same agent — your phone connects
> straight to it, skip to step 2.

---

## 2. Get your access token + pairing link

One command prints everything you need:

```bash
npm run onboard
```

It shows:
- whether the server is up,
- your **access token**,
- a **pairing link** (`https://your-box.ts.net/?token=…`),
- a **scannable QR code**.

Other ways to get the token:
- `npm run token` — just print the token (mint one if none exists)
- `npm run token -- --new` — rotate it (old devices must re-pair)
- In the app: **Settings → Link a device** — QR + copy-token buttons

---

## 3. Pair your phone

**Install the app:** open the TestFlight link on your iPhone, tap Install.
(No TestFlight link? You can also use it as a PWA — open your box URL in Safari →
Share → Add to Home Screen.)

**Connect:** open Battlestation → the Connect screen.
- **Box URL:** your box's URL (the one `npm run onboard` printed,
  e.g. `https://your-box.ts.net`)
- **Token:** paste the token, or scan the QR from `npm run onboard`

That's it — you're looking at your own agent.

---

## Troubleshooting

- **"Connecting…" forever / black screen** — your phone can't reach your box.
  Make sure the box is on and, if your phone is off your home Wi-Fi, that both
  are on the same Tailscale tailnet. Plain-HTTP LAN URLs only work on the same
  Wi-Fi; for anywhere-access run `tailscale serve --bg 9119` on the box and
  re-run `npm run onboard`.
- **Rejected token** — it was rotated. Run `npm run token` on the box for the
  current one. (After `--new` you must restart the server: re-run `npm run serve:vps`.)
- **App opens to a "enter your box" screen** — that's expected; this is the
  public build with no box baked in. Enter your own box URL + token (step 3).
- **macOS DMG "damaged" / "processor mismatch"** — the build is unsigned:
  right-click → Open (not double-click), or `xattr -cr *.dmg`. Apple-Silicon
  Macs need the `arm64` DMG, Intel needs `x64`.

---

## Security note

Your Battlestation token is **full access to your box** — terminal, secrets,
files, fleet. Treat it like a password. Only put it on **your own** devices.
Never paste someone else's token, and never hand yours out — it's not a
read-only/guest credential.
