#!/usr/bin/env bash
# Live workflow state generator for the Locals Only superset build.
# Emits Conductor-style "<workflow> . N/M agents done . elapsed" JSON from REAL git ground truth.
# The Fleet board / API reads this; never self-reported, always disk-derived.
# No set -e: arithmetic ($((done+1))) and grep-returns-1 are normal control flow here.
set -uo pipefail
REPO=/home/demi/projects/demi-workspace
WT=/home/demi/projects/lol-worktrees
WF=locals-only-superset-build
cd "$REPO"

slices=(chat repos fleet prs)
total=$(( ${#slices[@]} + 1 ))   # +1 for slice-1 (already on main)
done=1                            # slice-1 is committed to main
agents_json=""

# slice 1 (foundation, on main)
agents_json+="{\"id\":\"slice-1-shell\",\"lane\":\"done\",\"node\":\"PC\",\"branch\":\"main\",\"commit\":\"$(git rev-parse --short HEAD)\"},"

for s in "${slices[@]}"; do
  branch="slice/$s"
  ahead=$(git rev-list --count "main..$branch" 2>/dev/null || echo 0)
  running=0; pgrep -f "lol-worktrees/$s.*claude" >/dev/null 2>&1 && running=1
  # ground-truth lane derivation
  if [ "$ahead" -gt 0 ]; then lane="done"; done=$((done+1))
  elif [ "$running" -eq 1 ]; then
    # working vs verifying vs stalled: file mtime in last 2min => working
    nf=$(find "$WT/$s" -newermt "-2 minutes" \( -name '*.tsx' -o -name '*.ts' \) 2>/dev/null | grep -vE 'node_modules|\.next' | wc -l | tr -d ' ')
    nf=${nf:-0}
    pw=0; pgrep -f "lol-worktrees/$s.*playwright|playwright.*$s" >/dev/null 2>&1 && pw=1
    if [ "$nf" -gt 0 ]; then lane="working"
    elif [ "$pw" -eq 1 ]; then lane="verifying"
    else
      # alive, no writes, no browser. Only call it blocked if it's been running long
      # enough that reading/planning can't explain it (>20min). Early = still reading.
      etmin=$(ps -o etimes= -p "$(pgrep -f "lol-worktrees/$s.*claude"|head -1)" 2>/dev/null | tr -d ' '); etmin=$(( ${etmin:-0} / 60 ))
      if [ "$etmin" -ge 20 ]; then lane="blocked"; else lane="working"; fi
    fi
  else lane="spawned"; fi
  # live diff stat — include UNCOMMITTED working-tree changes (agents write before they commit).
  # committed delta (main..branch) + working-tree delta (vs branch HEAD), summed.
  read -r ca cd_ < <(git diff --numstat "main..$branch" 2>/dev/null | awk '{a+=$1;d+=$2} END{print a+0, d+0}')
  read -r wa wd < <(git -C "$WT/$s" diff --numstat HEAD 2>/dev/null | grep -vE 'node_modules|\.next|package-lock' | awk '{a+=$1;d+=$2} END{print a+0, d+0}')
  adds=$(( ${ca:-0} + ${wa:-0} )); dels=$(( ${cd_:-0} + ${wd:-0} ))
  agents_json+="{\"id\":\"slice-$s\",\"lane\":\"$lane\",\"node\":\"PC\",\"branch\":\"$branch\",\"diffStat\":{\"adds\":$adds,\"dels\":$dels}},"
done

agents_json="[${agents_json%,}]"
printf '{"workflow":"%s","title":"Locals Only - Superset Build","done":%d,"total":%d,"summary":"%s . %d/%d agents done","agents":%s}\n' \
  "$WF" "$done" "$total" "$WF" "$done" "$total" "$agents_json"
