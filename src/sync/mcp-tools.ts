/**
 * SSE MCP tool bridge: servers the org imports (or creates without a
 * streamable endpoint) speak the legacy SSE transport, which dsh's mcp-client
 * cannot host. This registry connects to each of them, lists their tools, and
 * registers one dsh tool per remote tool — so the agent calls them like any
 * other tool, while the row-based mcp-client path keeps handling the
 * streamable servers.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import { McpSseSession } from '../nexus/mcp-sse'
import { toValueSpec, type ParamSpec } from './openapi'
import type { McpSseCallResult, McpSseTool } from '../types'

/** Public tool name budget, matching the custom-tool registry. */
const NAME_LIMIT = 64

/** One SSE server to bridge. */
export interface McpSseServerInput {
  /** Catalog id (`import-<mcpId>` or the created server's id). */
  readonly id: string
  readonly name: string
  /** The `sseUrl` the session opens. */
  readonly url: string
}

/** What one bridged server contributed, for the panel and the sync report. */
export interface McpSseSummary {
  readonly id: string
  readonly name: string
  readonly url: string
  readonly toolNames: readonly string[]
  /** Set when connecting or listing failed; the server stays visible but unbridged. */
  readonly error?: string
}

export interface McpSseToolRegistryOptions {
  readonly toolNamePrefix: string
  readonly timeoutMs: number
}

export class McpSseToolRegistry {
  private disposers: Array<() => Promise<void>> = []
  private summaries: McpSseSummary[] = []
  /** Live sessions per server id, reconnected on demand. */
  private live = new Map<string, { input: McpSseServerInput; session: McpSseSession }>()
  /** In-flight reconnects, so concurrent tool calls share one handshake. */
  private connecting = new Map<string, Promise<McpSseSession>>()

  constructor(
    private readonly ctx: Context,
    private readonly options: McpSseToolRegistryOptions,
  ) {}

  /** The bridge's state after the last sync. */
  list(): McpSseSummary[] {
    return [...this.summaries]
  }

  /** Whether a server id currently has live tools (panel marking). */
  bridgedIds(): string[] {
    return this.summaries.filter(summary => summary.error === undefined).map(summary => summary.id)
  }

  /** Connect to every SSE server and (re-)register its tools. */
  async sync(servers: readonly McpSseServerInput[]): Promise<{ servers: number; tools: number; errors: string[] }> {
    await this.clear()
    const errors: string[] = []
    let bridged = 0
    let tools = 0
    for (const server of servers) {
      try {
        const session = await this.connect(server)
        const listed = await session.listTools()
        for (const tool of listed) this.registerTool(server, tool)
        tools += listed.length
        bridged++
        this.summaries.push({
          id: server.id,
          name: server.name,
          url: server.url,
          toolNames: listed.map(tool => tool.name),
        })
      } catch (error) {
        const message = (error as Error).message
        errors.push(`mcp sse ${server.name}: ${message}`)
        this.summaries.push({ id: server.id, name: server.name, url: server.url, toolNames: [], error: message })
      }
    }
    return { servers: bridged, tools, errors }
  }

  /** The live session for a server, reconnecting when the stream has ended —
   * SSE servers drop the stream after a while, and a bridged tool must still
   * work minutes later. */
  private connect(server: McpSseServerInput): Promise<McpSseSession> {
    const existing = this.live.get(server.id)
    if (existing !== undefined && !existing.session.isClosed()) return Promise.resolve(existing.session)
    const inflight = this.connecting.get(server.id)
    if (inflight !== undefined) return inflight
    const pending = McpSseSession.connect(server.url, { timeoutMs: this.options.timeoutMs })
      .then(session => {
        existing?.session.close()
        this.live.set(server.id, { input: server, session })
        return session
      })
      .finally(() => { this.connecting.delete(server.id) })
    this.connecting.set(server.id, pending)
    return pending
  }

  /** Call one remote tool, reconnecting once when the stream had dropped. */
  private async callRemote(server: McpSseServerInput, toolName: string, args: Record<string, unknown>): Promise<McpSseCallResult> {
    for (let attempt = 0; ; attempt++) {
      const session = await this.connect(server)
      try {
        return await session.callTool(toolName, args)
      } catch (error) {
        const message = (error as Error).message
        const stale = session.isClosed() || message.includes('未就绪') || message.includes('流已关闭')
        if (attempt >= 1 || !stale) throw error
        // the stream died between the two calls: reconnect and retry once
        session.close()
        this.live.delete(server.id)
      }
    }
  }

  /** Close every session and drop every registered tool (logout / re-sync). */
  async clear(): Promise<void> {
    for (const { session } of this.live.values()) session.close()
    this.live.clear()
    this.connecting.clear()
    this.summaries = []
    const pending = this.disposers
    this.disposers = []
    for (const dispose of pending.reverse()) await dispose()
  }

  private registerTool(server: McpSseServerInput, tool: McpSseTool): void {
    const name = mcpToolName(this.options.toolNamePrefix, server.name, tool.name)
    const description = [
      tool.description !== '' ? tool.description : `MCP tool ${tool.name}`,
      `NexusAI MCP server "${server.name}" tool ${tool.name}（legacy SSE 桥接）`,
    ].join(' — ')
    const parameters = inputSchemaToParameters(tool.inputSchema, `MCP 工具 ${tool.name}`) as unknown as ParameterSchemaSpec
    const registry = this
    const definition = defineTool({
      name,
      description,
      parameters,
      output: {
        schema: { type: 'json' },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: renderCallResult(value) }],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async execute(args: any): Promise<any> {
        const result = await registry.callRemote(server, tool.name, (args ?? {}) as Record<string, unknown>)
        if (result.isError) throw new Error(result.text)
        return { text: result.text }
      },
    })
    const dispose = this.ctx.effect(() => this.ctx.tools.register(definition), `nexusai mcp tool ${name}`)
    this.disposers.push(() => Promise.resolve(dispose()))
  }
}

/** `<prefix>__mcp__<server>__<tool>`, slug-safe and bounded like the custom tools. */
function mcpToolName(prefix: string, serverName: string, toolName: string): string {
  return `${prefix}__mcp__${slugPart(serverName)}__${slugPart(toolName)}`.slice(0, NAME_LIMIT).replace(/_+$/, '')
}

/** A slug that survives non-ASCII names: CJK server names would otherwise all
 * fold to the same placeholder and collide across servers. */
function slugPart(value: string): string {
  const slug = slugify(value)
  if (slug !== 'x') return slug
  let hash = 0
  for (let index = 0; index < value.length; index++) hash = (hash * 31 + value.charCodeAt(index)) | 0
  return `x${(hash >>> 0).toString(36)}`
}

/** Non `[A-Za-z0-9_]` characters fold to underscores (kept distinct from other
 * modules' helpers: a shared identifier name makes esbuild rename Remote
 * parameters, which the Typert gateway reads wire field names from). */
function slugify(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'x'
}

/**
 * MCP `inputSchema` is JSON Schema; dsh takes a flat parameter map and
 * validates it strictly — every annotation must be lossless JSON, so a spec
 * may never carry `undefined` (a missing property description is filled in).
 */
export function inputSchemaToParameters(schema: Record<string, unknown>, toolLabel = 'parameter'): Record<string, ParamSpec> {
  const properties = schema.properties
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) return {}
  const required = Array.isArray(schema.required) ? schema.required.filter(entry => typeof entry === 'string') : []
  const spec: Record<string, ParamSpec> = {}
  for (const [name, node] of Object.entries(properties as Record<string, unknown>)) {
    const raw = typeof node === 'object' && node !== null
      ? toValueSpec(node as Parameters<typeof toValueSpec>[0], undefined)
      : { type: 'json' as const }
    const description = typeof raw.description === 'string' && raw.description !== ''
      ? raw.description
      : `${toolLabel} 参数 ${name}`
    const value = { ...raw, description } as ParamSpec
    spec[name] = (required.includes(name) ? { ...value, required: true } : value) as ParamSpec
  }
  return spec
}

/** Tool output: plain text when the tool returned text, JSON otherwise. */
function renderCallResult(value: unknown): string {
  if (value !== null && typeof value === 'object' && typeof (value as { text?: unknown }).text === 'string') {
    return (value as { text: string }).text
  }
  return JSON.stringify(value)
}