#!/usr/bin/env pwsh
#
# Install the produced installer on this (real) Windows machine, launch what it
# installed, and prove the app comes up: bundled runtime ready, client plugin
# mounted (the sign-in dialog offers itself on a signed-out start).
#
# This is what turns "the CI job produced an .exe" into "the .exe installs and
# the thing it installs runs" — the parts that can be checked without a human.
# It does NOT cover SmartScreen (a locally built file carries no Mark-of-the-Web)
# or signing in with a real account (the captcha blocks automation on purpose).
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

$installDir = Join-Path $env:LOCALAPPDATA 'Programs\NexusAgent Builder'
$exe = Join-Path $installDir 'NexusAgent Builder.exe'
# RUNNER_TEMP is GitHub's; Yunxiao has no equivalent, so fall back to the OS temp.
$tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$home = Join-Path $tempRoot "nexusai-home-$([guid]::NewGuid().ToString('N').Substring(0,8))"
$log = Join-Path $home 'logs\runtime.log'
$proc = $null

function Show-Evidence([string]$why) {
  Write-Host "--- $why ---"
  if (Test-Path $log) { Get-Content $log -Tail 60 } else { Write-Host '(no runtime log written)' }
  Get-ChildItem (Join-Path $home 'profiles') -Recurse -Depth 1 -ErrorAction SilentlyContinue |
    Select-Object -First 10 FullName | Format-Table -AutoSize | Out-String | Write-Host
}

try {
  Write-Host "== silent install: $($installer.Name) =="
  # One installer, silent flag: NSIS honours /S in both one-click and assisted
  # builds. -Wait so the check that follows tests a finished install.
  $install = Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait -PassThru
  Write-Host "installer exit code: $($install.ExitCode)"
  if (-not (Test-Path $exe)) { throw "installer did not place $exe" }
  Write-Host "OK: installed to $installDir"

  Write-Host '== launching the installed app with a clean home =='
  $env:NEXUSAI_DSH_HOME = $home
  $proc = Start-Process -FilePath $exe -ArgumentList "--remote-debugging-port=$Port" -PassThru

  $deadline = (Get-Date).AddMinutes(4)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $log) {
      if (Select-String -Path $log -Pattern 'runtime ready: http://127\.0\.0\.1:' -Quiet) { $ready = $true; break }
    }
    if ($proc.HasExited) { break }
    Start-Sleep -Seconds 5
  }
  if (-not $ready) { Show-Evidence "runtime never reported ready (exit=$($proc.HasExited))"; throw 'bundled runtime did not come up' }
  Write-Host 'OK: installed app started and its bundled runtime is up'

  $profile = Join-Path $home 'profiles\nexusai'
  if (-not (Test-Path (Join-Path $profile 'package.json'))) { Show-Evidence 'profile missing'; throw 'profile was not materialized' }
  if (-not (Select-String -Path (Join-Path $profile 'cordis.patch.yml') -Pattern 'dsh-plugin-nexusai' -Quiet)) {
    throw 'bundled patch does not mount the plugin'
  }
  Write-Host 'OK: profile materialized with the plugin row'

  # The client half is the last thing that can be silently missing: if it did not
  # mount, nobody could sign in at all. A signed-out start opens the sign-in
  # dialog on its own, so its presence proves host + client + plugin are wired.
  Write-Host '== checking the client plugin mounted (sign-in dialog) =='
  Push-Location $app
  try {
    $out = node scripts/check-auto-signin.mjs $Port 6000 2>&1 | Out-String
    Write-Host $out.Trim()
    if ($out -notmatch '"dialogs":\s*1') { Show-Evidence 'sign-in dialog absent'; throw 'client plugin did not mount (no sign-in dialog)' }
  } finally { Pop-Location }
  Write-Host 'OK: sign-in dialog present — host, client and plugin are all wired'

  Write-Host '== all checks passed =='
} catch {
  Write-Host "FAILED: $($_.Exception.Message)"
  Show-Evidence 'failure evidence'
  exit 1
} finally {
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 3
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
