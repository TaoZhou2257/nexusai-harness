#!/usr/bin/env node
/**
 * Wire this plugin into a dsh checkout on a fresh machine.
 *
 * What a working setup needs (none of it lives in dsh's git tree, so a new
 * machine needs all four steps reproduced):
 *
 *   1. the plugin resolved as `@toby/dsh-plugin-nexusai` inside the dsh dev
 *      project — a symlink into the generated
 *      `apps/desktop/.desktop-build/development/project/node_modules/@toby/`
 *   2. the dev home's profile patch carrying the `nexusai` insert (baseUrl)
 *      and the `ui-settings-account` disable. The login cipher, when
 *      NEXUSAI_AES_KEY / NEXUSAI_AES_IV (or AES_KEY / AES_IV) are set, is
 *      written to the home credentials file, not the patch.
 *   3. a built plugin (`lib/index.js`, `lib/client.js`)
 *   4. a login (the account's credentials are stored per machine, so the new
 *      machine signs in through the UI — nothing to copy)
 *
 * Idempotent: running it twice changes nothing.
 *
 * Usage:
 *   node scripts/dev/install-into-dsh.mjs
 *   DSH_REPO=~/src/deepseek-harness node scripts/dev/install-into-dsh.mjs
 *   DSH_BASE_URL=http://host:8081 AES_KEY=... AES_IV=... node scripts/dev/install-into-dsh.mjs
 *
 * Notes for a genuinely new machine: the dsh checkout must be at the version
 * this plugin pins (`dsh.dshBaseline`, checked by `npm run check:dsh`), with
 * `pnpm install` run once, and the desktop must have been started at least
 * once so `.desktop-build/development/` exists.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const { seedCipher } = createRequire(import.meta.url)('../../apps/nexusai-desktop/src/cipher-seed.cjs')

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dshRepo = resolve(process.env.DSH_REPO ?? join(homedir(), 'IdeaProjects', 'deepseek-harness'))
const devRoot = join(dshRepo, 'apps', 'desktop', '.desktop-build', 'development')
const home = process.env.DSH_HOME ?? join(devRoot, 'home')
const patchFile = join(home, 'profiles', 'desktop', 'cordis.patch.yml')
const linkDir = join(devRoot, 'project', 'node_modules', '@toby')
const linkPath = join(linkDir, 'dsh-plugin-nexusai')

const baseUrl = process.env.DSH_BASE_URL ?? process.env.NEXUSAI_BASE_URL ?? 'http://agent.nexusai.net.cn:8081'
const aesKey = process.env.AES_KEY ?? process.env.NEXUSAI_AES_KEY ?? ''
const aesIv = process.env.AES_IV ?? process.env.NEXUSAI_AES_IV ?? ''

const say = message => console.log(`• ${message}`)
const fail = message => { console.error(`✗ ${message}`); process.exit(1) }

// ── 1. build ────────────────────────────────────────────────────────────────
say(`building the plugin in ${pluginRoot}`)
execFileSync('node', [join(pluginRoot, 'scripts', 'build.mjs')], { cwd: pluginRoot, stdio: 'inherit' })
for (const file of ['lib/index.js', 'lib/client.js']) {
  if (!existsSync(join(pluginRoot, file))) fail(`${file} missing after build`)
}
say('lib/index.js and lib/client.js are present')

// ── 2. symlink into the dsh dev project ─────────────────────────────────────
if (!existsSync(devRoot)) {
  fail(`${devRoot} does not exist — start the desktop once in ${dshRepo} first (pnpm run start:desktop)`)
}
mkdirSync(linkDir, { recursive: true })
if (existsSync(linkPath)) {
  say(`link already present: ${linkPath}`)
} else {
  symlinkSync(pluginRoot, linkPath, 'dir')
  say(`linked ${linkPath} → ${pluginRoot}`)
}

// ── 3. profile patch rows ───────────────────────────────────────────────────
if (!existsSync(patchFile)) fail(`${patchFile} does not exist — start the desktop once to generate the dev home`)
const yamlModule = await import('yaml').catch(() => undefined)
const patchText = readFileSync(patchFile, 'utf8')

const hasAccountDisable = /^-\s*id:\s*ui-settings-account\b/m.test(patchText)
const hasPluginRow = /name:\s*['"]@toby\/dsh-plugin-nexusai['"]/.test(patchText)
const additions = []
if (!hasAccountDisable) {
  additions.push(`- id: ui-settings-account
  disabled: true`)
}
if (!hasPluginRow) {
  additions.push(`- insert:
    - id: nexusai
      name: '@toby/dsh-plugin-nexusai'
      config:
        baseUrl: '${baseUrl}'`)
}
if (additions.length === 0) {
  say('profile patch already carries the ui-settings-account disable and the nexusai row')
} else {
  const next = `${patchText.replace(/\s*$/, '')}\n\n${additions.join('\n')}\n`
  if (yamlModule !== undefined) {
    const doc = yamlModule.parseDocument(next, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] })
    if (doc.errors.length > 0) fail(`refusing to write: the patched YAML would not parse (${doc.errors[0].message})`)
    say('patched YAML parses cleanly')
  }
  writeFileSync(patchFile, next, { encoding: 'utf8', mode: 0o600 })
  for (const line of additions) say(`added to ${patchFile}: ${line.split('\n')[0]}`)
}

const stripped = readFileSync(patchFile, 'utf8').replace(/^[ \t]+aes(?:Key|Iv):.*\n/gm, '')
if (stripped !== readFileSync(patchFile, 'utf8')) {
  writeFileSync(patchFile, stripped, { encoding: 'utf8', mode: 0o600 })
  say('removed aesKey/aesIv from the profile patch')
}
if (aesKey !== '' && aesIv !== '') {
  const seedFile = join(home, '.nexusai-cipher-seed.json')
  writeFileSync(seedFile, `${JSON.stringify({ seedVersion: 1, aesKey, aesIv })}\n`, { mode: 0o600 })
  const seeded = seedCipher({ home, seedFile, log: say })
  rmSync(seedFile, { force: true })
  say(`login cipher ${seeded}`)
} else {
  say('AES_KEY / AES_IV unset — login cipher was not seeded')
}

// ── 4. what the operator still has to do ────────────────────────────────────
console.log(`
下一步：
  1. 启动桌面端（同一时间只跑一个实例，残留实例会占住 19387 端口导致下一个实例启动失败）:
       cd ${dshRepo} && DSH_DESKTOP_RENDERER_DEBUG_PORT=9223 pnpm run start:desktop
  2. 点左下角「登录」完成账号登录（凭据存在本机，不需要拷贝）
  3. 验证：侧栏出现「专家 · 技能 · 连接器」，登录后连接器应显示创建+导入的 MCP
  4. 可选：窗口居中 —— 在你自己的终端里跑
       ${pluginRoot}/scripts/dev/watch-window.sh center
     （需要给终端开「辅助功能」权限）`)
