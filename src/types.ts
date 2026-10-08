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
  /** One-shot message code for the surfaces, e.g. a session lost to a 401. */
  readonly notice?: string
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
  /** 创建 MCP (bound to published apps) or 导入 MCP (external endpoint). */
  readonly source: 'created' | 'imported'
  readonly transport: string
  readonly url: string
  /** Whether dsh can host it (streamable HTTP); false = legacy SSE only. */
  readonly connectable: boolean
  /** Whether this plugin bridged an SSE server's tools into dsh. */
  readonly bridged: boolean
  /** Why bridging failed, when it did. */
  readonly bridgeError?: string
}

/** One custom skill listed by `GET /v1/agent/skill/custom/list`. */
export interface SkillSummary {
  readonly skillId: string
  readonly name: string
  readonly description: string
  readonly author: string
}

/** One browsable card of the SkillHub marketplace (api.skillhub.cn). */
export interface SkillHubCard {
  /**
   * Unique package identity (`namespace.canonicalName`, e.g.
   * `@user_814dbe54/anti-fraud`). The marketplace's `slug` is NOT unique —
   * different publishers reuse it — so list keys, dedupe, install and
   * installed marking all go through this id.
   */
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly description: string
  /** Display label of the marketplace category. */
  readonly category: string
  readonly version: string
  readonly downloads: number
  readonly stars: number
  readonly installs: number
  readonly owner: string
  /** Skill page on skillhub.cn. */
  readonly pageUrl: string
  /** The skill needs its own API key configured before use
   * (`labels.requires_api_key`). */
  readonly requiresApiKey: boolean
  /** Marketplace pricing marker (`labels.pricing_type`): `paid`/`alipay`/... */
  readonly pricing: string
  readonly iconUrl?: string
}

/** Login-page branding from `GET /v1/base/custom` (all fields optional: an
 * unconfigured server simply returns nothing for them). */
export interface Branding {
  readonly name: string
  /** Absolute URL of the login-page logo. */
  readonly logoUrl: string
  /** Absolute URL of the login-page background image. */
  readonly backgroundUrl: string
  readonly welcomeText: string
  readonly platformDesc: string
  /** The platform's login-button color, when configured. */
  readonly buttonColor: string
  /** Platform version (`about.version`, e.g. `v1.5.0.3`). */
  readonly version: string
  readonly copyright: string
  /** A near-square branding logo suitable for the sidebar mark; '' when the
   * server only ships wide wordmarks. */
  readonly markUrl: string
  /** The dsh build string the shell shows in the sidebar (`0.2.0-rc.2-639ed01`). */
  readonly dshVersion: string
}

/** One tool advertised by an MCP server (JSON-Schema input, as MCP returns it). */
export interface McpSseTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
}

/** The flattened outcome of one `tools/call`. */
export interface McpSseCallResult {
  readonly text: string
  readonly isError: boolean
}

/** One local skill file behind the 本地 tab: enabled skills come from the
 * registry, 关闭-ed ones are found on disk (`SKILL.md.disabled`). */
export interface LocalSkillEntry {
  readonly name: string
  readonly description: string
  /** Absolute path of the instruction file (SKILL.md or SKILL.md.disabled). */
  readonly path: string
  readonly enabled: boolean
}

/** Where one installed SkillHub package landed on disk. */
export interface SkillHubInstallResult {
  readonly name: string
  /** Absolute path of the installed SKILL.md. */
  readonly path: string
}

/** One SkillHub listing's full detail (`GET /api/v1/skills/<slug>`), flattened
 * for the workbench's detail view. */
export interface SkillHubDetail {
  /** Unique package identity (canonical name when present). */
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly summary: string
  /** Display label of the marketplace category. */
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
  /** `@owner/name` when the marketplace provides it. */
  readonly canonicalName: string
  readonly updatedAt: number
  readonly source: string
  readonly pageUrl: string
  /** The skill needs its own API key configured before use. */
  readonly requiresApiKey: boolean
  /** Marketplace pricing marker (`paid`/`alipay`/…), empty when free. */
  readonly pricing: string
  readonly iconUrl?: string
}

/** Outcome of one capability sync: what got registered, and what failed. */
export interface SyncReport {
  readonly tools: number
  /** Streamable MCP servers written as mcp-client rows. */
  readonly mcpServers: number
  /** Legacy-SSE MCP servers bridged into dsh tools by this plugin. */
  readonly mcpSseServers: number
  /** Tools those SSE servers contributed. */
  readonly mcpSseTools: number
  readonly errors: readonly string[]
}

/** Where one downloaded skill landed on disk. */
export interface SkillDownloadResult {
  readonly name: string
  readonly path: string
}
