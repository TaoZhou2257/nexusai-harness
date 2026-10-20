/**
 * Login cipher stored as a grant at `nexusai/cipher`. The shell seeds it
 * from the build-time cipher file; row configuration no longer carries the
 * key. An absent or unreadable record means the caller keeps the config
 * fallback (empty unless a dev patch still sets it).
 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'

/** One plugin-owned credential record key. */
export const CIPHER_KEY = credentialKey('nexusai', 'cipher')

/** The two values the login request encrypts the password with. */
export interface LoginCipher {
  readonly aesKey: string
  readonly aesIv: string
}

/** Reads the login cipher through `ctx.credentials`. */
export class CipherStore {
  private cache: LoginCipher | undefined
  private loaded = false

  constructor(private readonly ctx: Context) {}

  /** Load the record once; later calls serve the in-memory snapshot. */
  async load(): Promise<LoginCipher | undefined> {
    if (this.loaded) return this.cache
    const record = await this.ctx.credentials.readRecord(CIPHER_KEY)
    this.cache = record?.kind === 'grant' ? coerceLoginCipher(record.payload) : undefined
    this.loaded = true
    return this.cache
  }
}

/** Admit a grant payload that carries both cipher halves. */
export function coerceLoginCipher(payload: unknown): LoginCipher | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const candidate = payload as { aesKey?: unknown, aesIv?: unknown }
  if (typeof candidate.aesKey !== 'string' || candidate.aesKey === '') return undefined
  if (typeof candidate.aesIv !== 'string' || candidate.aesIv === '') return undefined
  return { aesKey: candidate.aesKey, aesIv: candidate.aesIv }
}
