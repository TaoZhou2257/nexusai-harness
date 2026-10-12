/**
 * The 自定义连接器 seam: three ways to author a local MCP connector, all of
 * which end as `custom-mcp-*` rows (see `connector-rows.ts`). Parsing and
 * validation live here rather than in the dialog so every route reports the
 * same errors and the panel only collects text.
 */
import type { ConnectorAuthorRequest, ConnectorAuthorResult } from '../types'
import type { ConnectorDraft, ConnectorRows, ConnectorTransport } from '../sync/connector-rows'
import { CONNECTOR_DEFAULT_TIMEOUT_SECONDS, connectorTimeoutMs } from '../sync/connector-rows'
import type { SseConnectors } from '../sync/sse-connectors'
// Re-exported for the verification suite, which drives this module outside dsh.
export { ConnectorRows, customConnectorLabel } from '../sync/connector-rows'
export { SseConnectors } from '../sync/sse-connectors'
// The timing rules are re-exported too: the verification suite asserts them.
export { connectorTimeoutMs, CONNECTOR_DEFAULT_TIMEOUT_SECONDS } from '../sync/connector-rows'
import { installBundle, readBundle, type BundleSummary } from '../sync/mcp-bundle'

/** Ceiling for a pasted JSON document. */
const MAX_JSON = 200_000

/** What the authoring routes need from the host. */
export interface ConnectorAuthorDeps {
  /** Rows in the profile patch: stdio and streamable-http connectors. */
  readonly rows: ConnectorRows
  /** The custom legacy-SSE list (dsh cannot host that transport as a row). */
  readonly sseConnectors: SseConnectors
  /** Re-run the SSE bridge so a new connector's tools appear right away. */
  readonly refreshSse: () => Promise<readonly string[]>
}

/**
 * Turn one request into connectors. stdio / http become mcp-client rows; legacy
 * SSE cannot (dsh's mcp-client has no such transport) and is stored for the
 * plugin's bridge instead — the same route the NexusAI catalogue's SSE servers
 * take, so those connectors end up with ordinary dsh tools too.
 */
export async function authorConnector(deps: ConnectorAuthorDeps, request: ConnectorAuthorRequest): Promise<ConnectorAuthorResult> {
  const parsed = request.kind === 'quick'
    ? quickDrafts(request)
    : request.kind === 'json'
      ? draftsFromJson(request.text)
      : [{ draft: (await installBundle(request.path, request.values)).draft }]
  const previousId = 'previousId' in request ? request.previousId : undefined
  const rows = parsed.filter(entry => entry.draft !== undefined).map(entry => entry.draft as ConnectorDraft)
  const sse = parsed.filter(entry => entry.sse !== undefined).map(entry => entry.sse as SseDraftInput)
  const added: ConnectorAuthorResult['added'][number][] = []
  for (const draft of rows) {
    const result = await deps.rows.add(draft, previousId)
    added.push({ name: result.name, transport: result.transport, serverName: result.serverName })
  }
  for (const entry of sse) {
    const result = await deps.sseConnectors.add({
      name: entry.name,
      url: entry.url,
      timeoutSeconds: entry.timeoutSeconds,
      headers: { ...entry.headers },
    })
    if (previousId?.startsWith('custom-sse-') === true && previousId !== result.connector.id) {
      await deps.sseConnectors.remove(previousId)
    }
    added.push({ name: result.connector.name, transport: 'sse', serverName: result.connector.id })
  }
  if (sse.length > 0) {
    const issues = await deps.refreshSse()
    if (issues.length > 0) {
      // The connectors are stored; a failed bridge is reported without losing them.
      const names = added.map(entry => entry.name).join('、')
      return { added, message: `已添加连接器：${names}（桥接报警：${issues.join('；')}）` }
    }
  }
  const names = added.map(entry => entry.name).join('、')
  return { added, message: added.length === 1 ? `已添加连接器：${names}` : `已添加 ${added.length} 个连接器：${names}` }
}

/** One legacy-SSE draft waiting for the store. */
interface SseDraftInput {
  readonly name: string
  readonly url: string
  readonly timeoutSeconds: number
  readonly headers: Readonly<Record<string, string>>
}

/** A pasted config's `timeout` (seconds) when it is a positive number. */
function readTimeoutSeconds(value: unknown): number {
  const seconds = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0
}

/** The form's timeout field: blank or 0 means the default; anything else must
 * be a positive whole number of seconds. */
function parseTimeoutSeconds(value: string | undefined): number {
  const text = (value ?? '').trim()
  if (text === '') return 0
  const seconds = Number(text)
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error(`超时时间需要是秒数（0 或留空表示默认 ${CONNECTOR_DEFAULT_TIMEOUT_SECONDS} 秒）`)
  return Math.round(seconds)
}

/** One parsed entry: a row draft, or an SSE connection for the bridge. */
interface ParsedConnector {
  readonly draft?: ConnectorDraft
  readonly sse?: SseDraftInput
}

/** Read one bundle for the dialog's confirmation step. */
export async function describeBundle(path: string): Promise<BundleSummary> {
  return (await readBundle(path)).summary
}

/** The quick form: text fields in, one row draft or one SSE entry out. */
function quickDrafts(request: Extract<ConnectorAuthorRequest, { kind: 'quick' }>): ParsedConnector[] {
  const timeoutSeconds = parseTimeoutSeconds(request.timeoutSeconds)
  const budget = connectorTimeoutMs(timeoutSeconds)
  if (request.transport === 'sse') {
    if (request.url.trim() === '') throw new Error('SSE 连接器需要填写 URL')
    return [{
      sse: {
        name: request.name,
        url: request.url.trim(),
        timeoutSeconds,
        headers: parseHeaders(request.headers),
      },
    }]
  }
  const transport: ConnectorTransport = request.transport === 'streamable-http' ? 'streamable-http' : 'stdio'
  if (transport === 'stdio') {
    return [{
      draft: {
        name: request.name,
        transport,
        timeoutMs: budget,
        command: request.command.trim(),
        args: splitArgs(request.args),
        env: parseEnv(request.env),
        origin: '自定义连接器（快速创建）',
      },
    }]
  }
  return [{
    draft: {
      name: request.name,
      transport,
      timeoutMs: budget,
      url: request.url.trim(),
      headers: parseHeaders(request.headers),
      origin: '自定义连接器（快速创建）',
    },
  }]
}

/**
 * The common JSON shapes: `{ "mcpServers": { … } }` (Claude Desktop, Claude
 * Code, Cursor), `{ "servers": { … } }` (VS Code), a bare map of servers, or a
 * single server object carrying its own name.
 */
function draftsFromJson(text: string): ParsedConnector[] {
  const source = text.trim()
  if (source === '') throw new Error('请粘贴 MCP 配置 JSON')
  if (source.length > MAX_JSON) throw new Error('JSON 过长（上限 200KB）')
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    throw new Error(`JSON 解析失败：${(error as Error).message}`)
  }
  const entries = serverEntries(parsed)
  if (entries.length === 0) throw new Error('没有找到 MCP 服务器定义（应形如 {"mcpServers": {"name": {"command": …}}}）')
  const drafts: ParsedConnector[] = []
  for (const [name, config] of entries) {
    drafts.push(entryFromJson(name, config))
  }
  return drafts
}

/** Every `name → config` pair the document declares. */
function serverEntries(parsed: unknown): Array<[string, Record<string, unknown>]> {
  const record = asRecord(parsed)
  const wrapped = asRecord(record.mcpServers ?? record.servers)
  if (Object.keys(wrapped).length > 0) return Object.entries(wrapped).map(([name, config]) => [name, asRecord(config)])
  if (typeof record.command === 'string' || typeof record.url === 'string') {
    const name = typeof record.name === 'string' && record.name.trim() !== '' ? record.name.trim() : 'custom-connector'
    return [[name, record]]
  }
  const bare = Object.entries(record).filter(([, value]) => {
    const config = asRecord(value)
    return typeof config.command === 'string' || typeof config.url === 'string'
  })
  return bare.map(([name, config]) => [name, asRecord(config)])
}

/**
 * One JSON entry → a row draft (stdio when it has a command, http when a url),
 * or an SSE entry (`type: "sse"`, which the bridge handles because dsh's
 * mcp-client has no such transport).
 */
function entryFromJson(name: string, config: Record<string, unknown>): ParsedConnector {
  const origin = `自定义连接器（JSON 导入 · ${name}）`
  const command = typeof config.command === 'string' ? config.command.trim() : ''
  if (command !== '') {
    return {
      draft: {
        name,
        transport: 'stdio',
        command,
        args: Array.isArray(config.args) ? config.args.map(String) : [],
        env: stringMap(config.env),
        timeoutMs: connectorTimeoutMs(readTimeoutSeconds(config.timeout)),
        origin,
      },
    }
  }
  const url = typeof config.url === 'string' ? config.url.trim() : ''
  if (url === '') throw new Error(`「${name}」既没有 command 也没有 url，无法作为连接器`)
  const type = typeof config.type === 'string' ? config.type.trim().toLowerCase() : ''
  if (type === 'sse') {
    // A pasted SSE entry carries no timeout of ours: it takes the defaults.
    return { sse: { name, url, timeoutSeconds: 0, headers: stringMap(config.headers) } }
  }
  return {
    draft: {
      name,
      transport: 'streamable-http',
      url,
      headers: stringMap(config.headers),
      // `timeout` in a pasted config is seconds, the same unit as our form.
      timeoutMs: connectorTimeoutMs(readTimeoutSeconds(config.timeout)),
      origin,
    },
  }
}

/**
 * Merge the catalogue's bridged servers with the custom ones, custom last and
 * winning on id collision — the bridge keys tools by id, so one entry per id.
 */
export function mergeSseInputs(
  catalog: readonly { id: string; name: string; url: string }[],
  custom: readonly { id: string; name: string; url: string }[],
): Array<{ id: string; name: string; url: string }> {
  const merged = new Map(catalog.map(entry => [entry.id, entry]))
  for (const entry of custom) merged.set(entry.id, entry)
  return [...merged.values()]
}

/** One arg per line; a single line is split on whitespace so pasted command
 * lines (`-y @scope/server /tmp`) work as-is. */
function splitArgs(value: string): string[] {
  const text = value.trim()
  if (text === '') return []
  if (!text.includes('\n')) return text.split(/\s+/).filter(part => part !== '')
  return text.split('\n').map(line => line.trim()).filter(line => line !== '')
}

/** `KEY=VALUE` per line (blank lines and `#` comments ignored). */
function parseEnv(value: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of value.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const at = trimmed.indexOf('=')
    if (at <= 0) throw new Error(`环境变量需要写成 KEY=VALUE：${trimmed}`)
    env[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim()
  }
  return env
}

/** `Name: value` per line (HTTP header style, so curl output pastes cleanly). */
function parseHeaders(value: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of value.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const at = trimmed.indexOf(':')
    if (at <= 0) throw new Error(`请求头需要写成 Name: value：${trimmed}`)
    headers[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim()
  }
  return headers
}

/** String-valued view of a JSON object (non-strings stringify, null drops). */
function stringMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(asRecord(value))) {
    if (entry === null || entry === undefined) continue
    out[key] = String(entry)
  }
  return out
}

/** A plain-object view of an unknown value; anything else reads as empty. */
function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
