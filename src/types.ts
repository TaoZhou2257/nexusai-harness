/**
 * Client-safe DTOs shared by the host and browser halves. Nothing here may
 * carry a credential: the session token exists only host-side, and Remote
 * methods answer with the {@link AuthView} projection.
 */

/** One NexusAI organization a logged-in user belongs to. */
export interface NexusOrg {
  readonly id: string
  readonly name: string
}

/** Durable login session; stored as the GrantRecord payload at `nexusai/session`. */
export interface NexusSession {
  readonly uid: string
  readonly username: string
  readonly nickname: string
  readonly token: string
  /** Epoch milliseconds the JWT expires at. */
  readonly expiresAt: number
  readonly orgId: string
  readonly orgs: readonly NexusOrg[]
}

/** One sign-in attempt's user-visible phase, mirroring the built-in account provider's state machine. */
export type SignInPhase =
  | 'initializing'
  | 'waiting-input'
  | 'verifying'
  | 'committing'
  | 'succeeded'
  | 'cancelled'
  | 'failed'

/** Token-free snapshot of one sign-in attempt. */
export interface SignInAttemptView {
  readonly id: string
  readonly phase: SignInPhase
  /** Base64 PNG captcha to solve, present while the attempt `waiting-input`. */
  readonly captchaB64?: string
  /** Human-readable progress or failure line. */
  readonly message?: string
}

/** Token-free login projection that crosses the Remote wire. */
export interface AuthView {
  readonly loggedIn: boolean
  readonly uid?: string
  readonly username?: string
  readonly nickname?: string
  readonly orgId?: string
  readonly orgs?: readonly NexusOrg[]
  readonly expiresAt?: number
  readonly attempt: SignInAttemptView | null
}

/** One custom tool listed by `GET /v1/tool/custom/list`. */
export interface CustomToolSummary {
  readonly customToolId: string
  readonly name: string
  readonly description: string
}

/** One MCP Server entity listed by `GET /v1/mcp/server/list`. */
export interface McpServerSummary {
  readonly mcpServerId: string
  readonly name: string
  readonly desc: string
  readonly toolNum: number
}

/** One custom skill listed by `GET /v1/agent/skill/custom/list`. */
export interface SkillSummary {
  readonly skillId: string
  readonly name: string
  readonly description: string
  readonly author: string
}

/** Outcome of one capability sync: what got registered, and what failed. */
export interface SyncReport {
  readonly tools: number
  readonly mcpServers: number
  readonly errors: readonly string[]
}

/** Where one downloaded skill landed on disk. */
export interface SkillDownloadResult {
  readonly name: string
  readonly path: string
}
