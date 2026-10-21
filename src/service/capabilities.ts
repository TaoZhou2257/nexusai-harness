/**
 * `nexusaiCapabilities` Remote service: what the sidebar panel lists and
 * syncs after login — custom tools, MCP servers, and downloadable skills.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

import type { NexusApiClient } from '../nexus/api-client'
import type { SkillHubClient } from '../nexus/skillhub'
import type { BuiltinToolRegistry } from '../sync/builtin-tools'
import type { CustomToolRegistry } from '../sync/custom-tools'
import { intranetSchema } from '../sync/tool-host'
import type { McpRowSync } from '../sync/mcp-rows'
import { listMcpCatalog, listSseInputs } from '../sync/mcp-list'
import type { McpSseServerInput, McpSseToolRegistry } from '../sync/mcp-tools'
import type { SkillSync } from '../sync/skills'
import type { ConnectorAuthorRequest, ConnectorAuthorResult, ConnectorBundleSummary, ConnectorToolsResult, LocalSkillEntry, LocalSkillInstallRequest, LocalSkillInstallResult, McpServerSummary, SkillDownloadResult, SkillHubCard, SkillHubDetail, SkillHubInstallResult, SkillSummary, SyncReport } from '../types'
import type { LocalSkills } from '../sync/local-skills'
import type { ConnectorRows } from '../sync/connector-rows'
import { customConnectorLabel, dropConnectorRow, connectorTimeoutMs } from '../sync/connector-rows'
import type { ConnectorTools } from '../sync/connector-tools'
import type { SseConnectors } from '../sync/sse-connectors'
import { bridgeInputOf } from '../sync/sse-connectors'
import { authorConnector, describeBundle, mergeSseInputs } from './connector-author'

/** One 本地 connector card: a patch row, or a custom SSE connector's bridge state. */
export interface LocalMcpSummary {
  readonly id: string
  readonly name: string
  readonly transport: string
  readonly url: string
  /** Whether the connector runs (a row's `disabled` flag / the SSE entry's). */
  readonly enabled: boolean
  /** Whether its tools are registered right now. */
  readonly connected: boolean
  /** How many tools it contributes. */
  readonly toolCount: number
  /** Why it could not contribute tools (a bridge error, when there is one). */
  readonly bridgeError?: string
}

/** Constructor dependencies. */
export interface NexusaiCapabilitiesServiceOptions {
  readonly api: NexusApiClient
  readonly tools: CustomToolRegistry
  readonly builtinTools: BuiltinToolRegistry
  readonly mcp: McpRowSync
  readonly skills: SkillSync
  /** SkillHub marketplace client (api.skillhub.cn). */
  readonly skillhub: SkillHubClient
  readonly localSkills: LocalSkills
  /** User-authored MCP connector rows (自定义连接器). */
  readonly connectors: ConnectorRows
  /** Custom legacy-SSE connectors, bridged instead of written as rows. */
  readonly sseConnectors: SseConnectors
  /** Re-run the SSE bridge (assembly-provided, so the service stays Remote-only). */
  readonly refreshSse: () => Promise<readonly string[]>
  /** The "which tools can I call" read: the dsh registry, per connector. */
  readonly connectorTools: ConnectorTools
  /** Bridge for legacy-SSE MCP servers (dsh cannot host that transport). */
  readonly mcpSse: McpSseToolRegistry
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
    const cached = this.deps.tools.list()
    if (cached.length > 0) return cached
    const listed = await this.deps.api.listCustomTools()
    const cards = []
    for (const item of listed.list ?? []) {
      let intranet = false
      try {
        const detail = await this.deps.api.customToolDetail(item.customToolId)
        intranet = intranetSchema(detail.schema, this.deps.api.baseUrl)
      } catch {
        intranet = false
      }
      cards.push({
        customToolId: item.customToolId,
        name: item.name,
        description: item.description,
        intranet,
      })
    }
    return cards
  }

  /** Built-in tools from the platform tool square (`GET /v1/tool/square/list`). */
  @Remote
  async listBuiltinTools(): Promise<import('../types.ts').BuiltinToolSummary[]> {
    const cached = this.deps.builtinTools.list()
    if (cached.length > 0) return cached
    const listed = await this.deps.api.listBuiltinTools()
    const cards = []
    for (const item of listed.list ?? []) {
      const id = item.toolSquareId.trim()
      if (id === '') continue
      let intranet = false
      try {
        const detail = await this.deps.api.builtinToolDetail(id)
        intranet = intranetSchema(detail.schema ?? '', this.deps.api.baseUrl)
      } catch {
        intranet = false
      }
      cards.push({
        toolSquareId: id,
        name: item.name,
        description: item.desc,
        tags: item.tags ?? [],
        intranet,
      })
    }
    return cards
  }

  /** MCP servers of the active org: 创建 MCP plus 导入 MCP. */
  @Remote
  async listMcpServers(): Promise<McpServerSummary[]> {
    const catalog = await listMcpCatalog(this.deps.api)
    const bridge = new Map(this.deps.mcpSse.list().map(summary => [summary.id, summary]))
    return await Promise.all(catalog.servers.map(async server => {
      const bridged = bridge.get(server.id)
      const serverName = bridged === undefined ? await this.deps.mcp.serverNameOfRow(`nexusai-mcp-${server.id}`) : ''
      const toolCount = bridged !== undefined
        ? bridged.tools.length
        : serverName === '' ? 0 : this.ctx.tools.schemas().filter(schema => schema.name.startsWith(`mcp__${serverName}__`)).length
      return {
        mcpServerId: server.id,
        id: server.id,
        name: server.name,
        desc: server.desc,
        // SSE servers report the tools the bridge actually registered.
        toolNum: bridged !== undefined ? bridged.tools.length : server.toolNum,
        source: server.source,
        transport: server.transport,
        url: server.url,
        connectable: server.connectable,
        bridged: bridged !== undefined && bridged.error === undefined,
        connected: bridged !== undefined ? bridged.error === undefined : toolCount > 0,
        toolCount,
        ...(bridged?.error !== undefined ? { bridgeError: bridged.error } : {}),
      }
    }))
  }

  /** Locally configured MCP servers (the profile's own mcp-client rows). */
  @Remote
  async listLocalMcpServers(): Promise<LocalMcpSummary[]> {
    // Rows (stdio / http) plus the custom SSE connectors, which have no row of
    // their own — they are bridged. Both kinds report whether they are running
    // and what they contribute, so a card can show 连通/未连通/已关闭 without a
    // second call: one registry read covers every row.
    const schemas = this.ctx.tools.schemas()
    const bridge = new Map(this.deps.mcpSse.list().map(summary => [summary.id, summary]))
    const custom = (await this.deps.sseConnectors.list()).map(entry => {
      const bridged = bridge.get(entry.id)
      const connected = entry.enabled && bridged !== undefined && bridged.error === undefined
      return {
        id: entry.id,
        name: entry.name,
        transport: 'sse',
        url: entry.url,
        enabled: entry.enabled,
        headers: entry.headers,
        timeoutSeconds: entry.timeoutSeconds,
        connected,
        toolCount: connected ? bridged.tools.length : 0,
        ...(entry.enabled && bridged?.error !== undefined ? { bridgeError: bridged.error } : {}),
      }
    })
    const rows = (await this.deps.mcp.list()).map(row => {
      const toolCount = row.enabled && row.serverName !== ''
        ? schemas.filter(schema => schema.name.startsWith(`mcp__${row.serverName}__`)).length
        : 0
      // The timeout is the row's own number.
      const budget = row.toolCallTimeoutMs ?? 0
      return {
        ...row,
        connected: row.enabled && toolCount > 0,
        toolCount,
        timeoutSeconds: budget === 0 ? 0 : Math.round(budget / 1000),
      }
    })
    return [...rows, ...custom]
  }

  /**
   * Turn one local connector on or off: a patch row's `disabled` flag (dsh's own
   * switch), or a custom SSE connector's stored flag (its bridge session is
   * dropped or re-established).
   * @param id - the connector's row id or SSE id.
   * @param enabled - whether it should run.
   * @returns whether a connector was found and changed.
   */
  @Remote
  async setConnectorEnabled(id: string, enabled: boolean): Promise<{ changed: boolean }> {
    const target = id.trim()
    if (target === '') throw new Error('缺少连接器 id')
    if (target.startsWith('custom-sse-')) {
      const changed = await this.deps.sseConnectors.setEnabled(target, enabled)
      await this.deps.refreshSse()
      return { changed }
    }
    const changed = await this.deps.mcp.setEnabled(target, enabled)
    return { changed }
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

  /** Author a local MCP connector: the quick form, pasted JSON, or a DXT/MCPB
   * bundle. `request` is the JSON of a ConnectorAuthorRequest — text fields and
   * parsing live behind it so the wire codec stays plain scalars. */
  @Remote
  async authorConnector(request: string): Promise<ConnectorAuthorResult> {
    let parsed: ConnectorAuthorRequest
    try {
      parsed = JSON.parse(request) as ConnectorAuthorRequest
    } catch {
      throw new Error('连接器请求无法解析')
    }
    return authorConnector({
      rows: this.deps.connectors,
      sseConnectors: this.deps.sseConnectors,
      refreshSse: this.deps.refreshSse,
    }, parsed)
  }

  /** The tools one connector contributes, with their parameter schemas. */
  @Remote
  async connectorTools(id: string): Promise<ConnectorToolsResult> {
    return this.deps.connectorTools.list(id)
  }

  /** Remove one connector this plugin authored: its patch row, or its SSE
   * entry. Hand-written rows are refused — the plugin does not own them. */
  @Remote
  async removeConnector(id: string): Promise<{ removed: boolean }> {
    const target = id.trim()
    if (target === '') throw new Error('缺少连接器 id')
    if (customConnectorLabel(target) !== '') {
      const removed = await dropConnectorRow(this.deps.connectors.patchFile(), target)
      return { removed }
    }
    if (target.startsWith('custom-sse-')) {
      const removed = await this.deps.sseConnectors.remove(target)
      if (removed) await this.deps.refreshSse()
      return { removed }
    }
    throw new Error('这个连接器来自配置文件（不是在本页添加的），插件不会删除它')
  }

  /** Read a picked DXT/MCPB bundle's manifest, for the dialog's confirm step. */
  @Remote
  async describeConnectorBundle(path: string): Promise<ConnectorBundleSummary> {
    return describeBundle(path)
  }

  /** Install a skill the desktop panel picked, by absolute path. The panel
   * offers one dialog for everything, so the host decides what was picked: a
   * folder, a SKILL.md (meaning its folder), a .zip or a .md. */
  @Remote
  async installUploadedPath(path: string, overwrite: boolean): Promise<LocalSkillInstallResult> {
    return this.deps.localSkills.installFromPath(path, overwrite)
  }

  /** Install one uploaded skill (folder / .zip / .md). `request` is the JSON
   * of a LocalSkillInstallRequest: uploads carry base64 payloads, and the wire
   * codec for the capability Remote is deliberately kept to plain strings. */
  @Remote
  async installUploadedSkill(request: string, overwrite: boolean): Promise<LocalSkillInstallResult> {
    let parsed: LocalSkillInstallRequest
    try {
      parsed = JSON.parse(request) as LocalSkillInstallRequest
    } catch {
      throw new Error('上传请求无法解析')
    }
    return this.deps.localSkills.install(parsed, overwrite)
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
    // Each capability stands alone: a failing custom-tool sync must not stop
    // the MCP rows or the SSE bridge from being applied.
    let tools = 0
    const errors: string[] = []
    try {
      const report = await this.deps.tools.sync()
      tools = report.tools
      errors.push(...report.errors)
    } catch (error) {
      errors.push(`tools: ${(error as Error).message}`)
    }
    try {
      const builtin = await this.deps.builtinTools.sync()
      tools += builtin.tools
      errors.push(...builtin.errors.map(issue => `builtin: ${issue}`))
    } catch (error) {
      errors.push(`builtin: ${(error as Error).message}`)
    }
    let servers = 0
    let sseServers = 0
    let sseTools = 0
    let sse: McpSseServerInput[] = []
    try {
      const catalog = await listMcpCatalog(this.deps.api)
      for (const note of catalog.notes) this.ctx.logger.info('nexusai: %s', note)
      const rows = catalog.servers
        .filter(server => server.connectable)
        .map(server => ({ mcpServerId: server.id, name: server.name, url: server.url }))
      servers = await this.deps.mcp.write(rows)
      sse = await listSseInputs(this.deps.api)
    } catch (error) {
      errors.push(`mcp: ${(error as Error).message}`)
    }
    try {
      // Legacy-SSE servers cannot ride the mcp-client rows; bridge them into
      // ordinary dsh tools instead so the agent can actually call them. Custom
      // SSE connectors (authored here) ride the same bridge — and survive a
      // failed catalogue request, because they are read from disk below.
      const custom = await this.deps.sseConnectors.enabledList().catch(() => [])
      const bridged = await this.deps.mcpSse.sync(mergeSseInputs(sse, custom.map(bridgeInputOf)))
      for (const issue of bridged.errors) errors.push(issue)
      sseServers = bridged.servers
      sseTools = bridged.tools
    } catch (error) {
      errors.push(`mcp sse: ${(error as Error).message}`)
    }
    return { tools, mcpServers: servers, mcpSseServers: sseServers, mcpSseTools: sseTools, errors }
  }

  /** Download one skill's SKILL.md into the user skills root. */
  @Remote
  async downloadSkill(skillId: string): Promise<SkillDownloadResult> {
    return this.deps.skills.download(skillId)
  }
}
