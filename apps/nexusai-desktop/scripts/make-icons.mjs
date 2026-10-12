#!/usr/bin/env node
/**
 * Derive the app icons from `resources/icon.svg`.
 *
 * Kept as a script (rather than checked-in binaries only) so the mark can be
 * changed in one editable file and regenerated predictably:
 *   svg ──qlmanage──▶ 1024 png ──sips──▶ .iconset ──iconutil──▶ .icns
 *                              └──▶ .ico (PNG payloads; no extra tooling)
 *
 * Usage: node scripts/make-icons.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = resolve(SCRIPT_DIR, '..')
const RESOURCES = join(APP_ROOT, 'resources')
const SOURCE = join(RESOURCES, 'icon.svg')
const PNG = join(RESOURCES, 'icon.png')
const ICNS = join(RESOURCES, 'icon.icns')
const ICO = join(RESOURCES, 'icon.ico')
const ICONSET = join(RESOURCES, '.icon.iconset')

for (const tool of ['qlmanage', 'sips', 'iconutil']) {
  try {
    execFileSync('which', [tool], { stdio: 'ignore' })
  } catch {
    throw new Error(`${tool} is required (macOS only). Run this on a Mac, or commit the generated icons.`)
  }
}
if (!existsSync(SOURCE)) throw new Error(`missing ${SOURCE}`)

// qlmanage writes `<name>.png` into the output directory; the SVG name is fixed.
const render = () => {
  rmSync(join(APP_ROOT, 'resources', 'icon.svg.png'), { force: true })
  execFileSync('qlmanage', ['-t', '-s', '1024', '-o', RESOURCES, SOURCE], { stdio: 'ignore' })
  const produced = join(RESOURCES, 'icon.svg.png')
  if (!existsSync(produced)) throw new Error('qlmanage produced no PNG from icon.svg')
  return produced
}
const rendered = render()
writeFileSync(PNG, readFileSync(rendered))
rmSync(rendered, { force: true })
console.log(`icon.png      1024x1024`)

// macOS needs an .icns; the iconset covers the sizes the system actually asks for.
rmSync(ICONSET, { recursive: true, force: true })
mkdirSync(ICONSET, { recursive: true })
for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  execFileSync('sips', ['-z', String(size), String(size), PNG, '--out', join(ICONSET, `icon_${size}x${size}.png`)], { stdio: 'ignore' })
  if (size <= 512) {
    execFileSync('sips', ['-z', String(size * 2), String(size * 2), PNG, '--out', join(ICONSET, `icon_${size}x${size}@2x.png`)], { stdio: 'ignore' })
  }
}
execFileSync('iconutil', ['-c', 'icns', ICONSET, '-o', ICNS])
rmSync(ICONSET, { recursive: true, force: true })
console.log(`icon.icns     ${(readFileSync(ICNS).length / 1024).toFixed(0)} KB`)

// Windows wants .ico. Vista+ reads PNG payloads inside an ICO container, so the
// 256 px render can be embedded verbatim — no image tooling required.
const ICO_SIZES = [16, 32, 48, 64, 128, 256]
const payloads = ICO_SIZES.map(size => {
  const out = join(APP_ROOT, 'resources', `.icon-${size}.png`)
  execFileSync('sips', ['-z', String(size), String(size), PNG, '--out', out], { stdio: 'ignore' })
  const bytes = readFileSync(out)
  rmSync(out, { force: true })
  return { size, bytes }
})
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)          // reserved
header.writeUInt16LE(1, 2)          // type: icon
header.writeUInt16LE(payloads.length, 4)
const entries = Buffer.alloc(16 * payloads.length)
let offset = header.length + entries.length
payloads.forEach(({ size, bytes }, index) => {
  const at = index * 16
  entries.writeUInt8(size >= 256 ? 0 : size, at)      // 0 means 256
  entries.writeUInt8(size >= 256 ? 0 : size, at + 1)
  entries.writeUInt8(0, at + 2)                        // palette
  entries.writeUInt8(0, at + 3)                        // reserved
  entries.writeUInt16LE(1, at + 4)                     // colour planes
  entries.writeUInt16LE(32, at + 6)                    // bits per pixel
  entries.writeUInt32LE(bytes.length, at + 8)
  entries.writeUInt32LE(offset, at + 12)
  offset += bytes.length
})
writeFileSync(ICO, Buffer.concat([header, entries, ...payloads.map(p => p.bytes)]))
console.log(`icon.ico      ${ICO_SIZES.join('/')} px, ${(readFileSync(ICO).length / 1024).toFixed(0)} KB`)
