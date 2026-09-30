/**
 * `nexusaiCapabilities` Remote service: what the sidebar panel lists and
 * syncs after login — custom tools, MCP servers, and downloadable skills.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { NexusApiClient } from '../nexus/api-client'
import type { CustomToolRegistry } from '../sync/custom-tools'
import type { McpRowSync } from '../sync/mcp-rows'
import type { SkillSync } from '../sync/skills'
import type { McpServerSummary, SkillDownloadResult, SkillSummary, SyncReport } from '../types'

/** Constructor dependencies. */
export interface NexusaiCapabilitiesServiceOptions {
  readonly api: NexusApiClient
  readonly tools: CustomToolRegistry
  readonly mcp: McpRowSync
  readonly skills: SkillSync
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

  /** MCP Server entities of the active org. */
  @Remote
  async listMcpServers(): Promise<McpServerSummary[]> {
    const listed = await this.deps.api.listMcpServers()
    return (listed.list ?? []).map(server => ({
      mcpServerId: server.mcpServerId,
      name: server.name,
      desc: server.desc,
      toolNum: server.toolNum,
    }))
  }

  /** Custom skills of the active org. */
  @Remote
  async listSkills(): Promise<SkillSummary[]> {
    return this.deps.skills.list()
  }

  /** Re-fetch everything and (re-)register tools plus MCP rows. */
  @Remote
  async sync(): Promise<SyncReport> {
    const report = await this.deps.tools.sync()
    const errors = [...report.errors]
    let servers = 0
    try {
      const listed = await this.deps.api.listMcpServers()
      const rows = []
      for (const server of listed.list ?? []) {
        const detail = await this.deps.api.mcpServerDetail(server.mcpServerId)
        const url = detail.streamableUrl !== '' ? detail.streamableUrl : detail.sseUrl
        if (url === '') {
          errors.push(`mcp server ${server.name}: no sse/streamable url`)
          continue
        }
        rows.push({ mcpServerId: server.mcpServerId, name: server.name, url })
      }
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
