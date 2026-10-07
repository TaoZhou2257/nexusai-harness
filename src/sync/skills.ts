/**
 * Skill downloads: list custom skills and write a chosen one's SKILL.md into
 * the user skills root (`<dshHome>/skills/<slug>/SKILL.md`) that
 * skill-filesystem scans and chokidar-watches, so a download appears in the
 * agent's skill catalog without a restart. Downloads are idempotent.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { Context } from '@deepseek-ai/cordis'
import type { NexusApiClient } from '../nexus/api-client'
import type { SkillDownloadResult, SkillSummary } from '../types'

/** Constructor options. */
export interface SkillSyncOptions {
  readonly api: NexusApiClient
  /** Skills root; empty = `<dshHome>/skills`. */
  readonly downloadRoot: string
}

/** skill-filesystem ignores a SKILL.md without YAML frontmatter, so missing frontmatter is synthesized. */
const FRONTMATTER_PATTERN = /^---\r?\n/

/** Lists skills and downloads their SKILL.md into the user skills root. */
export class SkillSync {
  constructor(
    private readonly ctx: Context,
    private readonly options: SkillSyncOptions,
  ) {}

  private root(): string {
    return this.options.downloadRoot !== '' ? this.options.downloadRoot : join(resolveDshHome(), 'skills')
  }

  /** Custom skills visible to the logged-in org. */
  async list(signal?: AbortSignal): Promise<SkillSummary[]> {
    const response = await this.options.api.listSkills(signal)
    return (response.list ?? []).map(item => ({
      skillId: item.skillId,
      name: item.name,
      description: item.desc,
      author: item.author,
    }))
  }

  /** Download one skill's SKILL.md; returns where it landed. */
  async download(skillId: string, signal?: AbortSignal): Promise<SkillDownloadResult> {
    const detail = await this.options.api.skillDetail(skillId, signal)
    const name = slugify(detail.name || skillId)
    const directory = join(this.root(), name)
    await mkdir(directory, { recursive: true })
    const markdown = FRONTMATTER_PATTERN.test(detail.skillMarkdown)
      ? detail.skillMarkdown
      : synthesizeFrontmatter(detail.name, detail.desc) + detail.skillMarkdown
    const path = join(directory, 'SKILL.md')
    await writeFile(path, markdown, 'utf8')
    this.ctx.logger.info('nexusai: skill "%s" downloaded to %s', name, path)
    return { name, path }
  }
}

/**
 * Non-alphanumerics fold to dashes; skill names are directory names. Named
 * `slugify` rather than `slug` on purpose: a module-level `slug` collides with
 * the Remote method parameter of the same name when esbuild flattens the
 * bundle, and the gateway reads wire field names off the compiled signature.
 */
function slugify(value: string): string {
  return value.replace(/[^A-Za-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'skill'
}

function synthesizeFrontmatter(name: string, description: string): string {
  const lines = ['---', `name: ${JSON.stringify(name || 'nexusai-skill')}`]
  if (description !== '') lines.push(`description: ${JSON.stringify(description)}`)
  lines.push('---', '')
  return `${lines.join('\n')}\n`
}
