#!/bin/bash
# Next standalone server omits static/ + public/ — copy them in so /_next/static
# and public assets serve (else CSS/JS 404 -> unstyled app). Idempotent.
cd "$(dirname "$0")/.." || exit 0
mkdir -p .next/standalone/.next .next/standalone/public
if [ -d .next/static ]; then
  rm -rf .next/standalone/.next/static
  cp -R .next/static .next/standalone/.next/static
fi
if [ -d public ]; then
  cp -R public/. .next/standalone/public/
fi
exit 0
