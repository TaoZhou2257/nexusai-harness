/**
 * Durable storage for the user-configured NexusAI base URL (the login
 * dialog's server field): a grant record at the credential key
 * `nexusai/endpoint`, so the override survives restarts and never enters row
 * configuration. Absent record means "use the config default".
 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'

/** One plugin-owned credential record key. */
const ENDPOINT_KEY = credentialKey('nexusai', 'endpoint')

/** Reads and persists the base-URL override through `ctx.credentials`. */
export class EndpointStore {
  private cache: string | undefined
  private loaded = false

  constructor(private readonly ctx: Context) {}

  /** The stored override, or undefined when the config default applies. */
  async load(): Promise<string | undefined> {
    if (this.loaded) return this.cache
    const record = await this.ctx.credentials.readRecord(ENDPOINT_KEY)
    this.cache = record?.kind === 'grant' ? this.coerce(record.payload) : undefined
    this.loaded = true
    return this.cache
  }

  /** Persist the override (the caller has already normalized it). */
  async persist(baseUrl: string): Promise<void> {
    const record: CredentialRecord = { kind: 'grant', payload: { version: 1, baseUrl } }
    await this.ctx.credentials.modifyRecord(ENDPOINT_KEY, () => Promise.resolve(record))
    this.cache = baseUrl
    this.loaded = true
  }

  /** Guard against a corrupted or foreign payload shape. */
  private coerce(payload: unknown): string | undefined {
    if (typeof payload !== 'object' || payload === null) return undefined
    const candidate = payload as { baseUrl?: unknown }
    return typeof candidate.baseUrl === 'string' && candidate.baseUrl !== '' ? candidate.baseUrl : undefined
  }
}
