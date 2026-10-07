/**
 * Local skill files behind the 本地 tab's 启用 / 关闭 control.
 *
 * The registry only recognises `<directory>/SKILL.md`, so "关闭" a skill is a
 * rename to `SKILL.md.disabled` and "启用" renames it back — the registry's
 * file watcher then adds or drops the skill on its own, which keeps the
 * conversation "/" catalog in step with what the panel shows.
 */
import { readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'
import type { LocalSkillEntry } from '../types'

/** The instruction file the registry looks for. */
const ENABLED_NAME = 'SKILL.md'
/** What a 关闭-ed skill's instruction file is called. */
const DISABLED_NAME = 'SKILL.md.disabled'
/** Preview/path reads stay bounded. */
const MAX_TEXT = 400_000

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