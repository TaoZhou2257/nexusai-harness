/**
 * Row configuration for the `nexusai` patch row, validated by the loader
 * against the exported Schemastery schema.
 */
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'

/** Plugin row configuration. */
export interface Config {
  /** NexusAI bff base URL, e.g. `http://127.0.0.1:8080`. */
  baseUrl: string
  /** bff config `decrypt-passwd.key`, as the literal string the server bytewise-uses. */
  aesKey: string
  /** bff config `decrypt-passwd.iv`, same encoding as {@link Config.aesKey}. */
  aesIv: string
  /** Org used after login when the account has several; empty picks the first. */
  defaultOrgId: string
  /** Per-request timeout (ms) for NexusAI API calls. */
  requestTimeoutMs: number
  /** MCP Server sync: insert/remove mcp-client rows in the profile patch. */
  mcp: {
    enabled: boolean
    serverNamePrefix: string
    toolCallTimeoutMs: number
    failOnStartupError: boolean
  }
  /** Custom tool sync: register OpenAPI operations as dsh tools. */
  customTools: {
    enabled: boolean
    toolNamePrefix: string
  }
  /** Skill downloads: root the SKILL.md bundles land in; empty = `<dshHome>/skills`. */
  skills: {
    downloadRoot: string
  }
  /** SkillHub marketplace endpoints (public catalog, no auth). */
  skillhub: {
    apiBase: string
    webBase: string
    timeoutMs: number
  }
  /** Profile user patch file the MCP rows are written to; empty = the `desktop` profile's. */
  profilePatchFile: string
}

export const Config: Schema<Config> = z.object({
  baseUrl: z.string().required(),
  aesKey: z.string().default(''),
  aesIv: z.string().default(''),
  defaultOrgId: z.string().default(''),
  requestTimeoutMs: z.natural().min(1000).default(30_000),
  mcp: z.object({
    enabled: z.boolean().default(true),
    serverNamePrefix: z.string().default('nexusai'),
    toolCallTimeoutMs: z.natural().default(60_000),
    failOnStartupError: z.boolean().default(false),
  }),
  customTools: z.object({
    enabled: z.boolean().default(true),
    toolNamePrefix: z.string().default('nexusai'),
  }),
  skills: z.object({
    downloadRoot: z.string().default(''),
  }),
  skillhub: z.object({
    apiBase: z.string().default('https://api.skillhub.cn'),
    webBase: z.string().default('https://skillhub.cn'),
    timeoutMs: z.natural().default(15_000),
  }),
  profilePatchFile: z.string().default(''),
})
