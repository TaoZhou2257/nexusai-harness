#!/usr/bin/env pwsh
#
# The single source of truth for building the Windows installer.
#
# Mirror of `build-app.sh` for the other platform: both pipelines call this
# instead of reimplementing the steps, so GitHub Actions and Aliyun
# Yunxiao/Codeup cannot drift apart.
#
# Written for PowerShell on purpose — a Chinese CI Windows image may not ship
# Git Bash, and the app's own scripts already handle the Windows-specific bits
# (npm/corepack are `.cmd` shims there).
#
# Required secrets (baked into the bundled profile patch, never committed):
#   NEXUSAI_BASE_URL, NEXUSAI_AES_KEY, NEXUSAI_AES_IV
[CmdletBinding()]
param(
  [string]$Target = 'win-x64'
)
$ErrorActionPreference = 'Stop'

if ($Target -ne 'win-x64') { throw "build-app.ps1 builds win-x64; use build-app.sh for macOS (got $Target)" }

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$app = Join-Path $root 'apps\nexusai-desktop'

# Mirrors first: npmmirror keeps these downloads off GitHub, which is the
# difference between minutes and a timeout on this network. Overridable.
if (-not $env:NPM_CONFIG_REGISTRY) { $env:NPM_CONFIG_REGISTRY = 'https://registry.npmmirror.com' }
if (-not $env:COREPACK_NPM_REGISTRY) { $env:COREPACK_NPM_REGISTRY = $env:NPM_CONFIG_REGISTRY }
if (-not $env:ELECTRON_MIRROR) { $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/' }
if (-not $env:ELECTRON_BUILDER_BINARIES_MIRROR) { $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/' }

Write-Host '== toolchain =='
node --version
corepack enable
pnpm --version

Write-Host '== plugin dependencies (root, npm) =='
Push-Location $root
try { npm ci; if ($LASTEXITCODE -ne 0) { throw "npm ci failed ($LASTEXITCODE)" } } finally { Pop-Location }

Write-Host '== carrier dependencies =='
Push-Location $app
try { pnpm install; if ($LASTEXITCODE -ne 0) { throw "pnpm install failed ($LASTEXITCODE)" } } finally { Pop-Location }

Write-Host "== bundled runtime ($Target) =="
Push-Location $app
try {
  node scripts/prepare-runtime.mjs --target=$Target
  if ($LASTEXITCODE -ne 0) { throw "prepare:runtime failed ($LASTEXITCODE)" }
} finally { Pop-Location }

Write-Host '== headless runtime smoke =='
Push-Location $app
try {
  node scripts/smoke-runtime.mjs --timeout=180
  if ($LASTEXITCODE -ne 0) { throw "smoke:runtime failed ($LASTEXITCODE)" }
} finally { Pop-Location }

Write-Host '== package (nsis) =='
Push-Location $app
try {
  pnpm exec electron-builder --config electron-builder.config.cjs --win --x64
  if ($LASTEXITCODE -ne 0) { throw "electron-builder failed ($LASTEXITCODE)" }
} finally { Pop-Location }

Write-Host '== artifacts =='
Get-ChildItem (Join-Path $app 'dist') -Filter *.exe | Format-Table Name, Length -AutoSize
