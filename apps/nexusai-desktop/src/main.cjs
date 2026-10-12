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
const { app, BrowserWindow, shell, screen } = require('electron')
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
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('https://') || target.startsWith('http://')) void shell.openExternal(target)
    return { action: 'deny' }
  })
  void window.loadURL(url).then(() => window.show())
  window.on('closed', () => { mainWindow = undefined })
  mainWindow = window
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
  child.once('error', cause => { if (!quitting) throw cause })
  child.once('exit', code => {
    runtime = undefined
    if (!quitting && code !== 0) app.quit()
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
    const home = runtimeHome()
    const profile = materializeProfile(home)
    startRuntime(home, profile)
  }).catch(cause => {
    process.stderr.write(`${APP_NAME} failed to start: ${cause && cause.stack ? cause.stack : String(cause)}\n`)
    app.quit()
  })
}
