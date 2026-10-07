/**
 * `nexusaiCapabilities` Remote service: what the sidebar panel lists and
 * syncs after login — custom tools, MCP servers, and downloadable skills.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

import type { NexusApiClient } from '../nexus/api-client'
import type { SkillHubClient } from '../nexus/skillhub'
import type { CustomToolRegistry } from '../sync/custom-tools'
import type { McpRowSync } from '../sync/mcp-rows'
import { listMcpCatalog } from '../sync/mcp-list'
import type { SkillSync } from '../sync/skills'
import type { LocalSkillEntry, McpServerSummary, SkillDownloadResult, SkillHubCard, SkillHubDetail, SkillHubInstallResult, SkillSummary, SyncReport } from '../types'
import type { LocalSkills } from '../sync/local-skills'

/** Constructor dependencies. */
export interface NexusaiCapabilitiesServiceOptions {
  readonly api: NexusApiClient
  readonly tools: CustomToolRegistry
  readonly mcp: McpRowSync
  readonly skills: SkillSync
  /** SkillHub marketplace client (api.skillhub.cn). */
  readonly skillhub: SkillHubClient
  readonly localSkills: LocalSkills
}

/** Capability listing and sync face for the sidebar panel. */
export class NexusaiCapabilitiesService extends TypertRemoteService {
  private readonly deps: NexusaiCapabilitiesServiceOptions

  constructor(ctx: Context, deps: NexusaiCapabilitiesServiceOptions) {
    super(ctx, 'nexusaiCapabilities')
    this.deps = deps
  }

  /** Custom tools as the last sync saw them. */
  @Remote
  async listCustomTools(): Promise<import('../types.ts').CustomToolSummary[]> {
    if (this.deps.tools.list().length === 0) {
      const listed = await this.deps.api.listCustomTools()
      return (listed.list ?? []).map(item => ({
        customToolId: item.customToolId,
        name: item.name,
        description: item.description,
      }))
    }
    return this.deps.tools.list()
  }

  /** MCP servers of the active org: 创建 MCP plus 导入 MCP. */
  @Remote
  async listMcpServers(): Promise<McpServerSummary[]> {
    const catalog = await listMcpCatalog(this.deps.api)
    return catalog.servers.map(server => ({
      mcpServerId: server.id,
      name: server.name,
      desc: server.desc,
      toolNum: server.toolNum,
      source: server.source,
      transport: server.transport,
      url: server.url,
      connectable: server.connectable,
    }))
  }

  /** Custom skills of the active org. */
  @Remote
  async listSkills(): Promise<SkillSummary[]> {
    return this.deps.skills.list()
  }

  /** Search the SkillHub marketplace (unauthenticated public catalog). */
  @Remote
  async searchSkillHub(keyword: string, category: string, page: number): Promise<{ cards: SkillHubCard[]; total: number }> {
    return this.deps.skillhub.search(keyword, category, page)
  }

  /** The marketplace's category taxonomy (chips in the workbench). */
  @Remote
  async skillhubCategories(): Promise<{ key: string; label: string }[]> {
    return this.deps.skillhub.categories()
  }

  /** 关闭-ed local skills (they exist on disk as `SKILL.md.disabled`, so the
   * registry does not list them). `roots` are the directories of the enabled
   * skills the panel already knows. */
  @Remote
  async disabledLocalSkills(roots: string[]): Promise<LocalSkillEntry[]> {
    return this.deps.localSkills.scanDisabled(roots)
  }

  /** Which of these skill files no longer exist on disk. */
  @Remote
  async missingLocalSkills(paths: string[]): Promise<string[]> {
    return this.deps.localSkills.missing(paths)
  }

  /** 启用 / 关闭 one local skill by renaming its instruction file. */
  @Remote
  async setLocalSkillEnabled(path: string, enabled: boolean, roots: string[]): Promise<void> {
    await this.deps.localSkills.setEnabled(path, enabled, roots)
  }

  /** Delete one local skill's directory. */
  @Remote
  async removeLocalSkill(path: string, roots: string[]): Promise<void> {
    await this.deps.localSkills.remove(path, roots)
  }

  /** One local skill's SKILL.md text, for the panel's preview. */
  @Remote
  async readLocalSkill(path: string, roots: string[]): Promise<string> {
    return this.deps.localSkills.read(path, roots)
  }

  /** One SkillHub listing's full detail (the card's detail view). */
  @Remote
  async skillhubDetail(slug: string): Promise<SkillHubDetail> {
    return this.deps.skillhub.detail(slug)
  }

  /** The skill's SKILL.md text, read from its DSH package. */
  @Remote
  async skillhubPreview(slug: string): Promise<string> {
    return this.deps.skillhub.preview(slug)
  }

  /** Download and install one SkillHub skill into the local skills root. */
  @Remote
  async installSkillHub(slug: string): Promise<SkillHubInstallResult> {
    return this.deps.skillhub.install(slug)
  }

  /** Re-fetch everything and (re-)register tools plus MCP rows. */
  @Remote
  async sync(): Promise<SyncReport> {
    const report = await this.deps.tools.sync()
    const errors = [...report.errors]
    let servers = 0
    try {
      const catalog = await listMcpCatalog(this.deps.api)
      for (const note of catalog.notes) this.ctx.logger.info('nexusai: %s', note)
      const rows = catalog.servers
        .filter(server => server.connectable)
        .map(server => ({ mcpServerId: server.id, name: server.name, url: server.url }))
      servers = await this.deps.mcp.write(rows)
    } catch (error) {
      errors.push(`mcp: ${(error as Error).message}`)
    }
    return { tools: report.tools, mcpServers: servers, errors }
  }

  /** Download one skill's SKILL.md into the user skills root. */
  @Remote
  async downloadSkill(skillId: string): Promise<SkillDownloadResult> {
    return this.deps.skills.download(skillId)
  }
}
