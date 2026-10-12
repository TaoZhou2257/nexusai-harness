/**
 * Custom legacy-SSE connectors, kept beside the rows the other three routes
 * write: dsh's mcp-client has no SSE transport, so these cannot be rows — they
 * are bridged into ordinary dsh tools by `McpSseToolRegistry` instead, exactly
 * like the NexusAI catalogue's SSE servers.
 *
 * The list lives in one JSON file under the dsh home and is merged into the
 * bridge's inputs on every sync, so an org switch or a failed catalogue request
 * never drops them. A file that cannot be parsed is reported and left alone
 * rather than overwritten.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { connectorTimeoutMs } from './connector-rows'

/** One custom SSE connector. */
export interface SseConnector {
  /** Bridge id (`custom-sse-<name>`), also the panel's label. */
  readonly id: string
  readonly name: string
  /** The `sseUrl` the bridge's session opens. */
  readonly url: string
  /** Whether the bridge should carry it (off = listed but not bridged). */
  readonly enabled: boolean
  /** Per-tool-call timeout in seconds as the form collected it; 0 → default 60. */
  readonly timeoutSeconds: number
  /** Custom headers the SSE handshake appends. */
  readonly headers: Readonly<Record<string, string>>
}

/**
 * The bridge input for one stored connector: its headers plus the resolved
 * per-call budget. Both callers (the sync and the author-time refresh) go
 * through this, so a setting added to the store can never be wired into one
 * path and forgotten in the other.
 * @param entry - the stored connector.
 * @returns what `McpSseToolRegistry.sync()` wants for it.
 */
export function bridgeInputOf(entry: SseConnector): {
  readonly id: string
  readonly name: string
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly toolCallTimeoutMs: number
} {
  return {
    id: entry.id,
    name: entry.name,
    url: entry.url,
    headers: { ...entry.headers },
    toolCallTimeoutMs: connectorTimeoutMs(entry.timeoutSeconds),
  }
}

/** Id prefix that marks a connector as authored here. */
export const CUSTOM_SSE_PREFIX = 'custom-sse-'

/** Reads and writes the custom SSE connector list. */
export class SseConnectors {
  constructor(private readonly file: string = defaultFile()) {}

  /** The file this store owns (shown in errors). */
  path(): string {
    return this.file
  }

  /** Every stored connector, in insertion order. */
  async list(): Promise<SseConnector[]> {
    const parsed = await this.read()
    return parsed === undefined ? [] : parsed
  }

  /**
   * Add one connector, replacing any earlier one with the same name (the id is
   * derived from the name) so re-adding corrects an address instead of
   * bridging two sessions onto the same tools.
   */
  async add(input: { name: string; url: string; timeoutSeconds?: number; headers?: Record<string, string> }): Promise<{ connector: SseConnector; replaced: boolean }> {
    const name = input.name.trim()
    const url = input.url.trim()
    if (name === '') throw new Error('连接器需要一个名称')
    if (url === '') throw new Error('SSE 连接器需要填写 URL')
    const existing = (await this.list()).find(entry => entry.id === `${CUSTOM_SSE_PREFIX}${name}`)
    const connector: SseConnector = {
      id: `${CUSTOM_SSE_PREFIX}${name}`, name, url,
      enabled: existing?.enabled ?? true,
      timeoutSeconds: input.timeoutSeconds ?? existing?.timeoutSeconds ?? 0,
      headers: { ...(input.headers ?? existing?.headers ?? {}) },
    }
    const current = await this.read()
    if (current === undefined) {
      throw new Error(`连接器清单 ${this.file} 解析失败（不是合法 JSON）；先修好或移走它再添加`)
    }
    const at = current.findIndex(entry => entry.id === connector.id)
    const next = at >= 0 ? current.map((entry, index) => (index === at ? connector : entry)) : [...current, connector]
    await this.write(next)
    return { connector, replaced: at >= 0 }
  }

  /** Turn one connector's bridge session on or off; returns whether it was there. */
  async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const current = await this.read()
    if (current === undefined) return false
    let changed = false
    const next = current.map(entry => {
      if (entry.id !== id || entry.enabled === enabled) return entry
      changed = true
      return { ...entry, enabled }
    })
    if (changed) await this.write(next)
    return changed
  }

  /** The connectors the bridge should carry, in insertion order. */
  async enabledList(): Promise<SseConnector[]> {
    return (await this.list()).filter(entry => entry.enabled)
  }

  /** Remove one connector by id; returns whether it was there. */
  async remove(id: string): Promise<boolean> {
    const current = await this.read()
    if (current === undefined) return false
    const next = current.filter(entry => entry.id !== id)
    if (next.length === current.length) return false
    await this.write(next)
    return true
  }

  /** The stored list, or undefined when the file exists but cannot be read back. */
  private async read(): Promise<SseConnector[] | undefined> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    if (text.trim() === '') return []
    try {
      const parsed = JSON.parse(text) as unknown
      if (!Array.isArray(parsed)) return undefined
      return parsed.flatMap(entry => {
        if (entry === null || typeof entry !== 'object') return []
        const record = entry as Record<string, unknown>
        const id = typeof record.id === 'string' ? record.id.trim() : ''
        const name = typeof record.name === 'string' ? record.name.trim() : ''
        const url = typeof record.url === 'string' ? record.url.trim() : ''
        return id === '' || url === ''
          ? []
          : [{ id, name: name === '' ? id : name, url, enabled: record.enabled !== false,
               timeoutSeconds: typeof record.timeoutSeconds === 'number' && record.timeoutSeconds > 0 ? record.timeoutSeconds : 0,
               headers: record.headers !== null && typeof record.headers === 'object' ? record.headers as Record<string, string> : {} }]
      })
    } catch {
      return undefined
    }
  }

  /** Atomic write: a temp file in the same directory, then rename over. */
  private async write(connectors: readonly SseConnector[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid.toString(36)}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(connectors, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, this.file)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }
}

/** `<dshHome>/mcp-sse-connectors.json`. */
function defaultFile(): string {
  return join(resolveDshHome(), 'mcp-sse-connectors.json')
}