/**
 * Local skill files behind the 本地 tab's 启用 / 关闭 control.
 *
 * The registry only recognises `<directory>/SKILL.md`, so "关闭" a skill is a
 * rename to `SKILL.md.disabled` and "启用" renames it back — the registry's
 * file watcher then adds or drops the skill on its own, which keeps the
 * conversation "/" catalog in step with what the panel shows.
 *
 * `install` adds a skill the user uploaded (a folder, a .zip, or a single
 * markdown file): it validates the bundle, stages it next to the target and
 * swaps it in, so a failed upload never leaves a half-written skill behind.
 */
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, normalize, sep } from 'node:path'
import { unzipSync } from 'fflate'
import { parse as parseYaml } from 'yaml'
import type { LocalSkillEntry, LocalSkillInstallRequest, LocalSkillInstallResult } from '../types'

/** The instruction file the registry looks for. */
const ENABLED_NAME = 'SKILL.md'
/** What a 关闭-ed skill's instruction file is called. */
const DISABLED_NAME = 'SKILL.md.disabled'
/** Preview/path reads stay bounded. */
const MAX_TEXT = 400_000
/** Ceiling for one upload: decoded bytes of every file it carries. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
/** Ceiling for a picked folder; it never crosses the wire, so it can be bigger. */
const MAX_FOLDER_BYTES = 64 * 1024 * 1024
/** dsh's skill-name grammar (`packages/skill/skill`): kebab-case ASCII only.
 * Anything else makes the registry ignore the skill, so an upload is refused
 * rather than installed as a skill that never shows up. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export class LocalSkills {
  constructor(readonly roots: readonly string[]) {}

  private allRoots(extra: readonly string[]): string[] {
    const unique = new Set<string>()
    for (const root of [...this.roots, ...extra]) {
      const trimmed = root.trim()
      if (trimmed !== '') unique.add(trimmed)
    }
    return [...unique]
  }

  /** Refuse anything that is not a SKILL.md / SKILL.md.disabled file inside
   * one of the known skill roots. */
  private guard(path: string, extra: readonly string[]): string {
    const target = path.trim()
    if (target === '') throw new Error('技能路径为空')
    const fileName = basename(target)
    if (fileName !== ENABLED_NAME && fileName !== DISABLED_NAME) {
      throw new Error(`不是技能文件：${fileName}`)
    }
    const inside = this.allRoots(extra).some(root => target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`))
    if (!inside) throw new Error('技能路径不在已知的技能目录内')
    return target
  }

  /** Skills that exist on disk but are 关闭-ed (the registry does not list
   * them). Root directories come from the caller — they are the directories
   * of the enabled skills it already knows. */
  async scanDisabled(extra: readonly string[]): Promise<LocalSkillEntry[]> {
    const entries: LocalSkillEntry[] = []
    const seen = new Set<string>()
    for (const root of this.allRoots(extra)) {
      let children: string[]
      try {
        const listing = await readdir(root, { withFileTypes: true })
        children = listing.filter(entry => entry.isDirectory()).map(entry => entry.name)
      } catch {
        continue
      }
      for (const child of children) {
        const file = join(root, child, DISABLED_NAME)
        try {
          const info = await stat(file)
          if (!info.isFile()) continue
        } catch {
          continue
        }
        const text = await readFile(file, 'utf8').catch(() => '')
        const front = readFrontmatter(text)
        const name = front.name !== '' ? front.name : child
        if (seen.has(name)) continue
        seen.add(name)
        entries.push({
          name,
          description: front.description,
          path: file,
          enabled: false,
        })
      }
    }
    return entries.sort((left, right) => left.name.localeCompare(right.name))
  }

  /** 启用 / 关闭 one skill by renaming its instruction file. */
  async setEnabled(path: string, enabled: boolean, extra: readonly string[] = []): Promise<void> {
    const target = this.guard(path, extra)
    const directory = dirname(target)
    if (enabled) {
      const file = join(directory, DISABLED_NAME)
      const info = await stat(file).catch(() => undefined)
      if (info === undefined) {
        const present = await stat(join(directory, ENABLED_NAME)).catch(() => undefined)
        throw new Error(present === undefined ? '技能文件不存在' : '该技能已启用')
      }
      await rename(file, join(directory, ENABLED_NAME))
    } else {
      const file = join(directory, ENABLED_NAME)
      const info = await stat(file).catch(() => undefined)
      if (info === undefined) {
        const present = await stat(join(directory, DISABLED_NAME)).catch(() => undefined)
        throw new Error(present === undefined ? '技能文件不存在' : '该技能已关闭')
      }
      await rename(file, join(directory, DISABLED_NAME))
    }
  }

  /** Which of these skill files are gone from disk. The registry keeps listing
   * a deleted skill for a while, so the panel checks before trusting it. */
  async missing(paths: readonly string[]): Promise<string[]> {
    const gone: string[] = []
    for (const candidate of paths) {
      const target = candidate.trim()
      if (target === '') continue
      const fileName = basename(target)
      if (fileName !== ENABLED_NAME && fileName !== DISABLED_NAME) continue
      const info = await stat(target).catch(() => undefined)
      if (info === undefined) gone.push(target)
    }
    return gone
  }

  /** Delete one skill's whole directory (explicit, confirmed in the UI). */
  async remove(path: string, extra: readonly string[] = []): Promise<void> {
    const target = this.guard(path, extra)
    await rm(dirname(target), { recursive: true, force: true })
  }

  /** The skill's SKILL.md text, for the panel's detail view. */
  async read(path: string, extra: readonly string[] = []): Promise<string> {
    const target = this.guard(path, extra)
    const text = await readFile(target, 'utf8').catch(() => '')
    return text.slice(0, MAX_TEXT)
  }

  /**
   * Install one uploaded skill into the writable root from an in-memory
   * request (a browser drop, or a pick without the desktop's path bridge).
   * Shapes: `folder` / `zip` must carry a `SKILL.md`, `markdown` becomes it.
   */
  async install(request: LocalSkillInstallRequest, overwrite = false): Promise<LocalSkillInstallResult> {
    return this.installFiles(uploadedFiles(request), overwrite)
  }

  /**
   * Install from a path the user picked in the desktop's own panel. That panel
   * cannot offer files and folders in one dialog, so the path decides what the
   * pick meant — which is what lets the dialog keep a single 「点击上传」 entry:
   * a directory is the skill folder, a `SKILL.md` is its folder, a `.zip` is a
   * package, a `.md` is a single-file skill, and any other file inside a
   * folder that carries a SKILL.md falls back to that folder.
   */
  async installFromPath(path: string, overwrite = false): Promise<LocalSkillInstallResult> {
    const picked = path.trim()
    if (picked === '') throw new Error('没有选择文件或文件夹')
    const info = await stat(picked)
    if (info.isDirectory()) return this.installFiles(await filesUnder(picked), overwrite)
    const name = basename(picked)
    if (name === ENABLED_NAME) return this.installFiles(await filesUnder(dirname(picked)), overwrite)
    if (/\.zip$/i.test(name)) return this.installFiles(packageFiles(await readFile(picked)), overwrite)
    if (/\.md$/i.test(name)) {
      // Name the file the user picked: it becomes the skill's SKILL.md, so a
      // missing front matter is about *their* file, not about a SKILL.md.
      const text = await readFile(picked, 'utf8')
      const front = readFrontmatter(text)
      if (front.name === '' || front.description === '') {
        throw new Error(`${name} 需要以 YAML 前置信息（---）开头，并包含 name 与 description`)
      }
      return this.installFiles(markdownFiles(text), overwrite)
    }
    const folder = dirname(picked)
    const sibling = await stat(join(folder, ENABLED_NAME)).catch(() => undefined)
    if (sibling?.isFile() === true) return this.installFiles(await filesUnder(folder), overwrite)
    throw new Error(`${name} 不是技能：请选择技能文件夹、文件夹里的 SKILL.md、.zip 或 .md`)
  }

  /**
   * Validate and write one bundle. Every shape's SKILL.md must open with YAML
   * front matter carrying `name` and `description`, and the name must match
   * dsh's kebab-case grammar: the registry ignores a skill whose name breaks
   * it, so accepting one here would install a file the app never lists. The
   * skill's name is also its directory name, so nothing user-supplied reaches
   * the path. An existing directory is reported rather than overwritten;
   * `overwrite` is the caller's second, explicit try.
   */
  private async installFiles(files: Map<string, Uint8Array>, overwrite: boolean): Promise<LocalSkillInstallResult> {
    // Validate the bundle first: a bad one is the user's problem to fix, and
    // reporting it before any configuration issue keeps the message actionable.
    const skillFile = files.get(ENABLED_NAME)
    if (skillFile === undefined) throw new Error('上传内容里没有 SKILL.md：文件夹或压缩包需要包含 SKILL.md 文件')
    const root = this.roots[0]?.trim() ?? ''
    if (root === '') throw new Error('没有可写入的技能目录（skills.downloadRoot 未配置）')
    const text = new TextDecoder().decode(skillFile)
    const front = readFrontmatter(text)
    if (front.name === '' || front.description === '') {
      throw new Error('SKILL.md 需要以 YAML 前置信息（---）开头，并包含 name 与 description')
    }
    // dsh reads these as YAML values and requires strings: `name: 12306` parses
    // as a number, so the registry drops the skill with only a log line.
    const values = frontmatterValues(text)
    if (typeof values?.name !== 'string' || typeof values?.description !== 'string') {
      throw new Error('name 与 description 必须是字符串：纯数字等要加引号（如 name: "12306"）')
    }
    if (!SKILL_NAME.test(front.name)) {
      throw new Error(`技能名称只支持小写字母、数字与连字符（如 my-skill），当前为「${front.name}」`)
    }
    const target = join(root, front.name)
    const present = await stat(target).catch(() => undefined)
    if (present !== undefined && !overwrite) return { installed: false, reason: 'exists', name: front.name }

    // Stage beside the target, then swap: an install that fails halfway leaves
    // the previous skill (if any) untouched.
    const staging = join(root, `.nexusai-upload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
    try {
      for (const [relative, bytes] of files) {
        const file = join(staging, relative)
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, bytes)
      }
      if (present !== undefined) await rm(target, { recursive: true, force: true })
      await rename(staging, target)
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
    return { installed: true, name: front.name, path: join(target, ENABLED_NAME) }
  }
}

/**
 * Read one picked directory as a skill bundle: paths relative to it, real
 * files only (symlinks and special files are skipped rather than followed).
 */
async function filesUnder(root: string): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>()
  let total = 0
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === '.DS_Store' || entry.name === '__MACOSX') continue
      const full = join(dir, entry.name)
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(full, relative)
        continue
      }
      if (!entry.isFile()) continue
      const bytes = new Uint8Array(await readFile(full))
      total += bytes.byteLength
      if (total > MAX_FOLDER_BYTES) {
        throw new Error(`技能文件夹过大（上限 ${Math.round(MAX_FOLDER_BYTES / 1024 / 1024)}MB）`)
      }
      addBundleFile(files, relative, bytes)
    }
  }
  await walk(root, '')
  return files
}

/** One markdown file as a single-file skill. */
function markdownFiles(text: string): Map<string, Uint8Array> {
  return new Map([[ENABLED_NAME, new TextEncoder().encode(text)]])
}

/** One `.zip` on disk as a bundle (its path entries are validated). */
function packageFiles(bytes: Uint8Array): Map<string, Uint8Array> {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch {
    throw new Error('不是有效的压缩包（.zip）')
  }
  const files = new Map<string, Uint8Array>()
  for (const [path, data] of Object.entries(entries)) addBundleFile(files, path, data)
  return stripWrappingDirectory(files)
}

/** Add one file to a bundle, refusing paths that escape the skill directory. */
function addBundleFile(files: Map<string, Uint8Array>, path: string, bytes: Uint8Array): void {
  const relative = normalize(path.replace(/\\/g, '/'))
  if (relative === '' || relative === '.' || relative.endsWith('/')) return
  if (relative.startsWith('__MACOSX/') || basename(relative) === '.DS_Store') return
  if (relative.startsWith('..')
    || relative.startsWith('/')
    || relative.includes(`..${sep}`)
    || /^[A-Za-z]:/.test(relative)
    || relative.includes('\0')) {
    throw new Error(`上传内容包含非法路径：${path}`)
  }
  files.set(relative, bytes)
}

/**
 * Turn one upload request into the file map to write, validating paths and
 * sizes on the way. Directory entries, macOS zip resource forks and
 * `.DS_Store` are dropped — they carry no skill content.
 */
function uploadedFiles(request: LocalSkillInstallRequest): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()
  let total = 0
  const add = (path: string, bytes: Uint8Array): void => {
    total += bytes.byteLength
    if (total > MAX_UPLOAD_BYTES) {
      throw new Error(`上传内容超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB，请改用更小的技能包`)
    }
    addBundleFile(files, path, bytes)
  }

  if (request.kind === 'markdown') {
    // The front matter is validated by install(); the whole file becomes the
    // skill's SKILL.md.
    add(ENABLED_NAME, new TextEncoder().encode(request.text))
    return files
  }

  if (request.kind === 'zip') {
    let entries: Record<string, Uint8Array>
    try {
      entries = unzipSync(decodeBase64(request.base64))
    } catch {
      throw new Error('不是有效的压缩包（.zip）')
    }
    for (const [path, bytes] of Object.entries(entries)) add(path, bytes)
    return stripWrappingDirectory(files)
  }

  for (const file of request.files) add(file.path, decodeBase64(file.base64))
  return stripWrappingDirectory(files)
}

/** Drop a single wrapping directory (`my-skill/SKILL.md` → `SKILL.md`), which
 * is what a picked folder and a zip built from it both arrive as. */
function stripWrappingDirectory(files: Map<string, Uint8Array>): Map<string, Uint8Array> {
  if (files.has(ENABLED_NAME)) return files
  const tops = new Set([...files.keys()].map(path => path.split('/')[0] ?? ''))
  if (tops.size !== 1) return files
  const top = [...tops][0] ?? ''
  if (top === '') return files
  const stripped = new Map<string, Uint8Array>()
  for (const [path, bytes] of files) {
    if (path === top) continue
    stripped.set(path.slice(top.length + 1), bytes)
  }
  return stripped.has(ENABLED_NAME) ? stripped : files
}

/** Uploads carry bytes; base64 is the only JSON-safe shape on the wire. */
function decodeBase64(value: string): Uint8Array {
  const trimmed = value.includes(',') && value.startsWith('data:') ? value.slice(value.indexOf(',') + 1) : value
  const buffer = Buffer.from(trimmed, 'base64')
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

/** The front matter parsed as YAML, for the type check dsh itself applies. */
function frontmatterValues(text: string): Record<string, unknown> | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (match === null) return undefined
  try {
    const parsed = parseYaml(match[1] ?? '') as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/** Minimal frontmatter reader: the `name:` and `description:` fields. */
function readFrontmatter(text: string): { name: string; description: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (match === null) return { name: '', description: '' }
  const body = match[1] ?? ''
  const read = (key: string): string => {
    const line = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(body)
    if (line === null) return ''
    return (line[1] ?? '').trim().replace(/^["']|["']$/g, '')
  }
  return { name: read('name'), description: read('description') }
}