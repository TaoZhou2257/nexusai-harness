/**
 * User-authored MCP connectors: the four 自定义连接器 routes (quick form,
 * pasted JSON, DXT bundle, MCPB bundle) all end here, as `custom-mcp-*` rows in
 * the profile's user-layer `cordis.patch.yml`.
 *
 * Rows are the only way to mount an mcp-client instance (dsh has no
 * programmatic connect API), and the id prefix is the ownership marker: the
 * NexusAI sync deletes only `nexusai-mcp-*`, so these survive every logout.
 * They live in their own `- insert:` item — mixing them into the NexusAI item
 * would make that item's "every row is ours" removal check fail and leave stale
 * remote rows behind.
 */
import { isMap, isSeq, type Node } from 'yaml'
import { parsePatchDocument, readPatchText, resolvePatchFile, serverNameOf, writeAtomic } from './patch-file'

/** Row ids this writer owns. The suffix is the connector's display name, so the
 * panel can show what the user typed (dsh's row schema has no label field). */
const CUSTOM_ID_PATTERN = /^custom-mcp-.+$/

/** The transport dsh's mcp-client can host. Legacy SSE is not one of them. */
export type ConnectorTransport = 'stdio' | 'streamable-http'

/** One connector to materialize as an mcp-client row. */
export interface ConnectorDraft {
  /** Display name; also the basis of the row's `serverName`. */
  readonly name: string
  readonly transport: ConnectorTransport
  /** stdio: executable, its arguments, environment and working directory. */
  readonly command?: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
  /** streamable-http: endpoint and extra request headers. */
  readonly url?: string
  readonly headers?: Readonly<Record<string, string>>
  /** Per-call budget in ms; omitted keeps the plugin's configured value. */
  readonly timeoutMs?: number
  /** Provenance, written as a YAML comment above the row (not a config key). */
  readonly origin?: string
}

/** Result of one authoring call. */
export interface ConnectorAddResult {
  readonly id: string
  readonly serverName: string
  readonly name: string
  readonly transport: ConnectorTransport
  /** True when a connector of the same name was replaced (re-adding updates). */
  readonly replaced: boolean
}

/** Constructor options, mirroring the NexusAI row writer's. */
export interface ConnectorRowsOptions {
  /** Absolute profile patch file; empty resolves the desktop profile default. */
  readonly profilePatchFile: string
  readonly serverNamePrefix: string
  readonly toolCallTimeoutMs: number
  readonly failOnStartupError: boolean
}

/** Writes and updates the user's own mcp-client rows. */
export class ConnectorRows {
  constructor(private readonly options: ConnectorRowsOptions) {}

  /** The patch file this writer targets. */
  patchFile(): string {
    return resolvePatchFile(this.options.profilePatchFile)
  }

  /**
   * Add one connector, replacing whatever had the same name: the row id is
   * derived from the name, so re-adding updates that connector in place instead
   * of stacking a second instance that fights over the same tool namespace.
   */
  async add(draft: ConnectorDraft, previousId?: string): Promise<ConnectorAddResult> {
    const name = draft.name.trim()
    if (name === '') throw new Error('连接器需要一个名称')
    if (draft.transport === 'stdio' && (draft.command ?? '').trim() === '') {
      throw new Error('stdio 连接器需要填写启动命令')
    }
    if (draft.transport === 'streamable-http' && (draft.url ?? '').trim() === '') {
      throw new Error('HTTP 连接器需要填写 URL')
    }

    // The id doubles as the panel label: keep the name as typed (CJK and spaces
    // included), dropping only characters that cannot live in an id.
    const suffix = name.replace(/[\r\n]+/g, ' ').replace(/[/\\:*?"<>|]+/g, '-').trim().slice(0, 60)
    const id = `custom-mcp-${suffix === '' ? serverNameOf('c', name, name) : suffix}`
    const serverName = serverNameOf(this.options.serverNamePrefix, name, id)
    const budget = draft.timeoutMs !== undefined && draft.timeoutMs > 0
      ? draft.timeoutMs
      : this.options.toolCallTimeoutMs
    const common = {
      serverName,
      ...(budget > 0 ? { toolCallTimeoutMs: budget } : {}),
      failOnStartupError: this.options.failOnStartupError,
    }
    const config = draft.transport === 'stdio'
      ? {
          transport: 'stdio',
          command: (draft.command ?? '').trim(),
          args: [...(draft.args ?? [])],
          env: { ...(draft.env ?? {}) },
          ...(draft.cwd === undefined || draft.cwd === '' ? {} : { cwd: draft.cwd }),
          ...common,
        }
      : {
          transport: 'streamable-http',
          url: (draft.url ?? '').trim(),
          headers: { ...(draft.headers ?? {}) },
          ...common,
        }

    const patchFile = this.patchFile()
    const document = parsePatchDocument(await readPatchText(patchFile), patchFile)
    if (!isSeq(document.contents)) {
      throw new Error(`nexusai: profile patch ${patchFile} is not a YAML sequence; refusing to edit`)
    }
    const created = document.createNode({ id, name: '@deepseek-ai/dsh-mcp-client', config })
    const row: Node | Record<string, unknown> = created ?? { id, name: '@deepseek-ai/dsh-mcp-client', config }
    const origin = (draft.origin ?? '').trim()
    if (origin !== '' && created !== undefined) created.commentBefore = ` ${origin}`
    // A patch read from a missing file starts as `[]` (flow style); keep
    // the document in the block style every real patch file uses.
    document.contents.flow = false
    const placed = placeCustomRow(document.contents.items, row, id)
    // A rename edits in place: the old id goes away with the same write, so the
    // patch never keeps a second instance of a connector the user just renamed.
    const renamed = previousId !== undefined && previousId !== '' && previousId !== id
      ? dropCustomRow(document.contents.items, previousId)
      : false
    if (placed === 'missing-item') document.add({ insert: [row] })
    await writeAtomic(patchFile, String(document))
    return { id, serverName, name, transport: draft.transport, replaced: placed === 'replaced' || renamed }
  }
}

/**
 * Remove one authored row (used by 删除连接器 and by a rename). Returns whether
 * it was there; nothing else in the patch is touched.
 */
export async function dropConnectorRow(patchFile: string, id: string): Promise<boolean> {
  const document = parsePatchDocument(await readPatchText(patchFile), patchFile)
  if (!isSeq(document.contents)) return false
  if (!dropCustomRow(document.contents.items, id)) return false
  await writeAtomic(patchFile, String(document))
  return true
}

/** Drop one authored row from the plugin-owned item. */
function dropCustomRow(items: unknown[], id: string): boolean {
  for (const item of items) {
    if (!isMap(item) || !item.has('insert')) continue
    const insert = item.get('insert')
    if (!isSeq(insert)) continue
    const at = insert.items.findIndex((entry: unknown) => isMap(entry) && entry.get('id') === id)
    if (at < 0) continue
    insert.items.splice(at, 1)
    return true
  }
  return false
}

/**
 * Put the row in the plugin-owned insert item — replacing the row with this id,
 * or appending. Returns `missing-item` when no such item exists yet, so the
 * caller adds one; leaving it out is what keeps NexusAI's item untouched.
 */
function placeCustomRow(items: unknown[], row: Node | Record<string, unknown>, id: string): 'replaced' | 'appended' | 'missing-item' {
  for (const item of items) {
    if (!isMap(item) || !item.has('insert')) continue
    const insert = item.get('insert')
    if (!isSeq(insert) || insert.items.length === 0) continue
    const ours = insert.items.every((entry: unknown) =>
      isMap(entry) && typeof entry.get('id') === 'string' && CUSTOM_ID_PATTERN.test(entry.get('id') as string))
    if (!ours) continue
    const at = insert.items.findIndex((entry: unknown) => isMap(entry) && entry.get('id') === id)
    if (at >= 0) {
      insert.items.splice(at, 1, row as never)
      return 'replaced'
    }
    insert.items.push(row as never)
    return 'appended'
  }
  return 'missing-item'
}

/** Whether a row id was authored here (the panel annotates those cards). */
export function isCustomConnectorId(id: string): boolean {
  return CUSTOM_ID_PATTERN.test(id)
}

/** The display name a row id carries, or '' when the row was not authored here. */
export function customConnectorLabel(id: string): string {
  return isCustomConnectorId(id) ? id.slice('custom-mcp-'.length) : ''
}

/** Default per-call budget every connector starts with. */
export const CONNECTOR_DEFAULT_TIMEOUT_SECONDS = 60

/**
 * A connector's per-call budget in milliseconds — the 超时 setting, verbatim.
 *
 * dsh's mcp-client has no other timeout field, and — verified — no
 * `progress`/`_meta.progressToken` handling, so a per-call budget is the only
 * knob its transport exposes.
 * @param seconds - the 超时 field in seconds; 0/undefined means the 60 s default.
 * @returns milliseconds, ready for `toolCallTimeoutMs` / the bridge's budget.
 */
export function connectorTimeoutMs(seconds: number | undefined): number {
  const typed = seconds !== undefined && Number.isFinite(seconds) && seconds > 0
    ? Math.round(seconds)
    : CONNECTOR_DEFAULT_TIMEOUT_SECONDS
  return typed * 1000
}
