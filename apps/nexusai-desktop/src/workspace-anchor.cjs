/**
 * First-use workspace directory name.
 *
 * dsh joins `<Documents>/deepseek-harness/default-workspace` from a literal in
 * the published controller bundle. There is no config key for the middle
 * segment. `renameInstalledWorkspaceAnchor` rewrites that one call after
 * `pnpm install`, so the app creates a real `nexusai-harness` directory.
 * `retireLegacyWorkspaceLink` only detaches the symlink an earlier build left
 * behind; a real `deepseek-harness` directory is never touched.
 */
const {
  lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmdirSync, rmSync, symlinkSync, writeFileSync,
} = require('node:fs')
const { dirname, isAbsolute, join, normalize, resolve } = require('node:path')

const WORKSPACE_JOIN_FROM = 'paths.join(directory, "deepseek-harness", DEFAULT_WORKSPACE_DIRECTORY)'
const WORKSPACE_JOIN_TO = 'paths.join(directory, "nexusai-harness", DEFAULT_WORKSPACE_DIRECTORY)'

/**
 * Rewrite the installed controller so first-use creates `nexusai-harness`.
 * Idempotent. Throws when the literal is missing or duplicated — a dsh upgrade
 * moved it, and shipping that bundle would recreate the old directory name.
 * @param {string} controllerFile - `dsh-api-workspace-controller/lib/index.js`.
 */
function renameInstalledWorkspaceAnchor(controllerFile) {
  const source = readFileSync(controllerFile, 'utf8')
  const fromCount = countOccurrences(source, WORKSPACE_JOIN_FROM)
  const toCount = countOccurrences(source, WORKSPACE_JOIN_TO)
  if (fromCount === 1 && toCount === 0) {
    writeFileSync(controllerFile, source.replace(WORKSPACE_JOIN_FROM, WORKSPACE_JOIN_TO))
    return 'renamed'
  }
  if (fromCount === 0 && toCount === 1) return 'already'
  throw new Error(
    `workspace anchor literal is not where prepare-runtime expects it in ${controllerFile} `
    + `(deepseek-harness joins: ${fromCount}, nexusai-harness joins: ${toCount}). `
    + 'dsh changed default-directory; update workspace-anchor.cjs before shipping.',
  )
}

/**
 * Remove `<documents>/deepseek-harness` when it is a link to `nexusai-harness`.
 * @param {string} documents - the account Documents directory.
 * @param {(line: string) => void} [log]
 * @returns {'absent' | 'removed' | 'real-directory' | 'other-target' | 'failed'}
 */
function retireLegacyWorkspaceLink(documents, log = () => {}) {
  if (documents === '') return 'absent'
  const wanted = join(documents, 'nexusai-harness')
  const literal = join(documents, 'deepseek-harness')
  const entry = lstatSync(literal, { throwIfNoEntry: false })
  if (entry === undefined) return 'absent'
  if (!entry.isSymbolicLink()) {
    log(`workspace anchor: ${literal} is a real directory; leaving it`)
    return 'real-directory'
  }
  if (!linkPointsAt(literal, wanted)) {
    log(`workspace anchor: ${literal} points elsewhere; leaving it`)
    return 'other-target'
  }
  try {
    detachLink(literal)
    log(`workspace anchor: removed leftover link ${literal}`)
    return 'removed'
  } catch (error) {
    log(`workspace anchor: could not remove ${literal}: ${error && error.message ? error.message : String(error)}`)
    return 'failed'
  }
}

function countOccurrences(source, needle) {
  let count = 0
  let from = 0
  while (from <= source.length) {
    const at = source.indexOf(needle, from)
    if (at === -1) return count
    count += 1
    from = at + needle.length
  }
  return count
}

function linkPointsAt(linkPath, wanted) {
  let target
  try {
    target = readlinkSync(linkPath)
  } catch {
    return false
  }
  const resolved = isAbsolute(target) ? target : resolve(dirname(linkPath), target)
  if (samePath(resolved, wanted)) return true
  try {
    return samePath(realpathSync(linkPath), realpathSync(wanted))
  } catch {
    return false
  }
}

/** Detach a symlink or Windows junction. Never recursive, so the target stays. */
function detachLink(path) {
  try {
    rmSync(path, { force: true })
    if (lstatSync(path, { throwIfNoEntry: false }) === undefined) return
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    if (!/directory|EPERM|EISDIR/u.test(message)) throw error
  }
  rmdirSync(path)
}

function samePath(left, right) {
  const strip = value => normalize(value).replace(/[\\/]+$/u, '')
  const fold = value => (process.platform === 'win32' ? strip(value).toLowerCase() : strip(value))
  return fold(left) === fold(right)
}

module.exports = {
  WORKSPACE_JOIN_FROM,
  WORKSPACE_JOIN_TO,
  renameInstalledWorkspaceAnchor,
  retireLegacyWorkspaceLink,
}

if (require.main === module) {
  const { mkdtempSync, writeFileSync: write } = require('node:fs')
  const { tmpdir } = require('node:os')
  const root = mkdtempSync(join(tmpdir(), 'workspace-anchor-'))
  const controller = join(root, 'index.js')
  const body = `/* <Documents>/deepseek-harness */\nreturn ${WORKSPACE_JOIN_FROM};\n`
  write(controller, body)
  if (renameInstalledWorkspaceAnchor(controller) !== 'renamed') throw new Error('expected renamed')
  if (!readFileSync(controller, 'utf8').includes(WORKSPACE_JOIN_TO)) throw new Error('join was not rewritten')
  if (readFileSync(controller, 'utf8').includes('deepseek-harness */') === false) throw new Error('comment should stay')
  if (renameInstalledWorkspaceAnchor(controller) !== 'already') throw new Error('expected already')
  write(controller, 'no join here\n')
  let threw = false
  try { renameInstalledWorkspaceAnchor(controller) } catch { threw = true }
  if (!threw) throw new Error('expected a missing literal to throw')

  const documents = join(root, 'Documents')
  const wanted = join(documents, 'nexusai-harness')
  const literal = join(documents, 'deepseek-harness')
  mkdirSync(wanted, { recursive: true })
  write(join(wanted, 'keep.txt'), 'stay')
  symlinkSync(wanted, literal, process.platform === 'win32' ? 'junction' : 'dir')
  if (retireLegacyWorkspaceLink(documents) !== 'removed') throw new Error('expected the alias link to be removed')
  if (lstatSync(literal, { throwIfNoEntry: false }) !== undefined) throw new Error('alias link still present')
  if (readFileSync(join(wanted, 'keep.txt'), 'utf8') !== 'stay') throw new Error('link target was modified')

  mkdirSync(literal, { recursive: true })
  write(join(literal, 'official.txt'), 'keep')
  if (retireLegacyWorkspaceLink(documents) !== 'real-directory') throw new Error('expected a real directory to be left alone')
  if (readFileSync(join(literal, 'official.txt'), 'utf8') !== 'keep') throw new Error('real directory was modified')
  rmSync(literal, { recursive: true, force: true })

  const elsewhere = join(root, 'elsewhere')
  mkdirSync(elsewhere, { recursive: true })
  symlinkSync(elsewhere, literal, process.platform === 'win32' ? 'junction' : 'dir')
  if (retireLegacyWorkspaceLink(documents) !== 'other-target') throw new Error('expected a foreign link to be left alone')
  if (!lstatSync(literal).isSymbolicLink()) throw new Error('foreign link was removed')

  rmSync(root, { recursive: true, force: true })
  console.log('workspace-anchor: ok')
}
