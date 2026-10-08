/**
 * `nexusaiAuth` Remote service: the login lifecycle, driven through the dsh
 * authorization seam (`ctx.authorization`). Sign-in runs as an
 * `AuthorizationFlow` registered for the `nexusai/session` credential record —
 * the flow performs the bff protocol (captcha → credentials → login) and
 * commits the session as a grant record through `session.commit`, while this
 * service exposes the attempt state machine and the reconnect-safe `watch`
 * stream the browser panel renders. This mirrors how the built-in DeepSeek
 * account provider fronts its own browser flow, and it keeps the token out of
 * every wire answer.
 *
 * Method parameters stay plain identifiers — the Typert gateway reads wire
 * argument names straight off the method signature.
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { AuthorizationService, AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { LoginResponse } from '../nexus/model'
import type { Branding } from '../types'
import { normalizeBaseUrl } from '../nexus/api-client'
import type { NexusApiClient } from '../nexus/api-client'
import type { EndpointStore } from '../sync/endpoint-store'
import type { CustomToolRegistry } from '../sync/custom-tools'
import type { McpRowSync } from '../sync/mcp-rows'
import { listMcpCatalog } from '../sync/mcp-list'
import type { McpSseToolRegistry } from '../sync/mcp-tools'
import { SESSION_KEY, type SessionStore } from '../sync/session-store'
import type { AuthView, NexusOrg, NexusSession, SignInAttemptView, SignInPhase } from '../types'

/** What the panel answered to the waiting flow. */
type Answer =
  | { kind: 'submit'; username: string; password: string; code: string }
  | { kind: 'refresh' }

/** One in-flight sign-in attempt: the view plus the channel the flow waits on. */
interface Attempt {
  readonly controller: AbortController
  /** Settled by the `begin()` continuation after every terminal outcome. */
  done: Promise<void>
  view: SignInAttemptView
  answer: ((answer: Answer) => void) | undefined
}

/** Phases in which a second `startSignIn()` joins the running attempt. */
const ACTIVE: readonly SignInPhase[] = ['initializing', 'waiting-input', 'verifying', 'committing']

/** Constructor dependencies. */
export interface NexusaiAuthServiceOptions {
  readonly api: NexusApiClient
  readonly store: SessionStore
  /** Durable storage for the user-configured base URL override. */
  readonly endpoint: EndpointStore
  readonly tools: CustomToolRegistry
  readonly mcp: McpRowSync
  readonly mcpSse: McpSseToolRegistry
  /** The dsh authorization seam this service registers its login flow with. */
  readonly authorization: AuthorizationService
  /** Org chosen when the account has none configured. */
  readonly defaultOrgId: string
}

/** Login-state Remote face for the sidebar panel. */
export class NexusaiAuthService extends TypertRemoteService {
  private readonly deps: NexusaiAuthServiceOptions
  private attempt: Attempt | undefined
  private readonly listeners = new Set<() => void>()
  private closed = false
  /** Set while `logout()` runs, so the record event does not double-handle it. */
  private deliberateSignOut = false
  /** A one-shot message for the surfaces (empty = nothing to say). */
  private notice = ''

  constructor(ctx: Context, deps: NexusaiAuthServiceOptions) {
    super(ctx, 'nexusaiAuth')
    this.deps = deps
    // One flow per key is a seam invariant; its disposer is an effect on this
    // plugin's context, so the flow (and any attempt it is running) is
    // withdrawn when the plugin unloads.
    deps.authorization.registerFlow({
      key: SESSION_KEY,
      label: 'NexusAI',
      methods: [{ id: 'web', label: 'NexusAI 账号登录' }],
      run: session => this.run(session),
    })
    // The flow commits through the seam, bypassing the store's cache: every
    // record write (login commit, org switch, silent token refresh) reloads it.
    ctx.on('credentials/record-updated', (key: CredentialKey) => {
      if (key !== SESSION_KEY) return
      const hadSession = this.deps.store.read() !== undefined
      this.deps.store.invalidate()
      void this.deps.store.load().then(session => {
        // The stored session vanished under us (expired token, a 401 from
        // another server): finish the sign-out the way `logout()` does, so no
        // stale tools/MCP rows survive it, and say why. A deliberate logout
        // sets the flag and handles both itself.
        if (hadSession && session === undefined && !this.deliberateSignOut) {
          void this.sessionLost()
          return
        }
        // A live session means any earlier loss notice is stale.
        if (session !== undefined) this.notice = ''
        this.changed()
      }, () => this.changed())
    })
    ctx.effect(() => () => {
      this.closed = true
      const active = this.attempt
      if (active !== undefined && active.view.phase !== 'committing') active.controller.abort()
      this.changed()
    }, 'nexusai: attempt lifetime')
  }

  /** The NexusAI base URL currently in effect (config default or user override). */
  @Remote
  async getBaseUrl(): Promise<string> {
    return this.deps.api.baseUrl
  }

  /**
   * Connectivity probe for the login dialog's server field: validate and
   * fetch the candidate's captcha endpoint without applying anything.
   * Throws a readable error when unreachable; resolves when connected.
   */
  @Remote
  async testBaseUrl(url: string): Promise<void> {
    await this.deps.api.testBaseUrl(url)
  }

  /**
   * The login-page branding from the server (the same `GET /v1/base/custom`
   * the web frontend renders from): `name` is the product title shown on the
   * login dialog. Empty string when the server doesn't provide one — the
   * dialog then shows a bare 「登录」 without any hardcoded brand.
   */
  @Remote
  async getBranding(): Promise<Branding> {
    try {
      const info = await this.deps.api.customInfo()
      const name = (info.tab?.title ?? info.home?.title ?? '').trim()
      return {
        name,
        // Login-page assets come from the same admin 平台配置 as the name.
        logoUrl: this.deps.api.assetUrl(info.login?.logo?.path),
        backgroundUrl: this.deps.api.assetUrl(info.login?.background?.path),
        welcomeText: (info.login?.welcomeText ?? '').trim(),
        platformDesc: (info.login?.platformDesc ?? '').trim(),
        buttonColor: (info.login?.loginButtonColor ?? '').trim(),
        version: (info.about?.version ?? '').trim(),
        copyright: (info.about?.copyright ?? '').trim(),
        markUrl: await pickSquareLogo(this.deps.api, [
          info.tab?.logo?.path,
          info.home?.logo?.path,
          info.login?.logo?.path,
        ]),
        dshVersion: dshClientVersion(),
      }
    } catch {
      // Branding is cosmetic: never block the login flow on it.
      return { name: '', logoUrl: '', backgroundUrl: '', welcomeText: '', platformDesc: '', buttonColor: '', version: '', copyright: '', markUrl: '', dshVersion: dshClientVersion() }
    }
  }

  /**
   * Validate, apply live, and persist a user-configured base URL (the login
   * dialog's server field). The running client swaps immediately, so the next
   * captcha fetch goes to the new address.
   */
  @Remote
  async setBaseUrl(url: string): Promise<void> {
    const normalized = normalizeBaseUrl(url)
    this.deps.api.setBaseUrl(normalized)
    await this.deps.endpoint.persist(normalized)
  }

  /** Current login projection; includes the in-flight attempt view when one exists. */
  @Remote
  async status(): Promise<AuthView> {
    return this.view()
  }

  /**
   * Begin a sign-in attempt, or join the active one. The flow runs behind
   * `begin()`; its progress reaches the panel through {@link watch}, and the
   * panel feeds it through {@link submit}.
   */
  @Remote
  async startSignIn(): Promise<AuthView> {
    const active = this.attempt
    if (active !== undefined) {
      if (ACTIVE.includes(active.view.phase)) return this.view()
      await active.done
    }
    if (this.closed) throw new Error('nexusai: service is shutting down')
    const attempt: Attempt = {
      controller: new AbortController(),
      done: Promise.resolve(),
      view: { id: randomUUID(), phase: 'initializing' },
      answer: undefined,
    }
    this.attempt = attempt
    // The interaction stub is never called: the flow reports progress through
    // the attempt view on the watch stream, exactly as the built-in provider
    // reports browser phases through its own account stream.
    attempt.done = this.deps.authorization.begin({
      key: SESSION_KEY,
      signal: attempt.controller.signal,
      interaction: {
        notify: () => undefined,
        prompt: () => Promise.reject(new Error('nexusai: prompt interaction is not supported')),
      },
    }).then(outcome => {
      this.update(attempt, {
        phase: outcome.status === 'authorized' ? 'succeeded' : 'cancelled',
        captchaB64: undefined,
        message: undefined,
      })
      if (outcome.status === 'authorized') void this.syncCapabilities()
    }).catch((error: unknown) => {
      this.update(attempt, { phase: 'failed', captchaB64: undefined, message: (error as Error).message })
    })
    this.changed()
    return this.view()
  }

  /** Feed the waiting flow what the panel collected. */
  @Remote
  async submit(attemptId: string, username: string, password: string, captchaCode: string): Promise<AuthView> {
    const attempt = this.attempt
    if (attempt === undefined || attempt.view.id !== attemptId) {
      throw new Error('nexusai: unknown sign-in attempt')
    }
    if (attempt.view.phase !== 'waiting-input' || attempt.answer === undefined) {
      throw new Error('nexusai: the attempt is not waiting for input')
    }
    attempt.answer({ kind: 'submit', username, password, code: captchaCode })
    return this.view()
  }

  /** Ask the flow for a fresh captcha image. */
  @Remote
  async refreshCaptcha(attemptId: string): Promise<AuthView> {
    const attempt = this.attempt
    if (attempt === undefined || attempt.view.id !== attemptId) {
      throw new Error('nexusai: unknown sign-in attempt')
    }
    if (attempt.view.phase !== 'waiting-input' || attempt.answer === undefined) {
      throw new Error('nexusai: the attempt is not waiting for input')
    }
    attempt.answer({ kind: 'refresh' })
    return this.view()
  }

  /** Withdraw the named attempt. */
  @Remote
  async cancelSignIn(attemptId: string): Promise<AuthView> {
    const attempt = this.attempt
    if (attempt?.view.id === attemptId) {
      if (attempt.view.phase !== 'committing') {
        attempt.controller.abort()
        this.deps.authorization.cancel(SESSION_KEY)
      }
      await attempt.done
    }
    return this.view()
  }

  /** Switch the active org and re-sync capabilities under it. */
  @Remote
  async selectOrg(orgId: string): Promise<AuthView> {
    const session = await this.deps.store.load()
    if (session === undefined) throw new Error('nexusai: not logged in')
    if (!session.orgs.some(org => org.id === orgId)) throw new Error(`nexusai: unknown org ${orgId}`)
    await this.deps.store.persist({ ...session, orgId })
    await this.syncCapabilities()
    return this.view()
  }

  /** Drop the session record, unregister tools, remove the MCP insert rows. */
  @Remote
  async logout(): Promise<void> {
    this.deliberateSignOut = true
    await this.deps.tools.clear()
    await this.deps.mcp.clear()
    await this.deps.mcpSse.clear()
    await this.deps.store.persist(undefined)
    this.notice = ''
    this.deliberateSignOut = false
    this.changed()
  }

  /**
   * A session the user did not give up (401 / expired): clear every
   * registration the old session produced and leave a notice the surfaces can
   * show — the alternative is a silent drop back to 「登录」.
   */
  private async sessionLost(): Promise<void> {
    this.notice = 'nexusai: session-lost'
    try {
      await this.deps.tools.clear()
      await this.deps.mcp.clear()
      await this.deps.mcpSse.clear()
    } catch {
      // Cleanup is best-effort: the projection must still report signed-out.
    }
    this.changed()
  }

  /**
   * Stream the login projection: an initial snapshot, then every change until
   * the stream is withdrawn or the service shuts down.
   */
  @Remote({ mode: 'stream' })
  watch(signal: AbortSignal): AsyncIterable<AuthView> {
    return this.views(signal)
  }

  private async *views(signal: AbortSignal): AsyncIterable<AuthView> {
    let dirty = true
    let wake: (() => void) | undefined
    const changed = (): void => { dirty = true; wake?.() }
    this.listeners.add(changed)
    signal.addEventListener('abort', changed, { once: true })
    try {
      while (!this.closed && !signal.aborted) {
        if (dirty) { dirty = false; yield await this.view(); continue }
        await new Promise<void>(resolve => { wake = resolve })
      }
    } finally {
      this.listeners.delete(changed)
      signal.removeEventListener('abort', changed)
    }
  }

  /**
   * The AuthorizationFlow body: fetch a captcha, wait for the panel's answer,
   * log in, and commit the session as the seam's grant record. Failure at any
   * step rejects `begin()`, which the attempt continuation renders as `failed`.
   */
  private async run(session: AuthorizationSession): Promise<void> {
    const attempt = this.attempt
    if (attempt === undefined) throw new Error('nexusai: no sign-in attempt is active')
    try {
      let captchaKey = ''
      for (;;) {
        this.update(attempt, { phase: 'waiting-input', captchaB64: undefined, message: undefined })
        const captcha = await this.deps.api.captcha(session.signal)
        captchaKey = captcha.key
        this.update(attempt, { phase: 'waiting-input', captchaB64: captcha.b64 })
        const answer = await waitForAnswer(attempt, session.signal)
        if (answer.kind === 'refresh') continue
        this.update(attempt, { phase: 'verifying', captchaB64: undefined, message: undefined })
        const response = await this.deps.api.login(answer.username, answer.password, captchaKey, answer.code)
        await session.commit({ kind: 'grant', payload: buildSession(response, this.deps.defaultOrgId) })
        return
      }
    } finally {
      attempt.answer = undefined
    }
  }

  /** Re-register tools and rewrite MCP rows for the current session. */
  private async syncCapabilities(): Promise<void> {
    const errors: string[] = []
    try {
      await this.deps.tools.sync()
    } catch (error) {
      errors.push(`tools: ${(error as Error).message}`)
    }
    try {
      const catalog = await listMcpCatalog(this.deps.api)
      for (const note of catalog.notes) this.ctx.logger.info('nexusai: %s', note)
      const rows = catalog.servers
        .filter(server => server.connectable)
        .map(server => ({ mcpServerId: server.id, name: server.name, url: server.url }))
      await this.deps.mcp.write(rows)
      const sse = catalog.servers.filter(server => !server.connectable && server.transport === 'sse')
      const bridged = await this.deps.mcpSse.sync(sse.map(server => ({ id: server.id, name: server.name, url: server.url })))
      errors.push(...bridged.errors)
    } catch (error) {
      errors.push(`mcp: ${(error as Error).message}`)
    }
    if (errors.length > 0) this.ctx.logger.warn('nexusai: capability sync issues: %s', errors.join('; '))
  }

  /** The token-free projection the browser half renders. */
  private async view(): Promise<AuthView> {
    const session = await this.deps.store.load()
    return {
      loggedIn: session !== undefined,
      uid: session?.uid,
      username: session?.username,
      nickname: session?.nickname,
      orgId: session?.orgId,
      orgs: session?.orgs,
      expiresAt: session?.expiresAt,
      attempt: this.attempt?.view ?? null,
      ...(this.notice !== '' ? { notice: this.notice } : {}),
    }
  }

  /** Merge fields into the attempt view and wake the watch streams. */
  private update(attempt: Attempt, patch: Partial<SignInAttemptView>): void {
    attempt.view = { ...attempt.view, ...patch }
    this.changed()
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }
}

/**
 * Wait for the panel's answer, or reject when the attempt is withdrawn. The
 * rejection stays a plain error: the withdrawal is the caller's doing, and
 * `begin()` already classifies it through the aborted signal.
 */
function waitForAnswer(attempt: Attempt, signal: AbortSignal): Promise<Answer> {
  return new Promise<Answer>((resolve, reject) => {
    const onAbort = (): void => reject(new Error('nexusai: sign-in withdrawn'))
    const settle = (answer: Answer): void => {
      signal.removeEventListener('abort', onAbort)
      resolve(answer)
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    attempt.answer = settle
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** The bff reports epoch milliseconds or seconds depending on version; normalize to ms. */
function normalizeExpiry(value: number): number {
  return value < 1e12 ? value * 1000 : value
}

function pickOrg(orgs: readonly NexusOrg[], defaultOrgId: string): string {
  if (orgs.length === 0) return ''
  if (defaultOrgId !== '' && orgs.some(org => org.id === defaultOrgId)) return defaultOrgId
  return orgs[0].id
}

function buildSession(response: LoginResponse, defaultOrgId: string): NexusSession {
  const orgs = response.orgs.map(org => ({ id: org.id, name: org.name }))
  return {
    uid: response.uid,
    username: response.username,
    nickname: response.nickname,
    token: response.token,
    expiresAt: normalizeExpiry(response.expiresAt),
    orgId: pickOrg(orgs, defaultOrgId),
    orgs,
  }
}

/**
 * Pick a branding image that works as a 24px sidebar mark: the server ships
 * wide wordmarks for most slots, so each candidate's pixel aspect is measured
 * and the first near-square one wins; '' when none qualifies.
 */
async function pickSquareLogo(api: NexusApiClient, candidates: readonly (string | undefined)[]): Promise<string> {
  for (const candidate of candidates) {
    const url = api.assetUrl(candidate)
    if (url === '') continue
    const size = await pngSize(url)
    if (size === undefined) continue
    const ratio = size.width / size.height
    if (ratio >= 0.8 && ratio <= 1.25) return url
  }
  return ''
}

/** PNG width/height from the IHDR chunk of the first bytes, without decoding. */
async function pngSize(url: string): Promise<{ width: number; height: number } | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) })
    if (!response.ok) return undefined
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return undefined
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return { width: view.getUint32(16), height: view.getUint32(20) }
  } catch {
    return undefined
  }
}

/**
 * The dsh build string the shell prints in the sidebar. The client bundle gets
 * it through a build-time define we cannot see, so it is reconstructed here:
 * the injected variables when the host carries them, else the installed
 * sidebar package's version, else the checkout's git commit when the dev home
 * still points into a repository.
 */
function dshClientVersion(): string {
  const env = process.env
  const injected = env.DSH_CLIENT_VERSION
  if (injected !== undefined && injected !== '') {
    // The desktop injects the version but not the commit into the host, so the
    // checkout's short hash fills the suffix the shell prints in dev builds.
    const commit = env.DSH_CLIENT_COMMIT_HASH !== undefined && env.DSH_CLIENT_COMMIT_HASH !== ''
      ? env.DSH_CLIENT_COMMIT_HASH
      : commitHashFromRepo()
    return injected
      + (commit === '' ? '' : `-${commit}`)
      + (env.DSH_CLIENT_GIT_DIRTY === 'true' ? '-dirty' : '')
  }
  let version = ''
  try {
    const resolved = createRequire(import.meta.url)('@deepseek-ai/dsh-client-ui-sidebar/package.json') as { version?: string }
    version = resolved.version ?? ''
  } catch {
    version = ''
  }
  if (version === '') return ''
  const commit = commitHashFromRepo()
  return version + (commit === '' ? '' : `-${commit}`)
}

/** The checkout's short commit hash: walk up from the dsh home until a `.git`
 * entry appears (a packaged install has none, and returns ''). */
function commitHashFromRepo(): string {
  try {
    let directory = resolveDshHome()
    for (let depth = 0; depth < 8; depth++) {
      if (existsSync(join(directory, '.git'))) {
        // Seven characters, the abbreviation dsh's own build prints.
        return execFileSync('git', ['-C', directory, 'rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8', timeout: 5_000 }).trim()
      }
      const parent = resolve(directory, '..')
      if (parent === directory) break
      directory = parent
    }
    return ''
  } catch {
    return ''
  }
}
