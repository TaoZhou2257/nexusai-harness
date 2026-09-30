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
import type { LoginResponse } from '../nexus/model'
import { normalizeBaseUrl } from '../nexus/api-client'
import type { NexusApiClient } from '../nexus/api-client'
import type { EndpointStore } from '../sync/endpoint-store'
import type { CustomToolRegistry } from '../sync/custom-tools'
import type { McpRowSync } from '../sync/mcp-rows'
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
      this.deps.store.invalidate()
      void this.deps.store.load().then(() => this.changed(), () => this.changed())
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
    await this.deps.tools.clear()
    await this.deps.mcp.clear()
    await this.deps.store.persist(undefined)
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
      const servers = await this.deps.api.listMcpServers()
      const rows = []
      for (const server of servers.list ?? []) {
        const detail = await this.deps.api.mcpServerDetail(server.mcpServerId)
        const url = detail.streamableUrl !== '' ? detail.streamableUrl : detail.sseUrl
        if (url === '') {
          errors.push(`mcp server ${server.name}: no sse/streamable url`)
          continue
        }
        rows.push({ mcpServerId: server.mcpServerId, name: server.name, url })
      }
      await this.deps.mcp.write(rows)
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
