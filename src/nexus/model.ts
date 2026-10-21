/**
 * NexusAI bff wire shapes. Field names mirror the Go response structs exactly
 * (`json:` tags in `internal/bff-service/model/response`).
 */

/** gin_util.Response envelope: `{code, data, msg}` with `code === 0` on success. */
export interface ApiResponse<T> {
  readonly code: number
  readonly data: T
  readonly msg: string
}

/** `GET /v1/base/captcha` → `response.Captcha`. */
export interface CaptchaResponse {
  readonly key: string
  readonly b64: string
}

/** One uploaded image reference in the branding payload (`{key, path}`). */
export interface CustomImageRef {
  readonly key?: string
  readonly path?: string
}

/**
 * `GET /v1/base/custom` → `response.LogoCustomInfo` (fields the plugin
 * consumes): the login-page branding, server-configurable via the admin
 * 平台配置 settings and the i18n data files.
 */
export interface CustomInfoResponse {
  readonly login?: {
    readonly welcomeText?: string
    /** Longer platform description shown under the welcome line; often empty. */
    readonly platformDesc?: string
    readonly logo?: CustomImageRef
    readonly background?: CustomImageRef
    readonly loginButtonColor?: string
  }
  readonly home?: {
    readonly title?: string
    readonly logo?: CustomImageRef
  }
  readonly tab?: {
    readonly title?: string
    readonly logo?: CustomImageRef
  }
  readonly about?: {
    readonly version?: string
    readonly copyright?: string
  }
}

/** `POST /v1/base/login` → `response.Login` (fields the plugin consumes). */
export interface LoginResponse {
  readonly uid: string
  readonly username: string
  readonly token: string
  readonly expiresAt: number
  readonly nickname: string
  readonly orgs: readonly { readonly id: string; readonly name: string }[]
}

/** `GET /v1/tool/square` → one square tool, including its OpenAPI schema. */
export interface BuiltinToolDetailResponse {
  readonly toolSquareId: string
  readonly name: string
  readonly desc: string
  readonly schema: string
  readonly apiAuth?: ApiAuthWebRequest
}

/** `GET /v1/tool/square/list` → `{list: ToolSquareInfo[], total}`. */
export interface BuiltinToolListResponse {
  readonly list: readonly {
    readonly toolSquareId: string
    readonly name: string
    readonly desc: string
    readonly tags?: readonly string[]
  }[]
  readonly total: number
}

/** `GET /v1/tool/custom/list` → `{list: CustomToolInfo[], total}`. */
export interface CustomToolListResponse {
  readonly list: readonly {
    readonly customToolId: string
    readonly name: string
    readonly description: string
  }[]
  readonly total: number
}

/** `pkg/util.ApiAuthWebRequest`, as returned inside `GET /v1/tool/custom`. */
export interface ApiAuthWebRequest {
  readonly authType: 'none' | 'api_key_query' | 'api_key_header'
  readonly apiKeyHeaderPrefix: '' | 'basic' | 'bearer' | 'custom'
  readonly apiKeyHeader: string
  readonly apiKeyQueryParam: string
  readonly apiKeyValue: string
}

/** `GET /v1/tool/custom` → `response.CustomToolDetail` (fields the plugin consumes). */
export interface CustomToolDetailResponse {
  readonly customToolId: string
  readonly name: string
  readonly description: string
  readonly schema: string
  readonly apiAuth: ApiAuthWebRequest
  readonly apiList: readonly {
    readonly name: string
    readonly desc: string
    readonly method: string
    readonly path: string
  }[]
}

/** `GET /v1/mcp/server/list` → `{list: MCPServerInfo[], total}`. */
export interface McpServerListResponse {
  readonly list: readonly {
    readonly mcpServerId: string
    readonly name: string
    readonly desc: string
    readonly toolNum: number
  }[]
  readonly total: number
}

/** `GET /v1/mcp/server` → `response.MCPServerDetail` (fields the plugin consumes). */
export interface McpServerDetailResponse {
  readonly mcpServerId: string
  readonly name: string
  readonly desc: string
  readonly sseUrl: string
  readonly streamableUrl: string
}

/** `GET /v1/mcp/list` → one 导入 MCP server (legacy SSE / streamable endpoint). */
export interface ImportedMcpServerRow {
  readonly mcpId: string
  readonly name: string
  readonly desc: string
  readonly from: string
  readonly transport: string
  readonly sseUrl: string
  readonly streamableUrl: string
  readonly avatar?: { readonly key?: string; readonly path?: string } | null
}

/** `GET /v1/mcp/list` → `{list: ImportedMcpServerRow[], total}`. */
export interface ImportedMcpListResponse {
  readonly list: readonly ImportedMcpServerRow[]
  readonly total: number
}

/** `GET /v1/mcp/tool/list?mcpId=` → one imported server's tools. */
export interface ImportedMcpToolListResponse {
  readonly tools: readonly {
    readonly name?: string
    readonly description?: string
  }[]
}

/** `GET /v1/agent/skill/custom/list` → `{list: CustomSkillInfo[], total}`. */
export interface SkillListResponse {
  readonly list: readonly {
    readonly skillId: string
    readonly name: string
    readonly desc: string
    readonly author: string
  }[]
  readonly total: number
}

/** `GET /v1/agent/skill/custom/detail` → `response.CustomSkillDetail` (fields consumed). */
export interface SkillDetailResponse {
  readonly skillId: string
  readonly name: string
  readonly desc: string
  readonly skillMarkdown: string
  readonly zipUrl: string
}
