/**
 * Shared client-side faces for the NexusAI surfaces (launcher, sign-in
 * dialog, settings section): wire DTO mirrors, the inject controller face,
 * and Remote answer unwrapping. Nothing here carries a credential.
 *
 * The inject controller is spread into component props by the slot delivery;
 * its `hooks` compartment is synthesized into `useNexusai` / `useTheme`
 * selector hooks by the framework (the same mechanism the built-in account
 * UI uses for `useAccount` / `useTheme`).
 */

/** The failure branch of a Remote answer, narrowed to what surfaces display. */
export interface RemoteFailureFace {
  readonly message?: unknown
  readonly code?: unknown
}

export type RemoteAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RemoteFailureFace }

/** Mirror of the host's AuthView DTO, token-free by construction. */
export interface AuthViewFace {
  loggedIn: boolean
  username?: string
  nickname?: string
  orgId?: string
  orgs?: { id: string; name: string }[]
  expiresAt?: number
  attempt: null | {
    id: string
    phase: 'initializing' | 'waiting-input' | 'verifying' | 'committing' | 'succeeded' | 'cancelled' | 'failed'
    captchaB64?: string
    message?: string
  }
}

/** The wire face of `nexusaiAuth` as this half consumes it. */
export interface AuthRemoteFace {
  getBaseUrl(): Promise<RemoteAnswer<string>>
  setBaseUrl(url: string): Promise<RemoteAnswer<void>>
  testBaseUrl(url: string): Promise<RemoteAnswer<void>>
  status(): Promise<RemoteAnswer<AuthViewFace>>
  startSignIn(): Promise<RemoteAnswer<AuthViewFace>>
  submit(attemptId: string, username: string, password: string, captchaCode: string): Promise<RemoteAnswer<AuthViewFace>>
  refreshCaptcha(attemptId: string): Promise<RemoteAnswer<AuthViewFace>>
  cancelSignIn(attemptId: string): Promise<RemoteAnswer<AuthViewFace>>
  selectOrg(orgId: string): Promise<RemoteAnswer<AuthViewFace>>
  logout(): Promise<RemoteAnswer<void>>
  watch(signal?: AbortSignal): unknown
}

/** The wire face of `nexusaiCapabilities` as this half consumes it. */
export interface CapabilitiesRemoteFace {
  listCustomTools(): Promise<RemoteAnswer<{ customToolId: string; name: string; description: string }[]>>
  listMcpServers(): Promise<RemoteAnswer<{ mcpServerId: string; name: string; desc: string; toolNum: number }[]>>
  listSkills(): Promise<RemoteAnswer<{ skillId: string; name: string; description: string; author: string }[]>>
  sync(): Promise<RemoteAnswer<{ tools: number; mcpServers: number; errors: string[] }>>
  downloadSkill(skillId: string): Promise<RemoteAnswer<{ name: string; path: string }>>
}

/** The wire face of `ctx.remote.$stream`, narrowed to what this plugin needs. */
export interface StreamFace<T> extends AsyncIterable<{ readonly value: T; accept(): void }> {
  dispose(): Promise<void> | void
}

/** Shared login projection consumed through the synthesized `useNexusai` hook. */
export interface NexusaiSnapshot {
  readonly view: AuthViewFace | undefined
  readonly failed: boolean
}

/** Unwrapped Remote operations handed to every surface. */
export interface NexusaiAuthOps {
  getBaseUrl(): Promise<string>
  setBaseUrl(url: string): Promise<void>
  testBaseUrl(url: string): Promise<void>
  status(): Promise<AuthViewFace>
  startSignIn(): Promise<AuthViewFace>
  submit(attemptId: string, username: string, password: string, captchaCode: string): Promise<AuthViewFace>
  refreshCaptcha(attemptId: string): Promise<AuthViewFace>
  cancelSignIn(attemptId: string): Promise<AuthViewFace>
  selectOrg(orgId: string): Promise<AuthViewFace>
  logout(): Promise<void>
}

export interface NexusaiCapabilitiesOps {
  listCustomTools(): Promise<{ customToolId: string; name: string; description: string }[]>
  listMcpServers(): Promise<{ mcpServerId: string; name: string; desc: string; toolNum: number }[]>
  listSkills(): Promise<{ skillId: string; name: string; description: string; author: string }[]>
  sync(): Promise<{ tools: number; mcpServers: number; errors: string[] }>
  downloadSkill(skillId: string): Promise<{ name: string; path: string }>
}

export function messageOf(error: unknown): string {
  if (typeof error === 'string' && error !== '') return error
  if (error !== null && typeof error === 'object') {
    const { message, code } = error as RemoteFailureFace
    if (typeof message === 'string' && message !== '') return message
    if (typeof code === 'string' && code !== '') return code
  }
  return 'nexusai remote call failed'
}

export async function unwrap<T>(answer: Promise<RemoteAnswer<T>>): Promise<T> {
  const result = await answer
  if (!result.ok) throw new Error(messageOf(result.error))
  return result.value
}
