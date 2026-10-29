#!/usr/bin/env node
/**
 * Build the bundled runtime for one target: the plugin tarball, the dsh profile
 * that carries it, and a version marker.
 *
 * The profile is a plain pnpm project — `@deepseek-ai/dsh` pinned to the version
 * `upstream.json` names, the official bundles it activates, and our plugin — so
 * the bundle needs no dsh source build and no host-side Windows machine:
 * `supportedArchitectures` makes pnpm resolve the *target* platform's optional
 * dependencies, which is the only platform-sensitive part of the tree.
 *
 * Secrets never enter git. NEXUSAI_BASE_URL is written into the profile patch.
 * NEXUSAI_AES_KEY / NEXUSAI_AES_IV, when set, are written to cipher-seed.json
 * beside the profile; the shell copies that into the home credentials file.
 * Both come from the environment or a local, git-ignored `.env`.
 *
 * Usage:
 *   node scripts/prepare-runtime.mjs                 # host target
 *   node scripts/prepare-runtime.mjs --target=win-x64
 *   node scripts/prepare-runtime.mjs --target=win-x64 --skip-plugin-build
 *
 * Output:
 *   build/package-cache/toby-dsh-plugin-nexusai-<version>.tgz
 *   build/profile/{package.json,pnpm-workspace.yaml,cordis.patch.yml,node_modules}
 *   build/cipher-seed.json    (only when AES key and IV are both set)
 *   build/runtime-version.txt
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const { renameInstalledWorkspaceAnchor } = createRequire(import.meta.url)('../src/workspace-anchor.cjs')
const { hideInstalledSettingsDocument } = createRequire(import.meta.url)('./settings-chrome.cjs')

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = resolve(SCRIPT_DIR, '..')
const PLUGIN_ROOT = resolve(APP_ROOT, '..', '..')
const UPSTREAM_DIR = join(PLUGIN_ROOT, 'upstream')
const BUILD = join(APP_ROOT, 'build')
const PROFILE = join(BUILD, 'profile')
const CACHE = join(BUILD, 'package-cache')

/** The dsh profile this bundle activates; the shell resolves the same name. */
const PROFILE_NAME = 'nexusai'

const args = process.argv.slice(2).filter(argument => argument !== '--')
const argValue = name => {
  const hit = args.find(a => a.startsWith(`--${name}=`))
  return hit === undefined ? undefined : hit.slice(`--${name}=`.length)
}
const skipPluginBuild = args.includes('--skip-plugin-build')

/** Only these three targets exist upstream; the carrier follows dsh's grammar. */
const TARGETS = {
  'mac-arm64': { platform: 'darwin', arch: 'arm64', os: 'darwin' },
  'mac-x64': { platform: 'darwin', arch: 'x64', os: 'darwin' },
  'win-x64': { platform: 'win32', arch: 'x64', os: 'win32' },
}
const hostTarget = () => {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64'
  if (process.platform === 'win32') return 'win-x64'
  throw new Error(`unsupported build host: ${process.platform}-${process.arch}`)
}
const targetName = argValue('target') ?? hostTarget()
const target = TARGETS[targetName]
if (target === undefined) {
  throw new Error(`unknown target ${JSON.stringify(targetName)}; expected ${Object.keys(TARGETS).join(', ')}`)
}

const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const dshVersion = readJson(join(PLUGIN_ROOT, 'upstream.json')).version
const plugin = readJson(join(PLUGIN_ROOT, 'package.json'))
const app = readJson(join(APP_ROOT, 'package.json'))
// This app declares the pinned pnpm itself. Never fall back to the dsh checkout:
// CI deliberately does not check the submodule out, so `upstream/package.json`
// may not exist there (that ENOENT was the first CI failure).
const pinnedPnpm = app.packageManager?.startsWith('pnpm@')
  ? app.packageManager.slice('pnpm@'.length)
  : '11.7.0'

const say = message => console.log(`\n==> ${message}`)
const run = (command, commandArgs, options = {}) => {
  execFileSync(command, commandArgs, {
    stdio: 'inherit',
    // On Windows `npm` and `corepack` are `.cmd` shims, which execFileSync
    // cannot launch without a shell.
    shell: process.platform === 'win32',
    ...options,
  })
}
/** pnpm through corepack so the pinned version in package.json is the one used. */
const pnpm = (commandArgs, cwd) => run('corepack', ['pnpm', ...commandArgs], { cwd })

/** `.env` in this app, for local builds; CI passes the same names as secrets. */
function localEnv() {
  const path = join(APP_ROOT, '.env')
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const at = trimmed.indexOf('=')
    if (at <= 0) continue
    out[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim().replace(/^['"]|['"]$/g, '')
  }
  return out
}

const settings = { ...localEnv(), ...process.env }
const baseUrl = settings.NEXUSAI_BASE_URL ?? ''
const aesKey = settings.NEXUSAI_AES_KEY ?? ''
const aesIv = settings.NEXUSAI_AES_IV ?? ''
// White-label selection: `--customer=<name>` or NEXUSAI_CUSTOMER picks
// `branding/<name>/`. Its brand.json + images ride inside the profile (the
// plugin serves them while nobody is signed in, the shell takes the window
// title from it) and electron-builder derives app name/icons from the same
// manifest. Empty = the default NexusAIHarness build, untouched.
const customer = (argValue('customer') ?? settings.NEXUSAI_CUSTOMER ?? '').trim()
let brandName = ''
if (customer !== '') {
  const brandFile = join(APP_ROOT, 'branding', customer, 'brand.json')
  if (!existsSync(brandFile)) {
    throw new Error(`NEXUSAI_CUSTOMER=${customer}: ${brandFile} not found — create branding/${customer}/ first`)
  }
  const brand = JSON.parse(readFileSync(brandFile, 'utf8'))
  brandName = typeof brand.name === 'string' ? brand.name.trim() : ''
  if (brandName === '') throw new Error(`${brandFile} has no name`)
}
if (baseUrl === '') {
  throw new Error(
    'NEXUSAI_BASE_URL is not set. Put it in apps/nexusai-desktop/.env (git-ignored) '
    + 'or export it; add NEXUSAI_AES_KEY / NEXUSAI_AES_IV when the server encrypts login payloads.',
  )
}

// ── 0. sanity: the pinned dsh checkout is what upstream.json says ────────────
if (existsSync(join(UPSTREAM_DIR, '.git'))) {
  const head = execFileSync('git', ['-C', UPSTREAM_DIR, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const pinned = readJson(join(PLUGIN_ROOT, 'upstream.json')).commit
  if (head !== pinned) console.warn(`warning: upstream/ is at ${head}, upstream.json pins ${pinned}`)
} else {
  console.warn('warning: upstream/ submodule is not checked out (git submodule update --init)')
}

// ── 1. the plugin tarball ────────────────────────────────────────────────────
say(`packing ${plugin.name}@${plugin.version}`)
if (!skipPluginBuild) run('node', [join(PLUGIN_ROOT, 'scripts', 'build.mjs')], { cwd: PLUGIN_ROOT })
mkdirSync(CACHE, { recursive: true })
// The cache holds only this run's artifact: a leftover tarball would keep the
// profile pinned to a stale plugin build, since the file name is stable across
// rebuilds and pnpm caches by integrity.
for (const stale of readdirSync(CACHE)) rmSync(join(CACHE, stale), { force: true })
const packedName = execFileSync('npm', ['pack', '--pack-destination', CACHE, '--silent'], {
  cwd: PLUGIN_ROOT,
  encoding: 'utf8',
  shell: process.platform === 'win32',
}).trim().split('\n').pop()
const pluginTarball = packedName.startsWith('toby-dsh-plugin-nexusai')
  ? packedName
  : `toby-dsh-plugin-nexusai-${plugin.version}.tgz`
if (!existsSync(join(CACHE, pluginTarball))) throw new Error(`npm pack produced no tarball in ${CACHE}`)
say(`plugin tarball: ${join(CACHE, pluginTarball)}`)

// ── 2. the profile ──────────────────────────────────────────────────────────
say(`writing the ${targetName} profile`)
rmSync(join(PROFILE, 'package.json'), { force: true })
rmSync(join(PROFILE, 'cordis.patch.yml'), { force: true })
// The lockfile too, and for the same reason as the tarball cache below: the
// plugin's version never changes between builds, so a surviving lock would pin
// the *previous* tarball's integrity and pnpm would silently skip reinstalling
// it — the bundle then ships a stale plugin no matter what was just packed.
rmSync(join(PROFILE, 'pnpm-lock.yaml'), { force: true })
mkdirSync(PROFILE, { recursive: true })
// The official bundle set a dsh profile activates; our plugin is not a bundle —
// it is mounted by the patch row below, exactly as it is in development.
const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
writeFileSync(join(PROFILE, 'package.json'), `${JSON.stringify({
  name: `dsh-profile-nexusai`,
  private: true,
  dependencies: {
    '@deepseek-ai/dsh': dshVersion,
    '@deepseek-ai/dsh-base': dshVersion,
    '@deepseek-ai/dsh-web-app': dshVersion,
    [plugin.name]: `file:../package-cache/${pluginTarball}`,
  },
  dsh: { profile: { bundles } },
}, null, 2)}\n`)
writeFileSync(join(PROFILE, 'pnpm-workspace.yaml'), [
  'packages:',
  '  - .',
  '',
  '# One flat tree, and — unlike a development profile, where the surrounding',
  '# dsh project supplies them — peers installed for real: dsh packages declare',
  '# @deepseek-ai/cordis-plugin-{group,include,loader} and friends as',
  '# peerDependencies, and a standalone bundle that skips them cannot boot',
  '# (dsh-app-boot imports them directly).',
  'nodeLinker: hoisted',
  'autoInstallPeers: true',
  '',
  '# The only platform-sensitive step: make pnpm resolve the TARGET platform\'s',
  '# optional dependencies, so a Windows bundle can be built from macOS.',
  'supportedArchitectures:',
  `  os: [${target.os}]`,
  `  cpu: [${target.arch}]`,
  '',
  '# pnpm 11 blocks every dependency lifecycle script until it is reviewed here.',
  '# This list mirrors dsh\'s own (pnpm-workspace.yaml): the native PTY and JSONL',
  '# backends genuinely need theirs; the rest are no-ops we deny.',
  'allowBuilds:',
  '  esbuild: true',
  '  node-pty: true',
  '  koffi: true',
  // dsh approves this one too: its postinstall restores the executable bit on
  // node-pty\'s macOS spawn helper, which the PTY backend needs.
  '  "@deepseek-ai/dsh-subprocess-local": true',
  '  msgpackr-extract: false',
  '  protobufjs: false',
  '  "@google/genai": false',
  '  node-addon-require-builtin: false',
  '  electron-winstaller: false',
  '',
].join('\n'))
writeFileSync(join(PROFILE, 'cordis.patch.yml'), profilePatch())
// The customer brand travels *inside* the profile, so the plugin host and the
// shell read the same manifest out of the packaged app with no extra plumbing.
// Only the manifest and the images it references ship — icon sources and
// provenance copies stay in the repo. A default build clears any earlier
// customer build's copy instead of letting it ride along in the bundle.
if (customer !== '') {
  const brandDir = join(APP_ROOT, 'branding', customer)
  const destination = join(PROFILE, 'branding')
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  cpSync(join(brandDir, 'brand.json'), join(destination, 'brand.json'))
  const brand = JSON.parse(readFileSync(join(brandDir, 'brand.json'), 'utf8'))
  for (const key of ['mark', 'logo']) {
    if (typeof brand[key] === 'string' && brand[key] !== '') {
      cpSync(join(brandDir, brand[key]), join(destination, brand[key]))
    }
  }
  say(`customer brand: ${customer} (${brandName}) → profile branding/`)
} else {
  rmSync(join(PROFILE, 'branding'), { recursive: true, force: true })
}

/**
 * The bundled profile's user-layer patch.
 *
 * In order:
 * 1. hide dsh's built-in DeepSeek account UI (NexusAI sign-in replaces it),
 *    the official-API session-log upload (switch and the upload itself), and
 *    leave the settings-document button to the post-install rewrite below;
 * 2. acknowledge dsh's preview notice on the user's behalf, so a shipped app
 *    opens on the product instead of an onboarding popup. dsh keeps the
 *    acknowledged version in `ui-settings-general.welcomeNoticeVersion` and
 *    compares it for exact equality, so the value has to be the *current*
 *    notice version — read out of the installed client bundle after install
 *    (`welcomeNoticeVersion()`), never hardcoded, or a dsh upgrade silently
 *    brings the popup back;
 * 3. pin the interface language (see the `locale` row below);
 * 4. mount this plugin.
 */
function profilePatch() {
  const acknowledged = welcomeNoticeVersion()
  return [
    '# Generated by scripts/prepare-runtime.mjs — do not edit in the bundle.',
    '- id: ui-settings-account',
    '  disabled: true',
    // Official DeepSeek session-log upload. The switch lives in General
    // settings and only attaches logs to official-API requests. NexusAI does
    // not use that API; disabling the host row stops the upload, and disabling
    // the client row removes the switch (and its toast).
    '- id: session-log-deepseek',
    '  disabled: true',
    '- id: ui-settings-session-log',
    '  disabled: true',
    // Right-sidebar browser. dsh ships this row disabled unless the profile is
    // named `desktop` (official app). This profile is `nexusai`, so the row is
    // turned on here. The carrier has no Electron <webview> host; the plugin
    // then uses its iframe page.
    '- id: ui-sidebar-browser',
    '  disabled: false',
    ...(acknowledged === undefined ? [] : [
      '- id: ui-settings-general',
      "  name: '@deepseek-ai/dsh-client-ui-settings-general'",
      '  config:',
      `    welcomeNoticeVersion: '${acknowledged}'`,
    ]),
    // Interface language: `zh` is dsh's own dictionary id for 简体中文 (it ships
    // `en` and `zh`). dsh matches the page's `navigator.languages` against those
    // ids and falls back to `en`, and that list only reflects the machine when a
    // shell supplies it — our window loads dsh's web app directly, and its
    // Chromium reports this bundle's localization, which is English-only. So the
    // preference (the same stored-setting mechanism the theme uses) is set here.
    '- id: locale',
    "  name: '@deepseek-ai/dsh-client-locale'",
    '  config:',
    "    preference: 'zh'",
    // dsh's first-run "添加一个 API Key 开始使用" prompt is this row's
    // `credentialOnboarding` (default true): the host publishes it as the page
    // global `__DSH_MODELS_ONBOARDING__` before client plugins activate. Off
    // means the app opens on the workbench and users configure a model
    // themselves (设置 → 模型) — which is what the product wants.
    '- id: ui-settings-models',
    "  name: '@deepseek-ai/dsh-client-ui-settings-models'",
    '  config:',
    '    credentialOnboarding: false',
    // Office skills run a *bundled* Python (with python-docx/pptx/openpyxl…) and
    // the bundled Node, never a system interpreter — dsh's own desktop wires the
    // same two rows. `source` is the payload this app ships, `root` is where the
    // tool installs it inside the home, and the skill's assetRoot/node come from
    // that payload; all three are resolved at startup, so the absolute paths are
    // never baked into the bundle.
    '- insert:',
    '    - id: workspace-dependencies',
    "      name: '@deepseek-ai/dsh-tool-workspace-dependencies'",
    '      config:',
    // Quoted on purpose: an unquoted `!!js` scalar containing a ternary's "? … : …"
    // reads as a nested mapping to YAML (dsh's own patch files quote them too).
    '        source: !!js "process.env.DSH_BUNDLED_PRIMARY_RUNTIME"',
    '        root: !!js "process.getBuiltinModule(\'node:path\').join(process.env.DSH_HOME, \'dsh-runtimes\', \'dsh-primary-runtime\')"',
    '    - id: skill-office',
    "      name: '@deepseek-ai/dsh-skill-office'",
    '      config:',
    '        assetRoot: !!js "process.getBuiltinModule(\'node:path\').join(process.env.DSH_BUNDLED_PRIMARY_RUNTIME, \'..\', \'office-skills\')"',
    '        node: !!js "process.getBuiltinModule(\'node:path\').join(process.env.DSH_BUNDLED_PRIMARY_RUNTIME, \'dependencies\', \'node\', \'bin\', process.platform === \'win32\' ? \'node.exe\' : \'node\')"',
    '    - id: nexusai',
    `      name: '${plugin.name}'`,
    '      config:',
    `        baseUrl: '${baseUrl}'`,
    ...(customer === '' ? [] : [
      // The shell hands the bundled manifest's absolute path to dsh through
      // this variable — the brand lives in the *bundle*, not in the materialized
      // home, so the same env pattern as the office rows keeps it authoritative
      // no matter how a profile is materialized. In dev (variable unset) the
      // expression yields undefined and the schema defaults to no brand layer.
      '        brandingFile: !!js "process.env.NEXUSAI_BRANDING_FILE"',
    ]),
    '',
  ].join('\n')
}

/**
 * The preview-notice version this dsh build expects, read from its own client
 * bundle (`WELCOME_NOTICE_VERSION = "…"`). Undefined before install, or if dsh
 * ever renames the constant — in which case the patch simply omits the
 * acknowledgement and the notice shows, which is the safe failure.
 */
function welcomeNoticeVersion() {
  const bundle = join(PROFILE, 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-models', 'lib', 'client.js')
  if (!existsSync(bundle)) return undefined
  const found = /WELCOME_NOTICE_VERSION\s*=\s*"([^"]+)"/u.exec(readFileSync(bundle, 'utf8'))
  return found?.[1]
}

/**
 * Packages to delete because this profile never mounts their feature.
 *
 * **Currently empty on purpose.** The only thing that ever qualified was the
 * voice chain (`sherpa-onnx-*`, `@deepseek-ai/dsh-experimental-*voice*` /
 * `*speech*`, ~46 MB) — dsh composes no row for it and its own plugins page says
 * 语音输入 installs its dependencies on first use, so deleting them was
 * defensible. The product decision went the other way: voice input ships ready,
 * so keep them and do not re-add the list without asking.
 *
 * Two packages are permanently excluded from this list, for different reasons:
 * - `@opentelemetry/*` — the `otel` row IS mounted (it arrives through
 *   `dsh-base`), so removing its libraries breaks boot;
 * - `@deepseek-ai/libreoffice-kit-*` — `office-to-pdf` is a mounted row; the
 *   148 MB it costs is a product decision (currently: keep).
 */
const UNMOUNTED_FEATURE_PACKAGES = []

/**
 * Trim the installed profile to what this target can actually load.
 *
 * Three provably-safe removals, each with the reason it cannot be read back:
 * 1. **source maps** — debugging metadata; nothing in a shipped runtime resolves
 *    them (`*.map` under node_modules, ~49 MB here);
 * 2. **other platforms' prebuilt binaries** — packages like node-pty ship every
 *    platform's `prebuilds/` and pick one at require time, so the rest can never
 *    be read on this target (~26 MB);
 * 3. **packages of features this profile does not mount** (see above, ~46 MB).
 *
 * Everything else stays: the point is dropping what is unreachable, not what is
 * merely optional. The compose probe and the runtime smoke that follow are what
 * prove the result still boots.
 */
function pruneProfile(target) {
  const modules = join(PROFILE, 'node_modules')
  let freed = 0
  const drop = path => {
    freed += directorySize(path)
    rmSync(path, { recursive: true, force: true })
  }

  // 1. source maps
  for (const file of findFiles(modules, name => name.endsWith('.map'))) drop(file)

  // 2. other platforms' prebuilds — only names that are unambiguously another
  //    platform's (`darwin-arm64`, `linux-x64`, …); anything else stays, because
  //    a package may name its tree something we cannot classify.
  const keepPrebuild = target.os === 'win32' ? `win32-${target.arch}` : `darwin-${target.arch}`
  const foreignPrebuild = /^(?:darwin|win32|linux|freebsd|openbsd|android)-/
  for (const dir of findDirectories(modules, name => name === 'prebuilds')) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && foreignPrebuild.test(entry.name) && entry.name !== keepPrebuild) {
        drop(join(dir, entry.name))
      }
    }
  }

  // 3. features this profile never mounts
  for (const name of UNMOUNTED_FEATURE_PACKAGES) {
    const path = join(modules, ...name.split('/'))
    if (existsSync(path)) drop(path)
  }

  say(`pruned ${(freed / 1024 / 1024).toFixed(0)} MB the ${targetName} target cannot load ` +
    `(kept prebuilds/${keepPrebuild})`)
}

/** Bytes under a path (0 when it is missing). */
function directorySize(path) {
  const info = statSync(path, { throwIfNoEntry: false })
  if (info === undefined) return 0
  if (!info.isDirectory()) return info.size
  let total = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    total += directorySize(join(path, entry.name))
  }
  return total
}

/** Every file below `root` matching a name predicate (depth-first, no symlink following). */
function findFiles(root, matches) {
  const found = []
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = join(dir, entry.name)
      if (entry.isDirectory()) walk(child)
      else if (entry.isFile() && matches(entry.name)) found.push(child)
    }
  }
  if (existsSync(root)) walk(root)
  return found
}

/** Every directory below `root` whose own name matches (depth-first). */
function findDirectories(root, matches) {
  const found = []
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const child = join(dir, entry.name)
      if (matches(entry.name)) { found.push(child); continue }
      walk(child)
    }
  }
  if (existsSync(root)) walk(root)
  return found
}

// ── 3. install (target-aware) ───────────────────────────────────────────────
say(`installing the profile with pnpm ${pinnedPnpm} (target ${target.platform}-${target.arch})`)
pnpm(['--dir', PROFILE, 'install'], APP_ROOT)

// Complete the patch now that dsh's own bundles are on disk and the preview
// notice's version can be read from them (see profilePatch()).
const acknowledged = welcomeNoticeVersion()
writeFileSync(join(PROFILE, 'cordis.patch.yml'), profilePatch())
say(acknowledged === undefined
  ? 'preview notice: version unknown — the popup will show once and stay acknowledged'
  : `preview notice: acknowledged as ${acknowledged} (no popup on first run)`)

// ── 3b. the payload the Office skills execute ───────────────────────────────
if (!args.includes('--skip-primary-runtime')) {
  say('preparing the primary runtime (Node + Python + Office libraries)')
  run(process.execPath, [join(APP_ROOT, 'scripts', 'prepare-primary-runtime.mjs'), `--target=${targetName}`], {
    cwd: APP_ROOT,
  })
}

const cli = join(PROFILE, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
if (!existsSync(cli)) throw new Error(`dsh CLI missing after install: ${cli}`)

// The plugin's version never changes between builds, and pnpm keys a `file:`
// dep's freshness on exactly that version — `install` reports "Already up to
// date" and keeps whatever sits in node_modules, stale *or missing* (observed
// on pnpm 11.7 even with the lockfile deleted). So the freshly packed tarball
// is extracted over the installed copy, which is both authoritative (it IS the
// artifact) and the only possible route — the repo root that hosts this script
// is an ancestor of the profile, so copying the tree directly is a self-nested
// copy that fs.cpSync refuses.
const installedPlugin = join(PROFILE, 'node_modules', ...plugin.name.split('/'))
const pluginStage = join(BUILD, '.plugin-stage')
rmSync(pluginStage, { recursive: true, force: true })
mkdirSync(pluginStage, { recursive: true })
execFileSync('tar', ['-xzf', join(CACHE, pluginTarball), '-C', pluginStage])
rmSync(installedPlugin, { recursive: true, force: true })
mkdirSync(dirname(installedPlugin), { recursive: true })
cpSync(join(pluginStage, 'package'), installedPlugin, { recursive: true, dereference: true })
rmSync(pluginStage, { recursive: true, force: true })
say('plugin tree replaced from the fresh tarball (pnpm would have kept whatever was there)')

// dsh hardcodes `<Documents>/deepseek-harness/default-workspace`. Rewrite that
// one join in the installed bundle so first use creates a real
// `nexusai-harness` directory. Must run after install (pnpm may restore the
// published file) and must fail the build if the literal moved.
const workspaceController = join(
  PROFILE, 'node_modules', '@deepseek-ai', 'dsh-api-workspace-controller', 'lib', 'index.js',
)
say(`workspace anchor: ${renameInstalledWorkspaceAnchor(workspaceController)}`)

// The "打开配置文件" button is the settings header action, so it shows on
// every settings page. dsh has no switch for it; the host always reports
// that a document exists. Hide that one flag. Settings forms do not use it.
const settingsController = join(
  PROFILE, 'node_modules', '@deepseek-ai', 'dsh-api-settings-controller', 'lib', 'index.js',
)
say(`settings document: ${hideInstalledSettingsDocument(settingsController)}`)

// ── 4. prune what this target can never load ────────────────────────────────
pruneProfile(target)

// ── 5. marker + a compose check that proves the bundle actually boots ───────
const runtimeVersion = `${plugin.version}+dsh-${dshVersion}+${targetName}`
writeFileSync(join(BUILD, 'runtime-version.txt'), `${runtimeVersion}\n`)
const cipherSeed = join(BUILD, 'cipher-seed.json')
if (aesKey !== '' && aesIv !== '') {
  writeFileSync(cipherSeed, `${JSON.stringify({ seedVersion: 1, aesKey, aesIv })}\n`, { mode: 0o600 })
  say('cipher seed written (not part of the profile patch)')
} else {
  rmSync(cipherSeed, { force: true })
  say('cipher seed omitted: NEXUSAI_AES_KEY and NEXUSAI_AES_IV are not both set')
}

/**
 * Whether one composed row carries `disabled: true` before the next row.
 * @param {string} dump - `dsh --dump-config` text.
 * @param {string} id - row id.
 */
function composedRowDisabled(dump, id) {
  const marker = `- id: ${id}\n`
  const at = dump.indexOf(marker)
  if (at === -1) return false
  const next = dump.indexOf('\n- id:', at + marker.length)
  const block = dump.slice(at, next === -1 ? undefined : next)
  return block.includes('disabled: true')
}

say('checking the profile composes (--dump-config, same platform only)')
if (target.platform === process.platform) {
  // Mirror what the shell does on first launch: dsh resolves a profile as
  // `<DSH_HOME>/profiles/<name>`, so the probe home needs the link, not just
  // the built directory.
  const probeHome = join(BUILD, 'probe-home')
  rmSync(probeHome, { recursive: true, force: true })
  // The same thin profile the shell builds: manifests in the home, the plugin
  // linked out of this installation, core packages resolved from the CLI.
  const { materializeProfile } = createRequire(import.meta.url)('../src/profile-link.cjs')
  materializeProfile({
    home: probeHome,
    profileName: PROFILE_NAME,
    sourceProfile: PROFILE,
    appVersion: app.version,
    runtimeVersion,
    log: message => console.log(`    ${message}`),
  })
  const output = execFileSync(process.execPath, [cli, '--profile', PROFILE_NAME, '--dump-config'], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, DSH_HOME: probeHome },
  })
  if (!output.includes(plugin.name)) {
    throw new Error('composed profile does not list the nexusai plugin row')
  }
  if (!output.includes('ui-settings-account')) {
    console.warn('warning: composed profile has no ui-settings-account row')
  }
  for (const id of ['ui-settings-account', 'session-log-deepseek', 'ui-settings-session-log']) {
    if (!composedRowDisabled(output, id)) {
      throw new Error(`composed profile did not disable ${id}`)
    }
  }
  const browserAt = output.indexOf('- id: ui-sidebar-browser\n')
  const browserNext = browserAt === -1 ? -1 : output.indexOf('\n- id:', browserAt + 1)
  const browserBlock = browserAt === -1 ? '' : output.slice(browserAt, browserNext === -1 ? undefined : browserNext)
  if (!browserBlock.includes('disabled: false') || browserBlock.includes('desktop')) {
    throw new Error('composed profile did not enable ui-sidebar-browser')
  }
  writeFileSync(join(BUILD, 'dump-config.yml'), output)
  say(`profile composes; ${plugin.name} present (dump written to build/dump-config.yml)`)
} else {
  console.log(`skipped: ${target.platform} != host ${process.platform} (CI runs this on the target)`)
}

// dsh writes its composed `cordis.yml` next to the profile whenever it boots.
// That file is an *output* — it must be generated in the user's own home, so
// the bundle ships only inputs.
rmSync(join(PROFILE, 'cordis.yml'), { force: true })

say(`runtime ready: ${BUILD}`)
console.log(`    profile      ${PROFILE}`)
console.log(`    version      ${runtimeVersion}`)
