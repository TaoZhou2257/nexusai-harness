/**
 * Build both halves of the plugin:
 *
 * - Host half: `src/index.ts` → `lib/index.js`, an ESM bundle whose
 *   `@deepseek-ai/*` and `node:*` imports stay external. In the dev profile
 *   the package is a linked root, and dsh's loader routes every request the
 *   package declares as a peerDependency to the installation's copies, so the
 *   host bundle must never inline the framework.
 *
 * - Client half: `client/index.ts` → `lib/client.js`, a CommonJS bundle with
 *   the browser module table's platform modules kept external, wrapped into
 *   the `window.__ModuleLoader__.load({ id, factory })` handoff the client
 *   plugin runner expects (see the built artifact of
 *   `@deepseek-ai/dsh-client-ui-plugin-manager` for the reference shape).
 */
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Module-table modules the client bundle must never inline. */
const PLATFORM_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

const PACKAGE = '@toby/dsh-plugin-nexusai'

const host = await build({
  entryPoints: [resolve(root, 'src/index.ts')],
  outfile: resolve(root, 'lib/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  external: ['@deepseek-ai/*', 'node:*', 'yaml'],
  logLevel: 'info',
})

const client = await build({
  entryPoints: [resolve(root, 'client/index.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: false,
  external: PLATFORM_EXTERNALS,
  write: false,
  logLevel: 'info',
})

const clientBody = client.outputFiles[0].text
const clientArtifact = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(PACKAGE)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${clientBody
  .split('\n')
  .map(line => (line.length === 0 ? '' : `\t\t${line}`))
  .join('\n')}
\t\treturn module.exports;
\t}
});
`

await mkdir(resolve(root, 'lib'), { recursive: true })
await writeFile(resolve(root, 'lib/client.js'), clientArtifact, 'utf8')

if (!host || !client) process.exitCode = 1
