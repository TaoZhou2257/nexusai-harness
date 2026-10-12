/**
 * Copy the prepared runtime into the packaged app, after electron-builder has
 * laid down the Electron framework.
 *
 * Why a hook instead of `extraResources`: electron-builder routes any directory
 * containing `node_modules` through its app-file copier, which copies the
 * *declared dependency tree* — for a profile that pnpm installed flat, that
 * yields an empty tree (the whole runtime silently disappeared from the app).
 * A plain recursive copy is the honest operation here, and it also lets us
 * dereference pnpm's links so the bundle stays portable to Windows.
 */
const { cpSync, existsSync, mkdirSync, rmSync } = require('node:fs')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  const projectDir = context.packager.projectDir
  const source = join(projectDir, 'build', 'profile')
  const marker = join(projectDir, 'build', 'runtime-version.txt')
  if (!existsSync(source) || !existsSync(marker)) {
    throw new Error('build/profile is missing — run `pnpm run prepare:runtime` first')
  }
  const resources = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources')
  const destination = join(resources, 'nexusai-runtime')
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  cpSync(source, join(destination, 'profile'), {
    recursive: true,
    dereference: true,
    // `cordis.yml` is dsh's composed *output*: any local boot regenerates it in
    // the source profile, and a stale copy (with build-machine paths) must not
    // ride along. Only inputs ship.
    filter: path => path !== join(source, 'cordis.yml'),
  })
  cpSync(marker, join(destination, 'runtime-version.txt'))
  console.log(`  • bundled runtime  ${destination}`)
}
