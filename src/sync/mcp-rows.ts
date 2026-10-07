/**
 * MCP Server sync: the dsh mcp-client plugin has no programmatic connect
 * API — one instance per patch row — so after login this writer appends one
 * `- insert:` item per NexusAI MCP Server (url = the server-provided
 * streamableUrl, AppKey embedded as its `?key=` query param) to the profile's
 * user-layer `cordis.patch.yml`. The HMR watcher mounts each instance without
 * a restart; tools surface as `mcp__<serverName>__<tool>`.
 *
 * File safety mirrors dsh's own `writePluginEnabled`: comment-preserving
 * `yaml` document edits, atomic 0600 writes, and — on any parse failure — an
 * abort that never clobbers the user's hand-written rows. Only top-level
 * insert items whose every row id matches `nexusai-mcp-*` are ever removed.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parseDocument, isMap, isSeq } from 'yaml'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { Context } from '@deepseek-ai/cordis'

/** Every row id this plugin owns, for surgical removal. */
const OWNED_ID_PATTERN = /^nexusai-mcp-[A-Za-z0-9_-]+$/

/** mcp-client serverName grammar: `[A-Za-z0-9_-]{1,32}`. */
const SERVER_NAME_LIMIT = 32

/** One MCP Server row to materialize. */
export interface McpRowInput {
  readonly mcpServerId: string
  readonly name: string
  readonly url: string
}

/** Constructor options. */
export interface McpRowSyncOptions {
  /** Absolute profile patch file; empty resolves the desktop profile default. */
  readonly profilePatchFile: string
  readonly serverNamePrefix: string
  readonly toolCallTimeoutMs: number
  readonly failOnStartupError: boolean
}

/** Writes and removes the plugin-owned mcp-client insert rows. */
export class McpRowSync {
  constructor(
    private readonly ctx: Context,
    private readonly options: McpRowSyncOptions,
  ) {}

  /** The patch file this writer targets. */
  patchFile(): string {
    if (this.options.profilePatchFile !== '') return this.options.profilePatchFile
    return resolvePatchFile('desktop')
  }

  /** Replace all owned rows with one `- insert:` item for every server. */
  async write(servers: readonly McpRowInput[]): Promise<number> {
    const patchFile = this.patchFile()
    const text = await readPatchText(patchFile)
    const document = parsePatchDocument(text, patchFile)
    if (!isSeq(document.contents)) {
      throw new Error(`nexusai: profile patch ${patchFile} is not a YAML sequence; refusing to edit`)
    }
    removeOwnedItems(document.contents.items)
    const rows = servers.map(server => ({
      id: `nexusai-mcp-${server.mcpServerId}`,
      name: '@deepseek-ai/dsh-mcp-client',
      config: {
        transport: 'streamable-http',
        serverName: serverNameOf(this.options.serverNamePrefix, server),
        url: server.url,
        toolCallTimeoutMs: this.options.toolCallTimeoutMs,
        failOnStartupError: this.options.failOnStartupError,
      },
    }))
    if (rows.length > 0) document.add({ insert: rows })
    await writeAtomic(patchFile, String(document))
    return rows.length
  }

  /** Remove every owned row (logout). */
  async clear(): Promise<void> {
    const patchFile = this.patchFile()
    let text: string
    try {
      text = await readFile(patchFile, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    const document = parsePatchDocument(text, patchFile)
    if (!isSeq(document.contents)) {
      throw new Error(`nexusai: profile patch ${patchFile} is not a YAML sequence; refusing to edit`)
    }
    const changed = removeOwnedItems(document.contents.items)
    if (!changed) return
    await writeAtomic(patchFile, String(document))
  }
}

/** Default: `<dshHome>/profiles/<name>/cordis.patch.yml`. */
function resolvePatchFile(profileName: string): string {
  return resolveDshHome() + `/profiles/${profileName}/cordis.patch.yml`
}

/** Drop every top-level insert item whose rows are all plugin-owned; returns whether any left. */
function removeOwnedItems(items: unknown[]): boolean {
  let removed = false
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (!isMap(item) || !item.has('insert')) continue
    const insert = item.get('insert')
    // A parsed document hands back a YAMLSeq node, not a JS array, so this
    // must go through `isSeq` — `Array.isArray` never matches and the old
    // rows would pile up on every sync.
    if (!isSeq(insert) || insert.items.length === 0) continue
    const owned = insert.items.every((row: unknown) =>
      isMap(row) && typeof row.get('id') === 'string' && OWNED_ID_PATTERN.test(row.get('id') as string))
    if (!owned) continue
    items.splice(index, 1)
    removed = true
  }
  return removed
}

/** serverName: `<prefix>-<slug>`, unique, ≤32 chars, `[A-Za-z0-9_-]`. */
function serverNameOf(prefix: string, server: McpRowInput): string {
  const serverSlug = server.name.replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  const unique = `${prefix}-${serverSlug || 'server'}-${shortId(server.mcpServerId)}`.slice(0, SERVER_NAME_LIMIT)
  return unique.replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+$/, '')
}

/** Stable short discriminator so same-named servers stay distinct. */
function shortId(mcpServerId: string): string {
  let hash = 0
  for (let index = 0; index < mcpServerId.length; index++) {
    hash = (hash * 31 + mcpServerId.charCodeAt(index)) | 0
  }
  return (hash >>> 0).toString(36)
}

async function readPatchText(patchFile: string): Promise<string> {
  try {
    return await readFile(patchFile, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '[]\n'
    throw error
  }
}

function parsePatchDocument(text: string, patchFile: string): ReturnType<typeof parseDocument> {
  const document = parseDocument(text, {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }],
  })
  const error = document.errors[0]
  if (error !== undefined) {
    throw new Error(`nexusai: profile patch ${patchFile} failed to parse (${error.message}); refusing to edit`)
  }
  return document
}

/** Write through the plugin's atomic pattern: create-if-missing, 0600 mode. */
async function writeAtomic(patchFile: string, text: string): Promise<void> {
  await mkdir(dirname(patchFile), { recursive: true })
  await writeFile(patchFile, text, { encoding: 'utf8', mode: 0o600 })
}
