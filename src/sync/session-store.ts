/**
 * Durable session storage: the JWT session lives as a GrantRecord at the
 * credential key `nexusai/session` (`$DSH_HOME/.credentials.yaml`), so it
 * survives restarts, never enters row configuration, and rotates safely
 * through the seam's serialized `modifyRecord`.
 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { NexusSession } from '../types'

/** One plugin-owned credential record key; the login flow commits here. */
export const SESSION_KEY = credentialKey('nexusai', 'session')

/** Reads and persists the login session through `ctx.credentials`. */
export class SessionStore {
  private cache: NexusSession | undefined
  private loaded = false

  constructor(private readonly ctx: Context) {}

  /** Load the record once; later calls serve the in-memory snapshot. */
  async load(): Promise<NexusSession | undefined> {
    if (this.loaded) return this.cache
    const record = await this.ctx.credentials.readRecord(SESSION_KEY)
    this.cache = record?.kind === 'grant' ? this.coerce(record.payload) : undefined
    this.loaded = true
    return this.cache
  }

  /** Current session, or undefined before load / when logged out. */
  read(): NexusSession | undefined {
    return this.cache
  }

  /** Drop the in-memory snapshot so the next `load()` re-reads the record. */
  invalidate(): void {
    this.loaded = false
    this.cache = undefined
  }

  /** Persist the session (or clear it with undefined) and refresh the cache. */
  async persist(session: NexusSession | undefined): Promise<void> {
    if (session === undefined) {
      await this.ctx.credentials.deleteRecord(SESSION_KEY)
    } else {
      const record: CredentialRecord = { kind: 'grant', payload: session }
      await this.ctx.credentials.modifyRecord(SESSION_KEY, () => Promise.resolve(record))
    }
    this.cache = session
    this.loaded = true
  }

  /** Guard against a corrupted or foreign payload shape. */
  private coerce(payload: unknown): NexusSession | undefined {
    if (typeof payload !== 'object' || payload === null) return undefined
    const candidate = payload as Partial<NexusSession>
    if (typeof candidate.token !== 'string' || candidate.token === '') return undefined
    return {
      uid: String(candidate.uid ?? ''),
      username: String(candidate.username ?? ''),
      nickname: String(candidate.nickname ?? ''),
      token: candidate.token,
      expiresAt: Number(candidate.expiresAt ?? 0),
      orgId: String(candidate.orgId ?? ''),
      orgs: Array.isArray(candidate.orgs) ? candidate.orgs : [],
    }
  }
}
