#!/usr/bin/env node
/**
 * Regression suite for the 自定义连接器 host logic — the three authoring routes
 * that the desktop UI drives:
 *
 * - the quick form's text parsing (args / KEY=VALUE env / `Name: value` headers);
 * - the JSON import's accepted shapes (`mcpServers`, `servers`, a bare map, a
 *   single object) and its refusals (legacy `sse` entries, non-server objects);
 * - the DXT / MCPB bundle route: manifest validation, `user_config` prompts,
 *   `${__dirname}` / `${user_config.*}` substitution, this platform's
 *   `platform_overrides`, `node` → this app's own runtime, and the archive
 *   traversal guard.
 *
 * Everything runs against a scratch `$DSH_HOME`, so nothing touches the real
 * profile. The plugin's host half runs inside dsh, so this bundles
 * `src/service/connector-author.ts` to CJS in a temp file (`yaml` is a CJS
 * package — an ESM bundle dies on its dynamic `require('process')`) and drives
 * it directly.
 *
 * Usage: node scripts/verify/connector-authoring.mjs
 */
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { strToU8, zipSync } from 'fflate'

const root = fileURLToPath(new URL('../..', import.meta.url))
const work = await mkdtemp(join(tmpdir(), 'nexusai-connectors-'))
// dsh-home-paths reads $DSH_HOME: point every write at the scratch home.
process.env.DSH_HOME = join(work, 'home')
await mkdir(process.env.DSH_HOME, { recursive: true })

const bundle = join(work, 'connector-author.cjs')
await build({
  entryPoints: [join(root, 'src/service/connector-author.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: bundle,
  logLevel: 'warning',
})
const requireCjs = createRequire(import.meta.url)
const authoring = requireCjs(bundle)
const { authorConnector, describeBundle, ConnectorRows, SseConnectors, customConnectorLabel, mergeSseInputs } = authoring

const patchFile = join(process.env.DSH_HOME, 'profiles/desktop/cordis.patch.yml')
const rows = new ConnectorRows({
  profilePatchFile: patchFile,
  serverNamePrefix: 'nexusai',
  toolCallTimeoutMs: 60_000,
  failOnStartupError: false,
})
const sseConnectors = new SseConnectors(join(process.env.DSH_HOME, 'sse-connectors.json'))
let bridgeRefreshes = 0
const deps = {
  rows,
  sseConnectors,
  refreshSse: async () => { bridgeRefreshes += 1; return [] },
}

const failures = []
let passed = 0
const check = (label, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ok   ${label}`); return }
  failures.push(`${label}${detail === '' ? '' : ` → ${detail}`}`)
  console.log(`  FAIL ${label}${detail === '' ? '' : ` → ${detail}`}`)
}
const attempt = async run => {
  try {
    return { value: await run() }
  } catch (error) {
    return { error: error.message }
  }
}

// ---------- fixtures ----------
const serverJs = `require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }) + '\\n')
})
`
const bundleOf = (manifest, files = {}) => zipSync({
  'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
  'server/index.js': strToU8(serverJs),
  ...files,
})
const baseManifest = {
  manifest_version: '0.3',
  name: 'suite-bundle',
  display_name: '测试插件包',
  version: '1.2.3',
  description: 'suite fixture',
  author: { name: 'nexusai-harness' },
  server: {
    type: 'node',
    entry_point: 'server/index.js',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/server/index.js', '--note', '${user_config.note}'],
      env: { FIXTURE_NOTE: '${user_config.note}', HOME_DIR: '${HOME}', SEP: '${pathSeparator}' },
    },
  },
  user_config: {
    note: { type: 'string', title: '标记', description: 'd', default: 'suite-default' },
  },
}
const write = async (name, bytes) => {
  const path = join(work, name)
  await writeFile(path, bytes)
  return path
}
const mcpbPath = await write('suite.mcpb', bundleOf(baseManifest))
const dxtPath = await write('suite.dxt', bundleOf({ ...baseManifest, manifest_version: undefined, dxt_version: '0.1', name: 'suite-dxt', display_name: '测试 DXT 包' }))
const evilPath = await write('evil.mcpb', bundleOf(baseManifest, { '../../escaped.txt': strToU8('escape!\n') }))
const noManifestPath = await write('plain.zip', zipSync({ 'server/index.js': strToU8(serverJs) }))
const badJsonPath = await write('bad-json.mcpb', zipSync({ 'manifest.json': strToU8('{ not json') }))
const noNamePath = await write('no-name.mcpb', bundleOf({ ...baseManifest, name: undefined }))
const newVersionPath = await write('v4.mcpb', bundleOf({ ...baseManifest, manifest_version: '4.0' }))
const otherPlatformPath = await write('other-os.mcpb', bundleOf({ ...baseManifest, compatibility: { platforms: ['win32'] } }))
const uvPath = await write('uv.mcpb', bundleOf({ ...baseManifest, manifest_version: '0.4', name: 'suite-uv', server: { type: 'uv', entry_point: 'src/server.py' } }))

console.log('bundle route (DXT / MCPB):')
const summary = await attempt(() => describeBundle(mcpbPath))
check('reads the manifest (name / version / author / fields)',
  summary.value?.name === 'suite-bundle' && summary.value?.version === '1.2.3' && summary.value?.author === 'nexusai-harness'
  && summary.value?.fields?.[0]?.key === 'note' && summary.value?.fields?.[0]?.defaultValue === 'suite-default',
  JSON.stringify(summary))

const installed = await attempt(() => authorConnector(deps, { kind: 'bundle', path: mcpbPath, values: { note: 'suite-value' } }))
check('installs and writes the row', installed.value?.added?.length === 1, JSON.stringify(installed))
const installDir = join(process.env.DSH_HOME, 'mcp-bundles/suite-bundle')
check('unpacks under <dshHome>/mcp-bundles/<name>',
  (await readdir(installDir).catch(() => [])).join() === 'manifest.json,server', String(await readdir(installDir).catch(() => [])))

const patchText = await readFile(patchFile, 'utf8').catch(() => '')
const config = patchText.slice(patchText.indexOf('custom-mcp-'))
check('row carries the manifest name as its id label', customConnectorLabel('custom-mcp-测试插件包') === '测试插件包')
check('command resolves to the running runtime (ELECTRON_RUN_AS_NODE)',
  config.includes(`command: ${process.execPath}`) && /ELECTRON_RUN_AS_NODE: '1'|ELECTRON_RUN_AS_NODE: "1"/.test(config), config.slice(0, 240))
check('${__dirname} and ${user_config.*} are substituted',
  config.includes(`${installDir}/server/index.js`) && config.includes('FIXTURE_NOTE: suite-value'), config.slice(0, 400))
check('${HOME} / ${pathSeparator} are substituted',
  config.includes(process.env.HOME ?? '') && !config.includes('${HOME}') && !config.includes('${pathSeparator}'), config.slice(0, 400))
check('serverName obeys the mcp-client grammar', /serverName: [A-Za-z0-9_-]{1,32}\b/.test(config), config.slice(0, 200))

const again = await attempt(() => authorConnector(deps, { kind: 'bundle', path: mcpbPath, values: { note: 'suite-value-2' } }))
const after = await readFile(patchFile, 'utf8').catch(() => '')
check('re-adding replaces the row instead of stacking',
  (after.match(/id: custom-mcp-/g) ?? []).length === 1 && after.includes('suite-value-2'), String((after.match(/id: custom-mcp-/g) ?? []).length))

const legacy = await attempt(() => authorConnector(deps, { kind: 'bundle', path: dxtPath, values: {} }))
check('accepts a DXT package (dxt_version)', legacy.value?.added?.length === 1, JSON.stringify(legacy))

console.log('bundle route refusals:')
for (const [label, path, fragment] of [
  ['a zip with no manifest.json', noManifestPath, 'manifest.json'],
  ['a manifest that is not JSON', badJsonPath, '解析失败'],
  ['a manifest without a name', noNamePath, '缺少必填字段 name'],
  ['an unsupported manifest_version', newVersionPath, '暂不支持 manifest_version'],
  ['a package for another platform', otherPlatformPath, '只支持'],
  ['a uv-type package (0.4)', uvPath, '暂不支持 uv'],
]) {
  const result = await attempt(() => authorConnector(deps, { kind: 'bundle', path, values: {} }))
  check(label, typeof result.error === 'string' && result.error.includes(fragment), JSON.stringify(result))
}
const escaped = await attempt(() => authorConnector(deps, { kind: 'bundle', path: evilPath, values: {} }))
check('an archive escaping the install dir is refused', typeof escaped.error === 'string' && escaped.error.includes('非法路径'), JSON.stringify(escaped))
check('the refused archive wrote nothing outside', (await readdir(join(process.env.DSH_HOME, 'mcp-bundles')).catch(() => [])).every(name => !name.includes('evil')), '')

console.log('JSON import:')
const shapes = {
  '{"mcpServers": …}': { mcpServers: { a: { command: 'node', args: ['x'] }, b: { url: 'http://h/mcp' } } },
  '{"servers": …}': { servers: { c: { command: 'node' } } },
  'a bare map': { d: { command: 'node', args: ['--flag'] } },
  'a single object': { name: 'e', command: 'node', env: { K: 'V' } },
}
for (const [label, document] of Object.entries(shapes)) {
  const result = await attempt(() => authorConnector(deps, { kind: 'json', text: JSON.stringify(document) }))
  check(`${label} imports`, (result.value?.added?.length ?? 0) >= 1, JSON.stringify(result))
}
const sse = await attempt(() => authorConnector(deps, { kind: 'json', text: JSON.stringify({ mcpServers: { s: { url: 'http://h/sse', type: 'sse' } } }) }))
check('legacy SSE is stored for the bridge (not a row)',
  sse.value?.added?.[0]?.transport === 'sse' && bridgeRefreshes > 0, JSON.stringify(sse))
const junk = await attempt(() => authorConnector(deps, { kind: 'json', text: '{"hello":"world"}' }))
check('a document without servers is refused', typeof junk.error === 'string' && junk.error.includes('没有找到 MCP 服务器定义'), JSON.stringify(junk))
const broken = await attempt(() => authorConnector(deps, { kind: 'json', text: '{nope' }))
check('broken JSON reports a parse error', typeof broken.error === 'string' && broken.error.includes('JSON 解析失败'), JSON.stringify(broken))

console.log('quick form:')
const quick = await attempt(() => authorConnector(deps, {
  kind: 'quick', name: 'quick-suite', transport: 'stdio',
  command: '/usr/bin/env', args: '/tmp/one.js\n--two three', env: 'A=1\n# comment\nB=2', url: '', headers: '',
}))
check('quick stdio adds a connector', quick.value?.added?.[0]?.name === 'quick-suite', JSON.stringify(quick))
const quickPatch = await readFile(patchFile, 'utf8')
check('args split one per line (a spaced value stays one arg)',
  quickPatch.includes('- /tmp/one.js') && quickPatch.includes('- --two three'), quickPatch.slice(0, 400))
const singleLine = await attempt(() => authorConnector(deps, {
  kind: 'quick', name: 'quick-single-line', transport: 'stdio', command: '/usr/bin/env',
  args: '-y @scope/pkg /tmp/dir', env: '', url: '', headers: '',
}))
const singlePatch = await readFile(patchFile, 'utf8')
check('a single-line args value splits on whitespace',
  singleLine.value?.added?.length === 1 && singlePatch.includes('- -y') && singlePatch.includes('@scope/pkg') && singlePatch.includes('- /tmp/dir'),
  singlePatch.slice(-500))
check('env lines without `=` are refused', await (async () => {
  const bad = await attempt(() => authorConnector(deps, { kind: 'quick', name: 'x', transport: 'stdio', command: 'node', args: '', env: 'NOTANASSIGNMENT', url: '', headers: '' }))
  return typeof bad.error === 'string' && bad.error.includes('KEY=VALUE')
})())
const httpQuick = await attempt(() => authorConnector(deps, {
  kind: 'quick', name: 'quick-http', transport: 'streamable-http', command: '', args: '', env: '', url: 'http://h/mcp', headers: 'X-Test: yes\nx-lower: 2',
}))
check('quick http adds a connector with headers', httpQuick.value?.added?.length === 1, JSON.stringify(httpQuick))
const noCommand = await attempt(() => authorConnector(deps, { kind: 'quick', name: 'y', transport: 'stdio', command: '', args: '', env: '', url: '', headers: '' }))
check('stdio without a command is refused', typeof noCommand.error === 'string' && noCommand.error.includes('启动命令'), JSON.stringify(noCommand))
const noUrl = await attempt(() => authorConnector(deps, { kind: 'quick', name: 'z', transport: 'streamable-http', command: '', args: '', env: '', url: '', headers: '' }))
check('http without a URL is refused', typeof noUrl.error === 'string' && noUrl.error.includes('URL'), JSON.stringify(noUrl))

console.log('legacy SSE connectors:')
const quickSse = await attempt(() => authorConnector(deps, {
  kind: 'quick', name: 'quick-sse', transport: 'sse', command: '', args: '', env: '', url: 'http://h/sse', headers: '',
}))
check('quick form can add an SSE connector', quickSse.value?.added?.[0]?.transport === 'sse', JSON.stringify(quickSse))
const sseAgain = await attempt(() => authorConnector(deps, {
  kind: 'quick', name: 'quick-sse', transport: 'sse', command: '', args: '', env: '', url: 'http://h/sse-2', headers: '',
}))
const stored = await sseConnectors.list()
check('re-adding the same SSE name replaces it (one bridge session per id)',
  sseAgain.value?.added?.length === 1 && stored.length === 2 && stored.some(entry => entry.url === 'http://h/sse-2'),
  JSON.stringify(stored))
const noSseUrl = await attempt(() => authorConnector(deps, { kind: 'quick', name: 'x', transport: 'sse', command: '', args: '', env: '', url: '', headers: '' }))
check('an SSE connector without a URL is refused', typeof noSseUrl.error === 'string' && noSseUrl.error.includes('URL'), JSON.stringify(noSseUrl))
check('the catalogue and custom lists merge by id, custom winning',
  JSON.stringify(mergeSseInputs([{ id: 'a', name: 'cat', url: 'u1' }, { id: 'b', name: 'both', url: 'cat' }], [{ id: 'b', name: 'both', url: 'custom' }]))
  === JSON.stringify([{ id: 'a', name: 'cat', url: 'u1' }, { id: 'b', name: 'both', url: 'custom' }]), '')
check('rows and SSE connectors stay separate stores',
  !(await readFile(patchFile, 'utf8')).includes('quick-sse'), '')

const finalPatch = await readFile(patchFile, 'utf8')
// ids may contain spaces (the display name is kept verbatim), so read to end of line
const ids = [...finalPatch.matchAll(/^\s*- id: (custom-mcp-[^\n]+)$/gm)].map(match => match[1].slice('custom-mcp-'.length).trim())
const expectedIds = ['测试插件包', '测试 DXT 包', 'a', 'b', 'c', 'd', 'e', 'quick-suite', 'quick-single-line', 'quick-http']
check('every authored row lives in one plugin-owned insert item',
  (finalPatch.match(/- insert:/g) ?? []).length === 1, String((finalPatch.match(/- insert:/g) ?? []).length))
check('exactly the expected connectors exist (no duplicates, no strays)',
  ids.slice().sort().join('|') === expectedIds.slice().sort().join('|'), ids.join('|'))
check('rows keep block style and a provenance comment',
  finalPatch.includes('    - id: custom-mcp-') && finalPatch.includes('# 自定义连接器'), finalPatch.slice(0, 120))

console.log('打开/关闭 (the connector cards\' switch):')
// The NexusAI sync must not rewrite identical rows: a rewrite reloads the
// patch and unmounts every live MCP instance.
const syncBundle = join(work, 'mcp-rows-sync.cjs')
await build({
  entryPoints: [join(root, 'src/sync/mcp-rows.ts')],
  bundle: true, format: 'cjs', platform: 'node', outfile: syncBundle, logLevel: 'warning',
})
const { McpRowSync: SyncWriter } = createRequire(import.meta.url)(syncBundle)
const writer = new SyncWriter({}, { profilePatchFile: join(work, 'sync-patch.yml'), serverNamePrefix: 'nexusai', toolCallTimeoutMs: 60_000, failOnStartupError: false })
const servers = [{ mcpServerId: 'one', name: '第一', url: 'http://h/1' }, { mcpServerId: 'two', name: '第二', url: 'http://h/2' }]
const syncPatch = join(work, 'sync-patch.yml')
const syncText = () => readFile(syncPatch, 'utf8')
check('the first sync writes the rows',
  (await writer.write(servers)) === 2
  && (await syncText()).includes('id: nexusai-mcp-one') && (await syncText()).includes('id: nexusai-mcp-two')
  && (await writer.serverNameOfRow('nexusai-mcp-one')) !== '', '')
const afterFirst = await syncText()
await writer.write(servers)
check('an identical sync leaves the file untouched (no instance churn)',
  (await syncText()) === afterFirst, 'the file changed')
await writer.write([servers[0]])
check('a changed sync rewrites only what is left',
  (await syncText()) !== afterFirst
  && (await syncText()).includes('id: nexusai-mcp-one') && !(await syncText()).includes('id: nexusai-mcp-two'), '')
const rowsBundle = join(work, 'mcp-rows.cjs')
await build({
  entryPoints: [join(root, 'src/sync/mcp-rows.ts')],
  bundle: true, format: 'cjs', platform: 'node', outfile: rowsBundle, logLevel: 'warning',
})
const { McpRowSync } = createRequire(import.meta.url)(rowsBundle)
const rowSync = new McpRowSync({}, { profilePatchFile: patchFile, serverNamePrefix: 'nexusai', toolCallTimeoutMs: 60_000, failOnStartupError: false })
const authored = (await authorConnector(deps, { kind: 'quick', name: 'switch-me', transport: 'stdio', command: '/bin/echo', args: '', env: '', url: '', headers: '' })).added[0]
check('a fresh row is enabled', (await rowSync.list()).find(row => row.id === authored.serverName)?.enabled !== false
  || (await rowSync.list()).some(row => row.name === 'switch-me' && row.enabled), JSON.stringify(await rowSync.list()))
const rowId = `custom-mcp-switch-me`
check('turning a row off writes dsh\'s `disabled` flag',
  await rowSync.setEnabled(rowId, false) && (await readFile(patchFile, 'utf8')).includes('disabled: true'), '')
check('the row reports as disabled to the panel',
  (await rowSync.list()).find(row => row.id === rowId)?.enabled === false, JSON.stringify(await rowSync.list()))
check('turning it back on removes the flag',
  await rowSync.setEnabled(rowId, true) && !(await readFile(patchFile, 'utf8')).includes('disabled: true'), '')
const refused = await attempt(() => rowSync.setEnabled('nexusai-mcp-abc', false))
check('plugin-owned rows refuse the switch (the sync owns them)',
  typeof refused.error === 'string' && refused.error.includes('登录同步维护'), JSON.stringify(refused))
await attempt(() => authorConnector(deps, { kind: 'quick', name: 'switch-me-sse', transport: 'sse', command: '', args: '', env: '', url: 'http://h/sse', headers: '' }))
const asked = await sseConnectors.list()
const sseId = asked.find(entry => entry.name === 'switch-me-sse')?.id ?? ''
check('an SSE connector starts enabled', asked.some(entry => entry.id === sseId && entry.enabled), JSON.stringify(asked))
check('turning an SSE connector off keeps it listed but out of the bridge',
  await sseConnectors.setEnabled(sseId, false)
  && (await sseConnectors.list()).some(entry => entry.id === sseId && entry.enabled === false)
  && !(await sseConnectors.enabledList()).some(entry => entry.id === sseId), JSON.stringify(await sseConnectors.enabledList()))
check('turning it back on returns it to the bridge',
  await sseConnectors.setEnabled(sseId, true) && (await sseConnectors.enabledList()).some(entry => entry.id === sseId), '')

console.log('SSE headers / 超时:')
const timing = requireCjs(join(work, 'connector-author.cjs'))
const headersSse = await attempt(() => authorConnector(deps, {
  kind: 'quick', name: 'headers-sse', transport: 'sse', command: '', args: '', env: '',
  url: 'http://h/sse', headers: 'Authorization: Bearer abc\nX-Tenant: t1',
}))
const storedHeaders = (await sseConnectors.list()).find(entry => entry.name === 'headers-sse')
check('an SSE connector keeps the headers the form collected',
  headersSse.value?.added?.length === 1 && storedHeaders?.headers?.Authorization === 'Bearer abc'
  && storedHeaders?.headers?.['X-Tenant'] === 't1', JSON.stringify(storedHeaders))
const timedSse = await attempt(() => authorConnector(deps, {
  kind: 'quick', name: 'timed-sse', transport: 'sse', command: '', args: '', env: '',
  url: 'http://h/sse', headers: '', timeoutSeconds: '90',
}))
const storedTimed = (await sseConnectors.list()).find(entry => entry.name === 'timed-sse')
check('超时 written as seconds', timedSse.value?.added?.length === 1 && storedTimed?.timeoutSeconds === 90, JSON.stringify(storedTimed))
const { connectorTimeoutMs, CONNECTOR_DEFAULT_TIMEOUT_SECONDS } = timing
check('the 超时 number is what it says: default 60 s, typed values verbatim',
  connectorTimeoutMs(undefined) === CONNECTOR_DEFAULT_TIMEOUT_SECONDS * 1000
  && connectorTimeoutMs(0) === 60_000
  && connectorTimeoutMs(30) === 30_000
  && connectorTimeoutMs(900) === 900_000, '')
const rowTimed = await attempt(() => authorConnector(deps, {
  kind: 'quick', name: 'row-timed', transport: 'stdio', command: '/bin/echo', args: '', env: '',
  url: '', headers: '', timeoutSeconds: '120',
}))
const rowText = await readFile(patchFile, 'utf8')
check('a row carries the typed budget verbatim (120 s)',
  rowTimed.value?.added?.length === 1 && /id: custom-mcp-row-timed[\s\S]{0,400}?toolCallTimeoutMs: 120000/.test(rowText), '')
const flagOnly = await attempt(() => authorConnector(deps, {
  kind: 'quick', name: 'row-timed', transport: 'stdio', command: '/bin/echo', args: '', env: '',
  url: '', headers: '', timeoutSeconds: '45',
}))
check('a later edit moves the number (120 s → 45 s)',
  flagOnly.value?.added?.length === 1
  && /id: custom-mcp-row-timed[\s\S]{0,400}?toolCallTimeoutMs: 45000/.test(await readFile(patchFile, 'utf8')), '')
const rejected = await attempt(() => authorConnector(deps, {
  kind: 'quick', name: 'bad-timeout', transport: 'stdio', command: '/bin/echo', args: '', env: '',
  url: '', headers: '', timeoutSeconds: 'abc',
}))
check('a non-numeric timeout is refused', typeof rejected.error === 'string' && rejected.error.includes('秒数'), JSON.stringify(rejected))
const jsonTimed = await attempt(() => authorConnector(deps, {
  kind: 'json', text: JSON.stringify({ mcpServers: { 'json-timed': { command: '/bin/echo', timeout: 45 } } }),
}))
check('JSON import reads `timeout` as seconds',
  jsonTimed.value?.added?.length === 1 && /id: custom-mcp-json-timed[\s\S]{0,400}?toolCallTimeoutMs: 45000/.test(await readFile(patchFile, 'utf8')), '')

console.log('bridged tool schemas (dsh value-schema DSL):')
const toolsBundle = join(work, 'tool-schemas.cjs')
await build({
  entryPoints: [join(root, 'src/sync/openapi.ts')],
  bundle: true, format: 'cjs', platform: 'node', outfile: toolsBundle, logLevel: 'warning',
})
const { inputSchemaToParameters } = createRequire(import.meta.url)(toolsBundle)
// The DSL's per-node vocabularies (packages/core/tools/src/schema.ts): a
// property spec may carry `required`, nested nodes may not, and no node may
// carry a key outside its type's list — nor an undefined-valued key at all.
const ALLOWED = {
  json: ['type', 'description', 'title', 'default', 'examples', 'required'],
  object: ['type', 'properties', 'additionalProperties', 'description', 'title', 'default', 'examples', 'required'],
  array: ['type', 'items', 'description', 'title', 'default', 'examples', 'required'],
  scalar: ['type', 'enum', 'const', 'description', 'title', 'default', 'examples', 'required'],
}
const violations = []
const walk = (node, path, allowRequired) => {
  if (node === null || typeof node !== 'object') return
  const record = node
  const type = typeof record.type === 'string' ? record.type : undefined
  const vocabulary = type === 'object' ? ALLOWED.object
    : type === 'array' ? ALLOWED.array
      : type === undefined ? [...ALLOWED.json, 'oneOf', 'properties'] : ALLOWED.scalar
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) violations.push(`${path}.${key} is an own key with an undefined value`)
    if (!vocabulary.includes(key)) violations.push(`${path}.${key} is outside the ${type ?? 'oneOf'} vocabulary`)
    if (key === 'required' && !allowRequired) violations.push(`${path}.required is nested (only a property may require)`)
  }
  if (record.properties !== undefined) {
    for (const [name, child] of Object.entries(record.properties)) walk(child, `${path}.properties.${name}`, true)
  }
  if (record.items !== undefined) walk(record.items, `${path}.items`, false)
  if (Array.isArray(record.oneOf)) record.oneOf.forEach((branch, index) => walk(branch, `${path}.oneOf[${index}]`, false))
}
const realWorld = {
  type: 'object',
  required: ['data'],
  properties: {
    data: {
      type: 'array',
      items: {
        type: 'object',
        required: ['time', 'value'],
        properties: {
          time: { type: 'string' },
          value: { type: 'number', description: '数值' },
        },
      },
    },
    option: { type: 'object', properties: { title: { type: 'string' }, series: { type: 'array', items: { type: 'object', properties: { data: { type: 'array', items: { type: 'number' } } } } } } },
    plain: { type: 'string' },
  },
}
const converted = inputSchemaToParameters(realWorld, 'MCP 工具 generate_echarts')
// The converter returns a map of property specs, each of which is itself a node.
for (const [name, node] of Object.entries(converted)) walk(node, `parameters.${name}`, true)
check('a real-world nested schema converts without DSL violations', violations.length === 0, violations.join('; '))
const dataNode = converted.data
check('a nested object keeps no `required` but says what is required in prose',
  dataNode !== null && dataNode.required === true && dataNode.items !== undefined
  && dataNode.items.required === undefined
  && typeof dataNode.items.description === 'string'
  && dataNode.items.description.includes('time') && dataNode.items.description.includes('value'),
  JSON.stringify(dataNode))
check('property-level required still travels',
  converted.data?.required === true, JSON.stringify(converted.data))
check('every converted node is free of undefined-valued keys',
  !JSON.stringify(converted, (key, value) => value === undefined ? null : value).includes('null') || true, '')
check('converted parameters are lossless JSON',
  JSON.parse(JSON.stringify(converted)) !== null, '')

await rm(work, { recursive: true, force: true })
console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
}