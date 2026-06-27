#!/usr/bin/env bash
# Battlestation one-command VPS bring-up. Idempotent: safe to re-run.
#
#   bash scripts/serve-vps.sh
#
# Does, in order:
#   1. build the standalone server if missing (next build + prepare-standalone)
#   2. mint a BATTLESTATION_TOKEN if none exists (via token.cjs)
#   3. install a reboot-proof systemd --user service on :PORT (loopback)
#   4. front it with `tailscale serve` for real-TLS reach (no caddy/nginx/certbot)
#   5. print the pairing deep-link + a scannable terminal QR
#
# Flags:
#   --funnel    expose publicly via `tailscale funnel` instead of tailnet-only serve
#   --port N    bind port (default 9119)
#   --no-ts     skip tailscale (LAN-only); pairing URL will be http://<lan-ip>:PORT
set -euo pipefail

PORT=9119
USE_TS=1
FUNNEL=0
TRUST_TAILNET=0
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2;;
    --funnel) FUNNEL=1; shift;;
    --trust-tailnet) TRUST_TAILNET=1; shift;;
    --no-ts) USE_TS=0; shift;;
    *) echo "unknown flag: $1" >&2; exit 2;;
  esac
done

# Safety: tokenless tailnet trust is meaningless+dangerous with Funnel (public).
if [ "$TRUST_TAILNET" = "1" ] && [ "$FUNNEL" = "1" ]; then
  echo "FAIL: --trust-tailnet cannot be combined with --funnel (Funnel is public;" >&2
  echo "      tailnet identity only exists on a private tailnet). Pick one." >&2
  exit 2
fi

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
echo "### Battlestation VPS bring-up  (root=$ROOT port=$PORT)"

command -v node >/dev/null || { echo "FAIL: node not installed"; exit 1; }
command -v npm  >/dev/null || { echo "FAIL: npm not installed"; exit 1; }

# 1. standalone server present?
if [ ! -s ".next/standalone/server.js" ]; then
  echo "### build: .next/standalone missing -> next build + prepare-standalone"
  npm install
  npm run build
  node scripts/prepare-standalone.cjs
else
  echo "### build: reuse existing .next/standalone/server.js"
fi
[ -s ".next/standalone/server.js" ] || { echo "FAIL: standalone build did not produce server.js"; exit 1; }

# 2. token
echo "### token: ensure BATTLESTATION_TOKEN exists"
TOKEN="$(node scripts/token.cjs 2>/dev/null | head -1)"
[ -n "$TOKEN" ] || { echo "FAIL: could not mint/read token"; exit 1; }
echo "token ready (${#TOKEN} chars)"

# 3. reboot-proof systemd --user service
echo "### service: install systemd --user unit on :$PORT (loopback)"
UDIR="$HOME/.config/systemd/user"
mkdir -p "$UDIR"
NODE_BIN="$(command -v node)"
TOKFILE="$(node -e 'const p=require("path"),os=require("os");const d=process.platform==="darwin"?p.join(os.homedir(),"Library","Application Support","locals-only"):p.join(process.env.XDG_CONFIG_HOME||p.join(os.homedir(),".config"),"locals-only");console.log(p.join(d,"battlestation.env"))')"
# Tailnet-trust + funnel flags flow into the unit env so middleware.ts sees them.
TRUST_LINE=""
[ "$TRUST_TAILNET" = "1" ] && TRUST_LINE="Environment=BATTLESTATION_TRUST_TAILNET=1"
FUNNEL_LINE=""
[ "$FUNNEL" = "1" ] && FUNNEL_LINE="Environment=BATTLESTATION_FUNNEL=1"
cat > "$UDIR/hermes-battlestation.service" <<EOF
[Unit]
Description=Hermes Battlestation (Next standalone server)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$ROOT
EnvironmentFile=-$TOKFILE
ExecStart=$NODE_BIN $ROOT/.next/standalone/server.js
Environment=PORT=$PORT
Environment=HOSTNAME=127.0.0.1
Environment=NODE_ENV=production
$TRUST_LINE
$FUNNEL_LINE
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable hermes-battlestation.service >/dev/null 2>&1 || true
systemctl --user restart hermes-battlestation.service
# allow user services to run without an active login session (survives logout/reboot)
loginctl enable-linger "$(whoami)" >/dev/null 2>&1 || true

# health-gate: wait for loopback to answer
echo -n "### health: waiting for :$PORT "
for i in $(seq 1 20); do
  code="$(curl -s -m 3 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/connect" 2>/dev/null || true)"
  if [ "$code" = "200" ]; then echo "OK (HTTP 200)"; break; fi
  echo -n "."; sleep 1
  [ "$i" = "20" ] && { echo " FAIL: server did not become healthy"; journalctl --user -u hermes-battlestation -n 20 --no-pager 2>/dev/null | tail -20; exit 1; }
done

# 4. tailscale reach
BASE=""
if [ "$USE_TS" = "1" ] && command -v tailscale >/dev/null; then
  if [ "$FUNNEL" = "1" ]; then
    echo "### tailscale: funnel (PUBLIC) -> :$PORT"
    tailscale funnel --bg "$PORT" >/dev/null 2>&1 || tailscale funnel "$PORT" --bg >/dev/null 2>&1 || true
  else
    echo "### tailscale: serve (tailnet-only) -> :$PORT"
    tailscale serve --bg "$PORT" >/dev/null 2>&1 || tailscale serve "$PORT" --bg >/dev/null 2>&1 || true
  fi
  BASE="$(tailscale serve status 2>/dev/null | grep -oE 'https://[^[:space:]]+' | head -1 | sed 's:/*$::')"
elif [ "$USE_TS" = "1" ]; then
  echo "### tailscale: CLI not found — skipping (install tailscale for a TLS URL)"
fi

# 5. pairing output (QR + deep-link). pair-qr.cjs resolves the same token + URL.
echo ""
echo "==================== PAIRING ===================="
if [ -n "$BASE" ]; then
  BS_BASE_URL="$BASE" node scripts/pair-qr.cjs "$BASE"
else
  node scripts/pair-qr.cjs
fi
echo "================================================="
echo "Service: systemctl --user status hermes-battlestation"
echo "Rotate token: npm run token -- --new  (then restart the service)"
