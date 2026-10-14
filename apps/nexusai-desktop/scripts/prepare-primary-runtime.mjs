#!/usr/bin/env node
/**
 * Produce the bundled "primary runtime": Node.js + pnpm + a Python interpreter
 * with the Office libraries, plus the Office skill assets beside it.
 *
 * dsh's own desktop ships this payload so that Office skills work out of the box
 * (they call `load_workspace_dependencies` and execute the interpreter it
 * returns, rather than discovering a system Python). dsh builds it with
 * `scripts/primary-runtime/prepare.ts` inside its repository; we reproduce the
 * same layout **without needing a dsh checkout or its node_modules**, because CI
 * deliberately does not materialize the submodule:
 *
 *   build/runtime/primary-runtime/     node, pnpm, python (+ wheels), runtime.json
 *   build/runtime/office-skills/       the skill package's assets, verbatim
 *
 * Inputs: `primary-runtime-lock.json` (a copy of the pinned dsh version's
 * `scripts/primary-runtime/lock.json` — refresh it when the dsh baseline moves),
 * the installed profile (for the path helper and the Office assets), and the
 * network on first use. Downloads are cached by SHA-256, so a cache seeded by
 * dsh's own prepare step makes this offline.
 *
 * Usage:
 *   node scripts/prepare-primary-runtime.mjs [--target=mac-arm64|win-x64]
 *                                            [--cache=<dir>] [--skip-pnpm]
 */
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = resolve(SCRIPT_DIR, '..')
const PLUGIN_ROOT = resolve(APP_ROOT, '..', '..')
const PROFILE = join(APP_ROOT, 'build', 'profile')
const OUTPUT = join(APP_ROOT, 'build', 'runtime')
const STAGING = join(APP_ROOT, 'build', '.primary-runtime-staging')

const args = process.argv.slice(2).filter(argument => argument !== '--')
const argValue = name => {
  const hit = args.find(a => a.startsWith(`--${name}=`))
  return hit === undefined ? undefined : hit.slice(`--${name}=`.length)
}

const LOCK = JSON.parse(readFileSync(join(APP_ROOT, 'primary-runtime-lock.json'), 'utf8'))
const hostTarget = () => (process.platform === 'darwin' ? `mac-${process.arch}` : `win-${process.arch}`)
const targetName = argValue('target') ?? hostTarget()
const target = LOCK.targets[targetName]
if (target === undefined) {
  throw new Error(`unknown target ${JSON.stringify(targetName)}; expected ${Object.keys(LOCK.targets).join(', ')}`)
}
const platform = targetName.startsWith('win') ? 'win32' : targetName.startsWith('linux') ? 'linux' : 'darwin'
const arch = targetName.endsWith('arm64') ? 'arm64' : 'x64'

/** dsh's own download cache (shared with its prepare step) makes this offline. */
const CACHE = argValue('cache')
  ?? process.env.NEXUSAI_PRIMARY_RUNTIME_CACHE
  ?? (existsSync(join(PLUGIN_ROOT, 'upstream', 'apps', 'desktop', '.desktop-build', 'downloads'))
    ? join(PLUGIN_ROOT, 'upstream', 'apps', 'desktop', '.desktop-build', 'downloads')
    : join(APP_ROOT, 'build', '.primary-runtime-cache'))

const say = message => console.log(`==> ${message}`)

/**
 * Replace every symlink under `root` with a copy of what it points at.
 *
 * Python distributions ship `bin/2to3` and friends as symlinks, and extracting
 * with the platform tar can leave them **absolute** — pointing into whatever
 * directory the build happened to use. A bundle must not contain such links: the
 * path is gone (or wrong) on the user's machine. A dangling link is dropped,
 * since by definition there is nothing to copy.
 */
function materializeSymlinks(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const child = join(root, entry.name)
    let info
    try {
      info = lstatSync(child)
    } catch {
      continue
    }
    if (info.isSymbolicLink()) {
      let target
      try {
        target = realpathSync(child)
      } catch {
        rmSync(child, { force: true })
        continue
      }
      rmSync(child, { force: true })
      cpSync(target, child, { recursive: true, dereference: true })
      continue
    }
    if (info.isDirectory()) materializeSymlinks(child)
  }
}

/** Bytes under a path, tolerant of whatever the tree contains. */
function treeSize(path) {
  let total = 0
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = join(dir, entry.name)
      let info
      try {
        info = lstatSync(child)
      } catch {
        continue
      }
      if (info.isSymbolicLink()) continue
      if (info.isDirectory()) walk(child)
      else total += info.size
    }
  }
  walk(path)
  return total
}

/** Fetch one input, cached under its expected SHA-256 (dsh's own cache layout). */
async function fetchVerified(url, sha256) {
  mkdirSync(CACHE, { recursive: true })
  const cached = join(CACHE, sha256)
  let bytes
  try {
    bytes = readFileSync(cached)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    say(`downloading ${url.split('/').slice(0, 3).join('/')}/…/${url.split('/').pop()}`)
    const timeoutMs = Number(process.env.NEXUSAI_RUNTIME_DOWNLOAD_TIMEOUT_MS ?? '600000')
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) throw new Error(`download failed: ${response.status} ${url}`)
    bytes = Buffer.from(await response.arrayBuffer())
  }
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== sha256) {
    rmSync(cached, { force: true })
    throw new Error(`checksum mismatch for ${url}: expected ${sha256}, got ${digest}`)
  }
  if (!existsSync(cached)) writeFileSync(cached, bytes)
  return cached
}

/** Extract an archive with the platform's tar (bsdtar on Windows handles .zip too). */
function extract(archive, destination) {
  mkdirSync(destination, { recursive: true })
  execFileSync('tar', ['-xf', archive, '-C', destination], { stdio: 'inherit' })
}

say(`primary runtime for ${targetName} (node ${LOCK.nodeVersion}, python ${LOCK.pythonVersion}, cache ${CACHE})`)
rmSync(STAGING, { recursive: true, force: true })
mkdirSync(join(STAGING, 'dependencies'), { recursive: true })

// ── Node ────────────────────────────────────────────────────────────────────
const nodeFile = `node-v${LOCK.nodeVersion}-${target.nodeArchive}`
const nodeArchive = await fetchVerified(`https://nodejs.org/dist/v${LOCK.nodeVersion}/${nodeFile}`, target.nodeSha256)
const nodeTmp = join(STAGING, '.node')
extract(nodeArchive, nodeTmp)
const nodeSource = join(nodeTmp, nodeFile.replace(/\.(?:zip|tar\.gz)$/u, ''))
const nodeDestination = join(STAGING, 'dependencies', 'node')
mkdirSync(join(nodeDestination, 'bin'), { recursive: true })
cpSync(join(nodeSource, ...(platform === 'win32' ? ['node.exe'] : ['bin', 'node'])),
  join(nodeDestination, 'bin', platform === 'win32' ? 'node.exe' : 'node'))
cpSync(join(nodeSource, 'LICENSE'), join(nodeDestination, 'LICENSE'))
mkdirSync(join(nodeDestination, 'node_modules'), { recursive: true })
writeFileSync(join(nodeDestination, 'node_modules', 'README.txt'),
  'Reserved for bundled Node packages. pnpm uses its default installation directories.\n')
rmSync(nodeTmp, { recursive: true, force: true })
say('node in place')

// ── pnpm (the workspace tooling installs project dependencies with it) ──────
const PNPM_VERSION = '11.7.0'
if (!args.includes('--skip-pnpm')) {
  const packDir = join(STAGING, '.pnpm')
  mkdirSync(packDir, { recursive: true })
  if (!existsSync(join(packDir, `pnpm-${PNPM_VERSION}.tgz`))) {
    say(`fetching pnpm ${PNPM_VERSION}`)
    execFileSync('npm', ['pack', `pnpm@${PNPM_VERSION}`, '--pack-destination', packDir, '--silent'],
      { stdio: 'inherit', shell: process.platform === 'win32' })
  }
  const tarball = readdirSync(packDir).find(name => name.startsWith('pnpm-') && name.endsWith('.tgz'))
  if (tarball === undefined) throw new Error('npm pack produced no pnpm tarball')
  const pnpmTmp = join(packDir, 'unpacked')
  extract(join(packDir, tarball), pnpmTmp)
  // Tarballs carry a leading `package/` directory.
  cpSync(join(pnpmTmp, 'package'), join(STAGING, 'dependencies', 'pnpm'), { recursive: true, dereference: true })
  rmSync(packDir, { recursive: true, force: true })
  say('pnpm in place')
}

// ── Python ──────────────────────────────────────────────────────────────────
const pythonFile = `cpython-${LOCK.pythonVersion}+${LOCK.pythonRelease}-${target.pythonTarget}-install_only_stripped.tar.gz`
const pythonArchive = await fetchVerified(
  `https://github.com/astral-sh/python-build-standalone/releases/download/${LOCK.pythonRelease}/${encodeURIComponent(pythonFile)}`,
  target.pythonSha256)
extract(pythonArchive, join(STAGING, 'dependencies'))
if (!existsSync(join(STAGING, 'dependencies', 'python'))) {
  throw new Error('the python archive did not unpack a `python` directory')
}
say('python in place')

// ── manifest + wheels ───────────────────────────────────────────────────────
const manifest = {
  desktopVersion: JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')).version,
  platform,
  arch,
  python: LOCK.pythonVersion,
  node: LOCK.nodeVersion,
  pnpm: PNPM_VERSION,
  pythonPackages: LOCK.pythonPackages,
}
// dsh's own helper decides where the wheels belong, so the layout cannot drift.
const requireFromProfile = createRequire(join(PROFILE, 'package.json'))
const { workspaceDependencyPaths } = requireFromProfile('@deepseek-ai/dsh-tool-workspace-dependencies')
const entries = workspaceDependencyPaths(STAGING, manifest)
mkdirSync(entries.pythonPackages, { recursive: true })
for (const wheel of [...(target.wheels ?? []), ...(LOCK.wheels ?? [])]) {
  const archive = await fetchVerified(wheel.url, wheel.sha256)
  extract(archive, entries.pythonPackages)
}
say(`${(target.wheels ?? []).length + (LOCK.wheels ?? []).length} wheels unpacked`)
writeFileSync(join(STAGING, 'runtime.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)

// numpy/pandas ship their test suites; dsh prunes them too (it also rewrites the
// wheels' RECORD files, which nothing verifies at runtime — we only delete).
const pruned = []
for (const name of ['numpy', 'pandas']) {
  const tests = join(entries.pythonPackages, name, 'tests')
  if (existsSync(tests)) {
    rmSync(tests, { recursive: true, force: true })
    pruned.push(name)
  }
}
say(pruned.length === 0 ? 'no test suites to prune' : `pruned ${pruned.join('/')} test suites`)

// ── publish ─────────────────────────────────────────────────────────────────
// Before anything ships: no symlink may survive (see materializeSymlinks).
materializeSymlinks(STAGING)
rmSync(OUTPUT, { recursive: true, force: true })
mkdirSync(OUTPUT, { recursive: true })
cpSync(STAGING, join(OUTPUT, 'primary-runtime'), { recursive: true, dereference: true })
const officeSource = join(PROFILE, 'node_modules', '@deepseek-ai', 'dsh-skill-office', 'assets')
if (!existsSync(officeSource)) throw new Error(`Office skill assets are missing: ${officeSource}`)
cpSync(officeSource, join(OUTPUT, 'office-skills'), { recursive: true, dereference: true })
rmSync(STAGING, { recursive: true, force: true })

say(`runtime ready: ${OUTPUT}`)
console.log(`    primary-runtime  ${(treeSize(join(OUTPUT, 'primary-runtime')) / 1024 / 1024).toFixed(0)} MB`)
console.log(`    office-skills    ${(treeSize(join(OUTPUT, 'office-skills')) / 1024 / 1024).toFixed(0)} MB`)
