#!/usr/bin/env node
/**
 * Evaluate a JavaScript expression inside the running dsh desktop renderer
 * (the `dsh-app` page) via the Chrome DevTools Protocol and print the result.
 *
 * Usage:
 *   node scripts/verify/cdp-eval.mjs "<expression>"
 *   node scripts/verify/cdp-eval.mjs <cdp-target-id> "<expression>"
 *
 * Start the desktop first (`pnpm run start:desktop` in the dsh repo) — its
 * log prints the renderer inspector port (9222) and the page target id.
 */
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const targetId = args.length > 1 ? args[0] : undefined
const expression = args.length > 1 ? args.slice(1).join(' ') : args[0]
if (expression === undefined || expression === '') {
  console.error('usage: cdp-eval.mjs [targetId] "<expression>"')
  process.exit(1)
}

const list = await (await fetch(`http://127.0.0.1:${process.env.DSH_CDP_PORT ?? '9222'}/json/list`)).json()
const target = (targetId !== undefined ? list.find(t => t.id === targetId) : undefined)
  ?? list.find(t => t.type === 'page' && t.url.includes('dsh-app'))
if (target === undefined) {
  console.error('no dsh-app page target — is the desktop running?')
  for (const t of list) console.error(`  ${t.type} | ${t.url.slice(0, 60)} | ${t.id}`)
  process.exit(1)
}

const ws = new WebSocket(target.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const call = (method, params) => new Promise((resolve, reject) => {
  const id = ++seq
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params }))
})
ws.onmessage = event => {
  const message = JSON.parse(event.data)
  if (message.id !== undefined && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error !== undefined) reject(new Error(message.error.message))
    else resolve(message.result)
  }
}
await new Promise(resolve => { ws.onopen = resolve })
await call('Runtime.enable', {})

const result = await call('Runtime.evaluate', {
  expression,
  returnByValue: true,
  awaitPromise: true,
})
if (result.exceptionDetails !== undefined) {
  console.error('EXCEPTION:', result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails))
  process.exitCode = 1
} else {
  console.log(JSON.stringify(result.result.value, null, 2))
}
ws.close()
process.exit(0)
