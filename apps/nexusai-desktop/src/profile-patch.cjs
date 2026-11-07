/**
 * Refresh the home's profile patch from the bundle without losing user rows.
 *
 * `cordis.patch.yml` is two things at once. The bundle ships factory rows
 * (hidden account UI, language, office skills, this plugin), and dsh writes
 * the user's own settings into the same file: a custom model API is an
 * `llm-pi-ai` row, a custom connector is a `custom-mcp-*` insert, a changed
 * setting is a `config` field. Copying the bundle over it on every start
 * erased all of that.
 *
 * Each start does a three-way merge instead. The base is the factory patch
 * written last time (kept next to the patch), so a value the user never
 * touched follows the new bundle, a value the user changed stays, and a row
 * only the user has is kept where it was.
 */
const { existsSync, readFileSync, renameSync, writeFileSync } = require('node:fs')
const { dirname, join } = require('node:path')
const { isDeepStrictEqual } = require('node:util')
const { Document, parseDocument } = require('yaml')

/** The bundle patch this home was last refreshed from. */
const BASELINE_NAME = '.nexusai-factory-patch.yml'

/** A `!!js` scalar, carried as its source text so it is written back unevaluated. */
class JsExpression {
  /** @param {string} source */
  constructor(source) {
    this.source = source
  }
}

const JS_TAG = {
  tag: 'tag:yaml.org,2002:js',
  identify: value => value instanceof JsExpression,
  resolve: source => new JsExpression(source),
  stringify: item => JSON.stringify(item.value.source),
}

/**
 * @param {string} text
 * @param {string} label
 * @returns {unknown[]}
 */
function parseRows(text, label) {
  const document = parseDocument(text, { customTags: [JS_TAG] })
  if (document.errors[0] !== undefined) throw new Error(`${label} failed to parse: ${document.errors[0].message}`)
  const rows = document.toJS() ?? []
  if (!Array.isArray(rows)) throw new Error(`${label} is not a YAML sequence`)
  return rows
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof JsExpression)
}

/**
 * @param {unknown} row
 * @returns {string[] | undefined} the ids an `insert` item adds
 */
function insertIds(row) {
  if (!isPlainObject(row) || !Array.isArray(row.insert)) return undefined
  return row.insert.map(item => (isPlainObject(item) ? String(item.id) : '?'))
}

/**
 * Identity of a top-level row: its id, or for an `insert` item the ids it
 * inserts. An insert sharing an id with a factory insert takes that insert's
 * identity, so a release that adds or drops one entry still matches the old
 * item. A repeated identity gets an occurrence suffix.
 * @param {unknown[]} rows
 * @param {Array<[string, Set<string>]>} [factoryInserts]
 * @returns {Array<[string, unknown]>}
 */
function keyed(rows, factoryInserts = []) {
  const seen = new Map()
  return rows.map((row) => {
    let key
    const ids = insertIds(row)
    if (ids !== undefined) {
      const owner = factoryInserts.find(([, owned]) => ids.some(id => owned.has(id)))
      key = owner?.[0] ?? `insert:${[...ids].sort().join(',')}`
    } else if (isPlainObject(row) && typeof row.id === 'string') {
      key = `id:${row.id}`
    } else {
      key = `raw:${JSON.stringify(row)}`
    }
    const count = seen.get(key) ?? 0
    seen.set(key, count + 1)
    return [`${key}#${count}`, row]
  })
}

/**
 * Three-way merge of one value; `undefined` means absent.
 *
 * Without a base (a home last written by a build that kept none), a field
 * both sides set takes the factory value: those builds restored every factory
 * value on each start, so this changes nothing the user could have kept.
 * @param {unknown} factory
 * @param {unknown} base
 * @param {unknown} user
 * @param {boolean} hasBase
 * @returns {unknown}
 */
function merge(factory, base, user, hasBase) {
  if (isDeepStrictEqual(user, base)) return factory
  if (isDeepStrictEqual(factory, base)) return user
  if (isPlainObject(factory) && isPlainObject(user) && (base === undefined || isPlainObject(base))) {
    const out = {}
    for (const key of new Set([...Object.keys(factory), ...Object.keys(user)])) {
      const value = merge(factory[key], base?.[key], user[key], hasBase)
      if (value !== undefined) out[key] = value
    }
    return out
  }
  return hasBase ? user : factory
}

/**
 * Merge the user's patch rows with the new factory rows.
 * @param {unknown[]} factoryRows
 * @param {unknown[] | undefined} baseRows
 * @param {unknown[]} userRows
 * @returns {unknown[]}
 */
function mergeRows(factoryRows, baseRows, userRows) {
  const hasBase = baseRows !== undefined
  const factory = keyed(factoryRows)
  const factoryByKey = new Map(factory)
  const order = factory.map(([key]) => key)
  const factoryInserts = factory.flatMap(([key, row]) => {
    const ids = insertIds(row)
    return ids === undefined ? [] : [[key.replace(/#\d+$/, ''), new Set(ids)]]
  })
  const base = new Map(keyed(baseRows ?? [], factoryInserts))
  const user = keyed(userRows, factoryInserts)
  const userKeys = new Set(user.map(([key]) => key))
  const emitted = new Set()
  const out = []
  const emitFactory = (key, row) => {
    emitted.add(key)
    const value = merge(factoryByKey.get(key), base.get(key), row, hasBase)
    if (value !== undefined) out.push(value)
  }
  for (const [key, row] of user) {
    if (factoryByKey.has(key)) {
      // A factory row the user's file lacks (new, or an insert whose ids
      // changed) goes right after its factory predecessor. Patch rows apply in
      // order, so appending it would put the user's overrides of its entries
      // ahead of the row that creates them, and dsh would drop them.
      for (const earlier of order) {
        if (earlier === key) break
        if (!emitted.has(earlier) && !userKeys.has(earlier)) emitFactory(earlier, undefined)
      }
      emitFactory(key, row)
      for (const next of order.slice(order.indexOf(key) + 1)) {
        if (emitted.has(next) || userKeys.has(next)) break
        emitFactory(next, undefined)
      }
    } else if (base.has(key)) {
      const value = merge(undefined, base.get(key), row, hasBase)
      if (value !== undefined) out.push(value)
    } else {
      out.push(row)
    }
  }
  for (const [key] of factory) {
    if (!emitted.has(key)) emitFactory(key, undefined)
  }
  return out
}

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
 * Bring the home's profile patch up to the bundle's factory rows.
 * @param {object} options
 * @param {string} options.source bundle patch
 * @param {string} options.target home patch
 * @param {(line: string) => void} options.log
 * @returns {'copied' | 'kept' | 'merged' | 'replaced'}
 */
function refreshProfilePatch(options) {
  const { source, target, log } = options
  const baselinePath = join(dirname(target), BASELINE_NAME)
  const factoryText = readFileSync(source, 'utf8')
  if (!existsSync(target)) {
    writeAtomic(target, factoryText)
    writeAtomic(baselinePath, factoryText)
    return 'copied'
  }
  const userText = readFileSync(target, 'utf8')
  let outcome
  try {
    const factoryRows = parseRows(factoryText, 'bundled profile patch')
    const baseRows = existsSync(baselinePath) ? parseRows(readFileSync(baselinePath, 'utf8'), 'factory baseline') : undefined
    const userRows = parseRows(userText, 'profile patch')
    const merged = mergeRows(factoryRows, baseRows, userRows)
    if (isDeepStrictEqual(merged, userRows)) {
      outcome = 'kept'
    } else {
      writeAtomic(target, String(new Document(merged, { customTags: [JS_TAG] })))
      outcome = 'merged'
    }
  } catch (error) {
    const backup = `${target}.bak-${Date.now()}`
    writeAtomic(backup, userText)
    writeAtomic(target, factoryText)
    log(`profile patch could not be merged (${error && error.message ? error.message : String(error)}); kept a copy at ${backup}`)
    outcome = 'replaced'
  }
  writeAtomic(baselinePath, factoryText)
  return outcome
}

module.exports = { refreshProfilePatch, mergeRows, BASELINE_NAME }
