/**
 * Materialize the user profile against a bundled dsh installation.
 *
 * The installation (the prepared profile tree shipped in the app) stays where
 * it was built. The home receives the small manifests plus one link: the
 * NexusAI plugin package. Core packages resolve from the installation the CLI
 * is launched from, which is the layout dsh's runtime resolution expects.
 * A previous build linked the whole `node_modules` tree; that link is removed
 * without following it.
 */
const {
  cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, rmdirSync, symlinkSync, writeFileSync,
} = require('node:fs')
const { join, resolve } = require('node:path')

const LAYOUT = 'plugin-link'
const PLUGIN_SCOPE = '@toby'
const PLUGIN_NAME = 'dsh-plugin-nexusai'

/**
 * Remove a link without ever touching what it points at.
 *
 * `unlink` works for POSIX directory symlinks. `rmdir` detaches a Windows
 * junction. A recursive remove is never used on a link: on Windows it can
 * walk into the target and delete the app's own runtime.
 * @param {string} path
 * @param {(line: string) => void} log
 */
function removeLink(path, log) {
  const entry = lstatSync(path, { throwIfNoEntry: false })
  if (entry === undefined) return
  if (!entry.isSymbolicLink()) {
    rmSync(path, { recursive: true, force: true })
    return
  }
  try {
    rmSync(path, { force: true })
    return
  } catch (error) {
    log(`link remove: unlink failed (${error && error.message ? error.message : String(error)}); trying rmdir`)
  }
  rmdirSync(path)
}

/**
 * @param {string} path
 * @returns {string | undefined}
 */
function readTextIfExists(path) {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return undefined
  }
}

/**
 * @param {object} options
 * @param {string} options.home
 * @param {string} options.profileName
 * @param {string} options.sourceProfile bundled installation profile
 * @param {string} options.appVersion
 * @param {string} options.runtimeVersion
 * @param {(line: string) => void} [options.log]
 * @returns {{ profileDir: string, cli: string }}
 */
function materializeProfile(options) {
  const log = options.log ?? (() => {})
  const source = resolve(options.sourceProfile)
  const sourcePlugin = join(source, 'node_modules', PLUGIN_SCOPE, PLUGIN_NAME)
  const cli = join(source, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (!existsSync(sourcePlugin)) {
    throw new Error(`bundled runtime is incomplete (missing ${sourcePlugin})`)
  }
  if (!existsSync(cli)) {
    throw new Error(`bundled runtime is incomplete (missing ${cli})`)
  }

  const target = join(options.home, 'profiles', options.profileName)
  const modules = join(target, 'node_modules')
  const pluginLink = join(modules, PLUGIN_SCOPE, PLUGIN_NAME)
  const marker = join(target, '.nexusai-desktop-runtime')
  const expected = `${options.appVersion}+${options.runtimeVersion}+${LAYOUT}`
  mkdirSync(target, { recursive: true })
  for (const name of ['package.json', 'pnpm-workspace.yaml', 'cordis.patch.yml', 'pnpm-lock.yaml']) {
    const from = join(source, name)
    if (existsSync(from)) cpSync(from, join(target, name), { force: true })
  }

  const installed = readTextIfExists(marker)
  const entry = lstatSync(modules, { throwIfNoEntry: false })
  if (entry?.isSymbolicLink() === true) {
    log(`runtime link needs rebuilding (whole node_modules link, marker ${installed ?? 'none'})`)
    removeLink(modules, log)
  } else if (entry !== undefined && !entry.isDirectory()) {
    throw new Error(`${modules} exists and is not a directory this app can use. Move it, then reopen.`)
  } else if (entry?.isDirectory() === true && (installed === undefined || !installed.endsWith(`+${LAYOUT}`))) {
    throw new Error(
      `cannot replace the runtime at ${modules}: it was not created by this app. Move that directory, then reopen.`,
    )
  }

  mkdirSync(join(modules, PLUGIN_SCOPE), { recursive: true })
  const linkEntry = lstatSync(pluginLink, { throwIfNoEntry: false })
  const linkOk = linkEntry?.isSymbolicLink() === true && existsSync(pluginLink) && readlinkSync(pluginLink) === sourcePlugin
  if (installed !== expected || !linkOk) {
    if (linkEntry !== undefined) removeLink(pluginLink, log)
    symlinkSync(sourcePlugin, pluginLink, process.platform === 'win32' ? 'junction' : 'dir')
    log(`plugin link ${pluginLink} → ${sourcePlugin}`)
  }
  writeFileSync(marker, `${expected}\n`, 'utf8')
  if (!existsSync(pluginLink)) {
    throw new Error(`plugin link is broken: ${pluginLink} → ${sourcePlugin}. Delete that path and reopen.`)
  }
  return { profileDir: target, cli }
}

module.exports = { materializeProfile, removeLink, LAYOUT }
