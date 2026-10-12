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
import { dirname } from 'node:path'
import { parseDocument } from 'yaml'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** `serverName` grammar: `[A-Za-z0-9_-]{1,32}`, unique across live instances. */
export const SERVER_NAME_LIMIT = 32

/** Absolute profile patch file; empty resolves the desktop profile default. */
export function resolvePatchFile(profilePatchFile: string, profileName = 'desktop'): string {
  if (profilePatchFile.trim() !== '') return profilePatchFile
  return resolveDshHome() + `/profiles/${profileName}/cordis.patch.yml`
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