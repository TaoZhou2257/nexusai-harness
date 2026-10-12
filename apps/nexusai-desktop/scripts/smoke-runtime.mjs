#!/usr/bin/env node
/**
 * Headless check that the bundled runtime actually boots.
 *
 * `prepare-runtime.mjs` proves the profile *composes* (`--dump-config`); this
 * proves it *runs*: it starts the bundled dsh CLI exactly the way the shell
 * does, waits for the `dsh web: http://127.0.0.1:<port>/?token=…` line, then
 * shuts it down. That is the check CI can make on a machine with no display,
 * and the closest thing to "the app would have opened a window".
 *
 * Usage: node scripts/smoke-runtime.mjs [--target=mac-arm64|win-x64] [--timeout=120]
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = resolve(SCRIPT_DIR, '..')
const BUILD = join(APP_ROOT, 'build')
const PROFILE = join(BUILD, 'profile')
const PROFILE_NAME = 'nexusai'
const READY_PATTERN = /dsh web:\s+http:\/\/127\.0\.0\.1:(\d+)\/?\?token=/

const args = process.argv.slice(2)
const argValue = (name, fallback) => {
  const hit = args.find(a => a.startsWith(`--${name}=`))
  return hit === undefined ? fallback : hit.slice(`--${name}=`.length)
}
const timeoutSeconds = Number(argValue('timeout', '120'))
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) throw new Error('--timeout must be a positive number')

const cli = join(PROFILE, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
if (!existsSync(cli)) throw new Error(`bundled dsh CLI is missing: ${cli} — run prepare:runtime first`)

// A throwaway home, laid out the way the shell lays it out on first launch.
const home = join(BUILD, 'smoke-home')
rmSync(home, { recursive: true, force: true })
const profileLink = join(home, 'profiles', PROFILE_NAME)
mkdirSync(join(home, 'profiles'), { recursive: true })
symlinkSync(PROFILE, profileLink, process.platform === 'win32' ? 'junction' : 'dir')

const version = readFileSync(join(BUILD, 'runtime-version.txt'), 'utf8').trim()
console.log(`smoke: bundling ${version}`)
console.log(`smoke: starting the bundled dsh on ${home}`)

const child = spawn(process.execPath, [cli, '--profile', PROFILE_NAME, '--no-open'], {
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: process.env.NEXUSAI_SMOKE_ELECTRON_RUN_AS_NODE ?? process.env.ELECTRON_RUN_AS_NODE,
    DSH_HOME: home,
    DSH_AGENTS_HOME: join(home, 'agents'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
let settled = false
const finish = (code, message) => {
  if (settled) return
  settled = true
  child.kill('SIGTERM')
  console.log(message)
  process.exitCode = code
}
child.stdout.on('data', chunk => {
  const text = chunk.toString('utf8')
  output = `${output}${text}`.slice(-32_768)
  const match = READY_PATTERN.exec(output)
  if (match) finish(0, `smoke: ok — dsh web listening on 127.0.0.1:${match[1]}`)
})
child.stdout.on('data', () => {})
child.stderr.on('data', chunk => { process.stderr.write(chunk) })
child.once('error', cause => finish(1, `smoke: failed to spawn: ${cause.message}`))
child.once('exit', code => finish(1, `smoke: runtime exited early with ${String(code)}\n${output.slice(-2000)}`))

setTimeout(() => finish(1, `smoke: no ready line within ${timeoutSeconds}s\n${output.slice(-4000)}`), timeoutSeconds * 1000)
