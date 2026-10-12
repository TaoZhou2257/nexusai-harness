/**
 * The org's two MCP catalogues:
 *
 * - `GET /v1/mcp/server/list` (创建 MCP) — servers that bind published apps;
 *   the bff exposes each over streamable HTTP, so dsh can host them directly.
 * - `GET /v1/mcp/list` (导入 MCP) — externally hosted servers; today they are
 *   legacy-SSE only, which dsh's mcp-client does not speak, so they are shown
 *   in the panel but not registered as tools.
 */
import type { NexusApiClient } from '../nexus/api-client'

/** One server of either catalogue, normalized for the panel and the row writer. */
export interface McpDescriptor {
  /** Row-id discriminator passed to the mcp-client writer. */
  readonly id: string
  readonly name: string
  readonly desc: string
  readonly url: string
  readonly toolNum: number
  readonly source: 'created' | 'imported'
  readonly transport: string
  /** Whether dsh's mcp-client can host it (streamable HTTP endpoint present). */
  readonly connectable: boolean
}

/**
 * The catalogue's legacy-SSE servers, as the bridge wants them: the ones dsh's
 * mcp-client cannot host (`connectable` false) and that speak SSE.
 * @param api - the NexusAI client.
 * @returns bridge inputs; empty when the catalogue is unreachable.
 */
export async function listSseInputs(api: NexusApiClient): Promise<McpSseServerInput[]> {
  try {
    const catalog = await listMcpCatalog(api)
    return catalog.servers
      .filter(server => !server.connectable && server.transport === 'sse')
      .map(server => ({ id: server.id, name: server.name, url: server.url }))
  } catch {
    return []
  }
}

/** One bridge input: a server id, its display name, and the URL the session opens. */
export interface McpSseServerInput {
  readonly id: string
  readonly name: string
  readonly url: string
}

export interface McpCatalog {
  readonly servers: McpDescriptor[]
  /** Human-readable reasons for servers that cannot be registered. */
  readonly notes: string[]
}

export async function listMcpCatalog(api: NexusApiClient, signal?: AbortSignal): Promise<McpCatalog> {
  const servers: McpDescriptor[] = []
  const notes: string[] = []

  // 创建 MCP: streamable URL comes from the per-server detail.
  try {
    const listed = await api.listMcpServers(signal)
    for (const server of listed.list ?? []) {
      const detail = await api.mcpServerDetail(server.mcpServerId, signal)
      const streamable = detail.streamableUrl !== ''
      const url = streamable ? detail.streamableUrl : detail.sseUrl
      if (url === '') {
        notes.push(`MCP「${server.name}」没有可用的连接地址`)
        continue
      }
      if (!streamable) notes.push(`MCP「${server.name}」仅有 SSE 地址，dsh 暂不支持，未注册为工具`)
      servers.push({
        id: server.mcpServerId,
        name: server.name,
        desc: server.desc,
        url,
        toolNum: server.toolNum,
        source: 'created',
        transport: streamable ? 'streamable-http' : 'sse',
        connectable: streamable,
      })
    }
  } catch (error) {
    notes.push(`创建 MCP 获取失败：${(error as Error).message}`)
  }

  // 导入 MCP: tool counts need one call per server; failures degrade to 0.
  try {
    const listed = await api.listImportedMcpServers(signal)
    for (const server of listed.list ?? []) {
      const streamable = server.streamableUrl !== ''
      const url = streamable ? server.streamableUrl : server.sseUrl
      let toolNum = 0
      try {
        const tools = await api.importedMcpTools(server.mcpId, signal)
        toolNum = (tools.tools ?? []).length
      } catch {
        toolNum = 0
      }
      if (url === '') {
        notes.push(`MCP「${server.name}」没有可用的连接地址`)
        continue
      }
      if (!streamable) notes.push(`MCP「${server.name}」是 legacy SSE 连接，dsh 暂不支持，未注册为工具`)
      servers.push({
        id: `import-${server.mcpId}`,
        name: server.name,
        desc: server.desc !== '' ? server.desc : server.from,
        url,
        toolNum,
        source: 'imported',
        transport: streamable ? 'streamable-http' : 'sse',
        connectable: streamable,
      })
    }
  } catch (error) {
    notes.push(`导入 MCP 获取失败：${(error as Error).message}`)
  }

  return { servers, notes }
}