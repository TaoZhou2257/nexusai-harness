/**
 * Hide the settings-header "open configuration file" button.
 *
 * That button is one header action, so it shows on every settings page. dsh
 * draws it only when the host reports `hasDocument: true`, and the published
 * controller hardcodes that flag. There is no config key. Rewriting the one
 * flag after install makes the button stay unmounted; settings forms keep
 * working because they follow `writable`, not this flag.
 */
const { readFileSync, writeFileSync } = require('node:fs')

const DOCUMENT_FLAG_FROM = 'writable: settings.writable,\n\t\t\t\thasDocument: true,'
const DOCUMENT_FLAG_TO = 'writable: settings.writable,\n\t\t\t\thasDocument: false,'

/**
 * Tell the client there is no local settings document to open.
 * Idempotent. Throws when the flag moved, so a dsh upgrade cannot silently
 * put the button back.
 * @param {string} controllerFile - `dsh-api-settings-controller/lib/index.js`.
 */
function hideInstalledSettingsDocument(controllerFile) {
  const source = readFileSync(controllerFile, 'utf8')
  const fromCount = countOccurrences(source, DOCUMENT_FLAG_FROM)
  const toCount = countOccurrences(source, DOCUMENT_FLAG_TO)
  if (fromCount === 1 && toCount === 0) {
    writeFileSync(controllerFile, source.replace(DOCUMENT_FLAG_FROM, DOCUMENT_FLAG_TO))
    return 'hidden'
  }
  if (fromCount === 0 && toCount === 1) return 'already'
  throw new Error(
    `settings document flag is not where prepare-runtime expects it in ${controllerFile} `
    + `(visible: ${fromCount}, hidden: ${toCount}). `
    + 'dsh changed settings describe(); update settings-chrome.cjs before shipping.',
  )
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

module.exports = {
  DOCUMENT_FLAG_FROM,
  DOCUMENT_FLAG_TO,
  hideInstalledSettingsDocument,
}

if (require.main === module) {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const root = mkdtempSync(join(tmpdir(), 'settings-chrome-'))
  const controller = join(root, 'index.js')
  writeFileSync(controller, `return {\n${DOCUMENT_FLAG_FROM}\n};\n`)
  if (hideInstalledSettingsDocument(controller) !== 'hidden') throw new Error('expected hidden')
  if (!readFileSync(controller, 'utf8').includes(DOCUMENT_FLAG_TO)) throw new Error('flag was not rewritten')
  if (hideInstalledSettingsDocument(controller) !== 'already') throw new Error('expected already')
  writeFileSync(controller, 'hasDocument: true\n')
  let threw = false
  try { hideInstalledSettingsDocument(controller) } catch { threw = true }
  if (!threw) throw new Error('expected a moved flag to throw')
  console.log('settings-chrome: ok')
}
