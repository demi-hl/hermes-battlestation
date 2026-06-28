#!/usr/bin/env bash
# onboard.sh — one command a Battlestation host runs to connect a phone (TestFlight
# or PWA) to THIS box's Hermes agent. Resolves/mints the access token, finds the
# reachable URL, checks the server is up, then prints the token + pairing link + a
# scannable QR.
#
#   npm run onboard            → token (mint if none) + pairing link + QR
#   npm run onboard -- --new   → rotate the token first, then pair
#   BS_BASE_URL=https://x npm run onboard   → force the base URL
#
# Token + URL resolution are delegated to scripts/token.cjs and scripts/pair-qr.cjs
# so this never drifts from what the running server actually accepts.
set -euo pipefail

cd "$(dirname "$0")/.."
PORT="${PORT:-9119}"

command -v node >/dev/null 2>&1 || { echo "node not found — install Node 18+ and retry." >&2; exit 1; }

# 1. Token: mint+persist if none, rotate if --new. token.cjs prints the bare
#    token on stdout and guidance on stderr.
TOKEN_ARGS=()
[[ "${1:-}" == "--new" ]] && TOKEN_ARGS=(-- --new)
TOKEN="$(node scripts/token.cjs "${TOKEN_ARGS[@]}" 2>/dev/null | head -1)"
[[ -n "$TOKEN" ]] || { echo "Could not resolve a token (scripts/token.cjs failed)." >&2; exit 1; }

# 2. Base URL: explicit env > tailscale serve > LAN ip. (Same order pair-qr uses.)
base_url() {
  if [[ -n "${BS_BASE_URL:-}" ]]; then printf '%s' "${BS_BASE_URL%/}"; return; fi
  local ts
  ts="$(tailscale serve status 2>/dev/null | grep -oE 'https://[^[:space:]]+' | head -1 || true)"
  if [[ -n "$ts" ]]; then printf '%s' "${ts%/}"; return; fi
  local ip
  ip="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -vE '^127\.' | head -1 || true)"
  printf 'http://%s:%s' "${ip:-127.0.0.1}" "$PORT"
}
BASE="$(base_url)"

# 3. Reachability: is the server actually answering? 200/307/401 = alive (gate
#    redirects/needs-token are healthy); anything else = it's not up.
CODE="$(curl -s -m6 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/" 2>/dev/null || echo 000)"
echo ""
echo "=================================================================="
echo "  Battlestation onboarding — connect a phone to THIS box's agent"
echo "=================================================================="
if [[ "$CODE" =~ ^(200|307|401)$ ]]; then
  echo "  server: UP on :${PORT} (HTTP ${CODE})"
else
  echo "  server: NOT RESPONDING on :${PORT} (HTTP ${CODE})"
  echo "          start it first:  npm run serve:vps"
fi
echo ""
echo "  Your access token:"
echo "    ${TOKEN}"
echo ""

# 4. Pairing link + QR (pair-qr.cjs resolves the same token + base URL).
BS_BASE_URL="$BASE" node scripts/pair-qr.cjs "$BASE" 2>/dev/null || {
  echo "  Pairing link:"
  echo "    ${BASE}/?token=${TOKEN}"
}

echo "  How a tester connects (TestFlight app):"
echo "    1. Install Battlestation from the TestFlight link."
echo "    2. Open it → Connect screen."
echo "    3. Box URL: ${BASE}"
echo "    4. Token:   paste the token above (or scan the QR)."
echo ""
if [[ "$BASE" == http://* ]]; then
  echo "  NOTE: that's a plain-HTTP LAN URL — only works on the same Wi-Fi."
  echo "  For a phone anywhere, expose it over Tailscale and re-run:"
  echo "    tailscale serve --bg ${PORT}   &&   npm run onboard"
  echo ""
fi
