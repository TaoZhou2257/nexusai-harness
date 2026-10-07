/**
 * SkillHub client (api.skillhub.cn) — the public, unauthenticated skill
 * marketplace the @cocofhu/skillhub plugin also reads from. Search reads the
 * catalog; install downloads the DSH package (`source=dsh`, a zip with
 * SKILL.md at its root) and unpacks it into the local skills root, which the
 * skill registry picks up.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'
import { unzipSync } from 'fflate'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { SkillHubCard, SkillHubDetail, SkillHubInstallResult } from '../types'

/** Constructor options. */
export interface SkillHubClientOptions {
  /** Catalog API base, e.g. `https://api.skillhub.cn`. */
  readonly apiBase: string
  /** Web base for skill page links, e.g. `https://skillhub.cn`. */
  readonly webBase: string
  readonly timeoutMs: number
  /** Local skills root; empty = `<dshHome>/skills`. */
  readonly skillsRoot: string
}

/** Fallback category keys → display labels when the taxonomy API is down. */
export const SKILLHUB_CATEGORIES: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'office-efficiency', label: '办公效率' },
  { key: 'content-creation', label: '内容创作' },
  { key: 'dev-programming', label: '开发编程' },
  { key: 'data-analysis', label: '数据分析' },
  { key: 'design-media', label: '设计多媒体' },
  { key: 'ai-agent', label: 'AI Agent' },
  { key: 'knowledge-management', label: '知识管理' },
  { key: 'business-ops', label: '商业运营' },
  { key: 'education', label: '教育学习' },
  { key: 'professional', label: '行业专业' },
  { key: 'it-ops-security', label: 'IT 运维与安全' },
  { key: 'life-service', label: '生活服务' },
]

/** Raw search-hit fields the marketplace returns (subset we map). */
interface SkillHubRawSkill {
  slug?: string
  name?: string
  description?: string
  description_zh?: string
  category?: string
  version?: string
  downloads?: number
  stars?: number
  installs?: number
  ownerName?: string
  /** `{ requires_api_key: 'true', pricing_type: 'paid'|'alipay', ... }` */
  labels?: Record<string, unknown> | null
  /** Listings carry absent icons as JSON `null` (and sometimes the string
   * `"null"`), so this is deliberately loosely typed. */
  iconUrl?: string | null
  namespace?: { publicSlug?: string; canonicalName?: string; handle?: string }
  publisher?: { verified?: boolean; name?: string }
}

interface SkillHubEnvelope {
  code?: number
  data?: { skills?: SkillHubRawSkill[]; total?: number }
  msg?: string
}

/** One row of the marketplace taxonomy (`GET /api/v1/categories`). */
interface SkillHubCategoryRow {
  key?: string
  name?: string
  sortOrder?: number
  active?: boolean
}

/** Raw detail fields (`/api/v1/skills/<slug>` returns a nested envelope). */
interface SkillHubRawDetail {
  slug?: string
  latestVersion?: { version?: string; changelog?: string; createdAt?: number }
  namespace?: { canonicalName?: string; handle?: string; displayName?: string }
  owner?: { displayName?: string; handle?: string }
  skill?: {
    slug?: string
    displayName?: string
    summary?: string | null
    summary_zh?: string | null
    overviewMd?: string | null
    category?: string
    subCategories?: Array<{ key?: string; name?: string }> | null
    iconUrl?: string | null
    source?: string
    createdAt?: number
    updatedAt?: number
    tags?: { latest?: string } | null
    labels?: Record<string, unknown> | null
    stats?: { downloads?: number; stars?: number; installs?: number; comments?: number; versions?: number } | null
  }
}

/** Browsable SkillHub marketplace card (mapped from a raw search hit). */
export interface SkillHubSearchResult {
  readonly cards: SkillHubCard[]
  readonly total: number
}

/** The SkillHub marketplace client used by the capabilities service. */
export class SkillHubClient {
  constructor(readonly options: SkillHubClientOptions) {}

  private root(): string {
    return this.options.skillsRoot !== '' ? this.options.skillsRoot : join(resolveDshHome(), 'skills')
  }

  /** Search the catalog. Empty keyword = top skills by score. */
  async search(keyword: string, category = '', page = 1, pageSize = 24): Promise<SkillHubSearchResult> {
    return searchSkillHub(keyword, category, this.options, page, pageSize)
  }

  /**
   * The marketplace's own taxonomy (`GET /api/v1/categories`, the list the
   * reference client renders), ordered by `sortOrder`. Falls back to the
   * bundled table when the endpoint is unreachable.
   */
  async categories(): Promise<Array<{ key: string; label: string }>> {
    const requestUrl = `${this.options.apiBase.replace(/\/$/, '')}/api/v1/categories`
    try {
      const response = await fetch(requestUrl, {
        headers: { 'User-Agent': 'dsh-nexusai-plugin/0.1', Accept: 'application/json' },
        signal: AbortSignal.timeout(this.options.timeoutMs),
      })
      if (!response.ok) return [...SKILLHUB_CATEGORIES]
      const body = await response.json() as { items?: SkillHubCategoryRow[] }
      const rows = Array.isArray(body.items) ? body.items : []
      const mapped = rows
        .filter(row => row.active !== false)
        .map(row => ({ key: String(row.key ?? '').trim(), label: String(row.name ?? '').trim(), sortOrder: Number(row.sortOrder) || 0 }))
        .filter(row => row.key !== '' && row.label !== '')
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map(({ key, label }) => ({ key, label }))
      return mapped.length > 0 ? mapped : [...SKILLHUB_CATEGORIES]
    } catch {
      return [...SKILLHUB_CATEGORIES]
    }
  }

  /**
   * Download one skill's DSH package and unpack it into the local skills
   * root. `slug` carries the card id — the marketplace's canonical name
   * (`@owner/name`) when present, which disambiguates packages that share a
   * bare slug. The zip must carry SKILL.md at its root (checked); archive
   * paths are refused when they escape the skill directory.
   */
  async install(slug: string): Promise<SkillHubInstallResult> {
    const target = slug.trim()
    const entries = await fetchSkillPackage(target, this.options)
    const paths = Object.keys(entries).filter(path => !path.endsWith('/'))
    if (!paths.some(path => normalize(path) === 'SKILL.md')) {
      throw new Error('技能包缺少 SKILL.md，无法作为技能安装')
    }
    const directory = join(this.root(), sanitizeSegment(target))
    for (const path of paths) {
      const relative = normalize(path)
      if (relative.startsWith('..') || relative.startsWith(sep) || relative.includes(`..${sep}`)) {
        throw new Error(`技能包包含非法路径：${path}`)
      }
      const file = join(directory, relative)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, entries[path])
    }
    return { name: sanitizeSegment(target), path: join(directory, 'SKILL.md') }
  }

  /** One listing's full detail (`GET /api/v1/skills/<slug>`). The endpoint
   * rejects canonical names in the path (405), so a canonical id is split:
   * the bare slug goes in the path and the owner in `?namespace=`, which is
   * what disambiguates packages that share a slug. */
  async detail(id: string): Promise<SkillHubDetail> {
    const target = id.trim()
    if (target === '') throw new Error('SkillHub 技能标识为空')
    const slash = target.startsWith('@') ? target.indexOf('/') : -1
    const handle = slash > 0 ? target.slice(0, slash) : ''
    const bare = slash > 0 ? target.slice(slash + 1) : target
    const query = handle !== '' ? `?namespace=${encodeURIComponent(handle)}` : ''
    const requestUrl = `${this.options.apiBase.replace(/\/$/, '')}/api/v1/skills/${encodeURIComponent(bare)}${query}`
    let response: Response
    try {
      response = await fetch(requestUrl, {
        headers: { 'User-Agent': 'dsh-nexusai-plugin/0.1', Accept: 'application/json' },
        signal: AbortSignal.timeout(this.options.timeoutMs),
      })
    } catch (error) {
      if ((error as Error).name === 'TimeoutError') throw new Error('SkillHub 连接超时，请检查网络')
      throw new Error('无法连接到 SkillHub，请检查网络')
    }
    const body = await response.text().catch(() => '')
    let envelope: SkillHubRawDetail | undefined
    try {
      envelope = body !== '' ? JSON.parse(body) as SkillHubRawDetail : undefined
    } catch {
      envelope = undefined
    }
    if (!response.ok || envelope === undefined) {
      throw new Error(response.status === 404 ? '该技能不存在或已下架' : `获取技能详情失败（HTTP ${response.status}）`)
    }
    const skill = envelope.skill ?? {}
    const stats = skill.stats ?? {}
    const slug = String(skill.slug || envelope.slug || target).trim()
    const canonical = String(envelope.namespace?.canonicalName || '').trim()
    const icon = normalizeIconUrl(skill.iconUrl)
    const webBase = this.options.webBase.replace(/\/$/, '')
    return {
      id: canonical !== '' ? canonical : slug,
      slug,
      name: String(skill.displayName || slug).trim(),
      summary: String(skill.summary_zh || skill.summary || skill.overviewMd || '').trim(),
      category: SKILLHUB_CATEGORIES.find(entry => entry.key === skill.category)?.label
        ?? String(skill.category || '').trim(),
      subCategories: (Array.isArray(skill.subCategories) ? skill.subCategories : [])
        .map(entry => String(entry?.name ?? '').trim())
        .filter(name => name !== ''),
      version: String(skill.tags?.latest || envelope.latestVersion?.version || '').trim(),
      changelog: String(envelope.latestVersion?.changelog || '').trim(),
      downloads: Number(stats.downloads) || 0,
      stars: Number(stats.stars) || 0,
      installs: Number(stats.installs) || 0,
      comments: Number(stats.comments) || 0,
      versions: Number(stats.versions) || 0,
      owner: String(envelope.owner?.displayName || envelope.owner?.handle || envelope.namespace?.handle || '').trim(),
      canonicalName: canonical,
      updatedAt: Number(skill.updatedAt) || 0,
      source: String(skill.source || '').trim(),
      pageUrl: `${webBase}/skills/${encodeURIComponent(slug)}`,
      requiresApiKey: readRequiresApiKey(skill.labels),
      pricing: readPricing(skill.labels),
      ...(icon !== undefined ? { iconUrl: icon } : {}),
    }
  }

  /**
   * The skill's SKILL.md text, read from its DSH package (the same zip the
   * install path uses) for the detail view's preview. Empty when the package
   * carries no readable SKILL.md.
   */
  async preview(id: string): Promise<string> {
    const entries = await fetchSkillPackage(id, this.options)
    const skillFile = Object.keys(entries).find(path => !path.endsWith('/') && normalize(path) === 'SKILL.md')
    if (skillFile === undefined) return ''
    const text = new TextDecoder('utf-8').decode(entries[skillFile])
    return text.slice(0, 200_000)
  }
}

/** Download one skill's DSH zip and unzip it in memory. */
async function fetchSkillPackage(slug: string, options: SkillHubClientOptions): Promise<Record<string, Uint8Array>> {
  const target = slug.trim()
  if (target === '') throw new Error('SkillHub 技能标识为空')
  const requestUrl = `${options.apiBase.replace(/\/$/, '')}/api/v1/download?slug=${encodeURIComponent(target)}&source=dsh`
  let response: Response
  try {
    response = await fetch(requestUrl, {
      headers: { 'User-Agent': 'dsh-nexusai-plugin/0.1', Accept: '*/*' },
      signal: AbortSignal.timeout(Math.max(options.timeoutMs, 60_000)),
    })
  } catch (error) {
    if ((error as Error).name === 'TimeoutError') throw new Error('下载技能包超时，请检查网络')
    throw new Error('无法连接到 SkillHub，请检查网络')
  }
  if (!response.ok) {
    throw new Error(response.status === 404
      ? '该技能暂无可预览的 DSH 包'
      : `下载技能包失败（HTTP ${response.status}）`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  try {
    return unzipSync(bytes)
  } catch {
    throw new Error('技能包不是有效的压缩包')
  }
}

/** Search the SkillHub catalog. Empty keyword = top skills by score. */
export async function searchSkillHub(
  keyword: string,
  category: string,
  options: SkillHubClientOptions,
  page = 1,
  pageSize = 24,
): Promise<SkillHubSearchResult> {
  const params = new URLSearchParams()
  if (keyword.trim() !== '') params.set('keyword', keyword.trim())
  if (category.trim() !== '') params.set('category', category.trim())
  params.set('sortBy', 'score')
  params.set('order', 'desc')
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))
  const requestUrl = `${options.apiBase.replace(/\/$/, '')}/api/skills?${params.toString()}`

  let response: Response
  try {
    response = await fetch(requestUrl, {
      headers: { 'User-Agent': 'dsh-nexusai-plugin/0.1', Accept: '*/*' },
      signal: AbortSignal.timeout(options.timeoutMs),
    })
  } catch (error) {
    if ((error as Error).name === 'TimeoutError') {
      throw new Error(`SkillHub 连接超时（${options.timeoutMs} ms），请检查网络`)
    }
    throw new Error('无法连接到 SkillHub，请检查网络')
  }
  const body = await response.text().catch(() => '')
  let envelope: SkillHubEnvelope | undefined
  try {
    envelope = body !== '' ? JSON.parse(body) as SkillHubEnvelope : undefined
  } catch {
    envelope = undefined
  }
  if (!response.ok || envelope?.code !== 0) {
    const reason = envelope?.msg !== undefined && envelope.msg !== '' ? envelope.msg : `HTTP ${response.status}`
    throw new Error(`SkillHub 请求失败：${reason}`)
  }

  const raw = envelope?.data?.skills ?? []
  const webBase = options.webBase.replace(/\/$/, '')
  const cards: SkillHubCard[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const itemSlug = String(item.slug || item.namespace?.publicSlug || '').trim()
    const name = String(item.name || itemSlug).trim()
    if (itemSlug === '' || name === '') continue
    // A bare slug repeats across publishers (the marketplace's own listings
    // show several `anti-fraud`); the canonical name is the unique identity.
    const canonical = String(item.namespace?.canonicalName || '').trim()
    const id = canonical !== '' ? canonical : itemSlug
    if (seen.has(id)) continue
    seen.add(id)
    const icon = normalizeIconUrl(item.iconUrl)
    const label = SKILLHUB_CATEGORIES.find(entry => entry.key === item.category)?.label
    cards.push({
      id,
      slug: itemSlug,
      name,
      description: String(item.description_zh || item.description || '').trim(),
      category: label ?? String(item.category || '').trim(),
      version: String(item.version || '').trim(),
      downloads: Number(item.downloads) || 0,
      stars: Number(item.stars) || 0,
      installs: Number(item.installs) || 0,
      owner: String(item.ownerName || item.namespace?.handle || '').trim(),
      pageUrl: `${webBase}/skills/${encodeURIComponent(itemSlug)}`,
      requiresApiKey: readRequiresApiKey(item.labels),
      pricing: readPricing(item.labels),
      ...(icon !== undefined ? { iconUrl: icon } : {}),
    })
  }
  return { cards, total: Number(envelope?.data?.total ?? cards.length) || cards.length }
}

/** Keep one path segment safe as a directory name (canonical names become
 * `user-x-skill`, bare slugs stay as they are). */
function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9-_.]/g, '-').replace(/^[.-]+/, '').replace(/-+$/, '') || 'skill'
}

/** `labels.requires_api_key` arrives as `'true'`/`'false'` strings (and, from
 * some surfaces, as a boolean). */
function readRequiresApiKey(labels: Record<string, unknown> | null | undefined): boolean {
  const value = labels?.requires_api_key
  return value === true || value === 'true'
}

/** `labels.pricing_type`: `paid`, `alipay`, … Empty when the skill is free. */
function readPricing(labels: Record<string, unknown> | null | undefined): string {
  const value = labels?.pricing_type
  return typeof value === 'string' ? value.trim() : ''
}

/** A usable icon URL, or nothing: absent icons arrive as JSON `null` and,
 * for some listings, as the literal strings `"null"`/`"undefined"`. */
function normalizeIconUrl(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '' || /^(null|undefined|none)$/i.test(text)) return undefined
  return /^https?:\/\//i.test(text) ? text : undefined
}