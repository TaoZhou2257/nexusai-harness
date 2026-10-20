/**
 * The thin profile link and the cipher seed, without booting dsh.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, lstatSync, symlinkSync, readlinkSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { materializeProfile } = require('../src/profile-link.cjs')
const { seedCipher } = require('../src/cipher-seed.cjs')

const failures = []
const check = (name, ok) => {
  if (ok) console.log(`ok  ${name}`)
  else { console.error(`FAIL ${name}`); failures.push(name) }
}

const root = mkdtempSync(join(tmpdir(), 'nexusai-layout-'))
const source = join(root, 'install')
const plugin = join(source, 'node_modules', '@toby', 'dsh-plugin-nexusai')
const cli = join(source, 'node_modules', '@deepseek-ai', 'dsh', 'lib')
mkdirSync(plugin, { recursive: true })
mkdirSync(cli, { recursive: true })
writeFileSync(join(plugin, 'package.json'), '{"name":"@toby/dsh-plugin-nexusai"}\n')
writeFileSync(join(cli, 'bin.js'), '// cli\n')
writeFileSync(join(source, 'package.json'), '{"name":"dsh-profile-nexusai"}\n')
writeFileSync(join(source, 'cordis.patch.yml'), 'baseUrl: only\n')

const home = join(root, 'home')
const first = materializeProfile({
  home, profileName: 'nexusai', sourceProfile: source, appVersion: '0.1.14', runtimeVersion: 'rt', log() {},
})
const modules = join(home, 'profiles', 'nexusai', 'node_modules')
const linked = join(modules, '@toby', 'dsh-plugin-nexusai')
check('node_modules is a real directory', lstatSync(modules).isDirectory() && !lstatSync(modules).isSymbolicLink())
check('plugin link points at the installation', lstatSync(linked).isSymbolicLink() && readlinkSync(linked) === plugin)
check('cli stays in the installation', first.cli === join(cli, 'bin.js') && !existsSync(join(modules, '@deepseek-ai')))
check('patch copied without being the install tree', readFileSync(join(home, 'profiles', 'nexusai', 'cordis.patch.yml'), 'utf8') === 'baseUrl: only\n')

const marker = join(home, 'profiles', 'nexusai', '.nexusai-desktop-runtime')
writeFileSync(marker, '0.0.0+old\n')
rmSync(modules, { recursive: true, force: true })
symlinkSync(source, modules, 'dir')
const sentinel = join(source, 'node_modules', 'SENTINEL')
writeFileSync(sentinel, 'keep\n')
materializeProfile({
  home, profileName: 'nexusai', sourceProfile: source, appVersion: '0.1.14', runtimeVersion: 'rt', log() {},
})
check('old whole-tree link is replaced', lstatSync(modules).isDirectory() && !lstatSync(modules).isSymbolicLink())
check('replacing the link does not delete the installation', readFileSync(sentinel, 'utf8') === 'keep\n')

let refused = false
const foreign = join(root, 'foreign')
mkdirSync(join(foreign, 'profiles', 'nexusai', 'node_modules'), { recursive: true })
try {
  materializeProfile({
    home: foreign, profileName: 'nexusai', sourceProfile: source, appVersion: '0.1.14', runtimeVersion: 'rt', log() {},
  })
} catch {
  refused = true
}
check('a real node_modules this app did not create is refused', refused)

const seedHome = join(root, 'secrets')
mkdirSync(seedHome, { recursive: true })
const seedFile = join(root, 'cipher-seed.json')
writeFileSync(seedFile, JSON.stringify({ seedVersion: 1, aesKey: 'k', aesIv: 'v' }))
writeFileSync(join(seedHome, '.credentials.yaml'), 'version: 1\nrecords:\n  nexusai/session:\n    kind: grant\n    payload:\n      token: stay\n')
check('first seed writes the cipher', seedCipher({ home: seedHome, seedFile, log() {} }) === 'written')
const written = readFileSync(join(seedHome, '.credentials.yaml'), 'utf8')
check('session record survives the cipher write', written.includes('nexusai/session') && written.includes('token: stay'))
check('cipher grant is in the credentials file', written.includes('nexusai/cipher') && written.includes('aesKey: k') && written.includes('aesIv: v'))
check('same seed version is kept', seedCipher({ home: seedHome, seedFile, log() {} }) === 'skipped')
writeFileSync(seedFile, JSON.stringify({ seedVersion: 2, aesKey: 'k2', aesIv: 'v2' }))
check('a newer seed replaces the record', seedCipher({ home: seedHome, seedFile, log() {} }) === 'written')
check('replaced record carries the new key', readFileSync(join(seedHome, '.credentials.yaml'), 'utf8').includes('aesKey: k2'))

if (failures.length > 0) {
  console.error(`${failures.length} failed`)
  process.exit(1)
}
console.log('profile layout checks passed')
