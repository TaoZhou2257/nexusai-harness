/**
 * NexusAgent Builder — minimal Electron carrier for a bundled dsh profile.
 *
 * What it does, in order:
 *   1. resolve its own dsh home (`<userData>/dsh-home`);
 *   2. materialize the bundled `nexusai` profile into that home (first run, and
 *      again whenever the bundled runtime version changes);
 *   3. spawn the bundled dsh CLI on the app's own Electron binary in Node mode;
 *   4. read the `dsh web: http://127.0.0.1:<port>/?token=…` line off its stdout
 *      and open a centered window on it;
 *   5. kill the runtime when the app quits.
 *
 * CommonJS on purpose: no build step, no module-format surprises under Electron.
 */
const { app, BrowserWindow, Menu, shell, screen } = require('electron')
const { spawn } = require('node:child_process')
const {
  cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync,
  rmSync, symlinkSync, unlinkSync, writeFileSync,
} = require('node:fs')
const { join, resolve } = require('node:path')

const PROFILE_NAME = 'nexusai'
const APP_NAME = process.env.NEXUSAI_APP_NAME || 'NexusAgent Builder'
const READY_PATTERN = /dsh web:\s+(http:\/\/127\.0\.0\.1:\d+\/?\?token=[^\s]+)/u

/** Bundled runtime root: `resources/nexusai-runtime` in a packaged app, `build/` when running from source. */
function bundledRoot() {
  if (process.env.NEXUSAI_BUNDLED_RUNTIME) return resolve(process.env.NEXUSAI_BUNDLED_RUNTIME)
  if (!app.isPackaged) return join(__dirname, '..', 'build')
  return join(process.resourcesPath, 'nexusai-runtime')
}

/** The profile shipped inside the bundle: node_modules + profile manifests. */
function bundledProfileDir() {
  return join(bundledRoot(), 'profile')
}

function runtimeHome() {
  if (process.env.NEXUSAI_DSH_HOME) return resolve(process.env.NEXUSAI_DSH_HOME)
  return join(app.getPath('userData'), 'dsh-home')
}

/** dsh CLI entry inside the bundled profile. */
function dshCli(profileDir) {
  return join(profileDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

/**
 * Point the home's profile at the bundled one.
 *
 * Manifest files are copied (they are small and the user may edit them), while
 * `node_modules` is linked to the bundle so a first launch does not copy
 * hundreds of megabytes. The marker records which bundle version the home was
 * materialized from; a different version relinks. A `node_modules` the app did
 * not create is never deleted — that is a user's own runtime and we refuse to
 * clobber it.
 */
function materializeProfile(home) {
  const source = bundledProfileDir()
  if (!existsSync(join(source, 'node_modules'))) {
    throw new Error(`bundled runtime is incomplete (missing ${join(source, 'node_modules')})`)
  }
  const runtimeVersion = readFileSync(join(bundledRoot(), 'runtime-version.txt'), 'utf8').trim()
  const target = join(home, 'profiles', PROFILE_NAME)
  const marker = join(target, '.nexusai-desktop-runtime')
  const sourceModules = join(source, 'node_modules')
  const targetModules = join(target, 'node_modules')
  mkdirSync(target, { recursive: true })
  // Inputs only: `cordis.yml` is dsh's composed output and is regenerated in
  // the user's home, so a stale copy from build time is never shipped.
  for (const name of ['package.json', 'pnpm-workspace.yaml', 'cordis.patch.yml', 'pnpm-lock.yaml']) {
    const from = join(source, name)
    if (existsSync(from)) cpSync(from, join(target, name), { force: true })
  }
  const installed = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : undefined
  const linked = existsSync(targetModules)
    ? (() => { try { return lstatSync(targetModules).isSymbolicLink() } catch { return false } })()
    : false
  if (existsSync(targetModules) && installed !== runtimeVersion) {
    if (!linked) {
      throw new Error(
        `NexusAgent Builder cannot replace the runtime at ${targetModules}: it was not created by this app. `
        + 'Move that directory, then reopen.',
      )
    }
    try { readlinkSync(targetModules) } catch { /* readlink is only for diagnostics */ }
    unlinkSync(targetModules)
  }
  if (!existsSync(targetModules)) {
    symlinkSync(sourceModules, targetModules, process.platform === 'win32' ? 'junction' : 'dir')
  }
  writeFileSync(marker, `${runtimeVersion}\n`, 'utf8')
  return target
}

/**
 * Install a deliberately small menu.
 *
 * The default Electron menu carries Reload / Force Reload / Toggle DevTools,
 * and a reload tears down the page that dsh's host is attached to (a documented
 * way to break the running app). So the menu keeps only what a user needs to
 * quit, edit text and resize — and no reload accelerator exists at all.
 */
function installMenu() {
  const reloadKeys = [
    { key: 'r', meta: true }, { key: 'r', control: true },
    { key: 'F5' }, { key: 'r', meta: true, shift: true }, { key: 'r', control: true, shift: true },
  ]
  const template = [
    ...(process.platform === 'darwin'
      ? [{ role: 'appMenu' }]
      : []),
    { role: 'editMenu' },
    { role: 'viewMenu', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]
  const menu = Menu.buildFromTemplate(template)
  // Belt and braces: roles are the only accelerators above, but strip any reload
  // accelerator that a future Electron default might sneak in.
  for (const item of menu.items) {
    const strip = entry => {
      if (entry.accelerator && reloadKeys.some(k => entry.accelerator.toLowerCase().includes(k.key.toLowerCase()))) entry.accelerator = undefined
      if (Array.isArray(entry.submenu?.items)) entry.submenu.items.forEach(strip)
    }
    strip(item)
  }
  Menu.setApplicationMenu(menu)
  console.log(`menu: minimal installed (${menu.items.length} top-level, no reload)`)
}

function openWindow(url) {
  const { workAreaSize } = screen.getPrimaryDisplay()
  const width = Math.min(1440, Math.max(960, workAreaSize.width - 160))
  const height = Math.min(960, Math.max(640, workAreaSize.height - 160))
  const window = new BrowserWindow({
    width,
    height,
    minWidth: 960,
    minHeight: 640,
    center: true,
    title: APP_NAME,
    backgroundColor: '#111113',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  window.on('page-title-updated', event => { event.preventDefault(); window.setTitle(APP_NAME) })
  // A keyboard reload would drop the page dsh's host is attached to, so those
  // keys are swallowed before Chromium can act on them.
  window.webContents.on('before-input-event', (event, input) => {
    const pressed = input.type === 'keyDown' || input.type === 'keyRawDown'
    const modifier = input.meta || input.control
    const isReload = (modifier && input.key.toLowerCase() === 'r') || input.key === 'F5'
    const isDevTools = modifier && input.alt && input.key.toLowerCase() === 'i'
    if (pressed && (isReload || isDevTools)) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('https://') || target.startsWith('http://')) void shell.openExternal(target)
    return { action: 'deny' }
  })
  void window.loadURL(url).then(() => window.show())
  window.on('closed', () => { mainWindow = undefined })
  mainWindow = window
}

/**
 * Show what went wrong instead of vanishing.
 *
 * dsh runs as a child process, so its failure is invisible to a packaged user
 * (no terminal). A window carrying the captured output is what makes a first-run
 * failure reportable at all.
 */
function showFailure(detail) {
  const text = String(detail || 'unknown error')
  process.stderr.write(`${APP_NAME} failed: ${text}\n`)
  const html = `<!doctype html><meta charset="utf-8"><title>${APP_NAME}</title>
<style>body{margin:0;padding:32px;font:13px/1.6 -apple-system,Segoe UI,sans-serif;background:#111113;color:#e8e8ea}
h1{font-size:15px;margin:0 0 12px}p{margin:0 0 16px;color:#a0a0a8}
pre{white-space:pre-wrap;word-break:break-word;background:#1a1a1d;border-radius:8px;padding:14px;max-height:50vh;overflow:auto;font-size:12px}</style>
<h1>${APP_NAME} 启动失败</h1>
<p>内置运行时没有起来。把下面的信息发给维护者，或先删掉用户目录下的 dsh-home 再试一次。</p>
<pre>${text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre>`
  const window = new BrowserWindow({
    width: 720, height: 480, center: true, title: APP_NAME,
    backgroundColor: '#111113',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  mainWindow = window
  window.on('closed', () => { if (mainWindow === window) mainWindow = undefined })
  return window
}

let runtime
let mainWindow
let quitting = false

function startRuntime(home, profileDir) {
  const cli = dshCli(profileDir)
  if (!existsSync(cli)) throw new Error(`bundled dsh CLI is missing: ${cli}`)
  // The app's own Electron binary doubles as Node (`ELECTRON_RUN_AS_NODE`), so
  // the bundle ships one runtime instead of two.
  const child = spawn(process.execPath, [cli, '--profile', PROFILE_NAME, '--no-open'], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      DSH_HOME: home,
      DSH_AGENTS_HOME: join(home, 'agents'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  runtime = child
  let ready = false
  let output = ''
  const consume = chunk => {
    const text = chunk.toString('utf8')
    process.stderr.write(text)
    if (ready) return
    output = `${output}${text}`.slice(-16_384)
    const match = READY_PATTERN.exec(output)
    if (match && match[1]) {
      ready = true
      openWindow(match[1])
    }
  }
  child.stdout.on('data', consume)
  child.stderr.on('data', chunk => process.stderr.write(chunk))
  child.once('error', cause => {
    if (!quitting) showFailure(`spawn failed: ${cause && cause.message ? cause.message : String(cause)}`)
  })
  child.once('exit', code => {
    runtime = undefined
    // A non-zero exit before the ready line means the runtime never came up.
    if (!quitting && code !== 0) showFailure(ready ? `runtime exited with ${String(code)}` : `runtime exited with ${String(code)} before it was ready\n\n${output.slice(-4000)}`)
  })
}

function stopRuntime() {
  quitting = true
  if (runtime && runtime.exitCode === null) runtime.kill('SIGTERM')
  runtime = undefined
}

app.setName(APP_NAME)
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.on('before-quit', stopRuntime)
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  app.on('activate', () => {
    if (!mainWindow) { app.relaunch(); app.quit() }
  })
  app.whenReady().then(() => {
    installMenu()
    const home = runtimeHome()
    const profile = materializeProfile(home)
    startRuntime(home, profile)
  }).catch(cause => {
    showFailure(cause && cause.stack ? cause.stack : String(cause))
  })
}
