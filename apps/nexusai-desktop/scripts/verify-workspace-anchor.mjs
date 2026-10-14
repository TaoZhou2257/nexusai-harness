/**
 * Local proof that first-use lands on a real `nexusai-harness` directory.
 *
 * 1. restore the published join → run prepare-runtime rename → already
 * 2. retireLegacyWorkspaceLink cases
 * 3. boot bundled dsh with Documents pointed at a temp folder, open the web UI
 *    so client calls initializeDefault, then assert the on-disk tree
 *
 * Usage (from apps/nexusai-desktop, after prepare:runtime at least once):
 *   node scripts/verify-workspace-anchor.mjs
 */
import { spawn } from 'node:child_process'
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const {
  WORKSPACE_JOIN_FROM,
  WORKSPACE_JOIN_TO,
  renameInstalledWorkspaceAnchor,
  retireLegacyWorkspaceLink,
} = require('../src/workspace-anchor.cjs')

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = resolve(SCRIPT_DIR, '..')
const BUILD = join(APP_ROOT, 'build')
const PROFILE = join(BUILD, 'profile')
const PROFILE_NAME = 'nexusai'
const READY_PATTERN = /dsh web:\s+(http:\/\/127\.0\.0\.1:\d+\/?\?token=[^\s]+)/
const controller = join(
  PROFILE, 'node_modules', '@deepseek-ai', 'dsh-api-workspace-controller', 'lib', 'index.js',
)
const cli = join(PROFILE, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function say(message) {
  console.log(`verify-workspace-anchor: ${message}`)
}

function sleep(ms) {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms))
}

assert(existsSync(cli), `bundled dsh CLI missing: ${cli} — run prepare:runtime first`)
assert(existsSync(controller), `controller missing: ${controller}`)
assert(existsSync(chrome), `Google Chrome missing at ${chrome}`)

// ── 1. prepare rename ───────────────────────────────────────────────────────
let source = readFileSync(controller, 'utf8')
if (source.includes(WORKSPACE_JOIN_TO)) {
  writeFileSync(controller, source.replace(WORKSPACE_JOIN_TO, WORKSPACE_JOIN_FROM))
  source = readFileSync(controller, 'utf8')
}
assert(source.includes(WORKSPACE_JOIN_FROM), 'could not restore the published deepseek-harness join')
assert(renameInstalledWorkspaceAnchor(controller) === 'renamed', 'expected renamed')
assert(renameInstalledWorkspaceAnchor(controller) === 'already', 'expected already')
assert(readFileSync(controller, 'utf8').includes(WORKSPACE_JOIN_TO), 'new join missing after rename')
assert(!readFileSync(controller, 'utf8').includes(WORKSPACE_JOIN_FROM), 'old join still present after rename')
say('1/3 prepare rename: ok')

// ── 2. leftover-link cleanup ────────────────────────────────────────────────
const linkRoot = mkdtempSync(join(tmpdir(), 'workspace-anchor-link-'))
const documentsForLink = join(linkRoot, 'Documents')
const wanted = join(documentsForLink, 'nexusai-harness')
const literal = join(documentsForLink, 'deepseek-harness')
mkdirSync(wanted, { recursive: true })
writeFileSync(join(wanted, 'keep.txt'), 'stay')
symlinkSync(wanted, literal, process.platform === 'win32' ? 'junction' : 'dir')
assert(retireLegacyWorkspaceLink(documentsForLink) === 'removed', 'expected alias link removed')
assert(lstatSync(literal, { throwIfNoEntry: false }) === undefined, 'alias link still present')
assert(readFileSync(join(wanted, 'keep.txt'), 'utf8') === 'stay', 'link target was modified')
mkdirSync(literal, { recursive: true })
writeFileSync(join(literal, 'official.txt'), 'keep')
assert(retireLegacyWorkspaceLink(documentsForLink) === 'real-directory', 'expected real directory left alone')
assert(readFileSync(join(literal, 'official.txt'), 'utf8') === 'keep', 'real directory was modified')
rmSync(linkRoot, { recursive: true, force: true })
say('2/3 retire leftover link: ok')

// ── 3. boot dsh + open client so initializeDefault runs ─────────────────────
const root = mkdtempSync(join(tmpdir(), 'workspace-anchor-e2e-'))
const documents = join(root, 'Documents')
const home = join(root, 'dsh-home')
const profileLink = join(home, 'profiles', PROFILE_NAME)
mkdirSync(documents, { recursive: true })
mkdirSync(join(home, 'profiles'), { recursive: true })
symlinkSync(PROFILE, profileLink, process.platform === 'win32' ? 'junction' : 'dir')
// Home-layer patch (same mechanism dsh uses for user overlays) — does not touch build/profile.
writeFileSync(join(home, 'cordis.patch.yml'), [
  '- id: workspace-controller',
  '  config:',
  `    documentsDirectory: '${documents.replace(/'/g, "''")}'`,
  '',
].join('\n'))

const primaryRuntime = join(BUILD, 'runtime', 'primary-runtime')
const child = spawn(process.execPath, [cli, '--profile', PROFILE_NAME, '--no-open'], {
  env: {
    ...process.env,
    ...(existsSync(primaryRuntime) ? { DSH_BUNDLED_PRIMARY_RUNTIME: resolve(primaryRuntime) } : {}),
    ELECTRON_RUN_AS_NODE: process.env.NEXUSAI_SMOKE_ELECTRON_RUN_AS_NODE ?? process.env.ELECTRON_RUN_AS_NODE,
    DSH_HOME: home,
    DSH_AGENTS_HOME: join(home, 'agents'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
const timeoutMs = 120_000
let url
try {
  url = await new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => {
      rejectReady(new Error(`no ready line within ${timeoutMs}ms\n${output.slice(-4000)}`))
    }, timeoutMs)
    const onChunk = chunk => {
      output = `${output}${chunk.toString('utf8')}`.slice(-64_000)
      const match = READY_PATTERN.exec(output)
      if (!match) return
      clearTimeout(timer)
      resolveReady(match[1])
    }
    child.stdout.on('data', onChunk)
    child.stderr.on('data', onChunk)
    child.once('error', cause => {
      clearTimeout(timer)
      rejectReady(cause)
    })
    child.once('exit', code => {
      clearTimeout(timer)
      rejectReady(new Error(`runtime exited early with ${String(code)}\n${output.slice(-2000)}`))
    })
  })
  say(`dsh web ready: ${url.replace(/token=[^&\s]+/, 'token=…')}`)

  // Client mounts in the browser and calls initializeDefault. Headless Chrome loads that page.
  const browser = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${join(root, 'chrome-profile')}`,
    '--virtual-time-budget=60000',
    url,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let browserOut = ''
  browser.stdout.on('data', chunk => { browserOut += chunk.toString('utf8') })
  browser.stderr.on('data', chunk => { browserOut += chunk.toString('utf8') })
  await Promise.race([
    new Promise(resolveExit => browser.once('exit', resolveExit)),
    sleep(45_000).then(() => { browser.kill('SIGTERM') }),
  ])

  // Poll for the directory — client init is async after page load.
  const workspace = join(documents, 'nexusai-harness', 'default-workspace')
  const legacy = join(documents, 'deepseek-harness')
  let workspaceStat
  for (let i = 0; i < 30; i += 1) {
    workspaceStat = lstatSync(workspace, { throwIfNoEntry: false })
    if (workspaceStat?.isDirectory()) break
    await sleep(1_000)
  }

  assert(workspaceStat?.isDirectory() === true, [
    `expected real directory at ${workspace}`,
    `documents listing: ${existsSync(documents) ? require('node:fs').readdirSync(documents).join(', ') || '(empty)' : '(missing)'}`,
    `chrome exit log (tail):\n${browserOut.slice(-1500)}`,
    `dsh log (tail):\n${output.slice(-1500)}`,
  ].join('\n'))
  assert(workspaceStat?.isSymbolicLink() !== true, `workspace must not be a symlink: ${workspace}`)
  assert(lstatSync(legacy, { throwIfNoEntry: false }) === undefined, `legacy path must not exist: ${legacy}`)

  const storage = join(home, 'storages', 'workspace.json')
  assert(existsSync(storage), `workspace storage missing at ${storage}`)
  const text = readFileSync(storage, 'utf8')
  assert(text.includes('nexusai-harness'), `workspace storage missing nexusai-harness:\n${text.slice(0, 800)}`)
  assert(!text.includes('deepseek-harness'), `workspace storage still mentions deepseek-harness:\n${text.slice(0, 800)}`)
  say(`3/3 first-use: ${workspace}`)
  say(`storage path contains nexusai-harness (${storage})`)
} finally {
  child.kill('SIGTERM')
  await Promise.race([
    new Promise(resolveExit => child.once('exit', resolveExit)),
    sleep(5_000),
  ])
  rmSync(root, { recursive: true, force: true })
}

say('ok — Documents/nexusai-harness/default-workspace created with no deepseek-harness link')
