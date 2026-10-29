#!/usr/bin/env pwsh
#
# Install the produced installer on this (real) Windows machine, launch what it
# installed, and prove the app comes up — twice, because a home outlives an
# install:
#
#   1. **Fresh home** — runtime ready, profile materialized, client plugin
#      mounted (launcher marker). The ordinary first-run path.
#   2. **Stale home** — a home left by an earlier install whose `node_modules`
#      junction points somewhere else and whose marker is old. This is the class
#      of failure reported from the field ("bundled dsh CLI is missing"): the
#      shell has to notice and rebuild the link instead of failing.
#
# What it does NOT cover: SmartScreen (a locally built file carries no
# Mark-of-the-Web) and signing in with a real account (the captcha blocks
# automation on purpose).
#
# Usage: pwsh -File scripts/ci/install-and-launch-check.ps1 [-Port 9225] [-SkipUninstall]
[CmdletBinding()]
param(
  [int]$Port = 9225,
  [switch]$SkipUninstall
)
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$app = Join-Path $root 'apps\nexusai-desktop'
$installer = Get-ChildItem (Join-Path $app 'dist') -Filter '*Setup*.exe' | Select-Object -First 1
if (-not $installer) { throw "no *Setup*.exe in $app\dist — run build-app.ps1 first" }

# The product name follows the white-label brand, mirroring
# electron-builder.config.cjs: a customer build (NEXUSAI_CUSTOMER) installs and
# labels itself after branding/<customer>'s name, everything else stays
# NexusAIHarness.
$productName = 'NexusAIHarness'
if ($env:NEXUSAI_CUSTOMER) {
  $brandPath = Join-Path $root "apps\nexusai-desktop\branding\$env:NEXUSAI_CUSTOMER\brand.json"
  $productName = (Get-Content $brandPath -Raw | ConvertFrom-Json).name
}

$installDir = Join-Path $env:LOCALAPPDATA "Programs\$productName"
$exe = Join-Path $installDir "$productName.exe"
# RUNNER_TEMP is GitHub's; Yunxiao has no equivalent, so fall back to the OS temp.
$tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$script:proc = $null

function Show-Evidence([string]$why, [string]$dshHome) {
  Write-Host "--- $why ---"
  $log = Join-Path $dshHome 'logs\runtime.log'
  if (Test-Path $log) { Get-Content $log -Tail 60 } else { Write-Host "(no runtime log at $log)" }
  Get-ChildItem (Join-Path $dshHome 'profiles') -Recurse -Depth 1 -ErrorAction SilentlyContinue |
    Select-Object -First 10 FullName | Format-Table -AutoSize | Out-String | Write-Host
}

# Launch the installed app against one home and wait for the runtime's ready line
# (the app writes it to <home>\logs\runtime.log — see src/main.cjs).
function Test-AppBoots([string]$dshHome, [string]$label) {
  Write-Host "== launching ($label) with home $dshHome =="
  $env:NEXUSAI_DSH_HOME = $dshHome
  $script:proc = Start-Process -FilePath $exe -ArgumentList "--remote-debugging-port=$Port" -PassThru
  $log = Join-Path $dshHome 'logs\runtime.log'
  $deadline = (Get-Date).AddMinutes(4)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $log) {
      if (Select-String -Path $log -Pattern 'runtime ready: http://127\.0\.0\.1:' -Quiet) { return $true }
    }
    if ($script:proc.HasExited) { return $false }
    Start-Sleep -Seconds 5
  }
  return $false
}

function Stop-App {
  if ($script:proc -and -not $script:proc.HasExited) {
    Stop-Process -Id $script:proc.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
  }
  $script:proc = $null
}

try {
  Write-Host "== silent install: $($installer.Name) =="
  # NSIS honours /S in both one-click and assisted builds; -Wait so the checks
  # that follow test a finished install.
  $install = Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait -PassThru
  Write-Host "installer exit code: $($install.ExitCode)"
  if (-not (Test-Path $exe)) { throw "installer did not place $exe" }
  Write-Host "OK: installed to $installDir"

  # The shortcut labels are the other brand string that does not follow
  # productName: app-builder-lib's NSIS templates create them as
  # `${SHORTCUT_NAME}.lnk` (templates/nsis/common.nsh), and for the assisted
  # installer they are created on the silent path too — which is how this gate
  # installs. A rename that misses `nsis.shortcutName` leaves users with a
  # shortcut labelled after the old app name, so assert both by name.
  $shortcuts = @(
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$productName.lnk"),
    (Join-Path ([Environment]::GetFolderPath('Desktop')) "$productName.lnk")
  )
  foreach ($shortcut in $shortcuts) {
    if (-not (Test-Path $shortcut)) { throw "installer did not create $shortcut — check nsis.shortcutName in electron-builder.config.cjs" }
  }
  Write-Host "OK: shortcuts named after the app ($($shortcuts -join ' | '))"

  # ── scenario 1: fresh home ────────────────────────────────────────────────
  $fresh = Join-Path $tempRoot "nexusai-home-$([guid]::NewGuid().ToString('N').Substring(0,8))"
  if (-not (Test-AppBoots $fresh 'fresh home')) { Show-Evidence 'runtime never reported ready' $fresh; throw 'fresh home: bundled runtime did not come up' }
  Write-Host 'OK: fresh home — installed app started and its bundled runtime is up'

  $dshProfile = Join-Path $fresh 'profiles\nexusai'
  if (-not (Test-Path (Join-Path $dshProfile 'package.json'))) { Show-Evidence 'profile missing' $fresh; throw 'profile was not materialized' }
  if (-not (Select-String -Path (Join-Path $dshProfile 'cordis.patch.yml') -Pattern 'dsh-plugin-nexusai' -Quiet)) { throw 'bundled patch does not mount the plugin' }
  Write-Host 'OK: profile materialized with the plugin row'

  # The client half is the last thing that can be silently missing. Sign-in is
  # user-driven, so the evidence is a stable marker the launcher carries —
  # independent of copy and locale.
  Write-Host '== checking the client plugin mounted (launcher marker) =='
  Push-Location $app
  try {
    $out = node scripts/check-client-mounted.mjs $Port 6000 2>&1 | Out-String
    Write-Host $out.Trim()
    if ($out -notmatch '"launcher":\s*[1-9]') { Show-Evidence 'launcher marker absent' $fresh; throw 'client plugin did not mount (no launcher marker)' }
  } finally { Pop-Location }
  Write-Host 'OK: launcher marker present — host, client and plugin are all wired'
  Stop-App

  # ── scenario 2: a stale home must self-heal ───────────────────────────────
  # Reproduces the field report exactly: the home's node_modules junction points
  # at some other directory (an app that moved or was replaced) and the marker is
  # from an older version. The link gets rebuilt rather than becoming fatal.
  $stale = Join-Path $tempRoot "nexusai-stale-$([guid]::NewGuid().ToString('N').Substring(0,8))"
  $staleProfile = Join-Path $stale 'profiles\nexusai'
  $wrongTarget = Join-Path $tempRoot "nexusai-wrong-$([guid]::NewGuid().ToString('N').Substring(0,8))"
  New-Item -ItemType Directory -Force -Path $staleProfile, $wrongTarget | Out-Null
  $link = Join-Path $staleProfile 'node_modules'
  & cmd /c mklink /J "`"$link`"" "`"$wrongTarget`"" | Out-Null
  if (-not (Test-Path $link)) { throw 'could not create the stale junction for the self-heal check' }
  Set-Content -Path (Join-Path $staleProfile '.nexusai-desktop-runtime') -Value '0.0.0+stale' -Encoding utf8
  Write-Host '== checking a stale home self-heals (junction pointing elsewhere) =='

  if (-not (Test-AppBoots $stale 'stale home')) { Show-Evidence 'stale home never reported ready' $stale; throw 'stale home: the app did not rebuild the runtime link' }
  $modulesItem = Get-Item (Join-Path $staleProfile 'node_modules')
  if ($modulesItem.LinkType -eq 'Junction' -or $modulesItem.LinkType -eq 'SymbolicLink') {
    throw 'stale home: node_modules is still one link; expected a directory with only the plugin linked'
  }
  if (-not (Test-Path (Join-Path $staleProfile 'node_modules\@toby\dsh-plugin-nexusai'))) {
    throw 'stale home: plugin link was not created'
  }
  Write-Host 'OK: stale home — runtime came up; node_modules is a directory and the plugin is linked'
  Stop-App

  # ── scenario 3: the junction points at the app's own runtime ──────────────
  # This is the field case that cost a reinstall: a home from a previous install
  # whose link targets the app's bundled runtime, plus a stale marker, so the
  # shell rebuilds the link. Rebuilding must not touch the target — a recursive
  # remove that follows the junction would wipe the runtime the app ships.
  $bundled = Join-Path $installDir 'resources\nexusai-runtime\profile\node_modules'
  $bundledCli = Join-Path $bundled '@deepseek-ai\dsh\lib\bin.js'
  if (-not (Test-Path $bundledCli)) { throw "bundled runtime missing the CLI before the check: $bundledCli" }
  $pointed = Join-Path $tempRoot "nexusai-pointed-$([guid]::NewGuid().ToString('N').Substring(0,8))"
  $pointedProfile = Join-Path $pointed 'profiles\nexusai'
  New-Item -ItemType Directory -Force -Path $pointedProfile | Out-Null
  & cmd /c mklink /J "`"$(Join-Path $pointedProfile 'node_modules')`"" "`"$bundled`"" | Out-Null
  Set-Content -Path (Join-Path $pointedProfile '.nexusai-desktop-runtime') -Value '0.0.0+stale' -Encoding utf8
  Write-Host '== checking a link aimed at the bundled runtime survives its rebuild =='

  if (-not (Test-AppBoots $pointed 'home pointing at the bundled runtime')) { Show-Evidence 'app did not come up' $pointed; throw 'the app did not survive rebuilding a link aimed at its own runtime' }
  Stop-App
  if (-not (Test-Path $bundledCli)) {
    Show-Evidence 'the bundled runtime lost its CLI' $pointed
    throw "rebuilding the link DELETED the app's own runtime ($bundledCli is gone) — that is destructive, never acceptable"
  }
  Write-Host 'OK: rebuilding the link left the app runtime intact'

  Write-Host '== all checks passed =='
} catch {
  Write-Host "FAILED: $($_.Exception.Message)"
  exit 1
} finally {
  Stop-App
  if (-not $SkipUninstall) {
    $uninstaller = Get-ChildItem $installDir -Filter 'Uninstall*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($uninstaller) {
      Write-Host '== silent uninstall =='
      Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -Wait | Out-Null
      Start-Sleep -Seconds 5
      if (Test-Path $exe) { Write-Host 'note: install directory still present after uninstall' }
      else { Write-Host 'OK: uninstall removed the installed app' }
    }
  }
}
