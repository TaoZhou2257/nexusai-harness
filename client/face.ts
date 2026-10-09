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
  /** One-shot message code from the host (e.g. a session lost to a 401). */
  notice?: string
}

/** The wire face of `nexusaiAuth` as this half consumes it. */
export interface AuthRemoteFace {
  getBaseUrl(): Promise<RemoteAnswer<string>>
  setBaseUrl(url: string): Promise<RemoteAnswer<void>>
  testBaseUrl(url: string): Promise<RemoteAnswer<void>>
  getBranding(): Promise<RemoteAnswer<BrandingFace>>
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
  listLocalMcpServers(): Promise<RemoteAnswer<{ id: string; name: string; transport: string; url: string }[]>>
  listMcpServers(): Promise<RemoteAnswer<{ mcpServerId: string; name: string; desc: string; toolNum: number; source: 'created' | 'imported'; transport: string; url: string; connectable: boolean; bridged: boolean; bridgeError?: string }[]>>
  listSkills(): Promise<RemoteAnswer<{ skillId: string; name: string; description: string; author: string }[]>>
  searchSkillHub(keyword: string, category: string, page: number): Promise<RemoteAnswer<{ cards: SkillHubCardFace[]; total: number }>>
  disabledLocalSkills(roots: string[]): Promise<RemoteAnswer<LocalSkillEntryFace[]>>
  missingLocalSkills(paths: string[]): Promise<RemoteAnswer<string[]>>
  setLocalSkillEnabled(path: string, enabled: boolean, roots: string[]): Promise<RemoteAnswer<void>>
  removeLocalSkill(path: string, roots: string[]): Promise<RemoteAnswer<void>>
  readLocalSkill(path: string, roots: string[]): Promise<RemoteAnswer<string>>
  skillhubDetail(slug: string): Promise<RemoteAnswer<SkillHubDetailFace>>
  skillhubPreview(slug: string): Promise<RemoteAnswer<string>>
  skillhubCategories(): Promise<RemoteAnswer<{ key: string; label: string }[]>>
  installSkillHub(slug: string): Promise<RemoteAnswer<{ name: string; path: string }>>
  sync(): Promise<RemoteAnswer<{ tools: number; mcpServers: number; mcpSseServers: number; mcpSseTools: number; errors: string[] }>>
  downloadSkill(skillId: string): Promise<RemoteAnswer<{ name: string; path: string }>>
}

/** The wire face of the dsh session-list service (`ctx.sessions`), narrowed. */
export interface SessionsFace {
  list: {
    getSnapshot(): {
      ids: readonly string[]
      byId: Readonly<Record<string, { id: string; running: boolean; retainedBy: Readonly<Record<string, number>> }>>
      phase: 'pending' | 'ready'
    }
  }
  create(): Promise<{ id: string }>
}

/** Reads the surfaces take straight off dsh client services (no Remote hop). */
export interface NexusaiRuntimeOps {
  /**
   * Whether any session currently runs a task, for the sign-out confirmation.
   * 'unknown' before the host session list arrives — the caller then warns
   * without asserting that nothing is running.
   */
  hasRunningTasks(): boolean | 'unknown'
}

/** One skill from the conversation "/" menu catalog (`remote.skills.list`). */
export interface SlashSkillFace {
  readonly name: string
  readonly description: string
  readonly path?: string
  readonly modelInvocable: boolean
}

/** The wire face of `remote.skills` (the slash-menu skill catalog), narrowed. */
export interface SkillsRemoteFace {
  list(request: { sessionId: string }, signal?: AbortSignal): Promise<RemoteAnswer<{ skills: SlashSkillFace[] }>>
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
  getBranding(): Promise<BrandingFace>
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
  listLocalMcpServers(): Promise<{ id: string; name: string; transport: string; url: string }[]>
  listMcpServers(): Promise<{ mcpServerId: string; name: string; desc: string; toolNum: number; source: 'created' | 'imported'; transport: string; url: string; connectable: boolean; bridged: boolean; bridgeError?: string }[]>
  listSkills(): Promise<{ skillId: string; name: string; description: string; author: string }[]>
  searchSkillHub(keyword: string, category: string, page: number): Promise<{ cards: SkillHubCardFace[]; total: number }>
  disabledLocalSkills(roots: string[]): Promise<LocalSkillEntryFace[]>
  missingLocalSkills(paths: string[]): Promise<string[]>
  setLocalSkillEnabled(path: string, enabled: boolean, roots: string[]): Promise<void>
  removeLocalSkill(path: string, roots: string[]): Promise<void>
  readLocalSkill(path: string, roots: string[]): Promise<string>
  skillhubDetail(slug: string): Promise<SkillHubDetailFace>
  skillhubPreview(slug: string): Promise<string>
  skillhubCategories(): Promise<{ key: string; label: string }[]>
  installSkillHub(slug: string): Promise<{ name: string; path: string }>
  sync(): Promise<{ tools: number; mcpServers: number; mcpSseServers: number; mcpSseTools: number; errors: string[] }>
  downloadSkill(skillId: string): Promise<{ name: string; path: string }>
}

/** One browsable card of the SkillHub marketplace (api.skillhub.cn). */
export interface SkillHubCardFace {
  /** Unique package identity (canonical name; bare slug repeats across publishers). */
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly category: string
  readonly version: string
  readonly downloads: number
  readonly stars: number
  readonly installs: number
  readonly owner: string
  readonly pageUrl: string
  readonly requiresApiKey: boolean
  readonly pricing: string
  readonly iconUrl?: string
}

/** Login-page branding (`GET /v1/base/custom`): name, logo, version, … */
export interface BrandingFace {
  readonly name: string
  readonly logoUrl: string
  readonly backgroundUrl: string
  readonly welcomeText: string
  readonly platformDesc: string
  readonly buttonColor: string
  readonly version: string
  readonly copyright: string
  /** Near-square branding logo for the sidebar mark ('' = use the default). */
  readonly markUrl: string
  /** The dsh build string shown under the sidebar brand name. */
  readonly dshVersion: string
}

/** One local skill file (enabled entries come from the registry, 关闭-ed
 * ones from disk). */
export interface LocalSkillEntryFace {
  readonly name: string
  readonly description: string
  readonly path: string
  readonly enabled: boolean
}

/** One SkillHub listing's full detail (the detail view's payload). */
export interface SkillHubDetailFace {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly summary: string
  readonly category: string
  readonly subCategories: readonly string[]
  readonly version: string
  readonly changelog: string
  readonly downloads: number
  readonly stars: number
  readonly installs: number
  readonly comments: number
  readonly versions: number
  readonly owner: string
  readonly canonicalName: string
  readonly updatedAt: number
  readonly source: string
  readonly pageUrl: string
  readonly requiresApiKey: boolean
  readonly pricing: string
  readonly iconUrl?: string
}

/** The conversation "/" menu catalog, exactly as the slash menu lists it. */
export interface SlashSkillsOps {
  list(): Promise<SlashSkillFace[]>
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
