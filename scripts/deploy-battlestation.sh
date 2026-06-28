#!/usr/bin/env bash
# deploy-battlestation.sh — atomic, integrity-checked redeploy of the
# Battlestation Next standalone server (NOT the agent gateway).
#
# Why this exists: the live service serves .next/standalone, but `next build`
# and `prepare-standalone` are two steps. Running build alone regenerates
# .next/static with new content hashes and orphans the standalone copy — the
# server then 500s every CSS/JS chunk (text/plain MIME) and the site renders
# unstyled / unhydrated. This script makes build → prepare → verify → restart
# one atomic, self-checking unit so that failure mode can't ship.
#
# Usage: deploy-battlestation.sh [--no-build]
#   --no-build   skip `next build`, just re-prepare standalone + restart
#                (use when .next is already fresh and you only desynced)
set -euo pipefail

REPO="${REPO:-/home/demi/projects/demi-workspace}"
SERVICE="${SERVICE:-hermes-battlestation.service}"
PORT="${PORT:-9119}"
LOG="${LOG:-/tmp/bs-deploy.log}"
DO_BUILD=1
[[ "${1:-}" == "--no-build" ]] && DO_BUILD=0

cd "$REPO"
exec > >(tee "$LOG") 2>&1
echo "=== $(date '+%T') deploy start (build=$DO_BUILD repo=$REPO) ==="

if [[ $DO_BUILD -eq 1 ]]; then
  echo "=== [1/5] next build ==="
  npm run build 2>&1 | tail -3
fi

echo "=== [2/5] prepare-standalone (copy static+public into standalone) ==="
node scripts/prepare-standalone.cjs 2>&1 | tail -3

echo "=== [3/5] INTEGRITY GATE (refuse to ship a broken bundle) ==="
SRC_STATIC=$(find .next/static -type f 2>/dev/null | wc -l | tr -d ' ')
STD_STATIC=$(find .next/standalone/.next/static -type f 2>/dev/null | wc -l | tr -d ' ')
SRC_BUILD=$(cat .next/BUILD_ID 2>/dev/null || echo "src-missing")
STD_BUILD=$(cat .next/standalone/.next/BUILD_ID 2>/dev/null || echo "std-missing")
echo "src static=$SRC_STATIC  standalone static=$STD_STATIC"
echo "src BUILD_ID=$SRC_BUILD  standalone BUILD_ID=$STD_BUILD"
if [[ "$STD_STATIC" -eq 0 || "$STD_STATIC" -ne "$SRC_STATIC" ]]; then
  echo "FATAL: standalone static is empty or out of sync with source — NOT restarting"; exit 2
fi
if [[ "$SRC_BUILD" != "$STD_BUILD" ]]; then
  echo "FATAL: BUILD_ID mismatch between source and standalone — NOT restarting"; exit 3
fi
echo "integrity ok"

echo "=== [4/5] restart $SERVICE ==="
systemctl --user restart "$SERVICE"
sleep 5
echo "active: $(systemctl --user is-active "$SERVICE")"

echo "=== [5/5] live asset probe (a real chunk must 200 with correct MIME) ==="
CHUNK=$(find .next/standalone/.next/static/chunks -name '*.js' 2>/dev/null | head -1)
CHUNK_URL="/_next/static/chunks/$(basename "$CHUNK")"
CODE=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' --max-time 10 "http://127.0.0.1:$PORT$CHUNK_URL")
echo "probe $CHUNK_URL -> $CODE"
case "$CODE" in
  200\ *javascript*) echo "=== $(date '+%T') deploy OK ===" ;;
  *) echo "FATAL: live chunk probe failed ($CODE) — server up but serving broken assets"; exit 4 ;;
esac
