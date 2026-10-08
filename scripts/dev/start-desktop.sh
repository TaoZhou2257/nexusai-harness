#!/usr/bin/env bash
# Start the dsh desktop and center its window once it appears.
#
# dsh creates its window without x/y and persists no frame, so macOS decides
# the spot (usually hard against the top of the work area). This wrapper keeps
# every launch centered without touching dsh's source — it just moves the
# window from the outside, which needs Accessibility permission for whatever
# runs it (System Settings → Privacy & Security → Accessibility).
#
# Placement is chosen with DSH_WINDOW_PLACEMENT:
#   center (default) — vertically centered inside the work area
#   bottom           — flush against the Dock
#   keep             — leave macOS's default (top-flush) alone
#
# Usage:  scripts/dev/start-desktop.sh            # foreground, like pnpm run start:desktop
#         DSH_REPO=/path/to/deepseek-harness scripts/dev/start-desktop.sh
#         DSH_DESKTOP_RENDERER_DEBUG_PORT=9223 scripts/dev/start-desktop.sh
#         DSH_WINDOW_PLACEMENT=bottom scripts/dev/start-desktop.sh
#         DSH_START_SCRIPT=dev:desktop scripts/dev/start-desktop.sh   # build first
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_REPO="${DSH_REPO:-/Users/toby/IdeaProjects/deepseek-harness}"
export DSH_DESKTOP_RENDERER_DEBUG_PORT="${DSH_DESKTOP_RENDERER_DEBUG_PORT:-9222}"
placement="${DSH_WINDOW_PLACEMENT:-center}"
# Which dsh script to run: start:desktop (default, no build) or dev:desktop
# (builds first), so the wrapper works whichever habit you have.
start_script="${DSH_START_SCRIPT:-start:desktop}"

if [[ ! -d "$DSH_REPO" ]]; then
  echo "dsh checkout not found: $DSH_REPO (set DSH_REPO)" >&2
  exit 1
fi

cd "$DSH_REPO"
pnpm run "$start_script" "$@" &
desktop_pid=$!
trap 'kill "$desktop_pid" 2>/dev/null || true' EXIT

# Center once the window shows up (up to ~3 minutes of boot time). Each try is
# the single-shot mode, which is the one verified to work from the shell.
if [[ "$placement" == "keep" ]]; then
  echo "window placement: keep (macOS default)"
else
  placed=0
  for _ in $(seq 1 60); do
    if node "$HERE/center-window.mjs" --mode "$placement" 2>/dev/null >/dev/null; then placed=1; break; fi
    sleep 3
  done
  if [[ "$placed" == "1" ]]; then
    echo "window placement: $placement"
  else
    echo "warning: could not place the window --mode $placement (Accessibility permission for this terminal?)" >&2
  fi
fi

wait "$desktop_pid"
