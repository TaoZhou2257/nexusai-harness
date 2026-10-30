/**
 * Is the plugin's browser half actually mounted in the running app?
 *
 * The acceptance gates used to answer this by asserting that the sign-in dialog
 * had appeared — that only worked while the launcher opened it on its own. Sign-in
 * is user-driven now, so the evidence is a stable marker the launcher carries
 * (`data-nexusai="launcher"`), which is independent of copy, locale and state.
 *
 * Usage: node scripts/check-client-mounted.mjs <port> [waitMs]
 */
const port = process.argv[2] ?? '9224'
const waitMs = Number(process.argv[3] ?? '3000')

// The DevTools HTTP endpoint comes up slightly after the main process does, so
// the target fetch retries within the wait budget — a connection that is not
// ready yet must not read as "the client did not mount" (that flake failed a
// whole release: the win customer gate died 0.2s in, before the in-page wait
// even started).
const deadline = Date.now() + waitMs
let page
for (;;) {
  let targets = []
  try {
    targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  } catch { /* endpoint not accepting yet */ }
  page = targets.find(target => target.type === 'page' && target.url.includes('127.0.0.1'))
  if (page !== undefined || Date.now() >= deadline) break
  await new Promise(resolve => setTimeout(resolve, 500))
}
if (page === undefined) {
  console.error(`no renderer page on ${port} within ${waitMs}ms`)
  process.exit(2)
}
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise(resolve => { socket.onopen = resolve })
const evaluate = expression => new Promise(resolve => {
  const id = Math.floor(Math.random() * 1e6)
  const listener = event => {
    const message = JSON.parse(event.data)
    if (message.id !== id) return
    socket.removeEventListener('message', listener)
    resolve(message.result?.result?.value)
  }
  socket.addEventListener('message', listener)
  socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
})

const result = await evaluate(`(async () => {
  await new Promise(r => setTimeout(r, ${waitMs}));
  return JSON.stringify({
    launcher: document.querySelectorAll('[data-nexusai="launcher"]').length,
    signInDialog: document.querySelectorAll('.nexusai-dialog').length,
    lang: document.documentElement.lang
  });
})()`)
console.log(result)
socket.close()
