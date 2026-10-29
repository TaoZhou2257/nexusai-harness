/**
 * Deployment-level customer branding, baked into the profile at packaging time:
 * `prepare-runtime.mjs` copies `apps/nexusai-desktop/branding/<customer>/` into
 * `<profile>/branding/` and points the row config's `brandingFile` at it.
 *
 * This layer exists for the white-label window *before* anyone signs in — on a
 * fresh machine no server has been reached, so the customer's name and logos
 * are the app's only identity. Once a session exists,
 * `NexusaiAuthService.getBranding` serves the platform's own
 * `GET /v1/base/custom` answer and this layer never applies.
 *
 * Cosmetic by contract: any failure to find, read or parse drops the layer
 * (parse problems warn once per file version), never blocking login.
 */
import { readFile, stat } from 'node:fs/promises'
import { extname, isAbsolute, join } from 'node:path'
import { dirname } from 'node:path'
import { resolvePatchFile } from '../sync/patch-file.js'

/** The customer brand the host serves while nobody is signed in. */
export interface CustomerBranding {
  readonly name: string
  /** Near-square mark for the sidebar slot, as a data URL ('' when unusable). */
  readonly markUrl: string
  /** Login-dialog logo, as a data URL ('' when absent or unreadable). */
  readonly logoUrl: string
}

interface BrandFile {
  readonly name?: unknown
  readonly mark?: unknown
  readonly logo?: unknown
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

/** One image at most: a logo that large is a mistake, and the data URL rides the wire. */
const MAX_IMAGE_BYTES = 2_000_000

interface CacheEntry {
  readonly mtimeMs: number
  readonly brand: CustomerBranding | undefined
}

const cache = new Map<string, CacheEntry>()

/**
 * Where the deployment's brand manifest lives, or `undefined` when the row
 * config carries none (every default build). A relative `brandingFile` sits
 * inside the profile that mounts this plugin — the same directory the row's
 * patch file lives in.
 */
export function customerBrandingFile(profilePatchFile: string, brandingFile: string): string | undefined {
  const trimmed = brandingFile.trim()
  if (trimmed === '') return undefined
  if (isAbsolute(trimmed)) return trimmed
  return join(dirname(resolvePatchFile(profilePatchFile)), trimmed)
}

/**
 * Read the manifest (mtime-cached, so re-branding a deployed profile needs no
 * restart — the next branding fetch picks it up). `undefined` = no brand layer.
 */
export async function loadCustomerBranding(file: string | undefined): Promise<CustomerBranding | undefined> {
  if (file === undefined) return undefined
  let mtimeMs: number
  try {
    mtimeMs = (await stat(file)).mtimeMs
  } catch {
    return undefined
  }
  const hit = cache.get(file)
  if (hit !== undefined && hit.mtimeMs === mtimeMs) return hit.brand
  const brand = await parseBrandFile(file)
  cache.set(file, { mtimeMs, brand })
  return brand
}

async function parseBrandFile(file: string): Promise<CustomerBranding | undefined> {
  let doc: BrandFile
  try {
    doc = JSON.parse(await readFile(file, 'utf8')) as BrandFile
  } catch (error) {
    console.warn(`nexusai: customer branding ${file} is unreadable, ignoring it (${(error as Error).message})`)
    return undefined
  }
  const name = typeof doc.name === 'string' ? doc.name.trim() : ''
  if (name === '') {
    console.warn(`nexusai: customer branding ${file} has no name, ignoring it`)
    return undefined
  }
  const dir = dirname(file)
  return {
    name,
    markUrl: await squareMarkDataUrl(typeof doc.mark === 'string' ? join(dir, doc.mark) : ''),
    logoUrl: typeof doc.logo === 'string' ? await imageDataUrl(join(dir, doc.logo)) : '',
  }
}

/**
 * The sidebar mark must survive 24px: PNG only (its header carries the pixel
 * size), near-square like the server marks `pickSquareLogo` accepts — anything
 * else falls back to the plugin's own glyph.
 */
async function squareMarkDataUrl(path: string): Promise<string> {
  if (path === '' || extname(path).toLowerCase() !== '.png') return ''
  try {
    const bytes = await readFile(path)
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return ''
    if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return ''
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const width = view.getUint32(16)
    const height = view.getUint32(20)
    const ratio = width / height
    if (ratio < 0.8 || ratio > 1.25) return ''
    return `data:image/png;base64,${bytes.toString('base64')}`
  } catch {
    return ''
  }
}

async function imageDataUrl(path: string): Promise<string> {
  const mime = MIME_BY_EXT[extname(path).toLowerCase()]
  if (mime === undefined) return ''
  try {
    const bytes = await readFile(path)
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return ''
    return `data:${mime};base64,${bytes.toString('base64')}`
  } catch {
    return ''
  }
}
