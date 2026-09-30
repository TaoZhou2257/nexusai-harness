/**
 * The NexusAI settings section: the capability console (custom tools, MCP
 * servers, downloadable skills) that used to live in the sidebar panel,
 * re-homed as a `settings.section` entry so the sidebar layout stays
 * untouched. Signed out, it shows a hint plus the sign-in dialog trigger.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { NexusaiSignInDialog } from './NexusaiSignInDialog'
import type { NexusaiLocaleKey } from './locales'
import type { NexusaiAuthOps, NexusaiCapabilitiesOps, NexusaiSnapshot } from './face'

/** The section's spread props: owner close, framework hooks, and the inject controller. */
export interface NexusaiSectionProps {
  readonly close?: () => void
  readonly useNexusai?: (selector: (snapshot: NexusaiSnapshot) => NexusaiSnapshot) => NexusaiSnapshot
  readonly auth?: NexusaiAuthOps
  readonly capabilities?: NexusaiCapabilitiesOps
  readonly t?: (key: NexusaiLocaleKey) => string
}

/** The NexusAI capability console inside the settings panel. */
export function NexusaiSection({ useNexusai, auth, capabilities, t }: NexusaiSectionProps): ReactNode {
  const resolve = (key: NexusaiLocaleKey) => t?.(key) ?? key
  const snapshot = useNexusai?.(value => value)
  const view = snapshot?.view
  const signedIn = view?.loggedIn === true
  const [tools, setTools] = useState<{ name: string; description: string }[]>([])
  const [mcpServers, setMcpServers] = useState<{ name: string; desc: string; toolNum: number }[]>([])
  const [skills, setSkills] = useState<{ skillId: string; name: string; description: string }[]>([])
  const [downloaded, setDownloaded] = useState<Record<string, string>>({})
  const [syncNote, setSyncNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    if (!signedIn || capabilities === undefined) return
    void capabilities.listCustomTools().then(list => setTools(list ?? []), () => setTools([]))
    void capabilities.listMcpServers().then(list => setMcpServers(list ?? []), () => setMcpServers([]))
    void capabilities.listSkills().then(list => setSkills(list ?? []), () => setSkills([]))
  }, [signedIn, capabilities])

  if (!signedIn || auth === undefined || capabilities === undefined) {
    return (
      <div style={pageStyle}>
        <div style={{ opacity: 0.7, marginBottom: 12 }}>{resolve('signedOutHint')}</div>
        <Button variant="primary" onClick={() => { setDialogOpen(true) }}>{resolve('login')}</Button>
        {snapshot?.failed === true && (
          <div style={errorStyle}>{resolve('notLoggedIn')}</div>
        )}
        {dialogOpen && auth !== undefined && (
          <NexusaiSignInDialog auth={auth} getView={() => snapshot?.view} t={resolve} close={() => { setDialogOpen(false) }} />
        )}
      </div>
    )
  }

  const sync = async (): Promise<void> => {
    setBusy(true)
    setError('')
    setSyncNote('')
    try {
      const report = await capabilities.sync()
      setSyncNote(`${resolve('tools')}: ${report.tools} · ${resolve('mcpServers')}: ${report.mcpServers}`
        + (report.errors.length > 0 ? ` · ⚠ ${report.errors.length}` : ''))
      setTools(await capabilities.listCustomTools() ?? [])
      setMcpServers(await capabilities.listMcpServers() ?? [])
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const download = async (skillId: string): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const result = await capabilities.downloadSkill(skillId)
      setDownloaded(current => ({ ...current, [skillId]: result.path }))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const logout = async (): Promise<void> => {
    setBusy(true)
    try {
      await auth.logout()
      setTools([])
      setMcpServers([])
      setSkills([])
      setDownloaded({})
      setSyncNote('')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={pageStyle}>
      <div style={{ marginBottom: 10 }}>
        {resolve('loggedInAs')}: <strong>{view.nickname || view.username}</strong>
        {view.expiresAt !== undefined && (
          <span style={{ marginLeft: 12, opacity: 0.7 }}>
            {resolve('expires')} {new Date(view.expiresAt).toLocaleString()}
          </span>
        )}
      </div>
      {(view.orgs?.length ?? 0) > 1 && (
        <label style={{ display: 'block', marginBottom: 10 }}>
          <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 4 }}>{resolve('org')}</div>
          <select
            value={view.orgId}
            style={selectStyle}
            onChange={event => {
              const orgId = event.target.value
              setBusy(true)
              void auth.selectOrg(orgId).catch(cause => setError(errorMessage(cause))).finally(() => setBusy(false))
            }}
          >
            {(view.orgs ?? []).map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
          </select>
        </label>
      )}
      <div style={{ display: 'flex', gap: 10, margin: '10px 0' }}>
        <Button variant="outline" disabled={busy} onClick={() => { void sync() }}>{busy ? resolve('syncing') : resolve('sync')}</Button>
        <Button variant="outline" disabled={busy} onClick={() => { void logout() }}>{resolve('logout')}</Button>
      </div>
      {syncNote !== '' && <div style={{ opacity: 0.8, marginBottom: 8, fontSize: 13 }}>{syncNote}</div>}
      {error !== '' && <div style={errorStyle} role="alert">{error}</div>}

      <section style={sectionStyle}>
        <h3 style={headingStyle}>{resolve('tools')} ({tools.length})</h3>
        {tools.map(tool => (
          <div key={tool.name} style={{ marginBottom: 6, fontSize: 13 }}>
            <strong>{tool.name}</strong>
            {tool.description !== '' && <span style={{ opacity: 0.7 }}> — {tool.description}</span>}
          </div>
        ))}
        {tools.length === 0 && <div style={{ opacity: 0.6, fontSize: 13 }}>{resolve('notLoggedIn')}</div>}
      </section>

      <section style={sectionStyle}>
        <h3 style={headingStyle}>{resolve('mcpServers')} ({mcpServers.length})</h3>
        {mcpServers.map(server => (
          <div key={server.name} style={{ marginBottom: 6, fontSize: 13 }}>
            <strong>{server.name}</strong>
            <span style={{ opacity: 0.7 }}> — {server.toolNum} tools</span>
          </div>
        ))}
      </section>

      <section style={sectionStyle}>
        <h3 style={headingStyle}>{resolve('skills')} ({skills.length})</h3>
        {skills.map(skill => (
          <div key={skill.skillId} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, fontSize: 13 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{skill.name}</strong>
              {skill.description !== '' && <span style={{ opacity: 0.7 }}> — {skill.description}</span>}
              {downloaded[skill.skillId] !== undefined && (
                <div style={{ opacity: 0.6, fontSize: 12 }}>{resolve('downloaded')}: {downloaded[skill.skillId]}</div>
              )}
            </div>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => { void download(skill.skillId) }}>
              {downloaded[skill.skillId] !== undefined ? resolve('downloaded') : resolve('download')}
            </Button>
          </div>
        ))}
      </section>
    </div>
  )
}

const pageStyle: React.CSSProperties = { padding: '4px 0', maxWidth: 640 }

const sectionStyle: React.CSSProperties = {
  borderTop: '1px solid var(--dsw-alias-border-primary, rgba(128, 128, 128, 0.2))',
  padding: '12px 0',
}

const headingStyle: React.CSSProperties = { margin: '0 0 8px', fontSize: 14 }

const selectStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-primary, rgba(128, 128, 128, 0.4))',
}

const errorStyle: React.CSSProperties = {
  color: 'var(--dsw-alias-state-error-primary, #d33)',
  fontSize: 13,
  margin: '8px 0',
}

function errorMessage(cause: unknown): string {
  const message = (cause as { message?: string; error?: { message?: string } })?.error?.message
    ?? (cause as { message?: string })?.message
    ?? String(cause)
  return message.replace(/^client api: /, '')
}
