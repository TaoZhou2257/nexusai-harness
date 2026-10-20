/**
 * The NexusAI sign-in dialog: the captcha login form presented through the
 * Modal primitive's built-in chrome (title row, close button, footer action
 * row), styled to the built-in SignInDialog's measurements. Opening the
 * dialog IS the intent to sign in — the attempt starts automatically on
 * mount, and cancelling closes in one step.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, IconCheckCircleOutlineRegular, IconLoadingOutlineRegular, IconShieldOutlineRegular, IconWarningOutlineRegular, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NexusaiLocaleKey } from './locales'
import { invalidateBranding } from './NexusaiBrand'
import type { BrandingFace } from './face'
import type { AuthViewFace, NexusaiAuthOps } from './face'

/** Phases in which the attempt is still running and owns the dialog. */
const ACTIVE_PHASES = new Set(['initializing', 'waiting-input', 'verifying', 'committing'])

/** Dialog dependencies, passed through from the injecting surface. */
export interface NexusaiSignInDialogProps {
  readonly auth: NexusaiAuthOps
  /** Live login projection; the dialog closes itself once `loggedIn`. */
  readonly getView: () => AuthViewFace | undefined
  readonly t: (key: NexusaiLocaleKey) => string
  readonly close: () => void
}

/**
 * Surface styling for the dialog, aligned with the built-in SignInDialog and
 * Modal measurements (332px content column, 13px labels, scrollable body).
 * Injected once per dialog mount; class names are nexusai-prefixed.
 */
const DIALOG_CSS = `
.nexusai-dialog { max-height: 100%; }
.nexusai-dialog-content { min-height: 0; flex: 1; overflow-y: auto; }
.nexusai-brand { display: flex; flex-direction: column; align-items: center; gap: 10px; margin: 4px 0 14px; }
.nexusai-logo { max-width: 76%; max-height: 44px; width: auto; height: auto; object-fit: contain; }
.nexusai-welcome { margin: 0; font-size: 13px; line-height: 19px; text-align: center; color: var(--dsw-alias-label-secondary); }
.nexusai-version { margin: 14px 0 0; font-size: 12px; line-height: 17px; text-align: center;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.nexusai-note { margin: 0 0 14px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.nexusai-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.nexusai-field > span { font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.nexusai-field input { width: 100%; box-sizing: border-box; }
.nexusai-server-row { position: relative; display: flex; align-items: center; }
.nexusai-server-row > :first-child { flex: 1; min-width: 0; }
.nexusai-server-row input { width: 100%; box-sizing: border-box; padding-right: 60px; }
.nexusai-server-row > button { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); }
.nexusai-captcha-row { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.nexusai-captcha-row .nexusai-captcha-input { flex: 1; min-width: 0; }
.nexusai-captcha-row .nexusai-captcha-input input { height: 48px; }
/* Server image is 80×40. Match that ratio so the glyphs are not stretched. */
.nexusai-captcha-img { flex: none; width: 80px; height: 40px; border-radius: 6px; border: 0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3)); background: #fff; cursor: pointer; object-fit: contain; }
.nexusai-captcha-loading { display: flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-secondary); }
.nexusai-alert { display: flex; flex-shrink: 0; align-items: flex-start; gap: 6px; margin: 0 0 12px; padding: 8px 10px; border-radius: 8px; font-size: 13px; line-height: 18px; overflow-wrap: anywhere; }
.nexusai-alert.is-error { color: var(--dsw-alias-state-error-primary, #d33); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d33) 10%, transparent); }
.nexusai-alert.is-ok { color: var(--dsw-alias-state-success-primary, #2a9d5c); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2a9d5c) 10%, transparent); }
.nexusai-alert svg { flex: none; margin-top: 1px; }
.nexusai-loading { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.nexusai-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
@keyframes nexusai-spin { to { transform: rotate(360deg); } }
.nexusai-spinner { flex: none; animation: nexusai-spin 1s linear infinite; }
@keyframes nexusai-shake { 0%, 100% { transform: translateX(0); } 20%, 60% { transform: translateX(-6px); } 40%, 80% { transform: translateX(6px); } }
.nexusai-shake-a, .nexusai-shake-b { animation: nexusai-shake 0.4s ease; }
.nexusai-field.is-invalid input, .nexusai-captcha-row.is-invalid input { border-color: var(--dsw-alias-state-error-primary, #d33); }
@media (prefers-reduced-motion: reduce) { .nexusai-spinner { animation: none; } .nexusai-shake-a, .nexusai-shake-b { animation: none; } }
`

/** The NexusAI captcha sign-in dialog. */
export function NexusaiSignInDialog({ auth, getView, t, close }: NexusaiSignInDialogProps): ReactNode {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [captchaCode, setCaptchaCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Field validation: empty fields get a red border + shake on submit (the
  // request is not sent); the flag clears as soon as the user types in that
  // field. The alternating tick re-triggers the shake on repeated clicks.
  const [invalid, setInvalid] = useState<{ username?: boolean; password?: boolean; captcha?: boolean }>({})
  const [shakeTick, setShakeTick] = useState(0)
  // The last failure's message, kept visible while a fresh attempt is auto-
  // restarted (the new attempt view carries no message, so the host's
  // attempt.message alone would flash away).
  const [lastError, setLastError] = useState('')
  const autoRetry = useRef<{ id: string; at: number } | undefined>(undefined)
  // Server field: loaded once, edited freely — nothing saves until the user
  // clicks 应用. The button enables only while the text differs from the
  // value currently in effect host-side. Applying runs a connectivity test
  // first; the button spins for the whole test+apply and the outcome derives
  // from appliedUrl vs serverError at render time (no transient flags that a
  // re-render could lose).
  const [serverUrl, setServerUrl] = useState('')
  const [appliedUrl, setAppliedUrl] = useState('')
  const [serverError, setServerError] = useState('')
  const [applying, setApplying] = useState(false)
  // Login-page branding, fetched from the server (GET /v1/base/custom, the
  // same source the web frontend renders from). Empty = show a bare 「登录」
  // with no hardcoded brand.
  const [productName, setProductName] = useState('')
  // The richer login-page branding from the same endpoint: logo, welcome line,
  // platform button color, version (about.version) and copyright.
  const [branding, setBranding] = useState<BrandingFace | undefined>(undefined)
  // Opening the dialog IS the intent to sign in: start the attempt once on
  // mount so the captcha form appears straight away, with no extra click.
  const autoStarted = useRef(false)

  const view = getView()
  const attempt = view?.attempt ?? null
  const waiting = attempt?.phase === 'waiting-input'
  const running = attempt !== null && ACTIVE_PHASES.has(attempt.phase)
  const booting = autoStarted.current && attempt === null
  const spinner = <IconLoadingOutlineRegular size={14} className="nexusai-spinner" />
  const serverDirty = serverUrl.trim() !== '' && serverUrl.trim() !== appliedUrl
  // Brand name from the server fills the {name} slot in the dialog copy; when
  // the server provides none, the bare variants keep the copy natural.
  const dialogTitle = productName === ''
    ? t('loginTitleBare')
    : t('loginTitle').replace('{name}', productName)
  const dialogHint = productName === ''
    ? t('loginHintBare')
    : t('loginHint').replace('{name}', productName)
  const welcome = (branding?.welcomeText ?? '').trim()
  // Version only (the platform's copyright line stays out of the dialog).
  const versionLine = (branding?.version ?? '').trim()
  // The platform configures its own login-button color; honor it when present.
  const loginButtonStyle = (branding?.buttonColor ?? '') !== ''
    ? { backgroundColor: branding?.buttonColor, borderColor: branding?.buttonColor }
    : undefined

  useEffect(() => {
    void auth.getBaseUrl().then(url => {
      setServerUrl(url)
      setAppliedUrl(url)
    }, () => undefined)
    void refreshBranding()
    if (autoStarted.current) return
    autoStarted.current = true
    const current = getView()
    if (current?.loggedIn === true) {
      close()
      return
    }
    const currentAttempt = current?.attempt ?? null
    if (currentAttempt === null || !ACTIVE_PHASES.has(currentAttempt.phase)) {
      auth.startSignIn().catch(cause => setError(errorMessage(cause)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A failed attempt keeps its message visible AND gets a fresh captcha
  // straight away: auto-restart once per attempt (throttled so a dead server
  // can't spin a retry loop). The form therefore never leaves the user.
  useEffect(() => {
    if (attempt?.phase !== 'failed' || attempt.message === undefined) return
    setLastError(attempt.message)
    if (autoRetry.current?.id === attempt.id) return
    if (autoRetry.current !== undefined && Date.now() - autoRetry.current.at < 5000) return
    autoRetry.current = { id: attempt.id, at: Date.now() }
    auth.startSignIn().catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt?.phase, attempt?.id, attempt?.message])

  // Success closes the dialog. The attempt phase only drops the form; the
  // parent keeps the modal mounted until this calls `close`.
  useEffect(() => {
    if (view?.loggedIn !== true) return
    setLastError('')
    close()
  }, [view?.loggedIn, close])

  /** Apply the edited server URL: connectivity test first, then save. */
  /** Pull the login-page branding of the address currently in effect. Called on
   * mount and again after 应用 — the dialog must show the new server's title,
   * logo, system name and version without being closed and reopened. */
  const refreshBranding = async (): Promise<void> => {
    try {
      const info = await auth.getBranding()
      setProductName(info.name)
      setBranding(info)
    } catch {
      // Branding is cosmetic; keep whatever we had.
    }
  }

  const applyServer = async (): Promise<void> => {
    const target = serverUrl.trim()
    if (target === '' || target === appliedUrl || applying) return
    setApplying(true)
    setServerError('')
    try {
      await auth.testBaseUrl(target)
      await auth.setBaseUrl(target)
      // The new server brings its own branding (title/logo/name/version) — the
      // dialog refreshes its own copy below, and this drops the shared cache so
      // the sidebar and the first-run hero follow along too.
      invalidateBranding()
      setAppliedUrl(target)
      await refreshBranding()
      const current = getView()
      const currentAttempt = current?.attempt ?? null
      if (currentAttempt?.phase === 'waiting-input') {
        // Same attempt, fresh captcha from the new address.
        await auth.refreshCaptcha(currentAttempt.id)
      } else if (currentAttempt !== null && (currentAttempt.phase === 'failed' || currentAttempt.phase === 'cancelled')) {
        // The old address's failure is stale — give the new one a fresh try.
        await auth.startSignIn()
      }
    } catch (cause) {
      // Test or save failed: the address in effect is unchanged.
      setServerError(errorMessage(cause))
    } finally {
      setApplying(false)
    }
  }

  const startSignIn = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await auth.startSignIn()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const submit = async (): Promise<void> => {
    if (attempt === null || attempt.phase !== 'waiting-input') return
    // Empty-field validation: mark, shake, and stay put — nothing is sent.
    const missing: { username?: boolean; password?: boolean; captcha?: boolean } = {}
    if (username.trim() === '') missing.username = true
    if (password === '') missing.password = true
    if (captchaCode.trim() === '') missing.captcha = true
    if (missing.username || missing.password || missing.captcha) {
      setInvalid(missing)
      setShakeTick(tick => tick + 1)
      return
    }
    setBusy(true)
    setError('')
    try {
      await auth.submit(attempt.id, username, password, captchaCode)
      // Keep the password on failure (the user retypes only the new captcha);
      // on success the dialog closes itself anyway.
      setCaptchaCode('')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const refreshCaptcha = async (): Promise<void> => {
    if (attempt === null) return
    setError('')
    try {
      await auth.refreshCaptcha(attempt.id)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  // Cancelling IS a dismissal: withdraw the attempt and close in one step.
  const cancelSignIn = async (): Promise<void> => {
    if (attempt === null) return
    setBusy(true)
    try {
      await auth.cancelSignIn(attempt.id)
      close()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const localMessage = error !== ''
    ? <p className="nexusai-alert is-error" role="alert"><IconWarningOutlineRegular size={14} />{error}</p>
    : null
  // Retained across the auto-restart that follows every failure: the fresh
  // attempt carries no message, but the user still needs to see why.
  const failureMessage = lastError !== '' && view?.loggedIn !== true
    ? <p className="nexusai-alert is-error" role="alert"><IconWarningOutlineRegular size={14} />{lastError}</p>
    : null

  return (
    <Modal
      open
      title={dialogTitle}
      closeLabel={t('close')}
      onClose={close}
      className="nexusai-dialog"
      contentClassName="nexusai-dialog-content"
      footer={(
        <div className="nexusai-actions">
          {running
            ? <Button variant="outline" disabled={busy} onClick={() => { void cancelSignIn() }}>{t('cancel')}</Button>
            : <Button variant="outline" disabled={busy} onClick={close}>{t('close')}</Button>}
          {running
            ? (
                <Button variant="primary" style={loginButtonStyle} disabled={busy || !waiting} onClick={() => { void submit() }}>
                  {busy ? spinner : null}
                  {t('login')}
                </Button>
              )
            : (
                <Button variant="primary" style={loginButtonStyle} disabled={busy} onClick={() => { void startSignIn() }}>{t('login')}</Button>
              )}
        </div>
      )}
    >
      <style>{DIALOG_CSS}</style>
      {branding !== undefined && branding.logoUrl !== '' && (
        <div className="nexusai-brand">
          <img
            className="nexusai-logo"
            src={branding.logoUrl}
            alt={productName}
            onError={event => { event.currentTarget.style.display = 'none' }}
          />
          {welcome !== '' && <p className="nexusai-welcome">{welcome}</p>}
        </div>
      )}
      <p className="nexusai-note">{dialogHint}</p>
      <div className="nexusai-field">
        <span>{t('server')}</span>
        <div className="nexusai-server-row">
          <Input
            value={serverUrl}
            spellCheck={false}
            onChange={event => {
              setServerUrl(event.target.value)
              setServerError('')
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!serverDirty || applying}
            onClick={() => { void applyServer() }}
          >
            {applying ? spinner : t('apply')}
          </Button>
        </div>
        {serverError === '' && appliedUrl !== '' && !serverDirty && (
          <p className="nexusai-alert is-ok" role="status"><IconCheckCircleOutlineRegular size={14} />{t('connected')}</p>
        )}
      </div>
      {(attempt?.phase === 'verifying' || attempt?.phase === 'committing' || attempt?.phase === 'initializing' || booting) && (
        <div className="nexusai-loading">{spinner}{t('loading')}</div>
      )}
      {waiting && (
        <>
          <label className={'nexusai-field' + (invalid.username ? ' is-invalid' : '') + (invalid.username ? (shakeTick % 2 === 0 ? ' nexusai-shake-a' : ' nexusai-shake-b') : '')}>
            <span>{t('username')}</span>
            <Input value={username} onChange={event => { setUsername(event.target.value); setInvalid(current => ({ ...current, username: false })) }} />
          </label>
          <label className={'nexusai-field' + (invalid.password ? ' is-invalid' : '') + (invalid.password ? (shakeTick % 2 === 0 ? ' nexusai-shake-a' : ' nexusai-shake-b') : '')}>
            <span>{t('password')}</span>
            <Input type="password" value={password} onChange={event => { setPassword(event.target.value); setInvalid(current => ({ ...current, password: false })) }} />
          </label>
          <div className={'nexusai-captcha-row' + (invalid.captcha ? ' is-invalid' : '') + (invalid.captcha ? (shakeTick % 2 === 0 ? ' nexusai-shake-a' : ' nexusai-shake-b') : '')}>
            <Input
              className="nexusai-captcha-input"
              icon={<IconShieldOutlineRegular size={16} />}
              placeholder={t('captcha')}
              value={captchaCode}
              onChange={event => { setCaptchaCode(event.target.value); setInvalid(current => ({ ...current, captcha: false })) }}
              onKeyDown={event => { if (event.key === 'Enter') void submit() }}
            />
            {attempt.captchaB64 !== undefined && attempt.captchaB64 !== ''
              ? (
                  // The bff's `b64` is already a complete data URI; click to refresh.
                  <img
                    className="nexusai-captcha-img"
                    src={attempt.captchaB64}
                    alt={t('captcha')}
                    title={t('refreshCaptcha')}
                    onClick={() => { void refreshCaptcha() }}
                  />
                )
              : <span className="nexusai-captcha-img nexusai-captcha-loading" title={t('refreshCaptcha')} onClick={() => { void refreshCaptcha() }}>{spinner}</span>}
          </div>
        </>
      )}
      {/* Errors render below the form so the inputs always stay in view. */}
      {failureMessage}
      {localMessage}
      {serverError !== '' && (
        <p className="nexusai-alert is-error" role="alert"><IconWarningOutlineRegular size={14} />{serverError}</p>
      )}
      {/* Platform version from `about` in the same branding payload. */}
      {versionLine !== '' && <p className="nexusai-version">{versionLine}</p>}
    </Modal>
  )
}

function errorMessage(cause: unknown): string {
  const message = (cause as { message?: string; error?: { message?: string } })?.error?.message
    ?? (cause as { message?: string })?.message
    ?? String(cause)
  return message.replace(/^client api: /, '')
}
