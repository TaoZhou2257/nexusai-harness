#!/usr/bin/env bash
# Keep the dsh window placed across launches, however the app was started.
#
# `scripts/dev/start-desktop.sh` only helps when it is the thing that launches
# dsh; running `pnpm run dev:desktop` / `pnpm run start:desktop` by hand skips
# it. This watcher instead reacts to the window: the first time it sees the
# window after a launch it places it (center by default), then leaves it alone
# until the window disappears — so a manual drag is never fought.
#
# Needs Accessibility permission for whatever runs it (System Settings →
# Privacy & Security → Accessibility).
#
# Usage:
#   scripts/dev/watch-window.sh            # center (default)
#   scripts/dev/watch-window.sh bottom     # hug the Dock
#   scripts/dev/watch-window.sh keep       # do nothing (exit)
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
placement="${1:-${DSH_WINDOW_PLACEMENT:-center}}"

if [[ "$placement" == "keep" ]]; then
  echo "placement 'keep' — nothing to watch"
  exit 0
fi

echo "watching for the dsh window (placement: $placement) — Ctrl-C to stop"
wasPresent=0
while true; do
  if node "$HERE/center-window.mjs" --probe >/dev/null 2>&1; then
    if [[ "$wasPresent" == "0" ]]; then
      # fresh launch: place it once
      if node "$HERE/center-window.mjs" --mode "$placement" --wait 180 >/dev/null 2>&1; then
        echo "$(date '+%H:%M:%S') window placed ($placement)"
      else
        echo "$(date '+%H:%M:%S') could not place the window (Accessibility permission?)" >&2
      fi
    fi
    wasPresent=1
    sleep 6
  else
    if [[ "$wasPresent" == "1" ]]; then
      echo "$(date '+%H:%M:%S') window closed"
    fi
    wasPresent=0
    sleep 3
  fi
done
