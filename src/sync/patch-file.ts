/**
 * Shared plumbing for writers that append `mcp-client` rows to a profile's
 * user-layer `cordis.patch.yml`: comment-preserving YAML edits, atomic 0600
 * writes, and — on any parse failure — an abort that never clobbers the user's
 * hand-written rows. Two writers use it: `nexusai-mcp-*` rows synced from the
 * NexusAI catalog (removed on logout) and `custom-mcp-*` rows the user authored
 * here (never removed). Keeping one implementation is what makes that split
 * safe: both edit the same document with the same guards.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseDocument } from 'yaml'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** `serverName` grammar: `[A-Za-z0-9_-]{1,32}`, unique across live instances. */
export const SERVER_NAME_LIMIT = 32

/** The row name that marks the profile patch this plugin was mounted from. */
const PLUGIN_ROW_NAME = '@toby/dsh-plugin-nexusai'

/** Resolution memo: one host process only ever runs one profile. */
let activeProfileCache: { readonly home: string; readonly profile: string } | undefined

/**
 * The profile patch file to write.
 *
 * Priority: an explicit `profilePatchFile` config, then the profile that
 * actually carries this plugin's row, then the desktop convention.
 *
 * The middle step is not decoration. A profile's own name decides where its
 * patch lives, and the name differs by how the app was started: a development
 * checkout runs the `desktop` profile, while this project's packaged app bundles
 * one named `nexusai`. Assuming `desktop` there would write rows into a file no
 * running host reads back — the panel would list connectors whose tools never
 * mount, and the same mistake would make 自定义连接器 silently do nothing.
 *
 * @param profilePatchFile - explicit absolute path from the row config ('' = auto).
 * @param profileName - explicit profile name, when a caller knows it.
 * @returns the absolute patch file path.
 */
export function resolvePatchFile(profilePatchFile: string, profileName?: string): string {
  if (profilePatchFile.trim() !== '') return profilePatchFile
  const home = resolveDshHome()
  return join(home, 'profiles', profileName ?? owningProfile(home), 'cordis.patch.yml')
}

/** The profile whose patch mounts this plugin, or a sane fallback when unknown. */
function owningProfile(home: string): string {
  if (activeProfileCache !== undefined && activeProfileCache.home === home) return activeProfileCache.profile
  const profilesRoot = join(home, 'profiles')
  const names = listProfiles(profilesRoot)
  const owner = names.find(name => patchMountsPlugin(join(profilesRoot, name, 'cordis.patch.yml')))
  const profile = owner ?? (names.includes('desktop') ? 'desktop' : names[0]) ?? 'desktop'
  activeProfileCache = { home, profile }
  return profile
}

/** Existing profile directory names ([] when the home has no profiles yet). */
function listProfiles(profilesRoot: string): string[] {
  try {
    return readdirSync(profilesRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    return []
  }
}

/**
 * Whether a patch file mounts this plugin. The bundled profile is materialized
 * with exactly this row, so it identifies the profile even if the user renamed
 * the app's directory or runs a profile with a name we never predicted.
 */
function patchMountsPlugin(patchFile: string): boolean {
  if (!existsSync(patchFile)) return false
  try {
    return readFileSync(patchFile, 'utf8').includes(PLUGIN_ROW_NAME)
  } catch {
    return false
  }
}

/** The patch text, or an empty sequence document when the file is absent. */
export async function readPatchText(patchFile: string): Promise<string> {
  try {
    return await readFile(patchFile, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '[]\n'
    throw error
  }
}

/** Parse the patch, refusing to edit anything we could not read back whole. */
export function parsePatchDocument(text: string, patchFile: string): ReturnType<typeof parseDocument> {
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
export async function writeAtomic(patchFile: string, text: string): Promise<void> {
  await mkdir(dirname(patchFile), { recursive: true })
  await writeFile(patchFile, text, { encoding: 'utf8', mode: 0o600 })
}

/** `serverName`-safe slug from a display name (CJK and punctuation become `-`). */
export function slugPart(value: string): string {
  const slug = value.replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return slug
}

/** Stable short discriminator so same-named entries stay distinct. */
export function shortId(value: string): string {
  let hash = 0
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0
  }
  return (hash >>> 0).toString(36)
}

/**
 * `serverName`: `<prefix>-<slug>-<hash>`, unique, ≤32 chars, `[A-Za-z0-9_-]`.
 * The hash keeps CJK and same-named entries distinct instead of collapsing to
 * the same namespace.
 */
export function serverNameOf(prefix: string, name: string, identity: string): string {
  const slug = slugPart(name)
  const unique = `${prefix}-${slug === '' ? 'server' : slug}-${shortId(identity)}`.slice(0, SERVER_NAME_LIMIT)
  return unique.replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+$/, '')
}