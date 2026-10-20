#!/usr/bin/env bash
#
# Launch the app that the DMG actually ships, and prove it works.
#
# This is the packaging-side acceptance gate: everything else (compose probe,
# smoke:runtime) runs against `build/`, which is not what a user receives. Here
# the app comes out of the DMG, is started with a clean home, and has to bring
# up its bundled runtime and materialize its profile by itself.
#
# What it cannot check: Gatekeeper. A file produced locally carries no download
# quarantine, so the "unidentified developer" path a user sees never triggers.
# That first-run approval stays a manual step.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
app_dir="$root/apps/nexusai-desktop"
dmg="$(ls -1 "$app_dir/dist"/*.dmg | head -1)"
[ -n "$dmg" ] || { echo "no .dmg in $app_dir/dist — run build-app.sh first" >&2; exit 2; }

work="$(mktemp -d)"
mnt="$work/mnt"
mkdir -p "$mnt"
app_pid=''
cleanup() {
  [ -n "$app_pid" ] && kill "$app_pid" 2>/dev/null || true
  hdiutil detach "$mnt" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== mounting $(basename "$dmg") =="
hdiutil attach -nobrowse -readonly "$dmg" -mountpoint "$mnt" >/dev/null
cp -R "$mnt"/*.app "$work/"
app_path="$(ls -d "$work"/*.app | head -1)"
app_name="$(basename "$app_path" .app)"
echo "app: $app_name"

# The mounted volume's name is the first brand string a user meets (Finder
# sidebar, the install window's title) and it comes from `dmg.title`, whose
# default does NOT follow `productName`. A rename that misses it ships silently
# under the old name — the field report that v0.1.8's DMG still mounted as
# "NexusAgent Builder". Assert that the volume and the app agree.
real_mnt="$(cd "$mnt" && pwd -P)"
volume="$(diskutil info "$(mount | grep -F " on $real_mnt (" | awk '{print $1}')" | sed -n 's/^ *Volume Name: *//p')"
[ "$volume" = "$app_name" ] || {
  echo "the DMG mounts as '$volume' but ships '$app_name.app' — set dmg.title in electron-builder.config.cjs" >&2
  exit 1
}
echo "dmg volume: $volume"

home="$work/home"
log="$home/logs/runtime.log"
echo "== launching with a clean home ($home) =="
NEXUSAI_DSH_HOME="$home" "$app_path/Contents/MacOS/$app_name" >"$work/launch.log" 2>&1 &
app_pid=$!

ready=''
deadline=$(( SECONDS + 240 ))
while [ "$SECONDS" -lt "$deadline" ]; do
  if [ -f "$log" ] && grep -q 'runtime ready: http://127\.0\.0\.1:' "$log"; then ready=yes; break; fi
  if ! kill -0 "$app_pid" 2>/dev/null; then echo "app exited before it was ready"; break; fi
  sleep 5
done

if [ -z "$ready" ]; then
  echo "--- app log ---"; cat "$log" 2>/dev/null || echo '(no log written)'
  echo "--- launch output ---"; tail -40 "$work/launch.log" 2>/dev/null || true
  exit 1
fi

profile="$home/profiles/nexusai"
if [ -L "$profile/node_modules" ]; then echo "profile node_modules is still a single link; expected a directory" >&2; exit 1; fi
[ -d "$profile/node_modules/@toby/dsh-plugin-nexusai" ] || { echo "plugin link missing after launch" >&2; exit 1; }
[ -e "$profile/node_modules/@deepseek-ai/dsh" ] && { echo "core dsh package was copied into the home profile" >&2; exit 1; }
grep -q 'dsh-plugin-nexusai' "$profile/cordis.patch.yml" || { echo "bundled patch does not mount the plugin" >&2; exit 1; }
grep -q 'aesKey:' "$profile/cordis.patch.yml" && { echo "profile patch still carries aesKey" >&2; exit 1; }

echo 'OK: installed app started, bundled runtime came up, profile materialized with the plugin row'
grep -E 'menu: minimal installed|window placement|runtime ready' "$log" | head -3
