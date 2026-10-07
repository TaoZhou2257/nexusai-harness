#!/usr/bin/env node
/**
 * Fail when the installed dsh version drifts from the recorded baseline —
 * the plugin targets the baseline's slot/API signatures, and an upstream
 * upgrade must be a conscious re-verification, never a silent drift.
 *
 * The installed version is resolved through node_modules/@deepseek-ai
 * (the symlink described in HANDOFF.md), i.e. exactly what `tsc` sees.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8'))
const baseline = pkg.dsh?.dshBaseline
if (!baseline) {
  console.error('check-dsh-version: package.json has no dsh.dshBaseline field')
  process.exit(1)
}

const require = createRequire(`${root}package.json`)
let installed
try {
  installed = JSON.parse(readFileSync(`${root}node_modules/@deepseek-ai/dsh-client-ui-primitives/package.json`, 'utf8')).version
} catch {
  console.error('check-dsh-version: @deepseek-ai/dsh-client-ui-primitives not found — is node_modules/@deepseek-ai linked to the dsh installation?')
  process.exit(1)
}

if (installed !== baseline) {
  console.error(`check-dsh-version: installed dsh ${installed} != baseline ${baseline}`)
  console.error('  the plugin targets the baseline; re-run tsc and re-verify the CDP flows after upgrading dsh, then bump dsh.dshBaseline')
  process.exit(1)
}
console.log(`check-dsh-version: ok (dsh ${installed})`)
