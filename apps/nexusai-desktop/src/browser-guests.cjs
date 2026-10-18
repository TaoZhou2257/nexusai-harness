/**
 * Main-process owner for the right-sidebar browser's Electron `<webview>` guests.
 *
 * Same lease, partition, and navigation rules as dsh's desktop shell
 * (`apps/desktop/src/browser-guests.ts`). This carrier loads the web profile
 * over loopback, so the allowed IPC origin is that page, not `dsh-app://`.
 */
const { randomUUID } = require('node:crypto')
const { app, session } = require('electron')

const OPEN_REQUESTED = 'nexusai:browser-open-requested'

function createBrowserGuests(hostUrl) {
  const partitions = new Map()
  const leases = new Map()

  function isApplicationHost(url) {
    const value = hostUrl()
    if (value === undefined) return false
    const host = new URL(value)
    return url.port === host.port
      && (url.hostname === host.hostname || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  }

  function allowedNavigation(value) {
    if (!URL.canParse(value)) return false
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && url.username === '' && url.password === ''
      && !isApplicationHost(url)
  }

  function configureSession(browserSession) {
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false) })
    browserSession.setPermissionCheckHandler(() => false)
    browserSession.setDevicePermissionHandler(() => false)
    browserSession.setDisplayMediaRequestHandler((_request, callback) => { callback({}) })
    browserSession.on('will-download', (event) => { event.preventDefault() })
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url)
      const network = ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)
      callback({
        cancel: network
          ? url.username !== '' || url.password !== '' || isApplicationHost(url)
          : !['about:', 'data:', 'blob:'].includes(url.protocol),
      })
    })
  }

  async function release(owner, id) {
    if (typeof id !== 'string') throw new Error('desktop browser: invalid guest lease')
    const lease = leases.get(id)
    if (lease === undefined) return
    if (lease.owner !== owner) throw new Error('desktop browser: guest belongs to another window')
    lease.releaseInput?.()
    leases.delete(id)
    const guest = lease.guest
    if (guest !== undefined && !guest.isDestroyed()) {
      const destroyed = new Promise((resolve) => { guest.once('destroyed', resolve) })
      guest.close({ waitForBeforeUnload: false })
      await destroyed
    }
  }

  function acquire(owner, workspace) {
    if (typeof workspace !== 'string' || workspace.length === 0 || workspace.length > 4096) {
      throw new Error('desktop browser: a workspace storage identity is required')
    }
    let partition = partitions.get(workspace)
    if (partition === undefined) {
      partition = `dsh-sidebar-browser-${randomUUID()}`
      configureSession(session.fromPartition(partition))
      partitions.set(workspace, partition)
    }
    const lease = randomUUID()
    leases.set(lease, { owner, partition, attached: false })
    return { lease, partition }
  }

  function bind(window, attachInput) {
    const owner = window.webContents
    owner.on('will-attach-webview', (event, preferences, params) => {
      const id = typeof params.src === 'string' && params.src.startsWith('about:blank#')
        ? params.src.slice('about:blank#'.length) : ''
      const lease = leases.get(id)
      if (lease === undefined || lease.owner !== owner || lease.attached || params.partition !== lease.partition) {
        event.preventDefault()
        return
      }
      lease.attached = true
      for (const key of Object.keys(preferences)) {
        if (key !== 'disablePopups') Reflect.deleteProperty(preferences, key)
      }
      Object.assign(preferences, {
        partition: lease.partition,
        nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
        contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
        webviewTag: false, plugins: false, navigateOnDragDrop: false, disableDialogs: true,
        devTools: !app.isPackaged,
      })
      params.httpreferrer = ''
    })
    owner.on('did-attach-webview', (_event, guest) => {
      let attachedLease
      guest.once('dom-ready', () => {
        const url = guest.getURL()
        const id = url.startsWith('about:blank#') ? url.slice('about:blank#'.length) : ''
        const lease = leases.get(id)
        if (lease === undefined || lease.owner !== owner || lease.guest !== undefined) {
          guest.close({ waitForBeforeUnload: false })
          return
        }
        lease.guest = guest
        attachedLease = id
        lease.releaseInput = attachInput(guest, id)
        guest.once('destroyed', () => { lease.releaseInput?.(); leases.delete(id) })
      })
      guest.setWindowOpenHandler(({ url, postBody }) => {
        const lease = attachedLease === undefined ? undefined : leases.get(attachedLease)
        if (attachedLease !== undefined && lease?.guest === guest && lease.owner === owner && !owner.isDestroyed()
          && postBody === undefined && allowedNavigation(url)) {
          owner.send(OPEN_REQUESTED, { lease: attachedLease, url: new URL(url).href })
        }
        return { action: 'deny' }
      })
      guest.on('will-frame-navigate', (event) => {
        if (event.isMainFrame && !allowedNavigation(event.url)) event.preventDefault()
      })
      guest.on('will-redirect', (event, url, _inPlace, mainFrame) => {
        if (mainFrame && !allowedNavigation(url)) event.preventDefault()
      })
      guest.on('will-attach-webview', (event) => { event.preventDefault() })
      guest.on('login', (event, _details, _authInfo, callback) => { event.preventDefault(); callback() })
    })
    const releaseAll = () => {
      for (const [id, lease] of leases) {
        if (lease.owner === owner) void release(owner, id).catch((error) => { console.error(error) })
      }
    }
    owner.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) releaseAll()
    })
    owner.on('render-process-gone', releaseAll)
    owner.once('destroyed', releaseAll)
  }

  return { acquire, release, bind }
}

module.exports = { createBrowserGuests, OPEN_REQUESTED }
