/**
 * MCP Server sync: the dsh mcp-client plugin has no programmatic connect
 * API — one instance per patch row — so after login this writer appends one
 * `- insert:` item per NexusAI MCP Server (url = the server-provided
 * streamableUrl, AppKey embedded as its `?key=` query param) to the profile's
 * user-layer `cordis.patch.yml`. The HMR watcher mounts each instance without
 * a restart; tools surface as `mcp__<serverName>__<tool>`.
 *
 * File safety mirrors dsh's own `writePluginEnabled`: comment-preserving
 * `yaml` document edits, atomic 0600 writes, and — on any parse failure — an
 * abort that never clobbers the user's hand-written rows. Only top-level
 * insert items whose every row id matches `nexusai-mcp-*` are ever removed.
 */
import { readFile } from 'node:fs/promises'
import { isMap, isSeq } from 'yaml'
import type { Context } from '@deepseek-ai/cordis'
import { parsePatchDocument, readPatchText, resolvePatchFile, serverNameOf, writeAtomic } from './patch-file'
import { customConnectorLabel } from './connector-rows'

/** One row of the patch, as the panel sees it. */
export interface McpRowSummary {
  readonly id: string
  readonly name: string
  readonly transport: string
  readonly url: string
  /** The mcp-client namespace (`mcp__<serverName>__<tool>`). */
  readonly serverName: string
  /** Whether the row runs (dsh's own `disabled` flag on an insert row). */
  readonly enabled: boolean
  /** The row's per-call budget, as configured (ms). */
  readonly toolCallTimeoutMs: number
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly headers: Readonly<Record<string, string>>
}

/** Every row id this plugin owns, for surgical removal. */
const OWNED_ID_PATTERN = /^nexusai-mcp-[A-Za-z0-9_-]+$/

/** One MCP Server row to materialize. */
export interface McpRowInput {
  readonly mcpServerId: string
  readonly name: string
  readonly url: string
}

/** Constructor options. */
export interface McpRowSyncOptions {
  /** Absolute profile patch file; empty resolves the desktop profile default. */
  readonly profilePatchFile: string
  readonly serverNamePrefix: string
  readonly toolCallTimeoutMs: number
  readonly failOnStartupError: boolean
}

/** Writes and removes the plugin-owned mcp-client insert rows. */
export class McpRowSync {
  constructor(
    private readonly ctx: Context,
    private readonly options: McpRowSyncOptions,
  ) {}

  /** The patch file this writer targets. */
  patchFile(): string {
    return resolvePatchFile(this.options.profilePatchFile)
  }

  /** Replace all owned rows with one `- insert:` item for every server. */
  async write(servers: readonly McpRowInput[]): Promise<number> {
    const patchFile = this.patchFile()
    const text = await readPatchText(patchFile)
    const document = parsePatchDocument(text, patchFile)
    if (!isSeq(document.contents)) {
      throw new Error(`nexusai: profile patch ${patchFile} is not a YAML sequence; refusing to edit`)
    }
    // A patch read from a missing file starts as `[]` (flow style); keep
    // the document in the block style every real patch file uses.
    document.contents.flow = false
    const rows = servers.map(server => ({
      id: `nexusai-mcp-${server.mcpServerId}`,
      name: '@deepseek-ai/dsh-mcp-client',
      config: {
        transport: 'streamable-http',
        serverName: serverNameOf(this.options.serverNamePrefix, server.name, server.mcpServerId),
        url: server.url,
        toolCallTimeoutMs: this.options.toolCallTimeoutMs,
        failOnStartupError: this.options.failOnStartupError,
      },
    }))
    // A rewrite is not free: dsh reloads the patch, unmounts every owned
    // instance and reconnects them (tools vanish for a moment). When the rows
    // are already exactly this, leave the file — and the live sessions — alone.
    if (isAlreadyWritten(document, rows)) return rows.length
    removeOwnedItems(document.contents.items)
    if (rows.length > 0) document.add({ insert: rows })
    await writeAtomic(patchFile, String(document))
    return rows.length
  }

  /** Locally configured mcp-client rows for the panel's 本地 tab: every
   * mcp-client insert whose id this plugin does not own (ours are the 远程
   * ones, written from the NexusAI catalog). */
  /**
   * The mcp-client namespace of one row, owned by this plugin or not — the
   * panel's 远程 cards need it to find their tools in the registry.
   * @param id - the row id.
   * @returns the row's `serverName`, or '' when no such row exists.
   */
  async serverNameOfRow(id: string): Promise<string> {
    const found = (await this.scanRows(true)).find(row => row.id === id)
    return found?.serverName ?? ''
  }

  async list(): Promise<McpRowSummary[]> {
    return this.scanRows(false)
  }

  /** Every mcp-client row of the patch; `includeOwned` also reports ours. */
  private async scanRows(includeOwned: boolean): Promise<McpRowSummary[]> {
    const patchFile = this.patchFile()
    const text = await readPatchText(patchFile)
    const document = parsePatchDocument(text, patchFile)
    if (!isSeq(document.contents)) return []
    const rows: McpRowSummary[] = []
    for (const item of document.contents.items) {
      if (!isMap(item) || !item.has('insert')) continue
      const insert = item.get('insert')
      if (!isSeq(insert)) continue
      for (const row of insert.items) {
        if (!isMap(row)) continue
        const id = row.get('id')
        if (typeof id !== 'string' || id === '') continue
        if (!includeOwned && OWNED_ID_PATTERN.test(id)) continue
        if (row.get('name') !== '@deepseek-ai/dsh-mcp-client') continue
        const config = row.get('config')
        const read = (key: string): string => {
          if (!isMap(config)) return ''
          const value = config.get(key)
          return typeof value === 'string' ? value : ''
        }
        const readList = (key: string): string[] => {
          const value = isMap(config) ? config.get(key) : undefined
          return isSeq(value) ? value.items.map(entry => String(entry)) : []
        }
        const readMap = (key: string): Record<string, string> => {
          const value = isMap(config) ? config.get(key) : undefined
          if (!isMap(value)) return {}
          const out: Record<string, string> = {}
          // YAMLMap items are Pair nodes, not arrays.
          for (const pair of value.items) {
            out[String(pair.key)] = String(pair.value)
          }
          return out
        }
        const command = read('command')
        const url = read('url') !== '' ? read('url') : command
        // Rows authored in this plugin carry their display name in the id;
        // everything else shows its serverName (the tool namespace).
        const label = customConnectorLabel(id)
        rows.push({
          id,
          name: label !== '' ? label : read('serverName') !== '' ? read('serverName') : id,
          transport: read('transport'),
          url,
          // The panel shows the tool namespace and can reopen the editor with
          // these values, so both travel with the row.
          serverName: read('serverName'),
          enabled: row.get('disabled') !== true,
          toolCallTimeoutMs: (() => {
            const value = isMap(config) ? config.get('toolCallTimeoutMs') : undefined
            return typeof value === 'number' && value > 0 ? value : 0
          })(),
          command: read('command'),
          args: readList('args'),
          env: readMap('env'),
          headers: readMap('headers'),
        })
      }
    }
    return rows
  }

  /**
   * Turn one local row on or off. dsh reads `disabled` on an insert row itself
   * (the same flag its plugin page writes), and its loader unmounts the
   * instance on the next patch reload — so a disabled connector's tools vanish
   * without a restart.
   * @param id - the row id (plugin-owned rows are refused: the sync owns those).
   * @param enabled - whether the connector should run.
   * @returns whether a row was found and changed.
   */
  async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    if (OWNED_ID_PATTERN.test(id)) {
      throw new Error('这个连接器由 NexusAI 登录同步维护，不能单独关闭')
    }
    const patchFile = this.patchFile()
    const document = parsePatchDocument(await readPatchText(patchFile), patchFile)
    if (!isSeq(document.contents)) {
      throw new Error(`nexusai: profile patch ${patchFile} is not a YAML sequence; refusing to edit`)
    }
    let changed = false
    for (const item of document.contents.items) {
      if (!isMap(item) || !item.has('insert')) continue
      const insert = item.get('insert')
      if (!isSeq(insert)) continue
      for (const row of insert.items) {
        if (!isMap(row) || row.get('id') !== id) continue
        if (enabled) row.delete('disabled')
        else row.set('disabled', true)
        changed = true
      }
    }
    if (changed) await writeAtomic(patchFile, String(document))
    return changed
  }

  /** Remove every owned row (logout). */
  async clear(): Promise<void> {
    const patchFile = this.patchFile()
    let text: string
    try {
      text = await readFile(patchFile, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    const document = parsePatchDocument(text, patchFile)
    if (!isSeq(document.contents)) {
      throw new Error(`nexusai: profile patch ${patchFile} is not a YAML sequence; refusing to edit`)
    }
    const changed = removeOwnedItems(document.contents.items)
    if (!changed) return
    await writeAtomic(patchFile, String(document))
  }
}

/** Whether the owned rows already hold exactly these servers. */
function isAlreadyWritten(
  document: ReturnType<typeof parsePatchDocument>,
  rows: readonly { id: string; config: Record<string, unknown> }[],
): boolean {
  const current = new Map<string, string>()
  if (!isSeq(document.contents)) return false
  for (const item of document.contents.items) {
    if (!isMap(item) || !item.has('insert')) continue
    const insert = item.get('insert')
    if (!isSeq(insert)) continue
    for (const row of insert.items) {
      if (!isMap(row)) continue
      const id = row.get('id')
      if (typeof id !== 'string' || !OWNED_ID_PATTERN.test(id)) continue
      current.set(id, JSON.stringify(row.get('config') ?? null))
    }
  }
  if (current.size !== rows.length) return false
  return rows.every(row => current.get(row.id) === JSON.stringify(row.config))
}

/**
 * Drop every top-level insert item whose rows are all plugin-owned; returns
 * whether any were removed. Only `nexusai-mcp-*` items are ever touched, so
 * rows the user authored here (`custom-mcp-*`) survive every logout.
 */
function removeOwnedItems(items: unknown[]): boolean {
  let removed = false
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (!isMap(item) || !item.has('insert')) continue
    const insert = item.get('insert')
    // A parsed document hands back a YAMLSeq node, not a JS array, so this
    // must go through `isSeq` — `Array.isArray` never matches and the old
    // rows would pile up on every sync.
    if (!isSeq(insert) || insert.items.length === 0) continue
    const owned = insert.items.every((row: unknown) =>
      isMap(row) && typeof row.get('id') === 'string' && OWNED_ID_PATTERN.test(row.get('id') as string))
    if (!owned) continue
    items.splice(index, 1)
    removed = true
  }
  return removed
}
