/**
 * NexusAI bff HTTP client: the web frontend's login contract (captcha →
 * encrypted-password login → JWT + X-Org-Id on every call, silent refresh
 * through `new-token` response headers) wrapped for host-side use.
 */
import { encryptPassword } from './crypto'
import type {
  ApiAuthWebRequest,
  ApiResponse,
  CaptchaResponse,
  CustomInfoResponse,
  BuiltinToolListResponse,
  CustomToolDetailResponse,
  CustomToolListResponse,
  LoginResponse,
  McpServerDetailResponse,
  ImportedMcpListResponse, ImportedMcpToolListResponse, McpServerListResponse,
  SkillDetailResponse,
  SkillListResponse,
} from './model'
import type { NexusSession } from '../types'

/** A bff API failure: envelope error code plus its message. */
export class NexusApiError extends Error {
  constructor(message: string, readonly code: number, readonly httpStatus?: number) {
    super(message)
    this.name = 'NexusApiError'
  }
}

/** The JWT stopped authorizing; callers react by dropping the session. */
export class NexusUnauthorizedError extends NexusApiError {
  constructor(message: string) {
    super(message, 401, 401)
    this.name = 'NexusUnauthorizedError'
  }
}

/** Where the client reads and durably keeps the session. */
export interface SessionAccess {
  /** Current session, or undefined when logged out. */
  read(): NexusSession | undefined
  /** Persist (or clear, with undefined) the session record. */
  persist(session: NexusSession | undefined): Promise<void>
}

/** Typed GET query for {@link NexusApiClient.request}. */
export interface RequestOptions {
  readonly query?: Record<string, string | number | boolean | undefined>
  readonly body?: unknown
  readonly signal?: AbortSignal
  /** Skip JWT headers (login, captcha). */
  readonly anonymous?: boolean
}

/** Constructor options. */
export interface NexusApiClientOptions {
  readonly baseUrl: string
  readonly timeoutMs: number
  readonly aesKey: string
  readonly aesIv: string
  readonly session: SessionAccess
}

/**
 * One fixed User-Agent for the process: the captcha's storage key is
 * `MD5(ClientIP + User-Agent + Date)` server-side, so the captcha GET must
 * come from the same UA identity the login POST will use.
 */
const USER_AGENT = 'dsh-nexusai-plugin/0.1'

/**
 * The nginx location that fronts the bff in a NexusAI deployment — the web
 * frontend calls the same composed paths (`<origin>/service/api/v1/...`), so
 * the user's base URL is the bare origin and this prefix rides along here.
 */
const API_PREFIX = '/service/api'

/**
 * Validate and normalize a user-provided base URL (login dialog field):
 * trimmed, no trailing slashes, http(s) only, no query or fragment. A legacy
 * trailing `/service/api` is stripped so older persisted values and config
 * rows do not double the prefix after it moved into `url()`.
 */
export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '').replace(/\/service\/api$/i, '')
  if (trimmed === '') throw new NexusApiError('nexusai: base url is required', -1)
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new NexusApiError(`nexusai: invalid base url "${value}"`, -1)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new NexusApiError(`nexusai: base url must be http(s), got "${parsed.protocol}"`, -1)
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    throw new NexusApiError('nexusai: base url must not carry a query or fragment', -1)
  }
  return trimmed
}

/** The bff client used by every service of this plugin. */
export class NexusApiClient {
  /** Current base URL: the config default, possibly swapped by the user at runtime. */
  private base: string
  /** Login cipher: config at construction, replaced when the credential record loads. */
  private aesKey: string
  private aesIv: string

  constructor(private readonly options: NexusApiClientOptions) {
    this.base = normalizeBaseUrl(options.baseUrl)
    this.aesKey = options.aesKey
    this.aesIv = options.aesIv
  }

  /** Replace the login cipher after the credential record has been read. */
  setCipher(aesKey: string, aesIv: string): void {
    this.aesKey = aesKey
    this.aesIv = aesIv
  }

  /** The base URL currently in effect. */
  get baseUrl(): string {
    return this.base
  }

  /** Swap the base URL at runtime (the login dialog's server field). */
  setBaseUrl(url: string): void {
    this.base = normalizeBaseUrl(url)
  }

  private url(path: string, query?: RequestOptions['query']): string {
    // String concatenation, not `new URL(path, base)`: a rooted path would
    // drop the base's own path prefix. The nginx `/service/api` location is
    // part of the API's path space, so it rides in here (see API_PREFIX).
    const url = new URL(`${this.base}${API_PREFIX}${path}`)
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  private signalOf(external?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.options.timeoutMs)
    return external === undefined ? timeout : AbortSignal.any([timeout, external])
  }

  /** Fetch one `/v1` API path with envelope decoding and session headers. */
  async request<T>(path: string, method: string, options: RequestOptions = {}): Promise<T> {
    const session = this.options.session.read()
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT }
    if (!options.anonymous) {
      if (session === undefined) throw new NexusUnauthorizedError('nexusai: not logged in')
      headers.Authorization = `Bearer ${session.token}`
      headers['X-Org-Id'] = session.orgId
    }
    let body: string | undefined
    if (options.body !== undefined) {
      body = JSON.stringify(options.body)
      headers['Content-Type'] = 'application/json'
    }
    const requestUrl = this.url(path, options.query)
    let response: Response
    try {
      response = await fetch(requestUrl, {
        method,
        headers,
        body,
        signal: this.signalOf(options.signal),
      })
    } catch (error) {
      if ((error as Error).name === 'TimeoutError') {
        throw new NexusApiError(`nexusai: request timed out after ${this.options.timeoutMs} ms`, -1)
      }
      throw error
    }
    await this.captureRefresh(response)
    if (response.status === 401) {
      await this.options.session.persist(undefined)
      throw new NexusUnauthorizedError('nexusai: session rejected (401)')
    }
    return this.decode<T>(response, `${method} ${requestUrl}`)
  }

  /**
   * Decode one bff envelope response with short, dialog-ready failures. A bff
   * envelope with a business message wins even on non-2xx statuses (gin
   * answers binding/decrypt failures with 400 + envelope), so the user sees
   * the real reason; anything else falls back to the HTTP status with a hint.
   */
  private async decode<T>(response: Response, requestLabel: string): Promise<T> {
    const text = await response.text().catch(() => '')
    let envelope: ApiResponse<T> | undefined
    if (text !== '') {
      try {
        envelope = JSON.parse(text) as ApiResponse<T>
      } catch {
        envelope = undefined
      }
    }
    if (envelope !== undefined && typeof envelope.code === 'number' && envelope.code !== 0
      && typeof envelope.msg === 'string' && envelope.msg !== '') {
      throw new NexusApiError(envelope.msg, envelope.code, response.status)
    }
    if (!response.ok) {
      console.info(`nexusai: ${requestLabel} → HTTP ${response.status}`)
      throw new NexusApiError(`NexusAI 服务器返回 HTTP ${response.status}，请检查服务器地址`, -1, response.status)
    }
    if (envelope === undefined) {
      console.info(`nexusai: ${requestLabel} → 不可解析的响应（HTTP ${response.status}）`)
      throw new NexusApiError(`服务器响应无效（HTTP ${response.status}），请确认服务器地址指向 NexusAI 服务`, -1, response.status)
    }
    if (envelope.code !== 0) {
      throw new NexusApiError(envelope.msg || `nexusai: bff error code ${envelope.code}`, envelope.code, response.status)
    }
    return envelope.data
  }

  /** Persist a silent token refresh the bff announced via response headers. */
  private async captureRefresh(response: Response): Promise<void> {
    const token = response.headers.get('new-token')
    const expiresAt = response.headers.get('new-expires-at')
    if (token === null) return
    const session = this.options.session.read()
    if (session === undefined) return
    const next: NexusSession = {
      ...session,
      token,
      expiresAt: expiresAt !== null && expiresAt !== '' ? Number(expiresAt) : session.expiresAt,
    }
    await this.options.session.persist(next)
  }

  /**
   * Probe a candidate base URL without applying it: the captcha endpoint is
   * the lightest anonymous call, so a successful decode means the address is
   * reachable and serving the bff. Never touches the base in effect.
   */
  async testBaseUrl(candidate: string, timeoutMs = 6000): Promise<void> {
    const base = normalizeBaseUrl(candidate)
    const requestUrl = `${base}${API_PREFIX}/v1/base/captcha`
    let response: Response
    try {
      response = await fetch(requestUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          Date: new Date().toUTCString(),
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      if ((error as Error).name === 'TimeoutError') {
        throw new NexusApiError('连接超时，请检查服务器地址和网络', -1)
      }
      throw new NexusApiError('无法连接到服务器，请检查服务器地址和网络', -1)
    }
    await this.decode(response, `GET ${requestUrl}`)
  }

  /** `GET /v1/base/captcha`. */
  async captcha(signal?: AbortSignal): Promise<CaptchaResponse> {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      // The server derives the captcha storage key from IP + UA + Date; a
      // deterministic Date header keeps retries coherent.
      Date: new Date().toUTCString(),
    }
    const requestUrl = this.url('/v1/base/captcha')
    let response: Response
    try {
      response = await fetch(requestUrl, {
        headers,
        signal: this.signalOf(signal),
      })
    } catch (error) {
      if ((error as Error).name === 'TimeoutError') {
        throw new NexusApiError(`nexusai: request timed out after ${this.options.timeoutMs} ms`, -1)
      }
      throw error
    }
    return this.decode<CaptchaResponse>(response, `GET ${requestUrl}`)
  }

  /**
   * `GET /v1/base/custom` — the login-page branding the web frontend renders
   * from (guest, no auth): tab/home titles, login welcome text and logos.
   */
  /** Absolute URL for a branding asset path (the server serves images under
   * the same `/service/api` prefix as the API). */
  assetUrl(path: string | undefined): string {
    const value = (path ?? '').trim()
    if (value === '') return ''
    if (/^https?:\/\//i.test(value)) return value
    const suffix = value.startsWith('/') ? value : `/${value}`
    return `${this.base.replace(/\/$/, '')}${API_PREFIX}${suffix}`
  }

  async customInfo(signal?: AbortSignal): Promise<CustomInfoResponse> {
    const requestUrl = this.url('/v1/base/custom')
    let response: Response
    try {
      response = await fetch(requestUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: this.signalOf(signal),
      })
    } catch (error) {
      if ((error as Error).name === 'TimeoutError') {
        throw new NexusApiError(`nexusai: request timed out after ${this.options.timeoutMs} ms`, -1)
      }
      throw error
    }
    return this.decode<CustomInfoResponse>(response, `GET ${requestUrl}`)
  }

  /** `POST /v1/base/login` with the AES-encrypted password; returns the JWT session. */
  async login(username: string, password: string, key: string, code: string): Promise<LoginResponse> {
    const encrypted = encryptPassword(password, this.aesKey, this.aesIv)
    return this.request<LoginResponse>('/v1/base/login', 'POST', {
      anonymous: true,
      body: { username, password: encrypted, key, code },
    })
  }

  /** `GET /v1/tool/custom/list`. */
  listCustomTools(signal?: AbortSignal): Promise<CustomToolListResponse> {
    return this.request<CustomToolListResponse>('/v1/tool/custom/list', 'GET', { signal })
  }

  /** `GET /v1/tool/square/list` — the platform's built-in tool square. */
  listBuiltinTools(signal?: AbortSignal): Promise<BuiltinToolListResponse> {
    return this.request<BuiltinToolListResponse>('/v1/tool/square/list', 'GET', { signal })
  }

  /** `GET /v1/tool/custom?customToolId=`. */
  customToolDetail(customToolId: string, signal?: AbortSignal): Promise<CustomToolDetailResponse> {
    return this.request<CustomToolDetailResponse>('/v1/tool/custom', 'GET', { query: { customToolId }, signal })
  }

  /** `GET /v1/mcp/server/list`. */
  listMcpServers(signal?: AbortSignal): Promise<McpServerListResponse> {
    return this.request<McpServerListResponse>('/v1/mcp/server/list', 'GET', { signal })
  }

  /** `GET /v1/mcp/server?mcpServerId=`. */
  mcpServerDetail(mcpServerId: string, signal?: AbortSignal): Promise<McpServerDetailResponse> {
    return this.request<McpServerDetailResponse>('/v1/mcp/server', 'GET', { query: { mcpServerId }, signal })
  }

  /** `GET /v1/mcp/list` — the 导入 MCP servers (separate from `/mcp/server/list`). */
  listImportedMcpServers(signal?: AbortSignal): Promise<ImportedMcpListResponse> {
    return this.request<ImportedMcpListResponse>('/v1/mcp/list', 'GET', { signal })
  }

  /** `GET /v1/mcp/tool/list?mcpId=` — one imported server's tools. */
  importedMcpTools(mcpId: string, signal?: AbortSignal): Promise<ImportedMcpToolListResponse> {
    return this.request<ImportedMcpToolListResponse>('/v1/mcp/tool/list', 'GET', { query: { mcpId }, signal })
  }

  /** `GET /v1/agent/skill/custom/list`. */
  listSkills(signal?: AbortSignal): Promise<SkillListResponse> {
    return this.request<SkillListResponse>('/v1/agent/skill/custom/list', 'GET', { signal })
  }

  /** `GET /v1/agent/skill/custom/detail?skillId=`. */
  skillDetail(skillId: string, signal?: AbortSignal): Promise<SkillDetailResponse> {
    return this.request<SkillDetailResponse>('/v1/agent/skill/custom/detail', 'GET', { query: { skillId }, signal })
  }

  /** Resolve an apiAuth request header exactly as the bff's `ToOpenapiAuth` does. */
  static authHeaderOf(auth: ApiAuthWebRequest): { name: string; value: string } | undefined {
    if (auth.authType !== 'api_key_header' || auth.apiKeyValue === '') return undefined
    const name = auth.apiKeyHeader === '' ? 'Authorization' : auth.apiKeyHeader
    const prefix = auth.apiKeyHeaderPrefix === 'basic' ? 'Basic ' : auth.apiKeyHeaderPrefix === 'bearer' ? 'Bearer ' : ''
    return { name, value: `${prefix}${auth.apiKeyValue}` }
  }
}
