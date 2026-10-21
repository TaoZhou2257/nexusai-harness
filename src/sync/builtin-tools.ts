/**
 * Built-in (tool-square) operations registered as dsh tools.
 *
 * Separate from CustomToolRegistry: that registry clears itself on every
 * sync, and the two catalogs must not wipe each other. Reachable tools send
 * the key stored on the platform. Cluster-internal hosts are not registered.
 * Names are `nexusai__b_<toolSquareId>__<operation>`.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ParameterSchemaSpec, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { NexusApiClient } from '../nexus/api-client'
import type { ApiAuthWebRequest } from '../nexus/model'
import { componentsOf, parseOpenApiDocument, toParameterSpec, type OpenApiOperation } from './openapi'
import { executeOperation, toolPublicName } from './custom-tools'
import { placeServer } from './tool-host'
import type { BuiltinToolSummary } from '../types'

/** Auth used when the detail has none. A stored platform key replaces this. */
const NO_API_KEY: ApiAuthWebRequest = {
  authType: 'none',
  apiKeyHeaderPrefix: '',
  apiKeyHeader: '',
  apiKeyQueryParam: '',
  apiKeyValue: '',
}

/** Constructor options. */
export interface BuiltinToolRegistryOptions {
  readonly api: NexusApiClient
  readonly toolNamePrefix: string
}

/** Owns the lifecycle of built-in tools registered from one sync. */
export class BuiltinToolRegistry {
  private disposers: Array<() => Promise<void>> = []
  private summaries: BuiltinToolSummary[] = []

  constructor(
    private readonly ctx: Context,
    private readonly options: BuiltinToolRegistryOptions,
  ) {}

  /** Cards from the last sync, including intranet tools that were not registered. */
  list(): BuiltinToolSummary[] {
    return [...this.summaries]
  }

  /** Fetch the tool square and (re-)register each reachable operation as a dsh tool. */
  async sync(signal?: AbortSignal): Promise<{ tools: number; errors: string[] }> {
    await this.clear()
    const errors: string[] = []
    const summaries: BuiltinToolSummary[] = []
    const listed = await this.options.api.listBuiltinTools(signal)
    let registered = 0
    for (const item of listed.list ?? []) {
      const id = item.toolSquareId.trim()
      if (id === '') continue
      let intranet = false
      try {
        const detail = await this.options.api.builtinToolDetail(id, signal)
        const doc = parseOpenApiDocument(detail.schema ?? '')
        errors.push(...doc.parseErrors.map(message => `${id}: ${message}`))
        if (doc.serverUrl === '') {
          errors.push(`${id}: OpenAPI document has no servers[0].url`)
        } else {
          const placed = placeServer(doc.serverUrl, this.options.api.baseUrl)
          intranet = placed.intranet
          if (placed.intranet) {
            errors.push(`${id}: cluster intranet host is not callable from the desktop`)
          } else {
            const components = componentsOf(parseValue(detail.schema ?? ''))
            const auth = storedAuth(detail.apiAuth)
            for (const operation of doc.operations) {
              const stripped = stripKeyParameters(operation, auth)
              const path = placed.pathPrefix === '' ? stripped.path : `${placed.pathPrefix}${stripped.path}`
              this.register(id, detail.name || id, placed.serverUrl, { ...stripped, path }, components, auth)
              registered++
            }
            if (doc.operations.length === 0) errors.push(`${id}: no operations in schema`)
          }
        }
      } catch (error) {
        errors.push(`${id}: ${(error as Error).message}`)
      }
      summaries.push({
        toolSquareId: id,
        name: item.name,
        description: item.desc,
        tags: item.tags ?? [],
        intranet,
      })
    }
    this.summaries = summaries
    return { tools: registered, errors }
  }

  /** Unregister every built-in tool this registry owns. */
  async clear(): Promise<void> {
    const pending = this.disposers
    this.disposers = []
    this.summaries = []
    for (const dispose of pending.reverse()) await dispose()
  }

  private register(
    toolSquareId: string,
    displayName: string,
    serverUrl: string,
    operation: OpenApiOperation,
    components: Record<string, unknown> | undefined,
    apiAuth: ApiAuthWebRequest,
  ): void {
    const name = toolPublicName(this.options.toolNamePrefix, `b_${toolSquareId}`, operation)
    const description = [
      operation.summary ?? operation.description ?? displayName,
      `NexusAI built-in tool "${displayName}" ${operation.method.toUpperCase()} ${operation.path}`,
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
        const cleaned: Record<string, unknown> = { ...(args as Record<string, unknown>) }
        for (const keyName of keyNames(apiAuth)) delete cleaned[keyName]
        return executeOperation(serverUrl, apiAuth, operation, cleaned, exec as ToolRunContext)
      },
    })
    const dispose = this.ctx.effect(() => this.ctx.tools.register(definition), `nexusai builtin tool ${name}`)
    this.disposers.push(() => Promise.resolve(dispose()))
  }
}

/** The key stored on the platform. Missing auth calls with none. */
function storedAuth(apiAuth: ApiAuthWebRequest | undefined): ApiAuthWebRequest {
  if (apiAuth === undefined) return NO_API_KEY
  const prefix = apiAuth.apiKeyHeaderPrefix
  return {
    authType: apiAuth.authType === 'api_key_query' || apiAuth.authType === 'api_key_header' ? apiAuth.authType : 'none',
    apiKeyHeaderPrefix: prefix === 'basic' || prefix === 'bearer' || prefix === 'custom' ? prefix : '',
    apiKeyHeader: apiAuth.apiKeyHeader ?? '',
    apiKeyQueryParam: apiAuth.apiKeyQueryParam ?? '',
    apiKeyValue: apiAuth.apiKeyValue ?? '',
  }
}

/** Names the model must not be allowed to send, even if it invents them. */
function keyNames(apiAuth: ApiAuthWebRequest | undefined): readonly string[] {
  const names = [apiAuth?.apiKeyQueryParam?.trim() ?? '', apiAuth?.apiKeyHeader?.trim() ?? '']
  return names.filter(name => name !== '')
}

/** Drop the declared key parameter so the model is not asked to supply it. */
function stripKeyParameters(operation: OpenApiOperation, apiAuth: ApiAuthWebRequest | undefined): OpenApiOperation {
  const queryName = apiAuth?.apiKeyQueryParam?.trim() ?? ''
  const headerName = apiAuth?.apiKeyHeader?.trim() ?? ''
  if (queryName === '' && headerName === '') return operation
  return {
    ...operation,
    parameters: operation.parameters.filter(parameter => {
      if (parameter.in === 'query' && queryName !== '' && parameter.name === queryName) return false
      if (parameter.in === 'header' && headerName !== '' && parameter.name === headerName) return false
      return true
    }),
  }
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
