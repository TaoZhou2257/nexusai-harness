/**
 * One-off check: does the sign-in dialog open on its own when the app starts
 * signed out? Connects to the shell's renderer over CDP and counts our modal.
 *
 * Usage: node scripts/check-auto-signin.mjs <port> [waitMs]
 */
const port = process.argv[2] ?? '9224'
const waitMs = Number(process.argv[3] ?? '6000')

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find(target => target.type === 'page' && target.url.includes('127.0.0.1'))
if (page === undefined) {
  console.error(`no renderer page on port ${port}; targets: ${list.map(t => `${t.type}:${t.url}`).join(', ')}`)
  process.exit(2)
}
const socket = new WebSocket(page.webSocketDebuggerUrl)
const send = (id, method, params) => socket.send(JSON.stringify({ id, method, params }))
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
  send(id, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
})

const expression = `(async () => {
  await new Promise(r => setTimeout(r, ${waitMs}));
  const dialogs = document.querySelectorAll('.nexusai-dialog').length;
  const launcher = document.querySelectorAll('[aria-label], [title]');
  const signInLabels = [...launcher].filter(el => /登录/.test(el.getAttribute('aria-label') || el.getAttribute('title') || '')).length;
  return JSON.stringify({ dialogs, signInLabels, url: location.href.replace(/token=.*/, 'token=…') });
})()`
console.log(await evaluate(expression))
socket.close()