/**
 * The first-run hero (the "Into the Unknown" landing screen).
 *
 * Two separate problems, solved two different ways — worth keeping straight:
 *
 * 1. **The mark is a real slot.** dsh renders it with
 *    `renderSlot("conversation.hero.brand.mark", …, { fallback: <HeroFish/> })`,
 *    so contributing here is the supported route (same seam the sidebar brand
 *    uses) and the built-in fish stays as the fallback.
 * 2. **The two strings are not.** They are plain dictionary entries
 *    (`hero.headline`, `hero.preview`) in dsh's own namespace, and re-registering
 *    a namespace+locale pair throws — so a plugin cannot override them. They are
 *    therefore rewritten in the DOM while this slot is mounted (the hero is only
 *    on screen then, which is exactly when the patch should exist).
 *
 * The patch only touches elements it can identify unambiguously (a title group
 * that *contains* the preview badge) and only writes when the text differs, so
 * it neither loops on its own mutations nor fights React re-renders.
 */
import { useEffect, type ReactNode } from 'react'
import markUrl from './assets/icon-mark-128.png'
import { useBranding } from './NexusaiBrand'
import type { NexusaiAuthOps } from './face'

/** The headline shown instead of dsh's "探索未至之境". */
const HEADLINE = '探索 AGI 之无限可能'

/** Badge / headline elements, matched by CSS-module local name (the hash changes per build). */
const TITLE_GROUP = '[class*="_titleGroup"]'
const HEADLINE_SPAN = `${TITLE_GROUP}:has(> [class*="_previewBadge"]) > span:first-child`
const PREVIEW_BADGE = `${TITLE_GROUP} > [class*="_previewBadge"]`

/** The version the badge shows: the platform's, else dsh's build string. */
function badgeText(authVersion: string | undefined): string {
  // Same rule as the sidebar brand: the platform version wins, dsh's own build
  // string is the fallback, and with neither we leave dsh's badge text alone.
  return (authVersion ?? '').trim()
}

/**
 * Rewrite the hero's headline and badge in place.
 * @param version - the text for the badge; '' leaves dsh's own label.
 */
function patchHeroText(version: string): void {
  for (const element of Array.from(document.querySelectorAll(HEADLINE_SPAN))) {
    if (element.textContent !== HEADLINE) element.textContent = HEADLINE
  }
  if (version === '') return
  for (const element of Array.from(document.querySelectorAll(PREVIEW_BADGE))) {
    if (element.textContent !== version) element.textContent = version
  }
}

/** The app mark in dsh's hero slot; also owns the text patch for as long as it is mounted. */
export function NexusaiHeroMark({ size = 34, auth }: { size?: number, auth?: NexusaiAuthOps }): ReactNode {
  const branding = useBranding(auth)
  const version = badgeText((branding?.version ?? '').trim() || (branding?.dshVersion ?? '').trim())

  useEffect(() => {
    patchHeroText(version)
    const observer = new MutationObserver(() => { patchHeroText(version) })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => { observer.disconnect() }
  }, [version])

  return (
    <img
      src={markUrl}
      alt=""
      width={size}
      height={size}
      // The hero mark is a bare glyph on the app's own background, so it keeps
      // its aspect and does not get the launch-icon plate.
      style={{ width: size, height: size, objectFit: 'contain', display: 'block' }}
    />
  )
}
