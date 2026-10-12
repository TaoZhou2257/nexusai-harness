/**
 * What a connector can actually do: the tools it contributes to the model.
 *
 * Both carriers land in the same place — dsh's tool registry — whether the
 * connector is an mcp-client row (stdio / streamable-http) or a bridged
 * legacy-SSE server. So one read answers both: `ctx.tools.schemas()` carries the
 * name, description and JSON Schema the model sees, and each connector is
 * matched by its own name prefix (`mcp__<serverName>__`) or, for bridged
 * servers, by the exact tool names the bridge recorded.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectorToolInfo, ConnectorToolsResult } from '../types'
import type { McpRowSync } from './mcp-rows'
import type { SseConnectors } from './sse-connectors'
import type { McpSseToolRegistry } from './mcp-tools'
import { customConnectorLabel } from './connector-rows'

/** Prefix every mcp-client / bridged tool name starts with. */
const MCP_PREFIX = 'mcp__'

/** Reads the registry and resolves which tools belong to one connector. */
export class ConnectorTools {
  constructor(
    private readonly ctx: Context,
    private readonly deps: {
      readonly rows: McpRowSync
      readonly sse: McpSseToolRegistry
      readonly sseConnectors: SseConnectors
    },
  ) {}

  /**
   * The tools of one connector, by the id the panel shows.
   * @param id - a patch row id (ours or hand-written) or a bridged SSE id.
   * @returns the tools with their schemas, plus why there are none.
   */
  async list(id: string): Promise<ConnectorToolsResult> {
    const target = id.trim()
    if (target === '') throw new Error('缺少连接器 id')
    // A bridged server (ours or the catalogue's): the bridge already recorded
    // both names, so the match is exact and the server's own name is known.
    const bridged = this.deps.sse.list().find(entry => entry.id === target)
    if (bridged !== undefined) {
      const rawNames = new Map(bridged.tools.map(tool => [tool.dshName, tool.rawName]))
      const tools = this.ctx.tools.schemas()
        .filter(schema => rawNames.has(schema.name))
        .map((schema): ConnectorToolInfo => ({
          name: schema.name,
          rawName: rawNames.get(schema.name) ?? schema.name,
          description: schema.description,
          parameters: schema.parameters,
        }))
      return { tools, ...(bridged.error === undefined ? {} : { error: bridged.error }) }
    }
    // A row-based connector: the tools are namespaced `mcp__<serverName>__`.
    const serverName = await this.deps.rows.serverNameOfRow(target)
      || await this.deps.rows.serverNameOfRow(`nexusai-mcp-${target}`)
    if (serverName === '') return { tools: [] }
    const prefix = `${MCP_PREFIX}${serverName}__`
    const tools = this.ctx.tools.schemas()
      .filter(schema => schema.name.startsWith(prefix))
      .map((schema): ConnectorToolInfo => ({
        name: schema.name,
        rawName: schema.name.slice(prefix.length),
        description: schema.description,
        parameters: schema.parameters,
      }))
    return { tools }
  }

}

/** Whether an id belongs to a connector this plugin authored (delete/edit are
 * offered for those only — hand-written rows belong to the user's own config). */
export function isAuthoredConnector(id: string): boolean {
  return customConnectorLabel(id) !== '' || id.startsWith('custom-sse-')
}
