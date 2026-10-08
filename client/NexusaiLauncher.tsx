/**
 * The NexusAI sidebar launcher, occupying the bottom-left `settings.launcher`
 * slot (shadowing the built-in account menu at a lower priority). The trigger
 * mirrors the built-in account button — avatar disc plus label, collapsing to
 * a rail disc when the sidebar hides labels — and opens a `Menu side="top"`
 * with the NexusAI actions. Signed out, the menu offers sign-in, which opens
 * the captcha dialog.
 */
import { useState, type ReactNode } from 'react'
import { IconChevronDownOutlineRegular, IconRefreshOutlineRegular, IconSettingsOutlineMedium, IconUserOutlineMedium, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { NexusaiSignInDialog } from './NexusaiSignInDialog'
import type { NexusaiLocaleKey } from './locales'
import type { NexusaiAuthOps, NexusaiCapabilitiesOps, NexusaiSnapshot } from './face'

/** The launcher's spread props: owner geometry, framework hooks, and the inject controller. */
export interface NexusaiLauncherProps {
  readonly wide?: boolean
  readonly openSettings?: () => void
  readonly useNexusai?: (selector: (snapshot: NexusaiSnapshot) => NexusaiSnapshot) => NexusaiSnapshot
  readonly auth?: NexusaiAuthOps
  readonly capabilities?: NexusaiCapabilitiesOps
  readonly t?: (key: NexusaiLocaleKey) => string
}

/** The bottom-left NexusAI account launcher. */
export function NexusaiLauncher({ wide, openSettings, useNexusai, auth, capabilities, t }: NexusaiLauncherProps): ReactNode {
  const resolve = (key: NexusaiLocaleKey) => t?.(key) ?? key
  const snapshot = useNexusai?.(value => value)
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Organization switcher, sitting right after the account name.
  const [orgMenuOpen, setOrgMenuOpen] = useState(false)
  const [orgBusy, setOrgBusy] = useState(false)

  const view = snapshot?.view
  const signedIn = view?.loggedIn === true
  const name = view?.nickname || view?.username || ''
  const initial = name.slice(0, 1).toUpperCase()
  const orgs = view?.orgs ?? []
  // Host-side notice codes map to localized copy (e.g. a session lost to a 401).
  const notice = view?.notice === 'nexusai: session-lost' ? resolve('sessionLost') : ''
  const currentOrg = orgs.find(org => org.id === view?.orgId)

  const switchOrg = async (orgId: string): Promise<void> => {
    if (auth === undefined || orgId === view?.orgId) return
    setOrgBusy(true)
    setError('')
    try {
      await auth.selectOrg(orgId)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setOrgBusy(false)
    }
  }

  const runSync = async (): Promise<void> => {
    if (capabilities === undefined) return
    setBusy(true)
    setError('')
    try {
      const report = await capabilities.sync()
      if (report.errors.length > 0) setError(report.errors[0])
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const runLogout = async (): Promise<void> => {
    if (auth === undefined) return
    setBusy(true)
    setError('')
    try {
      await auth.logout()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const trigger = (
    <button
      type="button"
      aria-label={signedIn ? `${resolve('signedInAs')}${name}` : resolve('login')}
      title={signedIn ? `${resolve('signedInAs')}${name}` : resolve('login')}
      aria-haspopup={signedIn ? 'menu' : 'dialog'}
      aria-expanded={signedIn ? menuOpen : undefined}
      onClick={() => {
        // Signed out, the launcher IS the sign-in entry: skip the menu and
        // open the captcha dialog straight away.
        if (signedIn) setMenuOpen(value => !value)
        else setDialogOpen(true)
      }}
      style={triggerStyle}
      data-collapsed={wide !== true ? '' : undefined}
    >
      <span style={avatarStyle} aria-hidden={true}>
        {signedIn && initial !== '' ? initial : <IconUserOutlineMedium size={16} />}
      </span>
      {wide === true && (
        <span style={labelStyle}>
          {/* Signed in: just the account name; the tooltip carries the state. */}
          {signedIn ? name : resolve('login')}
        </span>
      )}
      {/* Organization: a chip right after the name that switches orgs (the
          host re-syncs tools/MCP for the picked org). */}
      {signedIn && wide === true && currentOrg !== undefined && (
        orgs.length > 1
          ? (
              <Menu
                open={orgMenuOpen}
                side="top"
                portal
                autoFocus
                anchor={(
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={resolve('switchOrg')}
                    aria-haspopup="menu"
                    aria-expanded={orgMenuOpen}
                    title={`${resolve('switchOrg')}：${currentOrg.name}`}
                    style={orgChipStyle}
                    onClick={event => { event.stopPropagation(); setOrgMenuOpen(value => !value) }}
                    onKeyDown={event => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      event.stopPropagation()
                      setOrgMenuOpen(value => !value)
                    }}
                  >
                    {orgBusy ? '…' : currentOrg.name}
                    <IconChevronDownOutlineRegular size={12} />
                  </span>
                )}
                selectedId={view?.orgId}
                items={orgs.map(org => ({ id: org.id, label: org.name }))}
                onSelect={id => { setOrgMenuOpen(false); void switchOrg(id) }}
                onClose={() => { setOrgMenuOpen(false) }}
              />
            )
          : <span style={orgNameStyle} title={currentOrg.name}>{currentOrg.name}</span>
      )}
    </button>
  )

  if (!signedIn) {
    return (
      <>
        {trigger}
        {error !== '' && wide === true && <div style={errorStyle} role="alert">{error}</div>}
        {error === '' && notice !== '' && wide === true && <div style={errorStyle} role="alert">{notice}</div>}
        {dialogOpen && auth !== undefined && (
          <NexusaiSignInDialog
            auth={auth}
            getView={() => snapshot?.view}
            t={resolve}
            close={() => { setDialogOpen(false) }}
            openSettings={openSettings}
          />
        )}
      </>
    )
  }

  return (
    <>
      <Menu
        open={menuOpen}
        side="top"
        portal
        autoFocus
        anchor={trigger}
        items={[
          { id: 'openSettings', label: resolve('openSettings'), icon: <IconSettingsOutlineMedium size={16} /> },
          { id: 'sync', label: busy ? resolve('syncing') : resolve('sync'), icon: <IconRefreshOutlineRegular size={16} />, disabled: busy },
          { id: 'logout', label: resolve('logout'), disabled: busy },
        ]}
        onSelect={id => {
          setMenuOpen(false)
          if (id === 'openSettings') openSettings?.()
          if (id === 'sync') void runSync()
          if (id === 'logout') void runLogout()
        }}
        onClose={() => { setMenuOpen(false) }}
      />
      {error !== '' && wide === true && <div style={errorStyle} role="alert">{error}</div>}
    </>
  )
}

const triggerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: 6,
  border: 'none',
  borderRadius: 12,
  background: 'transparent',
  cursor: 'pointer',
  textAlign: 'left',
}

const avatarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: 32,
  height: 32,
  borderRadius: '50%',
  background: 'var(--dsw-alias-bg-skeleton, rgba(128, 128, 128, 0.2))',
  color: 'inherit',
  fontSize: 14,
  fontWeight: 600,
}

const labelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 13,
}

const orgChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  flexShrink: 0,
  maxWidth: 120,
  padding: '1px 6px',
  borderRadius: 999,
  background: 'var(--dsw-alias-interactive-bg-hover)',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  lineHeight: '16px',
  cursor: 'pointer',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const orgNameStyle: React.CSSProperties = {
  flexShrink: 0,
  maxWidth: 120,
  color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))',
  fontSize: 12,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const errorStyle: React.CSSProperties = {
  color: 'var(--dsw-alias-state-error-primary, #d33)',
  fontSize: 12,
  padding: '4px 6px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

function errorMessage(cause: unknown): string {
  const message = (cause as { message?: string; error?: { message?: string } })?.error?.message
    ?? (cause as { message?: string })?.message
    ?? String(cause)
  return message.replace(/^client api: /, '')
}
