/**
 * Custom tool sync: fetch every custom tool's OpenAPI schema and register one
 * dsh tool per operation, executing the target API directly from the client —
 * the same semantics the server's own agent-service uses
 * (`internal/agent-service/service/plugin_service.go` `createHTTPHandler`):
 * `servers[0].url + path`, GET args as query params (auth key first, business
 * params never overwrite it), POST/PUT/PATCH args as the JSON body, api_key
 * header auth with Basic/Bearer/raw prefix.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ParameterSchemaSpec, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { NexusApiClient } from '../nexus/api-client'
import type { ApiAuthWebRequest } from '../nexus/model'
import { componentsOf, parseOpenApiDocument, toParameterSpec, type OpenApiOperation } from './openapi'
import type { CustomToolSummary } from '../types'

/** Constructor options. */
export interface CustomToolRegistryOptions {
  readonly api: NexusApiClient
  readonly toolNamePrefix: string
}

/** Public tool name budget; dsh tool names stay short and slug-safe. */
const NAME_LIMIT = 64

/** Owns the lifecycle of all `nexusai__*` tools registered from one sync. */
export class CustomToolRegistry {
  private disposers: Array<() => Promise<void>> = []
  private summaries: CustomToolSummary[] = []

  constructor(
    private readonly ctx: Context,
    private readonly options: CustomToolRegistryOptions,
  ) {}

  /** The tool list of the last successful sync, for UI display. */
  list(): CustomToolSummary[] {
    return [...this.summaries]
  }

  /** Fetch all custom tools and (re-)register their operations as dsh tools. */
  async sync(signal?: AbortSignal): Promise<{ tools: number; errors: string[] }> {
    await this.clear()
    const errors: string[] = []
    const listed = await this.options.api.listCustomTools(signal)
    this.summaries = (listed.list ?? []).map(item => ({
      customToolId: item.customToolId,
      name: item.name,
      description: item.description,
    }))
    let registered = 0
    for (const item of listed.list ?? []) {
      try {
        const detail = await this.options.api.customToolDetail(item.customToolId, signal)
        const doc = parseOpenApiDocument(detail.schema)
        const components = componentsOf(parseValue(detail.schema))
        if (doc.serverUrl === '') {
          errors.push(`tool ${item.name}: OpenAPI document has no servers[0].url`)
          continue
        }
        for (const operation of doc.operations) {
          this.registerOperation(item.name, item.description, doc.serverUrl, detail.apiAuth, operation, components)
          registered++
        }
        if (doc.operations.length === 0) errors.push(`tool ${item.name}: no operations in schema`)      } catch (error) {
        errors.push(`tool ${item.name}: ${(error as Error).message}`)
      }
    }
    return { tools: registered, errors }
  }

  /** Unregister every tool this registry owns. */
  async clear(): Promise<void> {
    const pending = this.disposers
    this.disposers = []
    for (const dispose of pending.reverse()) await dispose()
  }

  private registerOperation(
    toolName: string,
    toolDescription: string,
    serverUrl: string,
    apiAuth: ApiAuthWebRequest,
    operation: OpenApiOperation,
    components: Record<string, unknown> | undefined,
  ): void {
    const name = toolPublicName(this.options.toolNamePrefix, toolName, operation)
    const description = [
      operation.summary ?? operation.description ?? toolDescription,
      `NexusAI custom tool "${toolName}" ${operation.method.toUpperCase()} ${operation.path}`,
    ].filter(part => part !== undefined && part !== '').join(' — ')
    const parameters = toParameterSpec(operation, components) as unknown as ParameterSchemaSpec
    const definition = defineTool({
      name,
      description,
      parameters,
      output: {
        schema: { type: 'json' },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: renderResult(value) }],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async execute(args: any, exec: any): Promise<any> {
        return executeOperation(serverUrl, apiAuth, operation, args, exec)
      },
    })
    const dispose = this.ctx.effect(() => this.ctx.tools.register(definition), `nexusai tool ${name}`)
    this.disposers.push(() => Promise.resolve(dispose()))
  }
}

/** `nexusai__<tool>__<operation>`, slug-safe and capped. */
function toolPublicName(prefix: string, toolName: string, operation: OpenApiOperation): string {
  const operationPart = operation.operationId ?? `${operation.method}_${operation.path}`
  return `${prefix}__${slugifyTool(toolName)}__${slugifyTool(operationPart)}`.slice(0, NAME_LIMIT).replace(/_+$/, '')
}

/** Non `[A-Za-z0-9_]` characters fold to underscores. Named `slugifyTool`
 * rather than `slug`: a bare `slug` here collides with other modules'
 * helpers once esbuild flattens the bundle, and the collision makes esbuild
 * rename Remote method parameters — which the Typert gateway reads wire
 * field names from. */
function slugifyTool(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'x'
}

/** Execute one operation against the target API, mirroring createHTTPHandler. */
async function executeOperation(
  serverUrl: string,
  apiAuth: ApiAuthWebRequest,
  operation: OpenApiOperation,
  args: Record<string, unknown>,
  exec: ToolRunContext,
): Promise<unknown> {
  if (operation.requestBody?.contentType === 'multipart/form-data') {
    throw new Error(`nexusai: multipart/form-data tools are not supported yet (${operation.method.toUpperCase()} ${operation.path})`)
  }
  const url = new URL(operation.path, ensureTrailingSlash(serverUrl))
  const pathParameters = operation.parameters.filter(parameter => parameter.in === 'path')
  let remaining = { ...args }
  for (const parameter of pathParameters) {
    const value = remaining[parameter.name]
    if (value === undefined) continue
    url.pathname = url.pathname.replace(`{${parameter.name}}`, encodeURIComponent(String(value)))
    delete remaining[parameter.name]
  }
  // Auth query key is set first; business params never overwrite it.
  if (apiAuth.authType === 'api_key_query' && apiAuth.apiKeyValue !== '') {
    url.searchParams.set(apiAuth.apiKeyQueryParam, apiAuth.apiKeyValue)
  }
  const method = operation.method.toUpperCase()
  let body: string | undefined
  if (method === 'GET') {
    for (const [key, value] of Object.entries(remaining)) {
      if (value === undefined) continue
      url.searchParams.set(key, stringifyArg(value))
    }
  } else if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    body = JSON.stringify(remaining)
  } else {
    // DELETE carries no body, matching the server executor.
    remaining = {}
  }
  const headers: Record<string, string> = {}
  const authHeader = NexusApiClient.authHeaderOf(apiAuth)
  if (authHeader !== undefined) headers[authHeader.name] = authHeader.value
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(url, {
    method,
    headers,
    body,
    signal: exec.signal,
  })
  const text = await response.text()
  let parsed: unknown = text
  try {
    parsed = JSON.parse(text)
  } catch {
    // Non-JSON body stays as text.
  }
  return { status: response.status, ok: response.ok, body: parsed }
}

function ensureTrailingSlash(serverUrl: string): string {
  return serverUrl.endsWith('/') ? serverUrl : `${serverUrl}/`
}

function stringifyArg(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function renderResult(value: unknown): string {
  if (typeof value === 'object' && value !== null) return JSON.stringify(value, null, 2)
  return String(value)
}

function parseValue(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
