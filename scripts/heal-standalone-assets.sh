#!/bin/bash
# Next standalone server omits static/ + public/ — copy them in so /_next/static
# and public assets serve (else CSS/JS 404 -> unstyled app). Idempotent.
cd /home/demi/projects/demi-workspace || exit 0
[ -d .next/static ] && cp -r .next/static .next/standalone/.next/static 2>/dev/null
[ -d public ] && cp -r public/. .next/standalone/public/ 2>/dev/null
exit 0
