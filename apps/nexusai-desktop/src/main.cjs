/**
 * NexusAIHarness — minimal Electron carrier for a bundled dsh profile.
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
const { app, BrowserWindow, Menu, dialog, shell, screen } = require('electron')
const { spawn, spawnSync } = require('node:child_process')
const {
  cpSync, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync,
  renameSync, rmdirSync, rmSync, statSync, symlinkSync, writeFileSync,
} = require('node:fs')
const { dirname, join, resolve } = require('node:path')

const PROFILE_NAME = 'nexusai'
const APP_NAME = process.env.NEXUSAI_APP_NAME || 'NexusAIHarness'
/** The app name earlier builds shipped with; their home is adopted on first launch. */
const LEGACY_APP_NAME = 'NexusAgent Builder'
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

/**
 * Take over the home an earlier release left behind.
 *
 * Electron derives `userData` from the app name, so renaming the app moves the
 * default home — an existing install would otherwise boot "fresh", with its
 * session, skills and connectors stranded under the old directory. Moving that
 * one directory (rather than the whole userData: the rest is disposable Electron
 * state) keeps the upgrade invisible, and it is the same volume, so this is a
 * rename.
 */
function adoptLegacyHome(home) {
  if (existsSync(home)) return home
  const legacy = join(app.getPath('appData'), LEGACY_APP_NAME, 'dsh-home')
  if (!existsSync(legacy)) return home
  try {
    mkdirSync(dirname(home), { recursive: true })
    renameSync(legacy, home)
    logLine(`adopted the home of ${LEGACY_APP_NAME} from ${legacy}`)
  } catch (error) {
    // Leaving it be is the safe direction: the app then starts fresh instead of
    // risking anything.
    logLine(`could not adopt ${legacy}: ${error && error.message ? error.message : String(error)}`)
  }
  return home
}

/** Where the runtime's output is kept, for the user to send with a bug report. */
let logsDir = ''
let runtimeLog = ''
let logStream
/** Resolved once at startup; see {@link resolvePlacement}. */
let windowPlacement = 'center'

/**
 * Start the run log.
 *
 * The packaged app has no terminal, so a failure's only trace used to be the
 * one-shot window. Appending everything the runtime prints to a file under the
 * home means a user can always hand over what happened — and one rotation keeps
 * a long-lived install from growing without bound.
 */
function openLog(home) {
  logsDir = join(home, 'logs')
  mkdirSync(logsDir, { recursive: true })
  runtimeLog = join(logsDir, 'runtime.log')
  try {
    if (statSync(runtimeLog).size > 2 * 1024 * 1024) renameSync(runtimeLog, `${runtimeLog}.1`)
  } catch { /* absent or unreadable: start fresh */ }
  logStream = createWriteStream(runtimeLog, { flags: 'a' })
  logStream.on('error', () => { logStream = undefined })
  logLine(`===== ${APP_NAME} ${app.getVersion()} start ${new Date().toISOString()} =====`)
  logLine(`home ${home}`)
  return runtimeLog
}

/**
 * Write one line to the run log and to stderr (both, so nothing is lost).
 *
 * Tokens are stripped: dsh prints its web URL with the session token, and the
 * log is exactly the file a user is asked to send along with a bug report —
 * that token grants access to the local session.
 */
function logLine(text) {
  const line = (text.endsWith('\n') ? text : `${text}\n`).replace(/(token=)[^&\s"']+/gu, '$1…')
  try { logStream?.write(line) } catch { /* keep going: logging must not break startup */ }
  process.stderr.write(line)
}

/** The bundled runtime's version string, e.g. `0.1.0+dsh-0.2.0-rc.2+mac-arm64`. */
function runtimeVersion() {
  try {
    return readFileSync(join(bundledRoot(), 'runtime-version.txt'), 'utf8').trim()
  } catch {
    return '(unknown)'
  }
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
 * hundreds of megabytes.
 *
 * The link is treated as disposable and **verified**, because a home outlives an
 * install: it can be left pointing at an app directory that was moved,
 * uninstalled or replaced, and a Windows junction to a gone target still
 * occupies the name (so `existsSync` — which resolves through the link — reports
 * "nothing there" while creating a new one fails). The marker therefore carries
 * the app version as well as the runtime version, occupancy is decided with
 * `lstat` (which sees a dangling link), and the CLI is checked before and after:
 * a stale link is simply rebuilt, and only a directory this app did not create
 * is refused.
 */
function materializeProfile(home) {
  const source = bundledProfileDir()
  const sourceModules = join(source, 'node_modules')
  if (!existsSync(sourceModules)) {
    throw new Error(`bundled runtime is incomplete (missing ${sourceModules})`)
  }
  const runtimeVersion = readFileSync(join(bundledRoot(), 'runtime-version.txt'), 'utf8').trim()
  const target = join(home, 'profiles', PROFILE_NAME)
  const targetModules = join(target, 'node_modules')
  const marker = join(target, '.nexusai-desktop-runtime')
  // The app version belongs in the marker: reinstalling or moving the app has to
  // re-point a home that was materialized by the previous one.
  const expected = `${app.getVersion()}+${runtimeVersion}`
  mkdirSync(target, { recursive: true })
  // Inputs only: `cordis.yml` is dsh's composed output and is regenerated in
  // the user's home, so a stale copy from build time is never shipped.
  for (const name of ['package.json', 'pnpm-workspace.yaml', 'cordis.patch.yml', 'pnpm-lock.yaml']) {
    const from = join(source, name)
    if (existsSync(from)) cpSync(from, join(target, name), { force: true })
  }

  const installed = readTextIfExists(marker)
  const entry = lstatSync(targetModules, { throwIfNoEntry: false })
  const ours = entry?.isSymbolicLink() === true
  const cliPresent = () => existsSync(dshCli(target))
  if (entry !== undefined && !ours && installed !== expected) {
    throw new Error(
      `${APP_NAME} cannot replace the runtime at ${targetModules}: it was not created by this app. `
      + 'Move that directory, then reopen.',
    )
  }
  if (ours && (installed !== expected || !cliPresent())) {
    logLine(`runtime link needs rebuilding (marker ${installed ?? 'none'}, cli ${cliPresent() ? 'ok' : 'missing'})`)
    removeLink(targetModules)
  }
  if (lstatSync(targetModules, { throwIfNoEntry: false }) === undefined) {
    symlinkSync(sourceModules, targetModules, process.platform === 'win32' ? 'junction' : 'dir')
  }
  writeFileSync(marker, `${expected}\n`, 'utf8')
  if (!cliPresent()) {
    // Say which side is broken: an ambiguous message here costs a reinstall.
    const sourceCli = existsSync(join(sourceModules, '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
    const entryAfter = lstatSync(targetModules, { throwIfNoEntry: false })
    const state = entryAfter === undefined
      ? 'the link is absent'
      : entryAfter.isSymbolicLink() ? 'the link is in place but does not resolve' : 'the path is a real directory, not our link'
    logLine(`runtime unusable: source CLI ${sourceCli ? 'present' : 'MISSING'} at ${sourceModules}; ${state}; marker ${expected}`)
    throw new Error(sourceCli
      ? `bundled runtime link is broken: ${targetModules} → ${sourceModules} (${state}). Delete that path and reopen.`
      : `the app's bundled runtime is missing files (${join(sourceModules, '@deepseek-ai', 'dsh', 'lib', 'bin.js')}); reinstall the app.`)
  }
  return target
}

/**
 * Remove a link without ever touching what it points at.
 *
 * Three tools, in the order the platform needs them, and never a recursive one:
 * `unlink` works for POSIX directory symlinks and for Windows file symlinks;
 * `rmdir` is what removes a Windows junction or directory symlink (it detaches
 * the reparse point and leaves the target alone) — and it is the reason this
 * function is not just `rm -r`, because a recursive remove is both the thing
 * that failed here on Windows (it refuses junctions) and the thing that can walk
 * into the target, which is the app's own bundled runtime.
 */
function removeLink(path) {
  const entry = lstatSync(path, { throwIfNoEntry: false })
  if (entry === undefined) return
  if (!entry.isSymbolicLink()) {
    // A real directory this app created (the caller checked the marker).
    rmSync(path, { recursive: true, force: true })
    return
  }
  try {
    rmSync(path, { force: true })
    return
  } catch (error) {
    logLine(`link remove: unlink failed (${error && error.message ? error.message : String(error)}); trying rmdir`)
  }
  try {
    rmdirSync(path)
  } catch (error) {
    logLine(`link remove: rmdir failed: ${error && error.message ? error.message : String(error)}`)
    throw error
  }
}

/**
 * Give the first-use workspace our own name instead of dsh's.
 *
 * dsh builds it as `<system Documents>/deepseek-harness/default-workspace` — that
 * middle segment is a literal in dsh's source with no config or env hook, so it
 * cannot be renamed there. It can be renamed *here* without touching dsh:
 * dsh creates the directory and then canonicalizes it with `realpath()`, so if
 * `…/deepseek-harness` is a link to `…/nexusai-harness`, the stored and displayed
 * workspace path reads `…/nexusai-harness/default-workspace`. The two rules that
 * must stay are untouched: the parent is still the account's Documents
 * directory, and the leaf is still `default-workspace` (whose basename dsh turns
 * into the localized "默认工作区" title).
 *
 * Only runs on a first launch (no workspace store yet) and only when the literal
 * path is absent — an existing real directory is never touched, and a failure is
 * logged without blocking startup.
 */
function alignWorkspaceAnchor(home) {
  const store = join(home, 'storages', 'workspace.json')
  if (existsSync(store)) return
  const documents = documentsDirectory()
  if (documents === '') return
  const wanted = join(documents, 'nexusai-harness')
  const literal = join(documents, 'deepseek-harness')
  if (lstatSync(literal, { throwIfNoEntry: false }) !== undefined) {
    logLine(`workspace anchor: ${literal} already exists; leaving the workspace path alone`)
    return
  }
  try {
    mkdirSync(wanted, { recursive: true })
    symlinkSync(wanted, literal, process.platform === 'win32' ? 'junction' : 'dir')
    logLine(`workspace anchor: ${literal} → ${wanted} (dsh stores the resolved path)`)
  } catch (error) {
    logLine(`workspace anchor: could not link ${literal}: ${error && error.message ? error.message : String(error)}`)
  }
}

/**
 * The account's Documents directory, asked of the OS the same way dsh asks.
 * `NEXUSAI_DOCUMENTS_DIR` overrides it (the checks use it, and anyone who wants
 * the workspace somewhere else can too).
 */
function documentsDirectory() {
  const overridden = (process.env.NEXUSAI_DOCUMENTS_DIR ?? '').trim()
  if (overridden !== '') return overridden
  const ask = (command, args) => {
    try {
      const result = spawnSync(command, args, { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] })
      return (result.stdout ?? '').trim().replace(/[\r\n]+$/u, '')
    } catch {
      return ''
    }
  }
  if (process.platform === 'darwin') {
    return ask('osascript', ['-e', 'POSIX path of (path to documents folder from user domain without folder creation)'])
  }
  if (process.platform === 'win32') {
    return ask('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); '
      + '[Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments, '
      + '[Environment+SpecialFolderOption]::DoNotVerify)',
    ])
  }
  return ask('xdg-user-dir', ['DOCUMENTS'])
}

/** A file's trimmed text, or undefined when it is absent. */
function readTextIfExists(path) {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return undefined
  }
}

/** What this app is, in the words a user can act on. */
function showAbout() {
  void dialog.showMessageBox({
    type: 'info',
    title: `关于 ${APP_NAME}`,
    message: `${APP_NAME} ${app.getVersion()}`,
    detail: [
      `内置运行时：${runtimeVersion()}`,
      `dsh home：${runtimeHome()}`,
      `运行日志：${runtimeLog || '(未开始)'}`,
      '',
      '未签名构建：macOS 首次打开需右键 →「打开」；Windows 会先被 SmartScreen 拦一下。',
    ].join('\n'),
    buttons: ['好'],
  })
}

/**
 * Install a deliberately small menu.
 *
 * The default Electron menu carries Reload / Force Reload / Toggle DevTools,
 * and a reload tears down the page that dsh's host is attached to (a documented
 * way to break the running app). So the menu keeps only what a user needs to
 * quit, edit text, resize, and — since there is no terminal — read the logs.
 */
function installMenu() {
  const reloadKeys = [
    { key: 'r', meta: true }, { key: 'r', control: true },
    { key: 'F5' }, { key: 'r', meta: true, shift: true }, { key: 'r', control: true, shift: true },
  ]
  const help = {
    role: 'help',
    submenu: [
      { label: '打开日志目录', click: () => { void shell.openPath(logsDir || runtimeHome()) } },
      { label: '查看运行日志', click: () => { void shell.openPath(runtimeLog) } },
      { type: 'separator' },
      { label: `关于 ${APP_NAME}`, click: showAbout },
    ],
  }
  const template = [
    ...(process.platform === 'darwin'
      ? [{
          role: 'appMenu',
          submenu: [
            { label: `关于 ${APP_NAME}`, click: showAbout },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    { role: 'editMenu' },
    { role: 'viewMenu', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
    help,
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
  logLine(`menu: minimal installed (${menu.items.length} top-level, no reload)`)
}

/**
 * Default window size, in points.
 *
 * Matches the reference editor window this product is used alongside, which is
 * taller and narrower than the proportion-derived size that was here before —
 * the extra height is what makes the workbench's card grid comfortable. It is
 * clamped to the display, so a small screen still gets a usable window.
 */
const DEFAULT_WIDTH = 1200
const DEFAULT_HEIGHT = 800

/**
 * Where the window goes on screen.
 *
 * Positioned explicitly rather than with `center: true`: measured on macOS the
 * built-in centring landed 41 px above the real middle of the work area, and
 * "middle of the work area" is exactly what a first impression should mean.
 * `workArea` already excludes the menu bar and the Dock, so `bottom` rests the
 * window on the Dock rather than under it.
 *
 * - `center` — middle of the work area (default);
 * - `bottom` — same size, bottom edge on the Dock;
 * - `fill` — the whole work area (tallest it can be without going under chrome).
 */
function windowBounds() {
  const { workArea } = screen.getPrimaryDisplay()
  const placement = windowPlacement
  const width = Math.min(DEFAULT_WIDTH, workArea.width)
  const height = placement === 'fill'
    ? workArea.height
    : Math.min(DEFAULT_HEIGHT, workArea.height)
  const x = Math.round(workArea.x + (workArea.width - width) / 2)
  const y = placement === 'center'
    ? Math.round(workArea.y + (workArea.height - height) / 2)
    : Math.round(workArea.y + workArea.height - height)
  return { x, y, width, height, placement, workArea }
}

/**
 * The placement to use, and where that decision came from.
 *
 * A double-clicked app has no shell to set an environment variable in, so the
 * home also carries the choice in a one-word file — the same kind of knob as
 * the log directory, next to the user rather than in a launcher.
 * Precedence: `NEXUSAI_WINDOW_PLACEMENT` (handy when running from source) >
 * `<home>/window-placement` > `center`.
 */
function resolvePlacement(home) {
  const fromEnv = (process.env.NEXUSAI_WINDOW_PLACEMENT ?? '').trim()
  if (fromEnv !== '') return { value: fromEnv, from: 'NEXUSAI_WINDOW_PLACEMENT' }
  try {
    const fromFile = readFileSync(join(home, 'window-placement'), 'utf8').trim()
    if (fromFile !== '') return { value: fromFile, from: `${home}/window-placement` }
  } catch { /* absent: the default applies */ }
  return { value: 'center', from: 'default' }
}

function openWindow(url) {
  const { x, y, width, height, placement, workArea } = windowBounds()
  logLine(`window: ${placement} ${width}x${height} at ${x},${y} (work area ${workArea.x},${workArea.y} ${workArea.width}x${workArea.height})`)
  const window = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 960,
    minHeight: 640,
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
  // Show on the load event, not on the promise: a load that never settles (or
  // settles after something went wrong) otherwise leaves a window that exists
  // but is never visible — the app looks dead while its log says it started.
  window.webContents.once('did-finish-load', () => {
    window.show()
    logLine('window shown')
  })
  window.webContents.once('did-fail-load', (_event, code, description, failedUrl) => {
    logLine(`window load failed (${code} ${description}) ${failedUrl}`)
    // Showing the window regardless is what makes a failure visible at all.
    window.show()
  })
  void window.loadURL(url).catch(error => {
    logLine(`loadURL rejected: ${error && error.message ? error.message : String(error)}`)
    window.show()
  })
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
  logLine(`${APP_NAME} failed: ${text}`)
  logLine(logsDir === '' ? '' : `see ${runtimeLog}`)
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

/**
 * The PATH a GUI-launched app should hand to dsh.
 *
 * macOS gives an app started from Finder/Dock only `/usr/bin:/bin:/usr/sbin:/sbin`,
 * so every tool the user installed elsewhere — node, python3, git, ripgrep, brew
 * — is invisible to the agent's shell. dsh's own desktop solves this by asking
 * the account's login shell for its environment; this is the same idea, kept
 * small: try the shells a Mac has, keep the first PATH that comes back, and
 * give up quietly if none answer.
 *
 * Windows needs none of it: a GUI process inherits the user PATH from the
 * registry, which is the shell's own.
 */
function loginShellPath() {
  if (process.platform === 'win32') return ''
  const shells = [process.env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh']
    .filter((shell, index, all) => typeof shell === 'string' && shell !== '' && all.indexOf(shell) === index)
  for (const shell of shells) {
    try {
      const result = spawnSync(shell, ['-ilc', 'printf %s "$PATH"'], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const path = (result.stdout ?? '').trim()
      if (path !== '') {
        logLine(`PATH from ${shell}: ${path}`)
        return path
      }
    } catch { /* try the next shell */ }
  }
  logLine('could not read a login-shell PATH; using the inherited one')
  return ''
}

/** Merge the login shell's PATH into the inherited one, keeping both orders' intent. */
function enrichedPath() {
  const inherited = process.env.PATH ?? ''
  const fromShell = loginShellPath()
  if (fromShell === '') return inherited
  const seen = new Set()
  const parts = [...fromShell.split(':'), ...inherited.split(':')]
    .map(part => part.trim())
    .filter(part => part !== '' && !seen.has(part) && seen.add(part) !== undefined)
  return parts.join(':')
}

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
      // The user's real toolchain, not the four directories a GUI app inherits.
      PATH: enrichedPath(),
      // `DSH_AGENTS_HOME` is deliberately NOT set. dsh's filesystem skill
      // provider defaults it to `~/.agents` — the machine-level skills root that
      // every agent tool on the machine shares — and overriding it with a
      // directory inside our own home hides the user's whole skill library
      // (learned the hard way: "/" in the composer listed nothing).
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  runtime = child
  let ready = false
  let output = ''
  const consume = chunk => {
    const text = chunk.toString('utf8')
    logLine(text)
    if (ready) return
    output = `${output}${text}`.slice(-16_384)
    const match = READY_PATTERN.exec(output)
    if (match && match[1]) {
      ready = true
      logLine(`runtime ready: ${match[1].replace(/token=[^&\s]+/, 'token=…')}`)
      openWindow(match[1])
    }
  }
  child.stdout.on('data', consume)
  child.stderr.on('data', chunk => logLine(chunk.toString('utf8')))
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
    const home = adoptLegacyHome(runtimeHome())
    openLog(home)
    // Before dsh runs for the first time: point the first-use workspace at our name.
    alignWorkspaceAnchor(home)
    const chosen = resolvePlacement(home)
    windowPlacement = ['bottom', 'fill'].includes(chosen.value) ? chosen.value : 'center'
    logLine(`window placement: ${windowPlacement} (from ${chosen.from})`)
    installMenu()
    const profile = materializeProfile(home)
    startRuntime(home, profile)
  }).catch(cause => {
    showFailure(cause && cause.stack ? cause.stack : String(cause))
  })
}
