#!/usr/bin/env node
/**
 * Rebrand the generated **development** app bundle (name + Dock icon) without
 * touching dsh's source.
 *
 * dsh's dev launcher builds `Harness Dev.app` by copying the installed
 * Electron bundle and rewriting its Info.plist (`scripts/development-app.ts`),
 * so the app shows Electron's own icon and that fixed name. The bundle is only
 * rebuilt when its cached identity changes (ports, paths, the source plist), so
 * edits applied here survive normal dev restarts — if dsh ever does rebuild it,
 * just run this script again.
 *
 * Name:  the server's brand by default (`GET /v1/base/custom` → `tab.title`),
 *        read from the address in `.credentials.yaml`; `--name` overrides it.
 * Icon:  the server's login logo by default, padded to a square and converted
 *        to .icns; `--icon path/to.png` uses a local file instead.
 *
 * Usage (stop the app first — a running bundle cannot be re-signed):
 *   node scripts/dev/brand-dev-app.mjs
 *   node scripts/dev/brand-dev-app.mjs --name "NexusAgent Builder" --icon ~/logo.png
 *   node scripts/dev/brand-dev-app.mjs --bundle "/path/Harness Dev.app" --bg 111113
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'

const args = process.argv.slice(2)
const readFlag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}

const dshRepo = resolve(process.env.DSH_REPO ?? '/Users/toby/IdeaProjects/deepseek-harness')
const devRoot = join(dshRepo, 'apps', 'desktop', '.desktop-build', 'development')
const bundle = resolve(readFlag('bundle', join(devRoot, 'Harness Dev.app')))
const home = resolve(process.env.DSH_HOME ?? join(devRoot, 'home'))
const credentials = join(home, '.credentials.yaml')
const iconArg = readFlag('icon', '')
const background = readFlag('bg', 'ffffff').replace(/^#/, '')
let name = readFlag('name', '')

const run = (command, commandArgs, options = {}) =>
  execFileSync(command, commandArgs, { encoding: 'utf8', ...options }).trim()

if (!existsSync(bundle)) {
  console.error(`找不到应用包：${bundle}\n（先用 pnpm run start:desktop 生成，或用 --bundle 指定）`)
  process.exit(1)
}

// A running bundle cannot be re-signed; ask for a stop first.
try {
  const running = execFileSync('pgrep', ['-f', `${bundle}/Contents/MacOS`], { encoding: 'utf8' }).trim()
  if (running !== '') {
    console.error(`应用正在运行（pid ${running.split('\n')[0]}）：先停掉再改（pkill -f "Harness Dev.app"），否则签名会失败`)
    process.exit(1)
  }
} catch {
  // pgrep exits non-zero when nothing matches — that is the expected case.
}

/** The NexusAI address the plugin currently points at (for the default logo). */
function endpoint() {
  try {
    const text = readFileSync(credentials, 'utf8')
    return /baseUrl:\s*(\S+)/.exec(text)?.[1] ?? ''
  } catch {
    return ''
  }
}

/** `GET /v1/base/custom` → brand name + login logo URL (empty on any failure). */
async function branding() {
  const base = endpoint()
  if (base === '') return { name: '', logo: '' }
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/service/api/v1/base/custom`, { signal: AbortSignal.timeout(15_000) })
    const body = await response.json()
    const data = body?.data ?? {}
    const path = data?.login?.logo?.path ?? data?.home?.logo?.path ?? data?.tab?.logo?.path ?? ''
    return {
      name: String(data?.tab?.title ?? data?.home?.title ?? '').trim(),
      logo: path === '' ? '' : `${base.replace(/\/$/, '')}/service/api${String(path).startsWith('/') ? path : `/${String(path)}`}`,
    }
  } catch {
    return { name: '', logo: '' }
  }
}

const brand = await branding()
if (name === '') name = brand.name
if (name === '') {
  console.error('没有得到应用名：用 --name 指定，或确认 .credentials.yaml 里的 nexusai/endpoint 可达')
  process.exit(1)
}

// ── icon source ─────────────────────────────────────────────────────────────
const work = mkdtempSync(join(tmpdir(), 'dsh-brand-'))
const png = join(work, 'source.png')
if (iconArg !== '') {
  if (!existsSync(iconArg)) {
    console.error(`找不到图标文件：${iconArg}`)
    process.exit(1)
  }
  execFileSync('cp', [iconArg, png])
} else if (brand.logo !== '') {
  const response = await fetch(brand.logo, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) {
    console.error(`下载 logo 失败：HTTP ${String(response.status)}（用 --icon 指定本地图片）`)
    process.exit(1)
  }
  writeFileSync(png, Buffer.from(await response.arrayBuffer()))
} else {
  console.error('没有图标来源：用 --icon 指定本地 PNG')
  process.exit(1)
}

// ── square canvas → iconset → .icns (built-in sips/iconutil only) ───────────
const square = join(work, 'square.png')
execFileSync('sips', ['--padToHeightWidth', '1024', '1024', '--padColor', background, png, '--out', square], { stdio: 'pipe' })
const iconset = join(work, 'App.iconset')
execFileSync('mkdir', ['-p', iconset])
for (const [size, suffix] of [[16, '16x16'], [32, '16x16@2x'], [32, '32x32'], [64, '32x32@2x'], [128, '128x128'], [256, '128x128@2x'], [256, '256x256'], [512, '256x256@2x'], [512, '512x512'], [1024, '512x512@2x']]) {
  execFileSync('sips', ['-z', String(size), String(size), square, '--out', join(iconset, `icon_${suffix}.png`)], { stdio: 'pipe' })
}
const icns = join(work, `${name.replace(/[^A-Za-z0-9]/g, '') || 'App'}.icns`)
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icns])

// ── apply to the bundle ─────────────────────────────────────────────────────
const resources = join(bundle, 'Contents', 'Resources')
const icnsName = basename(icns)
execFileSync('cp', [icns, join(resources, icnsName)])
const plist = join(bundle, 'Contents', 'Info.plist')
const set = (key, value) => execFileSync('plutil', ['-replace', key, '-json', JSON.stringify(value), plist])
set('CFBundleName', name)
set('CFBundleDisplayName', name)
set('CFBundleIconFile', icnsName)
// A re-signed ad-hoc bundle keeps Launch Services and Gatekeeper happy.
execFileSync('codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'pipe' })
try {
  execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', bundle], { stdio: 'pipe' })
} catch {
  // lsregister path differs across macOS versions; the sign step is what matters.
}

rmSync(work, { recursive: true, force: true })
console.log(`已重命名：${name}`)
console.log(`已设置图标：${icnsName}（源：${iconArg !== '' ? iconArg : brand.logo}）`)
console.log('重新启动应用即可看到新的 Dock 名称与图标（dsh 若重建了 dev 包，重跑本脚本）。')
void extname