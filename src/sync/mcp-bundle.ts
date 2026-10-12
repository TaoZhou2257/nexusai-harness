/**
 * DXT / MCPB bundles: one zip carrying a `manifest.json` and a bundled local
 * MCP server. MCPB is the current name of the format (manifest_version 0.3+);
 * DXT is the same shape under its former name (`dxt_version`), so both imports
 * run through here.
 *
 * Install = unpack under `<dshHome>/mcp-bundles/<slug>` and turn the manifest's
 * `mcp_config` into a connector row. The spec's substitutions (`${__dirname}`,
 * `${HOME}`, `${DESKTOP}`, `${DOCUMENTS}`, `${DOWNLOADS}`, `${pathSeparator}`,
 * `${/}`, `${user_config.KEY}`) and the current platform's
 * `platform_overrides` are applied, so a bundle's files are referenced by
 * absolute paths — dsh spawns the server with `shell: false`, from its own cwd.
 */
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, normalize, sep } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { unzipSync } from 'fflate'
import type { ConnectorDraft } from './connector-rows'

/** Ceiling for one bundle (decoded), matching the skill-upload order of magnitude. */
const MAX_BUNDLE_BYTES = 64 * 1024 * 1024
/** Manifest major version this installer understands. */
const SUPPORTED_MANIFEST_MAJOR = 0

/** One `user_config` field the manifest asks the user for. */
export interface BundleUserField {
  readonly key: string
  readonly type: 'string' | 'number' | 'boolean' | 'directory' | 'file'
  readonly title: string
  readonly description: string
  readonly required: boolean
  readonly sensitive: boolean
  readonly multiple: boolean
  /** Default as text (the dialog prefills it); empty when none. */
  readonly defaultValue: string
}

/** What a picked bundle declares, before anything is written. */
export interface BundleSummary {
  readonly kind: 'mcpb' | 'dxt'
  readonly manifestVersion: string
  /** Machine name (manifest `name`), used for the install directory. */
  readonly name: string
  readonly displayName: string
  readonly description: string
  readonly version: string
  readonly author: string
  readonly serverType: string
  readonly entryPoint: string
  readonly fields: readonly BundleUserField[]
}

/** One read bundle: its summary, the raw manifest, and the archive's files. */
export interface BundleRead {
  readonly summary: BundleSummary
  readonly manifest: Record<string, unknown>
  readonly files: Record<string, Uint8Array>
}

/** What installing one bundle produced. */
export interface BundleInstall extends BundleSummary {
  readonly directory: string
  readonly draft: ConnectorDraft
}

/** Read and validate a bundle's manifest without writing anything. */
export async function readBundle(path: string): Promise<BundleRead> {
  const picked = path.trim()
  if (picked === '') throw new Error('没有选择 .dxt / .mcpb 文件')
  const info = await stat(picked).catch(() => undefined)
  if (info === undefined || !info.isFile()) throw new Error(`找不到文件：${basename(picked)}`)
  if (info.size > MAX_BUNDLE_BYTES) throw new Error('插件包过大（上限 64MB）')
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(await readFile(picked)))
  } catch {
    throw new Error(`${basename(picked)} 不是有效的压缩包（应为 .dxt / .mcpb）`)
  }
  const manifestFile = files['manifest.json'] ?? files['dxt_manifest.json']
  if (manifestFile === undefined) throw new Error('插件包里没有 manifest.json，不是 DXT / MCPB 包')
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestFile)) as Record<string, unknown>
  } catch {
    throw new Error('manifest.json 解析失败（不是合法 JSON）')
  }
  return { summary: summarize(manifest), manifest, files }
}

/** Unpack one bundle and describe the connector it should become. */
export async function installBundle(path: string, values: Readonly<Record<string, string>>): Promise<BundleInstall> {
  const { summary, manifest, files } = await readBundle(path)
  const root = bundleRoot()
  const directory = join(root, directoryName(summary.name))
  const staging = join(root, `.nexusai-bundle-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
  try {
    await mkdir(staging, { recursive: true })
    for (const [entryPath, bytes] of Object.entries(files)) {
      const relative = normalize(entryPath.replace(/\\/g, '/'))
      if (relative === '' || relative.endsWith('/')) continue
      if (relative.startsWith('__MACOSX/') || basename(relative) === '.DS_Store') continue
      if (relative.startsWith('..') || relative.startsWith('/') || relative.includes(`..${sep}`) || /^[A-Za-z]:/.test(relative)) {
        throw new Error(`插件包含有非法路径：${entryPath}`)
      }
      const file = join(staging, relative)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, bytes)
    }
    await rm(directory, { recursive: true, force: true })
    await rename(staging, directory)
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
  const draft = connectorOf(summary, manifest, directory, values)
  await makeRunnable(draft, directory, summary.entryPoint === '' ? '' : join(directory, summary.entryPoint))
  return { ...summary, directory, draft }
}

/** `<dshHome>/mcp-bundles`. */
function bundleRoot(): string {
  return join(resolveDshHome(), 'mcp-bundles')
}

/** Read the manifest: required fields, the server block, the user prompts. */
function summarize(manifest: Record<string, unknown>): BundleSummary {
  const legacy = manifest.dxt_version !== undefined && manifest.manifest_version === undefined
  const version = text(legacy ? manifest.dxt_version : manifest.manifest_version)
  if (version === '') throw new Error('manifest.json 缺少 manifest_version（或 dxt_version）')
  if (Number.parseInt(version, 10) !== SUPPORTED_MANIFEST_MAJOR) {
    throw new Error(`暂不支持 manifest_version ${version}（当前支持 0.x）`)
  }
  const name = text(manifest.name)
  const server = record(manifest.server)
  const serverType = text(server.type)
  const entryPoint = text(server.entry_point)
  const mcpConfig = record(server.mcp_config)
  for (const [label, value] of [['name', name], ['server.type', serverType], ['server.entry_point', entryPoint]] as const) {
    if (value === '') throw new Error(`manifest.json 缺少必填字段 ${label}`)
  }
  if (serverType === 'uv') {
    // The 0.4 `uv` type leaves execution to the host, which would have to
    // install and run UV itself — dsh's mcp-client only spawns a command.
    throw new Error('暂不支持 uv 类型（manifest 0.4）的插件包，请改用 node / python / binary 类型')
  }
  if (text(mcpConfig.command) === '') {
    throw new Error('manifest.json 的 server.mcp_config 缺少 command')
  }
  const compatibility = record(manifest.compatibility)
  const platforms = Array.isArray(compatibility.platforms) ? compatibility.platforms.map(value => String(value)) : []
  if (platforms.length > 0 && !platforms.includes(process.platform)) {
    throw new Error(`该插件只支持 ${platforms.join(' / ')}，当前系统是 ${process.platform}`)
  }
  const author = record(manifest.author)
  return {
    kind: legacy ? 'dxt' : 'mcpb',
    manifestVersion: version,
    name,
    displayName: text(manifest.display_name) || name,
    description: text(manifest.description),
    version: text(manifest.version),
    author: text(author.name),
    serverType,
    entryPoint,
    fields: readFields(manifest.user_config),
  }
}

/** The typed prompts a manifest may declare, in declaration order. */
function readFields(raw: unknown): BundleUserField[] {
  const fields: BundleUserField[] = []
  for (const [key, value] of Object.entries(record(raw))) {
    const field = record(value)
    const type = text(field.type)
    if (type !== 'string' && type !== 'number' && type !== 'boolean' && type !== 'directory' && type !== 'file') continue
    const fallback = Array.isArray(field.default) ? field.default.map(item => String(item)).join('\n') : field.default
    fields.push({
      key,
      type,
      title: text(field.title) || key,
      description: text(field.description),
      required: field.required === true,
      sensitive: field.sensitive === true,
      multiple: field.multiple === true,
      defaultValue: fallback === undefined || fallback === null ? '' : String(fallback),
    })
  }
  return fields
}

/**
 * The connector a manifest describes: `mcp_config` with this platform's
 * override applied and every documented variable substituted. A `node` server
 * whose command is a bare `node` is pointed at the runtime this app itself runs
 * on (Electron in Node mode), so a bundle works without a Node on PATH.
 */
function connectorOf(
  summary: BundleSummary,
  manifest: Record<string, unknown>,
  directory: string,
  values: Readonly<Record<string, string>>,
): ConnectorDraft {
  const server = record(manifest.server)
  const config = record(server.mcp_config)
  const override = record(record(config.platform_overrides)[process.platform])
  const substitute = (value: string): string => substituteVars(value, directory, values)
  const command = substitute(text(override.command) !== '' ? text(override.command) : text(config.command))
  const rawArgs = Array.isArray(override.args) ? override.args : config.args
  const args = (Array.isArray(rawArgs) ? rawArgs : [])
    .map(value => substitute(String(value)))
    // A substituted value may carry a newline-separated list (multiple
    // selections expand into separate argv entries, per the spec).
    .flatMap(value => value.split('\n').map(part => part.trim()).filter(part => part !== ''))
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...record(config.env), ...record(override.env) })) {
    env[key] = substitute(String(value))
  }
  const entry = summary.entryPoint === '' ? '' : join(directory, summary.entryPoint)
  const resolved = command === '' ? entry : command
  const draft: ConnectorDraft = {
    name: summary.displayName,
    transport: 'stdio',
    command: resolveCommand(resolved, directory, summary.serverType, env),
    args,
    env,
    origin: `${summary.kind.toUpperCase()} 包 ${summary.name}@${summary.version} · 安装于 ${directory}`,
  }
  return draft
}

/**
 * Command resolution: a bundled `node` server runs on this app's own runtime
 * (the Electron binary with `ELECTRON_RUN_AS_NODE`), and a binary server's
 * relative path is anchored to its install directory.
 */
function resolveCommand(command: string, directory: string, serverType: string, env: Record<string, string>): string {
  if (serverType === 'node' && (command === 'node' || command === 'nodejs')) {
    env.ELECTRON_RUN_AS_NODE = '1'
    return process.execPath
  }
  if ((serverType === 'binary' || serverType === 'node') && command !== '' && !command.startsWith('/')) {
    const inside = join(directory, command)
    if (existsSync(inside)) return inside
  }
  return command
}

/** `${…}` substitution over the manifest spec's documented variables. */
function substituteVars(value: string, directory: string, values: Readonly<Record<string, string>>): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, rawToken: string) => {
    const token = rawToken.trim()
    switch (token) {
      case '__dirname': return directory
      case 'HOME': return homedir()
      case 'DESKTOP': return join(homedir(), 'Desktop')
      case 'DOCUMENTS': return join(homedir(), 'Documents')
      case 'DOWNLOADS': return join(homedir(), 'Downloads')
      case 'pathSeparator':
      case '/': return sep
      default:
        if (token.startsWith('user_config.')) {
          const key = token.slice('user_config.'.length)
          return values[key] ?? ''
        }
        return match
    }
  })
}

/** Give a bundled binary its executable bit (best effort). */
async function makeRunnable(draft: ConnectorDraft, directory: string, entry: string): Promise<void> {
  for (const candidate of [draft.command ?? '', entry]) {
    if (candidate.startsWith(directory)) await chmod(candidate, 0o755).catch(() => undefined)
  }
}

/** Filesystem-safe install-directory name that keeps non-ASCII names readable. */
function directoryName(value: string): string {
  const cleaned = value
    .replace(/[/\\:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\-]+/, '')
    .replace(/[.\-]+$/, '')
    .slice(0, 64)
  return cleaned === '' ? 'bundle' : cleaned
}

/** A plain-object view of an unknown value; anything else reads as empty. */
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** A manifest string field, trimmed; numbers stringify, everything else is empty. */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
}
