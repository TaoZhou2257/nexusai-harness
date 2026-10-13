#!/usr/bin/env bash
#
# The single source of truth for building the macOS installers.
#
# Both pipelines (GitHub Actions and Aliyun Yunxiao/Codeup) call this script
# instead of reimplementing the steps, so the two cannot drift apart: whichever
# rail you take, the same commands produce the same artifacts.
#
# Everything the environment can influence has a mirror-friendly default here,
# because runners in China reach npm / Electron / electron-builder's tool
# binaries far more reliably through npmmirror. Any of them can be overridden
# from the outside.
#
# Required secrets (baked into the bundled profile patch, never committed):
#   NEXUSAI_BASE_URL, NEXUSAI_AES_KEY, NEXUSAI_AES_IV
#
# Optional:
#   NEXUSAI_TARGET=mac-arm64 | mac-x64   (default: host architecture)
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
app="$root/apps/nexusai-desktop"
target="${NEXUSAI_TARGET:-}"

export NPM_CONFIG_REGISTRY="${NPM_CONFIG_REGISTRY:-https://registry.npmmirror.com}"
export COREPACK_NPM_REGISTRY="${COREPACK_NPM_REGISTRY:-$NPM_CONFIG_REGISTRY}"
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
export ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}"

case "$target" in
  ''|mac-arm64) builder_arch='--arm64'; probe_target='mac-arm64' ;;
  mac-x64)      builder_arch='--x64';   probe_target='mac-x64' ;;
  *) echo "build-app.sh builds macOS targets; use build-app.ps1 for Windows (got NEXUSAI_TARGET=$target)" >&2; exit 2 ;;
esac

echo "== toolchain =="
node --version
corepack enable
pnpm --version

echo "== plugin dependencies (root, npm) =="
(cd "$root" && npm ci)

echo "== carrier dependencies =="
(cd "$app" && pnpm install)

echo "== bundled runtime ($probe_target) =="
(cd "$app" && node scripts/prepare-runtime.mjs --target="$probe_target")

echo "== headless runtime smoke =="
(cd "$app" && node scripts/smoke-runtime.mjs --timeout=180)

echo "== package (dmg) =="
(cd "$app" && pnpm exec electron-builder --config electron-builder.config.cjs --mac "$builder_arch")

echo "== artifacts =="
ls -la "$app/dist"/*.dmg
