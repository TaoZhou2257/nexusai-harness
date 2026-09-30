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
// Side-effect type imports: merge `ctx.credentials` onto Context.
import type {} from '@deepseek-ai/dsh-credentials'
// Side-effect type import: merge `ctx.tools` onto Context.
import type {} from '@deepseek-ai/dsh-tools'
import { Config } from './config'
import type { Config as ConfigType } from './config'
import { NexusApiClient } from './nexus/api-client'
import { NexusaiAuthService } from './service/auth'
import { NexusaiCapabilitiesService } from './service/capabilities'
import { CustomToolRegistry } from './sync/custom-tools'
import { EndpointStore } from './sync/endpoint-store'
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
  const tools = new CustomToolRegistry(ctx, {
    api,
    toolNamePrefix: config.customTools.toolNamePrefix,
  })
  const mcp = new McpRowSync(ctx, {
    profilePatchFile: config.profilePatchFile,
    serverNamePrefix: config.mcp.serverNamePrefix,
    toolCallTimeoutMs: config.mcp.toolCallTimeoutMs,
    failOnStartupError: config.mcp.failOnStartupError,
  })
  const skills = new SkillSync(ctx, { api, downloadRoot: config.skills.downloadRoot })

  const auth = new NexusaiAuthService(ctx, {
    api,
    store,
    endpoint,
    tools,
    mcp,
    authorization: ctx.authorization,
    defaultOrgId: config.defaultOrgId,
  })
  const capabilities = new NexusaiCapabilitiesService(ctx, { api, tools, mcp, skills })

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
  }, 'nexusai: disposals')
}
