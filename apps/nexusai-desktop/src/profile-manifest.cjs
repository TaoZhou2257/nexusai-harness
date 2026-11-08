/**
 * Refresh the home's profile manifest without forgetting which bundles the
 * user turned off.
 *
 * `package.json` is the factory manifest (dependencies, the selected bundles)
 * and also the file dsh edits when the Plugins page toggles a bundle. That
 * toggle only rewrites `dsh.profile.bundles`; the dependency stays. Copying
 * the factory file over it turned the bundle back on at the next start.
 *
 * Dependencies still come from the factory every start, so the bundle we just
 * built is what pnpm installed. Only the bundle list is merged. A name the
 * user removed stays removed, and a name the factory adds becomes selected.
 * The list last shipped is kept beside the manifest. A home that has no such
 * record yet (every build before this one overwrote the file) treats a
 * dependency the user has but does not select as a toggle they already made,
 * so turning a bundle off survives the first start of this build too. A
 * package their manifest never depended on is a factory addition and is
 * selected.
 */
const { cpSync, existsSync, readFileSync, renameSync, writeFileSync } = require('node:fs')
const { dirname, join } = require('node:path')

/** The factory bundle list this home was last refreshed from. */
const BASELINE_NAME = '.nexusai-factory-bundles.json'

/**
 * @param {string} path
 * @param {string} text
 */
function writeAtomic(path, text) {
  const temporary = `${path}.tmp-${process.pid}`
  writeFileSync(temporary, text, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, path)
}

/**
 * @param {unknown} manifest
 * @param {string} label
 * @returns {string[] | undefined}
 */
function bundleList(manifest, label) {
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new Error(`${label} is not a JSON object`)
  }
  const list = manifest.dsh?.profile?.bundles
  if (list === undefined) return undefined
  if (!Array.isArray(list) || list.some(name => typeof name !== 'string')) {
    throw new Error(`${label} dsh.profile.bundles is not a string list`)
  }
  return list
}

/**
 * @param {unknown} manifest
 * @returns {Record<string, unknown>}
 */
function dependenciesOf(manifest) {
  const dependencies = manifest?.dependencies
  if (typeof dependencies !== 'object' || dependencies === null || Array.isArray(dependencies)) return {}
  return dependencies
}

/**
 * @param {string[]} factory
 * @param {string[] | undefined} base absent when this home has no recorded factory list
 * @param {string[] | undefined} user absent when their manifest names no list
 * @param {Record<string, unknown>} userDependencies
 * @returns {string[]}
 */
function mergeBundles(factory, base, user, userDependencies) {
  if (user === undefined) return [...factory]
  if (base !== undefined) {
    const baseSet = new Set(base)
    const userSet = new Set(user)
    return factory.filter(name => !(baseSet.has(name) && !userSet.has(name)))
  }
  const selected = new Set(user)
  return factory.filter(name => selected.has(name) || !Object.hasOwn(userDependencies, name))
}

/**
 * Bring the home's profile manifest up to the factory one, keeping bundle
 * toggles the user made.
 * @param {object} options
 * @param {string} options.source factory manifest
 * @param {string} options.target home manifest
 * @param {(line: string) => void} options.log
 * @returns {'copied' | 'kept' | 'updated' | 'merged' | 'replaced'}
 */
function refreshProfileManifest(options) {
  const { source, target, log } = options
  const baselinePath = join(dirname(target), BASELINE_NAME)
  const factoryText = readFileSync(source, 'utf8')
  const factory = JSON.parse(factoryText)
  const factoryBundles = bundleList(factory, 'bundled profile manifest')
  if (factoryBundles === undefined) {
    cpSync(source, target, { force: true })
    return 'copied'
  }
  const factoryRecord = `${JSON.stringify(factoryBundles)}\n`
  if (!existsSync(target)) {
    writeAtomic(target, factoryText.endsWith('\n') ? factoryText : `${factoryText}\n`)
    writeAtomic(baselinePath, factoryRecord)
    return 'copied'
  }
  const userText = readFileSync(target, 'utf8')
  let base
  if (existsSync(baselinePath)) {
    try {
      const parsed = JSON.parse(readFileSync(baselinePath, 'utf8'))
      if (!Array.isArray(parsed) || parsed.some(name => typeof name !== 'string')) throw new Error('not a string list')
      base = parsed
    } catch (error) {
      log(`factory bundle baseline ignored (${error && error.message ? error.message : String(error)})`)
    }
  }
  let outcome
  try {
    const user = JSON.parse(userText)
    const userBundles = bundleList(user, 'profile manifest')
    const merged = mergeBundles(factoryBundles, base, userBundles, dependenciesOf(user))
    const next = JSON.parse(factoryText)
    next.dsh.profile.bundles = merged
    const nextText = `${JSON.stringify(next, null, 2)}\n`
    if (nextText === userText) {
      outcome = 'kept'
    } else if (JSON.stringify(merged) === JSON.stringify(userBundles)) {
      writeAtomic(target, nextText)
      outcome = 'updated'
    } else {
      writeAtomic(target, nextText)
      outcome = 'merged'
    }
  } catch (error) {
    const backup = `${target}.bak-${Date.now()}`
    writeAtomic(backup, userText)
    writeAtomic(target, factoryText.endsWith('\n') ? factoryText : `${factoryText}\n`)
    log(`profile manifest could not be merged (${error && error.message ? error.message : String(error)}); kept a copy at ${backup}`)
    outcome = 'replaced'
  }
  writeAtomic(baselinePath, factoryRecord)
  return outcome
}

module.exports = { refreshProfileManifest, mergeBundles, BASELINE_NAME }
