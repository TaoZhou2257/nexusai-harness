/**
 * The NexusAI sidebar launcher, occupying the bottom-left `settings.launcher`
 * slot (shadowing the built-in account menu at a lower priority). The trigger
 * mirrors the built-in account button — avatar disc plus label, collapsing to
 * a rail disc when the sidebar hides labels — and opens a `Menu side="top"`
 * with the NexusAI actions. Signed out, the menu offers sign-in, which opens
 * the captcha dialog. Sign-out asks first, reporting whether tasks are running
 * (the built-in account menu's own confirmation, kept because signing out
 * drops the tools and MCP rows those tasks may be using).
 */
import { useState, type ReactNode } from 'react'
import { Button, IconChevronDownOutlineRegular, IconLoadingOutlineRegular, IconSettingsOutlineMedium, IconUserOutlineMedium, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { NexusaiSignInDialog } from './NexusaiSignInDialog'
import type { NexusaiLocaleKey } from './locales'
import type { NexusaiAuthOps, NexusaiRuntimeOps, NexusaiSnapshot } from './face'

/** The launcher's spread props: owner geometry, framework hooks, and the inject controller. */
export interface NexusaiLauncherProps {
  readonly wide?: boolean
  readonly openSettings?: () => void
  /** Effective Settings key labels and accessible combination, from the settings shell. */
  readonly settingsShortcut?: { readonly keys: readonly string[]; readonly aria?: string | undefined }
  readonly useNexusai?: (selector: (snapshot: NexusaiSnapshot) => NexusaiSnapshot) => NexusaiSnapshot
  readonly auth?: NexusaiAuthOps
  readonly runtime?: NexusaiRuntimeOps
  readonly t?: (key: NexusaiLocaleKey) => string
}

/** The bottom-left NexusAI account launcher. */
export function NexusaiLauncher({ wide, openSettings, settingsShortcut, useNexusai, auth, runtime, t }: NexusaiLauncherProps): ReactNode {
  const resolve = (key: NexusaiLocaleKey) => t?.(key) ?? key
  const snapshot = useNexusai?.(value => value)
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Organization switcher, sitting right after the account name.
  const [orgMenuOpen, setOrgMenuOpen] = useState(false)
  const [orgBusy, setOrgBusy] = useState(false)
  // Sign-out confirmation: undefined = closed, otherwise the task impact
  // sampled when the menu item was chosen.
  const [signOutImpact, setSignOutImpact] = useState<boolean | 'unknown'>()
  const [signOutError, setSignOutError] = useState('')

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

  // Sample the task impact when the action is chosen rather than while the
  // dialog is open: the copy describes the moment of the request, and a task
  // starting mid-confirmation cannot make the report untrue.
  const requestSignOut = (): void => {
    setMenuOpen(false)
    setSignOutError('')
    setSignOutImpact(runtime?.hasRunningTasks() ?? false)
  }

  const dismissSignOut = (): void => {
    if (!busy) setSignOutImpact(undefined)
  }

  const confirmSignOut = async (): Promise<void> => {
    if (auth === undefined) return
    setBusy(true)
    setSignOutError('')
    try {
      await auth.logout()
      setSignOutImpact(undefined)
    } catch (cause) {
      setSignOutError(errorMessage(cause))
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
          {
            id: 'openSettings',
            label: resolve('openSettings'),
            icon: <IconSettingsOutlineMedium size={16} />,
            ...(settingsShortcut === undefined ? {} : { shortcut: settingsShortcut }),
          },
          { id: 'logout', label: resolve('logout'), disabled: busy },
        ]}
        onSelect={id => {
          setMenuOpen(false)
          if (id === 'openSettings') openSettings?.()
          if (id === 'logout') requestSignOut()
        }}
        onClose={() => { setMenuOpen(false) }}
      />
      {signOutImpact !== undefined && (
        <Modal
          open
          title={resolve('logout')}
          closeLabel={resolve('close')}
          onClose={dismissSignOut}
          className="nexusai-confirm"
          footer={(
            <div className="nexusai-actions">
              <Button variant="outline" disabled={busy} onClick={dismissSignOut}>{resolve('cancelAction')}</Button>
              <Button variant="primary" disabled={busy} onClick={() => { void confirmSignOut() }}>
                {busy ? <IconLoadingOutlineRegular size={14} className="nexusai-spinner" /> : null}
                {resolve('logout')}
              </Button>
            </div>
          )}
        >
          <style>{CONFIRM_CSS}</style>
          <p className="nexusai-note">
            {resolve(signOutImpact === 'unknown'
              ? 'signOutUnknown'
              : signOutImpact ? 'signOutRunning' : 'signOutIdle')}
          </p>
          {signOutError !== '' && (
            <p className="nexusai-alert is-error" role="alert">{signOutError}</p>
          )}
        </Modal>
      )}
      {error !== '' && wide === true && <div style={errorStyle} role="alert">{error}</div>}
    </>
  )
}

/**
 * Confirmation measurements only. The `nexusai-note` / `nexusai-alert` /
 * `nexusai-actions` rules are declared by the sign-in dialog's stylesheet;
 * the duplicates here keep this dialog self-contained (the launcher renders
 * with no other NexusAI surface on screen).
 */
const CONFIRM_CSS = `
.nexusai-confirm { width: 360px; max-width: calc(100vw - 32px); }
.nexusai-note { margin: 0 0 14px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.nexusai-alert { display: flex; flex-shrink: 0; align-items: flex-start; gap: 6px; margin: 0; padding: 8px 10px; border-radius: 8px; font-size: 13px; line-height: 18px; overflow-wrap: anywhere; }
.nexusai-alert.is-error { color: var(--dsw-alias-state-error-primary, #d33); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d33) 10%, transparent); }
.nexusai-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
@keyframes nexusai-spin { to { transform: rotate(360deg); } }
.nexusai-spinner { flex: none; animation: nexusai-spin 1s linear infinite; }
@media (prefers-reduced-motion: reduce) { .nexusai-spinner { animation: none; } }
`

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

/** The avatar disc. `cornerShape` is newer than the CSS typings, hence the widening. */
const avatarStyle: React.CSSProperties & { cornerShape?: string } = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: 32,
  height: 32,
  borderRadius: '50%',
  // dsh sets `corner-shape: superellipse(1.5)` at the root and the property
  // inherits, so a 50% radius paints a squircle unless it is reset here.
  cornerShape: 'round',
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
