/** The sidebar's NexusAI entry icon; the sidebar owns the button, label, and selected state around it. */
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the NexusAI glyph at the size the sidebar asks for.
 *
 * A toolbox: the entry opens the capability workbench (专家 · 技能 ·
 * 连接器), so the glyph reads as "the box of tools" rather than the globe it
 * started as — and it stays distinct from dsh's own sidebar glyphs (the
 * plugin pinwheel, the workspace grid).
 *
 * @param props - the sidebar's icon share: the requested edge and whether the panel is selected.
 * @returns the icon element.
 */
export function NexusaiPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {/* lid seam */}
      <path d="M3 13.5h18" />
      {/* body */}
      <rect x="3" y="8.5" width="18" height="12" rx="2.6" />
      {/* handle */}
      <path d="M8.6 8.5V6.8A2.6 2.6 0 0 1 11.2 4.2h1.6a2.6 2.6 0 0 1 2.6 2.6v1.7" />
      {/* latch */}
      <path d="M9.8 13.5v2.1h4.4v-2.1" />
    </svg>
  )
}