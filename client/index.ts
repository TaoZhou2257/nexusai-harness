/**
 * NexusAI, browser half: the bottom-left account launcher (replacing the
 * built-in DeepSeek account menu) and the NexusAI settings section hosting
 * the capability console. All network stays host-side: every action crosses
 * the `nexusaiAuth` / `nexusaiCapabilities` Remotes mounted from `remote.ts`,
 * and login state arrives push-style over the `nexusaiAuth.watch` stream.
 *
 * The entry runs in two fibers: this one (injecting only the base `remote`
 * service) mounts the Remote contribution and starts a consumer fiber that
 * injects the `remote.nexusaiAuth` / `remote.nexusaiCapabilities` namespace
 * services the contribution installs — the mount/consumer split the built-in
 * `dsh-api-remotes` / `ui-settings-account` pair achieves across two
 * packages, folded into one because a `dsh.client` manifest ships a single
 * entry. Declaring the namespaces on this fiber instead would deadlock: the
 * runner would park on services that only this fiber's own `apply` mounts.
 *
 * @module @toby/dsh-plugin-nexusai/client
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: the settings slot contracts (`settings.launcher`, `settings.section`)
// and the ctx.theme merge this plugin registers into.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { NexusaiLauncher } from './NexusaiLauncher'
import { NexusaiSection } from './NexusaiSection'
import { en, zh, type NexusaiLocaleKey } from './locales'
import { unwrap, type AuthViewFace, type CapabilitiesRemoteFace, type AuthRemoteFace, type NexusaiSnapshot, type StreamFace } from './face'
import { TYPERT_REMOTE } from './remote'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** NexusAI surface copy. */
    'nexusai': NexusaiLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'nexusai'

/** Services required to mount the Remote contribution. */
export const inject = ['slots', 'locale', 'remote']

/**
 * Mount the Remote contribution, then start the consumer fiber that injects
 * the namespaces it installed and registers the launcher and settings
 * section.
 * @param ctx - the browser plugin context.
 */
export async function apply(ctx: Context): Promise<void> {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'nexusai: dictionaries')
  const t = ctx.locale.bind(NS)

  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  ctx.effect(() => () => { void disposeRemote() }, 'nexusai: remotes')

  const consumer = await ctx.plugin({
    name: 'nexusai-remotes-consumer',
    inject: ['remote.nexusaiAuth', 'remote.nexusaiCapabilities', 'theme'],
    apply(consumer: Context) {
      registerSurfaces(consumer, t)
    },
  })
  ctx.effect(() => () => { void consumer.dispose() }, 'nexusai: consumer fiber')
}

/**
 * Contribute the launcher (bottom-left, shadowing the built-in account menu
 * at a lower priority) and the settings section (capability console), both
 * reading one shared login projection.
 * @param consumer - fiber whose inject covers the mounted Remote namespaces.
 * @param t - locale resolver bound before the consumer started.
 */
function registerSurfaces(consumer: Context, t: (key: NexusaiLocaleKey) => string): void {
  const remote = consumer.remote as unknown as {
    nexusaiAuth: AuthRemoteFace
    nexusaiCapabilities: CapabilitiesRemoteFace
    $stream<T>(options: {
      name: string
      open: (signal: AbortSignal) => unknown
      ended: () => Error
    }): StreamFace<T>
  }

  // One shared snapshot behind every surface, fed by one reconnect-safe
  // watch stream — the same store pattern the built-in account UI runs.
  let snapshot: NexusaiSnapshot = { view: undefined, failed: false }
  const listeners = new Set<() => void>()
  const publish = (value: NexusaiSnapshot) => { snapshot = value; for (const listener of listeners) listener() }

  const stream = remote.$stream<AuthViewFace>({
    name: 'nexusaiAuth',
    open: signal => remote.nexusaiAuth.watch(signal),
    ended: () => new Error('nexusai auth stream ended'),
  })
  let disposed = false
  consumer.effect(() => () => { disposed = true; return stream.dispose() }, 'nexusai: state stream')
  void (async () => {
    try {
      for await (const frame of stream) {
        publish({ view: frame.value, failed: false })
        frame.accept()
      }
    } catch {
      // The stream dropped (host reload, connection change); the surfaces
      // keep the last snapshot, marked failed so they can show a hint.
      if (!disposed) publish({ ...snapshot, failed: true })
    }
  })()
  // Belt-and-braces: the stream opens with the current snapshot, but a status
  // read surfaces a broken Remote loudly instead of waiting for a frame.
  void unwrap(remote.nexusaiAuth.status())
    .then(view => publish({ view, failed: false }), () => publish({ ...snapshot, failed: true }))

  const controller = {
    auth: {
      getBaseUrl: () => unwrap(remote.nexusaiAuth.getBaseUrl()),
      setBaseUrl: (url: string) => unwrap(remote.nexusaiAuth.setBaseUrl(url)),
      testBaseUrl: (url: string) => unwrap(remote.nexusaiAuth.testBaseUrl(url)),
      status: () => unwrap(remote.nexusaiAuth.status()),
      startSignIn: () => unwrap(remote.nexusaiAuth.startSignIn()),
      submit: (attemptId: string, username: string, password: string, captchaCode: string) =>
        unwrap(remote.nexusaiAuth.submit(attemptId, username, password, captchaCode)),
      refreshCaptcha: (attemptId: string) => unwrap(remote.nexusaiAuth.refreshCaptcha(attemptId)),
      cancelSignIn: (attemptId: string) => unwrap(remote.nexusaiAuth.cancelSignIn(attemptId)),
      selectOrg: (orgId: string) => unwrap(remote.nexusaiAuth.selectOrg(orgId)),
      logout: () => unwrap(remote.nexusaiAuth.logout()),
    },
    capabilities: {
      listCustomTools: () => unwrap(remote.nexusaiCapabilities.listCustomTools()),
      listMcpServers: () => unwrap(remote.nexusaiCapabilities.listMcpServers()),
      listSkills: () => unwrap(remote.nexusaiCapabilities.listSkills()),
      sync: () => unwrap(remote.nexusaiCapabilities.sync()),
      downloadSkill: (skillId: string) => unwrap(remote.nexusaiCapabilities.downloadSkill(skillId)),
    },
    hooks: {
      nexusai: {
        getSnapshot: () => snapshot,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      },
      theme: {
        getSnapshot: () => consumer.theme.getTheme(),
        subscribe: (listener: () => void) => consumer.on('theme/change', listener),
      },
    },
  }

  // The launcher shadows the built-in account menu (registered at the default
  // priority 0; lowest priority renders, so -1 wins while both stay mounted —
  // and if this entry ever abdicates, the built-in menu takes over again).
  consumer.slots.inject('settings.launcher', () => consumer.slots.register({
    name: 'settings.launcher',
    priority: -1,
    locale: NS,
    registrant: 'nexusai',
    inject: () => controller,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as never, NexusaiLauncher as never))

  consumer.slots.inject('settings.section', () => consumer.slots.register({
    name: 'settings.section',
    id: 'nexusai',
    order: 10,
    label: () => t('nav'),
    locale: NS,
    registrant: 'nexusai',
    inject: () => controller,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as never, NexusaiSection as never))
}
