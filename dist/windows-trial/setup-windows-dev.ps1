# 一键把 NexusAI 插件接到 Windows 上的 dsh dev 环境（幂等，可重复跑）
#
# 用法（在本目录下）：
#   powershell -ExecutionPolicy Bypass -File .\setup-windows-dev.ps1
#   powershell -ExecutionPolicy Bypass -File .\setup-windows-dev.ps1 -DshRepo D:\src\deepseek-harness
#
# 前置：Node.js 22 LTS + Git + corepack enabled（Node 22 自带）。不需要 Visual Studio。
#
# 脚本做的事：
#   1. 检查 node / git / pnpm(corepack)
#   2. 克隆或复用 dsh 检出，并切到与本插件基线一致的 tag
#   3. pnpm install
#   4. 首次启动一次桌面端，生成 .desktop-build\development（随后自动关掉）
#   5. 解开 plugin-offline.zip 到 dev 工程的 node_modules（插件 + yaml + fflate）
#   6. 把 nexusai 配置行追加到 dev home 的 profiles\desktop\cordis.patch.yml
#
# 之后手动启动：cd <DshRepo>; pnpm run dev:desktop
[CmdletBinding()]
param(
  [string]$DshRepo = (Join-Path $env:USERPROFILE 'dev\deepseek-harness'),
  [string]$DshTag  = 'dsh-v0.2.0-rc.2',
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }

Step '检查环境'
foreach ($tool in @('node', 'git')) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "缺少 $tool。请先安装：winget install $tool"
  }
}
$nodeVersion = (& node -v).TrimStart('v')
if ([int]($nodeVersion.Split('.')[0]) -lt 22) { throw "Node 需要 22 及以上（当前 $nodeVersion）" }
Step "node $nodeVersion / git ok"
& corepack enable | Out-Null
$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpm) { throw 'corepack enable 之后仍找不到 pnpm，请确认 Node 安装的 npm/corepack 在 PATH 中' }

Step "准备 dsh 检出：$DshRepo"
if (-not (Test-Path (Join-Path $DshRepo '.git'))) {
  $parent = Split-Path -Parent $DshRepo
  if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
  & git clone https://github.com/deepseek-ai/deepseek-harness.git $DshRepo
} else {
  Write-Host '   已存在，跳过 clone'
}
Push-Location $DshRepo
& git fetch --tags --quiet
& git checkout $DshTag
$current = (& git rev-parse --short HEAD).Trim()
Step "dsh 版本：$DshTag（$current）"

if (-not $SkipInstall) {
  Step 'pnpm install（首次可能几分钟到十几分钟）'
  & pnpm install
}

$devRoot = Join-Path $DshRepo 'apps\desktop\.desktop-build\development'
if (-not (Test-Path $devRoot)) {
  Step '首次启动桌面端以生成 .desktop-build（约 60 秒，随后自动关闭）'
  $proc = Start-Process -FilePath 'pnpm' -ArgumentList 'run', 'start:desktop' -WorkingDirectory $DshRepo -PassThru -WindowStyle Minimized
  $deadline = (Get-Date).AddMinutes(3)
  while ((Get-Date) -lt $deadline -and -not (Test-Path $devRoot)) { Start-Sleep -Seconds 5 }
  Start-Sleep -Seconds 20
  if (-not $proc.HasExited) { & taskkill /PID $proc.Id /T /F | Out-Null }
  if (-not (Test-Path $devRoot)) { throw ".desktop-build 未生成，请手动运行一次 pnpm run start:desktop 看报错" }
}

Step '拷入插件与依赖（解开 plugin-offline.zip 到 dev 工程的 node_modules）'
$pluginTarget = Join-Path $devRoot 'project\node_modules'
if (-not (Test-Path $pluginTarget)) { New-Item -ItemType Directory -Path $pluginTarget -Force | Out-Null }
Expand-Archive -Path (Join-Path $here 'plugin-offline.zip') -DestinationPath $pluginTarget -Force
$pluginEntry = Join-Path $pluginTarget '@toby\dsh-plugin-nexusai\package.json'
if (-not (Test-Path $pluginEntry)) { throw '插件解压后找不到 @toby\dsh-plugin-nexusai\package.json' }
Step '插件已就位'

Step '写入配置（profiles\desktop\cordis.patch.yml）'
$patchDir = Join-Path $devRoot 'home\profiles\desktop'
if (-not (Test-Path $patchDir)) { New-Item -ItemType Directory -Path $patchDir -Force | Out-Null }
$patchFile = Join-Path $patchDir 'cordis.patch.yml'
$existing = if (Test-Path $patchFile) { Get-Content -Raw -Path $patchFile } else { '' }
$rows = Get-Content -Raw -Path (Join-Path $here 'nexusai.patch.yml')
# 去掉注释行后取纯 YAML 片段
$yamlOnly = ($rows -split "`n" | Where-Object { $_ -notmatch '^\s*#' }) -join "`n"
if ($existing -match '@toby/dsh-plugin-nexusai') {
  Write-Host '   配置已存在，跳过（如需更换服务器地址/密钥，请手工编辑该文件）'
} else {
  $next = ($existing.TrimEnd()) + "`n`n" + $yamlOnly.Trim() + "`n"
  if ($existing.Trim() -eq '') { $next = $yamlOnly.Trim() + "`n" }
  Set-Content -Path $patchFile -Value $next -Encoding utf8
  Write-Host "   已写入 $patchFile"
}

Pop-Location
Step '完成'
Write-Host @"
接下来：
  1. cd $DshRepo
  2. pnpm run dev:desktop
  3. 左下角点「登录」→ 填 NexusAI 账号 + 密码 + 验证码
  4. 验证：侧栏出现「专家 · 技能 · 连接器」，连接器应列出创建+导入的 MCP
排错见 README-WINDOWS.md。窗口位置脚本是 macOS 专属，Windows 上不适用。
"@ -ForegroundColor Green