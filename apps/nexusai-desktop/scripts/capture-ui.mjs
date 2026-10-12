/**
 * Capture the running app's UI over CDP, for docs and for verifying what a
 * first run actually looks like.
 *
 * The screenshot comes from the renderer, not the desktop: it shows exactly the
 * app's own content (no wallpaper, no other windows), which is what makes it
 * safe to attach to a report.
 *
 * Usage: node scripts/capture-ui.mjs <port> <out.png> [waitMs] [--close-dialog]
 */
import { writeFileSync } from 'node:fs'

const port = process.argv[2] ?? '9224'
const out = process.argv[3] ?? 'build/screenshot.png'
const waitMs = Number(process.argv[4] ?? '2000')
const closeDialog = process.argv.includes('--close-dialog')

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = targets.find(target => target.type === 'page' && target.url.includes('127.0.0.1'))
if (page === undefined) {
  console.error(`no renderer page on ${port}: ${targets.map(t => `${t.type}:${t.url}`).join(', ')}`)
  process.exit(2)
}

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise(resolve => { socket.onopen = resolve })
let seq = 0
const call = (method, params) => new Promise(resolve => {
  const id = ++seq
  const listener = event => {
    const message = JSON.parse(event.data)
    if (message.id !== id) return
    socket.removeEventListener('message', listener)
    resolve(message.result ?? message.error)
  }
  socket.addEventListener('message', listener)
  socket.send(JSON.stringify({ id, method, params }))
})

await call('Page.enable')
if (closeDialog) {
  const closed = await call('Runtime.evaluate', {
    expression: `(() => { const b = [...document.querySelectorAll('button')].find(x => /关闭|Close/.test(x.getAttribute('aria-label') || '')); if (b) b.click(); return !!b })()`,
    returnByValue: true,
  })
  console.log(`dismiss dialog: ${JSON.stringify(closed?.result?.value)}`)
}
await new Promise(resolve => setTimeout(resolve, waitMs))
const state = await call('Runtime.evaluate', {
  expression: `JSON.stringify({ dialogs: document.querySelectorAll('.nexusai-dialog').length, title: document.title })`,
  returnByValue: true,
})
const shot = await call('Page.captureScreenshot', { format: 'png' })
if (typeof shot?.data !== 'string') throw new Error(`capture failed: ${JSON.stringify(shot)}`)
writeFileSync(out, Buffer.from(shot.data, 'base64'))
console.log(`state ${state?.result?.value} → ${out}`)
socket.close()