/**
 * The sidebar's top-left brand: our own contributions to the shell's
 * `sidebar.brand.mark` / `sidebar.brand.name` slots (single, root-scope), so
 * the mark and the name come from the NexusAI server instead of dsh's local
 * build label — the official seam for exactly this, no source changes.
 *
 * Layout parity: the shell owns the surrounding row (`.brandIdentity`, 24px
 * tall, 8px gap; `.brandName` 18px/600). Our markup mirrors the fallback's
 * inner structure one-to-one — a 24px mark, then either a single name span
 * (17px, nowrap) or, when a dsh build string is known, the two-line
 * name-over-version badge the local-build fallback uses (12px title over a
 * 10px-tall badge in the code font).
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { BrandingFace, NexusaiAuthOps } from './face'

/** Copy shown when the server provides no brand at all. */
const DEFAULT_NAME = 'NexusAI DSH'

/** One shared fetch: both slots render from the same payload (and the whole
 * sidebar mounts once, so a module-level cache avoids a second round trip). */
let cached: BrandingFace | undefined
let inFlight: Promise<BrandingFace | undefined> | undefined
/** Mounted readers, so a server change can push a fresh payload into them. */
const reloads = new Set<() => void>()

/**
 * Drop the cached payload and make every mounted reader fetch again.
 *
 * The server address can change while the app runs — the sign-in dialog's
 * 「应用」 switches deployments — and the brand that identifies the app has to
 * follow it. Without this the sidebar keeps the previous deployment's
 * name/logo/version until the app restarts (the dialog refreshes its own copy,
 * so the mismatch reads as "the sidebar stopped updating").
 */
export function invalidateBranding(): void {
  cached = undefined
  inFlight = undefined
  for (const reload of reloads) reload()
}

export function useBranding(auth: NexusaiAuthOps | undefined): BrandingFace | undefined {
  const [branding, setBranding] = useState<BrandingFace | undefined>(cached)
  useEffect(() => {
    if (auth === undefined) return undefined
    let live = true
    const load = (): void => {
      if (cached !== undefined) {
        setBranding(cached)
        return
      }
      inFlight ??= auth.getBranding().then(info => {
        cached = info
        return info
      }, () => {
        cached = undefined
        return undefined
      }).finally(() => { inFlight = undefined })
      void inFlight.then(info => { if (live && info !== undefined) setBranding(info) })
    }
    load()
    reloads.add(load)
    return () => {
      live = false
      reloads.delete(load)
    }
  }, [auth])
  return branding
}

/** The 24px square mark: the server's square logo, else our own toolbox glyph. */
export function NexusaiBrandMark({ size = 24, auth }: { size?: number; auth?: NexusaiAuthOps }): ReactNode {
  const branding = useBranding(auth)
  const markUrl = (branding?.markUrl ?? '').trim()
  const [broken, setBroken] = useState(false)
  if (markUrl !== '' && !broken) {
    return (
      <img
        src={markUrl}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: Math.max(4, Math.round(size / 5)), objectFit: 'cover', display: 'block' }}
        onError={() => { setBroken(true) }}
      />
    )
  }
  return <NexusaiDefaultMark size={size} />
}

/**
 * The default mark: an agent graph — two upper nodes feeding one lower node.
 * Three nodes stand for the workbench's three capability families (专家 ·
 * 技能 · 连接器); nodes are filled so they stay crisp at 24px, the spokes keep
 * dsh's stroke weight and colour.
 */
function NexusaiDefaultMark({ size }: { size: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      <path d="M6.89 8.27 10.61 15.73" />
      <path d="M17.11 8.27 13.39 15.73" />
      <circle cx="5.5" cy="5.5" r="2.5" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="5.5" r="2.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18.5" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** The brand name beside the mark, with the version underneath: the platform's
 * `about.version` when the server answers, else dsh's own build string. */
export function NexusaiBrandName({ auth }: { auth?: NexusaiAuthOps }): ReactNode {
  const branding = useBranding(auth)
  const name = (branding?.name ?? '').trim() || DEFAULT_NAME
  // The platform's own version first (the one the login dialog shows); dsh's
  // build string is the fallback when the server cannot be reached.
  const version = (branding?.version ?? '').trim() || (branding?.dshVersion ?? '').trim()
  if (version === '') {
    return <span style={{ fontSize: 17, letterSpacing: 0, whiteSpace: 'nowrap' }}>{name}</span>
  }
  return (
    <span style={{ flex: 'none', display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 1, height: 24, whiteSpace: 'nowrap' }}>
      <span style={{ fontSize: 12, lineHeight: '13px', letterSpacing: 0 }}>{name}</span>
      <span style={{
        flex: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        height: 10,
        padding: '0 3px',
        borderRadius: 2,
        color: 'var(--dsw-alias-label-primary-inverted)',
        background: 'var(--dsw-alias-label-primary)',
        fontFamily: 'var(--ds-font-family-code)',
        fontSize: 6,
        fontWeight: 500,
        lineHeight: '10px',
        whiteSpace: 'nowrap',
      }}>{version}</span>
    </span>
  )
}