/**
 * Refresh the home's profile manifest without forgetting which bundles the
 * user turned off.
 *
 * `package.json` is the factory manifest (dependencies, the selected bundles)
 * and also the file dsh edits when the Plugins page toggles a bundle. That
 * toggle only rewrites `dsh.profile.bundles`; the dependency stays. Copying
 * the factory file over it turned the bundle back on at the next start.
 *
 * Factory dependency specs are what this build installed, so they win for
 * every package the factory ships. A dependency the user added (a plugin
 * they installed) is kept, and so is its entry in `dsh.profile.bundles` when
 * they left it on. A name the user removed stays removed, and a name the
 * factory adds becomes selected. The factory lists last shipped are kept
 * beside the manifest. A home that has no such record yet (every build before
 * this one overwrote the file) treats a dependency the user has but does not
 * select as a toggle they already made, and treats a dependency the factory
 * does not ship as a plugin they installed.
 */
const { cpSync, existsSync, readFileSync, renameSync, writeFileSync } = require('node:fs')
const { dirname, join } = require('node:path')
const { isDeepStrictEqual } = require('node:util')

/** The factory bundle list this home was last refreshed from. */
const BASELINE_NAME = '.nexusai-factory-bundles.json'
/** The factory dependency specs this home was last refreshed from. */
const DEPENDENCY_BASELINE_NAME = '.nexusai-factory-dependencies.json'

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
  const factorySet = new Set(factory)
  const baseSet = new Set(base ?? [])
  let selected
  if (base !== undefined) {
    const userSet = new Set(user)
    selected = factory.filter(name => !(baseSet.has(name) && !userSet.has(name)))
  } else {
    const userSet = new Set(user)
    selected = factory.filter(name => userSet.has(name) || !Object.hasOwn(userDependencies, name))
  }
  const seen = new Set(selected)
  for (const name of user) {
    if (seen.has(name) || factorySet.has(name)) continue
    // Still selected, but absent from the factory: a plugin the user installed.
    // A name the recorded factory list used to ship and no longer does is not one.
    if (base !== undefined && baseSet.has(name)) continue
    selected.push(name)
    seen.add(name)
  }
  return selected
}

/**
 * Factory specs win for packages this build ships. Anything else the user
 * depends on is a plugin they installed, unless the recorded factory list
 * shipped that same spec and this build no longer does.
 * @param {Record<string, unknown>} factory
 * @param {Record<string, unknown> | undefined} base
 * @param {Record<string, unknown>} user
 * @returns {Record<string, unknown>}
 */
function mergeDependencies(factory, base, user) {
  const merged = { ...factory }
  for (const [name, spec] of Object.entries(user)) {
    if (Object.hasOwn(factory, name)) continue
    if (base !== undefined && Object.hasOwn(base, name) && isDeepStrictEqual(base[name], spec)) continue
    merged[name] = spec
  }
  return merged
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
  const dependencyBaselinePath = join(dirname(target), DEPENDENCY_BASELINE_NAME)
  const factoryText = readFileSync(source, 'utf8')
  const factory = JSON.parse(factoryText)
  const factoryBundles = bundleList(factory, 'bundled profile manifest')
  if (factoryBundles === undefined) {
    cpSync(source, target, { force: true })
    return 'copied'
  }
  const factoryDependencies = dependenciesOf(factory)
  const factoryRecord = `${JSON.stringify(factoryBundles)}\n`
  const dependencyRecord = `${JSON.stringify(factoryDependencies, null, 2)}\n`
  if (!existsSync(target)) {
    writeAtomic(target, factoryText.endsWith('\n') ? factoryText : `${factoryText}\n`)
    writeAtomic(baselinePath, factoryRecord)
    writeAtomic(dependencyBaselinePath, dependencyRecord)
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
  let dependencyBase
  if (existsSync(dependencyBaselinePath)) {
    try {
      const parsed = JSON.parse(readFileSync(dependencyBaselinePath, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object')
      dependencyBase = parsed
    } catch (error) {
      log(`factory dependency baseline ignored (${error && error.message ? error.message : String(error)})`)
    }
  }
  let outcome
  try {
    const user = JSON.parse(userText)
    const userBundles = bundleList(user, 'profile manifest')
    const userDependencies = dependenciesOf(user)
    const merged = mergeBundles(factoryBundles, base, userBundles, userDependencies)
    const dependencies = mergeDependencies(factoryDependencies, dependencyBase, userDependencies)
    const next = JSON.parse(factoryText)
    next.dependencies = dependencies
    next.dsh.profile.bundles = merged
    const nextText = `${JSON.stringify(next, null, 2)}\n`
    const bundlesSame = JSON.stringify(merged) === JSON.stringify(userBundles)
    const dependenciesSame = isDeepStrictEqual(dependencies, userDependencies)
    if (nextText === userText) {
      outcome = 'kept'
    } else if (bundlesSame && dependenciesSame) {
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
  writeAtomic(dependencyBaselinePath, dependencyRecord)
  return outcome
}

module.exports = { refreshProfileManifest, mergeBundles, mergeDependencies, BASELINE_NAME, DEPENDENCY_BASELINE_NAME }
