#!/usr/bin/env node
/**
 * Regression suite for `LocalSkills.installFromPath` — the route the desktop's
 * picker takes, where the picked *path* decides what was uploaded: a skill
 * folder, a folder's SKILL.md, a .zip, a .md, or any file sitting beside a
 * SKILL.md. Also covers the refusals (no SKILL.md, missing/ill-typed front
 * matter, a name outside dsh's kebab-case grammar, archive path traversal) and
 * the exists → overwrite contract.
 *
 * The plugin's host half runs inside dsh, so this exercises the module
 * directly: esbuild bundles `src/sync/local-skills.ts` to CJS in a temp file
 * (CJS because `yaml` is a CJS package — an ESM bundle dies on its dynamic
 * `require('process')`), fixtures are built in a scratch skills root, and every
 * case asserts its outcome.
 *
 * Usage: node scripts/verify/local-skills-paths.mjs
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { strToU8, zipSync } from 'fflate'

const root = fileURLToPath(new URL('../..', import.meta.url))
const work = await mkdtemp(join(tmpdir(), 'nexusai-install-paths-'))
const bundle = join(work, 'local-skills.cjs')
await build({
  entryPoints: [join(root, 'src/sync/local-skills.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: bundle,
  logLevel: 'warning',
})
const { LocalSkills } = createRequire(import.meta.url)(bundle)

const skillsRoot = join(work, 'skills')
const incoming = join(work, 'incoming')
await mkdir(skillsRoot, { recursive: true })
await mkdir(join(incoming, 'good-skill', 'extras'), { recursive: true })
await mkdir(join(incoming, 'md-skill'), { recursive: true })
await mkdir(join(incoming, 'stray'), { recursive: true })
await writeFile(join(incoming, 'good-skill', 'SKILL.md'), '---\nname: from-folder\ndescription: 目录分支\n---\n\nbody\n')
await writeFile(join(incoming, 'good-skill', 'extras', 'help.md'), 'extra\n')
await writeFile(join(incoming, 'good-skill', 'notes.txt'), 'loose note\n')
await writeFile(join(incoming, 'md-skill', 'SKILL.md'), '---\nname: from-md\ndescription: md 分支\n---\n')
await writeFile(join(incoming, 'stray', 'README.md'), 'not a skill\n')
await writeFile(join(incoming, 'stray', 'notes.txt'), 'not a skill either\n')
await writeFile(join(incoming, 'single.md'), '---\nname: from-single-md\ndescription: 单文件分支\n---\n')
await writeFile(join(incoming, 'pack.zip'), zipSync({
  'wrapped/SKILL.md': strToU8('---\nname: from-zip\ndescription: 压缩包分支\n---\n'),
  'wrapped/extra.md': strToU8('x\n'),
}))
await writeFile(join(incoming, 'evil.zip'), zipSync({
  '../escaped.txt': strToU8('escape!\n'),
  'SKILL.md': strToU8('---\nname: evil\ndescription: x\n---\n'),
}))
await writeFile(join(incoming, 'no-frontmatter.zip'), zipSync({ 'SKILL.md': strToU8('# no front matter\n') }))
await writeFile(join(incoming, 'bad-name.zip'), zipSync({ 'SKILL.md': strToU8('---\nname: 中文名\ndescription: x\n---\n') }))
await writeFile(join(incoming, 'numeric-name.zip'), zipSync({ 'SKILL.md': strToU8('---\nname: 12306\ndescription: unquoted digits parse as a number\n---\n') }))
await writeFile(join(incoming, 'quoted-numeric.zip'), zipSync({ 'SKILL.md': strToU8('---\nname: "12306"\ndescription: quoted, so a string\n---\n') }))

const skills = new LocalSkills([skillsRoot])
const failures = []
let passed = 0
const expect = async (label, run, check) => {
  let outcome
  try {
    outcome = await run()
  } catch (error) {
    outcome = { error: error.message }
  }
  const problem = check(outcome)
  if (problem === '') {
    passed++
    console.log(`  ok   ${label}`)
    return
  }
  failures.push(`${label}: ${problem} (got ${JSON.stringify(outcome)})`)
  console.log(`  FAIL ${label} → ${problem} (got ${JSON.stringify(outcome)})`)
}
const installed = name => outcome => outcome.installed === true && outcome.name === name
  ? ''
  : `expected install of ${name}`
const refused = fragment => outcome => typeof outcome.error === 'string' && outcome.error.includes(fragment)
  ? ''
  : `expected refusal containing ${fragment}`

console.log('LocalSkills.installFromPath:')
await expect('a directory installs whole (nested files kept)', () => skills.installFromPath(join(incoming, 'good-skill')), installed('from-folder'))
await expect('a picked SKILL.md installs its folder', () => skills.installFromPath(join(incoming, 'md-skill', 'SKILL.md')), installed('from-md'))
await expect('a loose file beside SKILL.md falls back to that folder', () => skills.installFromPath(join(incoming, 'good-skill', 'notes.txt')), outcome => outcome.reason === 'exists' && outcome.name === 'from-folder' ? '' : 'expected the folder to be recognised (exists)')
await expect('a .zip installs, dropping its wrapping directory', () => skills.installFromPath(join(incoming, 'pack.zip')), installed('from-zip'))
await expect('a .md installs as a single-file skill', () => skills.installFromPath(join(incoming, 'single.md')), installed('from-single-md'))
await expect('a stray .md without front matter is refused', () => skills.installFromPath(join(incoming, 'stray', 'README.md')), refused('需要以 YAML 前置信息'))
await expect('a stray file with no SKILL.md beside it is refused', () => skills.installFromPath(join(incoming, 'stray', 'notes.txt')), refused('不是技能'))
await expect('an existing name reports exists', () => skills.installFromPath(join(incoming, 'good-skill')), outcome => outcome.reason === 'exists' ? '' : 'expected exists')
await expect('overwrite=true installs anyway', () => skills.installFromPath(join(incoming, 'good-skill'), true), installed('from-folder'))
await expect('an archive escaping its directory is refused', () => skills.installFromPath(join(incoming, 'evil.zip')), refused('非法路径'))
await expect('a SKILL.md without front matter is refused', () => skills.installFromPath(join(incoming, 'no-frontmatter.zip')), refused('需要以 YAML 前置信息'))
await expect('a non-kebab-case name is refused', () => skills.installFromPath(join(incoming, 'bad-name.zip')), refused('只支持小写字母'))
await expect('an unquoted numeric name is refused', () => skills.installFromPath(join(incoming, 'numeric-name.zip')), refused('必须是字符串'))
await expect('a quoted numeric name installs', () => skills.installFromPath(join(incoming, 'quoted-numeric.zip')), installed('12306'))

const landed = await readdir(skillsRoot)
const expected = ['12306', 'from-folder', 'from-md', 'from-single-md', 'from-zip']
if (JSON.stringify(landed.sort()) !== JSON.stringify(expected)) {
  failures.push(`skills root holds ${JSON.stringify(landed.sort())}, expected ${JSON.stringify(expected)}`)
} else {
  passed++
  console.log('  ok   exactly the expected skills landed (no staging leftovers, nothing escaped)')
}
const nested = await readdir(join(skillsRoot, 'from-folder'))
if (!nested.includes('extras') || !nested.includes('notes.txt')) {
  failures.push(`from-folder lost files: ${JSON.stringify(nested)}`)
} else {
  passed++
  console.log('  ok   the folder install kept its nested directory and loose file')
}

await rm(work, { recursive: true, force: true })
console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
}
void readFile