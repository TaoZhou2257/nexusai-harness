/**
 * Seed the NexusAI login cipher into `$DSH_HOME/.credentials.yaml`.
 *
 * The value ships beside the runtime as `cipher-seed.json`, not in the
 * profile patch. An existing record is left alone unless the seed's
 * `seedVersion` is newer, so a later rotation can replace it and a hand edit
 * of the same version is kept.
 */
const { chmodSync, existsSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { Document, parseDocument } = require('yaml')

const RECORD_KEY = 'nexusai/cipher'

/**
 * @param {string | undefined} text
 * @returns {import('yaml').Document}
 */
function mutableDocument(text) {
  const document = text === undefined ? new Document({}) : parseDocument(text)
  document.setIn(['version'], 1)
  return document
}

/**
 * @param {string | undefined} text
 * @returns {number}
 */
function storedSeedVersion(text) {
  if (text === undefined) return 0
  const root = parseDocument(text).toJS()
  const version = root?.records?.[RECORD_KEY]?.payload?.seedVersion
  return typeof version === 'number' && Number.isFinite(version) ? version : 0
}

/**
 * Write the cipher grant when the seed is newer than the stored record.
 * @param {object} options
 * @param {string} options.home
 * @param {string} options.seedFile
 * @param {(line: string) => void} [options.log]
 * @returns {'absent' | 'skipped' | 'written'}
 */
function seedCipher(options) {
  const log = options.log ?? (() => {})
  if (!existsSync(options.seedFile)) return 'absent'
  const seed = JSON.parse(readFileSync(options.seedFile, 'utf8'))
  const aesKey = typeof seed.aesKey === 'string' ? seed.aesKey : ''
  const aesIv = typeof seed.aesIv === 'string' ? seed.aesIv : ''
  const seedVersion = typeof seed.seedVersion === 'number' ? seed.seedVersion : 1
  if (aesKey === '' || aesIv === '') return 'absent'

  const path = join(options.home, '.credentials.yaml')
  const text = existsSync(path) ? readFileSync(path, 'utf8') : undefined
  if (storedSeedVersion(text) >= seedVersion) {
    log('cipher credential already at this seed version')
    return 'skipped'
  }
  const document = mutableDocument(text)
  document.setIn(['records', RECORD_KEY], {
    kind: 'grant',
    payload: { aesKey, aesIv, seedVersion },
  })
  writeFileSync(path, document.toString(), { encoding: 'utf8', mode: 0o600 })
  chmodSync(path, 0o600)
  log(`cipher credential written (${RECORD_KEY}, seed ${seedVersion})`)
  return 'written'
}

module.exports = { seedCipher, RECORD_KEY }
