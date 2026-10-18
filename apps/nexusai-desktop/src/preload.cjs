/**
 * Desktop bridge for the shared dsh UI.
 *
 * `data-platform=darwin` mounts the sidebar top strip and hides the column
 * when it is collapsed. The shortcuts plugin treats that mark as the desktop
 * runtime and refuses to start unless `window.dshDesktop.keyboard` exists.
 *
 * `protocolVersion: 1` plus `dshDesktop.browser` is what switches the right
 * sidebar onto Electron `<webview>` guests. The main process owns the leases.
 */
const { contextBridge, ipcRenderer } = require('electron')

const revision = crypto.randomUUID()
let sequence = 1

function snapshot() {
  return {
    revision,
    sequence,
    document: { schemaVersion: 1, profiles: {} },
    status: 'ready',
    error: null,
    usingDefaults: true,
  }
}

function createBrowserBridge() {
  const listeners = new Map()
  ipcRenderer.on('nexusai:browser-open-requested', (_event, request) => {
    if (typeof request !== 'object' || request === null || !('lease' in request) || !('url' in request)
      || typeof request.lease !== 'string' || typeof request.url !== 'string') return
    const callbacks = listeners.get(request.lease)
    if (callbacks === undefined) return
    for (const callback of [...callbacks]) {
      try { callback(request.url) } catch (error) { console.error('Desktop browser link handler failed', error) }
    }
  })
  return {
    acquire: (workspace) => ipcRenderer.invoke('nexusai:browser-acquire', workspace),
    release: (lease) => ipcRenderer.invoke('nexusai:browser-release', lease),
    onOpenRequested(lease, listener) {
      let callbacks = listeners.get(lease)
      if (callbacks === undefined) {
        callbacks = new Set()
        listeners.set(lease, callbacks)
      }
      callbacks.add(listener)
      return () => {
        callbacks.delete(listener)
        if (callbacks.size === 0 && listeners.get(lease) === callbacks) listeners.delete(lease)
      }
    },
  }
}

function markPlatform() {
  if (process.platform !== 'darwin') return
  const root = document.documentElement
  if (root === null) {
    window.addEventListener('DOMContentLoaded', markPlatform)
    return
  }
  root.dataset.platform = 'darwin'
  delete root.dataset.nexusaiHiddenInset
}

function mirrorFullscreen(fullscreen) {
  const root = document.documentElement
  if (root === null) return
  if (fullscreen) root.dataset.fullscreen = 'true'
  else delete root.dataset.fullscreen
}

const desktop = {
  protocolVersion: 1,
  browser: createBrowserBridge(),
}

if (process.platform === 'darwin') {
  const listeners = new Set()
  desktop.keyboard = {
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    closeWindow() {
      window.close()
      return Promise.resolve()
    },
  }
  desktop.shortcuts = {
    get() { return Promise.resolve(snapshot()) },
    edit() { return Promise.resolve({ status: 'not-ready', snapshot: snapshot() }) },
    subscribe() { return () => {} },
    recording() { return Promise.resolve() },
  }
  window.addEventListener('keydown', (event) => {
    const input = {
      revision,
      kind: 'keyboard',
      frameName: '',
      code: event.code,
      control: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      meta: event.metaKey,
      repeat: event.repeat,
    }
    for (const listener of listeners) {
      try { listener(input) } catch { /* page handler owns its own errors */ }
    }
  })
  ipcRenderer.on('nexusai:fullscreen', (_event, fullscreen) => { mirrorFullscreen(fullscreen) })
}

contextBridge.exposeInMainWorld('dshDesktop', desktop)
markPlatform()
