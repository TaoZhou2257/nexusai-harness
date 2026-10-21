/**
 * NexusAI connector for dsh: logs in with the web frontend's account API
 * through the dsh authorization seam, registers the account's custom tools as
 * first-party dsh tools, mounts its MCP Servers as mcp-client patch rows, and
 * lists/downloads its skills.
 *
 * Host half. The browser half lives in `client/` and is served through the
 * `dsh.client` manifest; the two communicate through the `nexusaiAuth` and
 * `nexusaiCapabilities` Typert remotes.
 *
 * @module @toby/dsh-plugin-nexusai
 */
import type { Context } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
// Side-effect type imports: merge `ctx.credentials` onto Context.
import type {} from '@deepseek-ai/dsh-credentials'
// Side-effect type import: merge `ctx.tools` onto Context.
import type {} from '@deepseek-ai/dsh-tools'
import { Config } from './config'
import type { Config as ConfigType } from './config'
import { NexusApiClient } from './nexus/api-client'
import { SkillHubClient } from './nexus/skillhub'
import { LocalSkills } from './sync/local-skills'
import { ConnectorRows } from './sync/connector-rows'
import { ConnectorTools } from './sync/connector-tools'
import { listSseInputs } from './sync/mcp-list'
import { mergeSseInputs } from './service/connector-author'
import { SseConnectors, bridgeInputOf } from './sync/sse-connectors'
import { McpSseToolRegistry } from './sync/mcp-tools'
import { NexusaiAuthService } from './service/auth'
import { NexusaiCapabilitiesService } from './service/capabilities'
import { BuiltinToolRegistry } from './sync/builtin-tools'
import { CustomToolRegistry } from './sync/custom-tools'
import { EndpointStore } from './sync/endpoint-store'
import { CipherStore } from './sync/cipher-store'
import { McpRowSync } from './sync/mcp-rows'
import { SessionStore } from './sync/session-store'
import { SkillSync } from './sync/skills'

/** Cordis plugin name used by loader diagnostics and the credentials scope. */
export const name = 'nexusai'

/** Services required before the plugin starts. */
export const inject = ['credentials', 'tools', 'authorization']

export { Config }

/**
 * Wire the auth and capability remotes. The auth service registers its
 * authorization flow on the context, so plugin disposal revokes the flow and
 * withdraws any in-flight attempt. A stored session re-syncs its tools and
 * MCP rows in the background at startup; failures log without failing the
 * plugin.
 */
export function apply(ctx: Context, config: ConfigType): void {
  if (config.baseUrl === '') throw new Error('nexusai: config.baseUrl is required')
  const store = new SessionStore(ctx)
  const endpoint = new EndpointStore(ctx)
  const cipher = new CipherStore(ctx)
  const api = new NexusApiClient({
    baseUrl: config.baseUrl,
    timeoutMs: config.requestTimeoutMs,
    aesKey: config.aesKey,
    aesIv: config.aesIv,
    session: { read: () => store.read(), persist: session => store.persist(session) },
  })
  // A user-configured base URL (login dialog field) wins over the config
  // default; applied as soon as the record loads, long before any request.
  void endpoint.load().then(stored => {
    if (stored !== undefined) api.setBaseUrl(stored)
  }, error => {
    ctx.logger.warn('nexusai: endpoint override could not be read: %s', (error as Error).message)
  })
  const cipherReady = cipher.load().then(stored => {
    if (stored === undefined) return
    api.setCipher(stored.aesKey, stored.aesIv)
    ctx.logger.info('nexusai: login cipher loaded from credentials')
  }, error => {
    ctx.logger.warn('nexusai: login cipher could not be read: %s', (error as Error).message)
  })
  const tools = new CustomToolRegistry(ctx, {
    api,
    toolNamePrefix: config.customTools.toolNamePrefix,
  })
  const builtinTools = new BuiltinToolRegistry(ctx, {
    api,
    toolNamePrefix: config.customTools.toolNamePrefix,
  })
  const mcp = new McpRowSync(ctx, {
    profilePatchFile: config.profilePatchFile,
    serverNamePrefix: config.mcp.serverNamePrefix,
    toolCallTimeoutMs: config.mcp.toolCallTimeoutMs,
    failOnStartupError: config.mcp.failOnStartupError,
  })
  // Legacy-SSE MCP servers: dsh's mcp-client hosts stdio and streamable-http
  // only, so this registry bridges the SSE ones into ordinary dsh tools.
  const mcpSse = new McpSseToolRegistry(ctx, {
    toolNamePrefix: config.mcp.serverNamePrefix,
    timeoutMs: config.mcp.toolCallTimeoutMs,
  })
  const skills = new SkillSync(ctx, { api, downloadRoot: config.skills.downloadRoot })
  // Every skill writer resolves the same root: the configured download root,
  // or the dsh home's own `skills/` when the config leaves that empty.
  const skillsRoot = config.skills.downloadRoot.trim() !== ''
    ? config.skills.downloadRoot
    : join(resolveDshHome(), 'skills')
  // SkillHub marketplace: the public catalog the @cocofhu/skillhub plugin also
  // reads (no auth); endpoints overridable for mirrors/deployments.
  const skillhub = new SkillHubClient({
    apiBase: config.skillhub.apiBase,
    webBase: config.skillhub.webBase,
    timeoutMs: config.skillhub.timeoutMs,
    skillsRoot,
  })

  const auth = new NexusaiAuthService(ctx, {
    api,
    store,
    endpoint,
    tools,
    builtinTools,
    mcp,
    mcpSse,
    authorization: ctx.authorization,
    defaultOrgId: config.defaultOrgId,
    cipherReady,
  })
  // Local skill files: the first root is where uploads and downloads land, the
  // panel adds the directories of the skills the registry reports (user and
  // project layers) so 启用/关闭/删除 also work on those.
  const localSkills = new LocalSkills([skillsRoot])
  // 自定义连接器: user-authored mcp-client rows. Same patch file as the NexusAI
  // ones, different id prefix — so a logout clears the remote catalog and
  // leaves the user's own connectors alone.
  const sseConnectors = new SseConnectors()
  const connectors = new ConnectorRows({
    profilePatchFile: config.profilePatchFile,
    serverNamePrefix: config.mcp.serverNamePrefix,
    toolCallTimeoutMs: config.mcp.toolCallTimeoutMs,
    failOnStartupError: config.mcp.failOnStartupError,
  })
  // The bridge refresh used right after an SSE connector is authored: the same
  // inputs `sync()` builds, recomputed on demand.
  const refreshSse = async (): Promise<readonly string[]> => {
    const custom = await sseConnectors.enabledList().catch(() => [])
    const bridged = await mcpSse.sync(mergeSseInputs(await listSseInputs(api), custom.map(bridgeInputOf)))
    return bridged.errors
  }
  const connectorTools = new ConnectorTools(ctx, { rows: mcp, sse: mcpSse, sseConnectors })
  const capabilities = new NexusaiCapabilitiesService(ctx, { api, tools, builtinTools, mcp, mcpSse, skills, skillhub, localSkills, connectors, sseConnectors, refreshSse, connectorTools })
  // Naming the resolved patch file up front is what makes "connectors don't
  // work" diagnosable: a wrong profile writes rows into a file the host never
  // loads, and nothing else in the logs would say so.
  ctx.logger.info('nexusai: connector patch file %s', connectors.patchFile())

  // A surviving session means the account was logged in before restart;
  // re-register its tools and rewrite its MCP rows without blocking boot.
  void store.load().then(async session => {
    if (session === undefined) return
    ctx.logger.info('nexusai: restoring session for %s', session.username)
    try {
      await capabilities.sync()
    } catch (error) {
      ctx.logger.warn('nexusai: startup sync failed: %s', (error as Error).message)
    }
  }, error => {
    ctx.logger.warn('nexusai: session record could not be read: %s', (error as Error).message)
  })

  ctx.effect(() => () => {
    void tools.clear()
    void builtinTools.clear()
  }, 'nexusai: disposals')
}
