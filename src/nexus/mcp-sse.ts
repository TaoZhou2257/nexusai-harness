/**
 * Minimal MCP client for the **legacy SSE transport** (`transport: 'sse'`),
 * which dsh's own mcp-client does not speak (it hosts stdio and
 * streamable-http only).
 *
 * Handshake, as the servers this org imports implement it:
 *   1. `GET <sseUrl>` with `Accept: text/event-stream` → the server streams an
 *      `event: endpoint` whose data is the URL JSON-RPC requests must POST to
 *      (usually carrying a `sessionId`).
 *   2. `POST` JSON-RPC to that endpoint; **responses come back over the same
 *      SSE stream**, matched by `id`.
 *   3. `initialize` → `notifications/initialized` → `tools/list` / `tools/call`.
 *
 * One session owns one connection; `close()` aborts the stream and fails every
 * request still in flight.
 */
import type { McpSseCallResult, McpSseTool } from '../types'

/** Per-request budget for JSON-RPC calls. */
const REQUEST_TIMEOUT_MS = 20_000

/** JSON-RPC over the stream: requests carry ids, the server answers in-band. */
interface JsonRpcResponse {
  id?: number
  result?: unknown
  error?: { code?: number; message?: string }
}

interface PendingCall {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

export interface McpSseConnectOptions {
  /** Budget for the stream handshake (the endpoint event). */
  readonly timeoutMs: number
}

export class McpSseSession {
  private readonly pending = new Map<number, PendingCall>()
  private readonly controller = new AbortController()
  private nextId = 1
  private closed = false
  private endpoint = ''

  private constructor(private readonly streamDone: Promise<void>) {}

  /** Open the stream, wait for the endpoint event, and finish the handshake. */
  static async connect(url: string, options: McpSseConnectOptions): Promise<McpSseSession> {
    const session = new McpSseSession(Promise.resolve())
    let response: Response
    try {
      response = await fetch(url, {
        headers: { Accept: 'text/event-stream', 'User-Agent': 'dsh-nexusai-plugin/0.1' },
        signal: AbortSignal.any([session.controller.signal, AbortSignal.timeout(options.timeoutMs)]),
      })
    } catch (error) {
      session.close()
      throw new Error(`SSE 连接失败：${(error as Error).message}`)
    }
    if (!response.ok || response.body === null) {
      throw new Error(`SSE 连接失败（HTTP ${response.status}）`)
    }

    let ready: (value: string) => void = () => undefined
    const endpointReady = new Promise<string>(resolve => { ready = resolve })
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    const pump = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          // Servers differ on line endings (CRLF vs LF), and SSE frames are
          // separated by a blank line either way.
          buffer = buffer.replace(/\r\n/g, '\n')
          let index: number
          while ((index = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, index)
            buffer = buffer.slice(index + 2)
            const event = /^event:\s*(.+)$/m.exec(frame)?.[1]?.trim() ?? 'message'
            const data = frame.split('\n')
              .filter(line => line.startsWith('data:'))
              .map(line => line.slice(5).trim())
              .join('\n')
            if (data === '') continue
            if (event === 'endpoint') {
              try {
                ready(new URL(data, url).href)
              } catch {
                ready('')
              }
              continue
            }
            let message: JsonRpcResponse
            try {
              message = JSON.parse(data) as JsonRpcResponse
            } catch {
              continue
            }
            const id = message.id
            if (id === undefined) continue
            const call = session.pending.get(id)
            if (call === undefined) continue
            session.pending.delete(id)
            clearTimeout(call.timer)
            if (message.error !== undefined) call.reject(new Error(message.error.message ?? 'MCP error'))
            else call.resolve(message.result)
          }
        }
      } catch {
        // aborted, or the peer closed the stream; in-flight calls fail below
      }
      for (const call of session.pending.values()) {
        clearTimeout(call.timer)
        call.reject(new Error('SSE 流已关闭'))
      }
      session.pending.clear()
      session.closed = true
      ready('')
    })()
    ;(session as unknown as { streamDone: Promise<void> }).streamDone = pump

    const timer = setTimeout(() => { ready('') }, options.timeoutMs)
    const endpoint = await endpointReady
    clearTimeout(timer)
    if (endpoint === '') {
      session.close()
      throw new Error('SSE 握手超时：未收到 endpoint 事件')
    }
    session.endpoint = endpoint

    await session.call('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'dsh-nexusai-plugin', version: '0.1' },
    })
    await session.notify('notifications/initialized')
    return session
  }

  /** Every tool the server advertises, with its JSON-Schema input. */
  async listTools(): Promise<McpSseTool[]> {
    const result = await this.call('tools/list', {}) as { tools?: unknown } | undefined
    const raw = Array.isArray(result?.tools) ? result.tools : []
    const tools: McpSseTool[] = []
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) continue
      const tool = entry as { name?: unknown; description?: unknown; inputSchema?: unknown }
      const name = typeof tool.name === 'string' ? tool.name.trim() : ''
      if (name === '') continue
      tools.push({
        name,
        description: typeof tool.description === 'string' ? tool.description : '',
        inputSchema: typeof tool.inputSchema === 'object' && tool.inputSchema !== null
          ? tool.inputSchema as Record<string, unknown>
          : { type: 'object', properties: {} },
      })
    }
    return tools
  }

  /** Call one tool and flatten its content blocks into text. */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpSseCallResult> {
    const result = await this.call('tools/call', { name, arguments: args }) as {
      content?: unknown
      isError?: unknown
    } | undefined
    const blocks = Array.isArray(result?.content) ? result.content : []
    const text = blocks.map(block => {
      if (typeof block !== 'object' || block === null) return ''
      const typed = block as { type?: unknown; text?: unknown }
      if (typed.type === 'text' && typeof typed.text === 'string') return typed.text
      return JSON.stringify(block)
    }).filter(part => part !== '').join('\n')
    return { text: text === '' ? JSON.stringify(result ?? {}) : text, isError: result?.isError === true }
  }

  /** Whether the stream has ended (the session must be reconnected to work). */
  isClosed(): boolean {
    return this.closed
  }

  /** Abort the stream; every pending request fails. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.controller.abort()
  }

  /** One JSON-RPC request; resolves with `result`, rejects on timeout/error. */
  private call(method: string, params: unknown): Promise<unknown> {
    if (this.closed || this.endpoint === '') return Promise.reject(new Error('SSE 会话未就绪'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} 超时`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      void fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'dsh-nexusai-plugin/0.1' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }).then(response => {
        if (response.ok) return
        this.pending.delete(id)
        clearTimeout(timer)
        reject(new Error(`${method} 发送失败（HTTP ${response.status}）`))
      }, error => {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(new Error(`${method} 发送失败：${(error as Error).message}`))
      })
    })
  }

  private async notify(method: string): Promise<void> {
    if (this.closed || this.endpoint === '') return
    await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'dsh-nexusai-plugin/0.1' },
      body: JSON.stringify({ jsonrpc: '2.0', method }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).catch(() => undefined)
  }
}