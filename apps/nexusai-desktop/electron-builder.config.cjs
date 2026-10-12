/**
 * electron-builder configuration for the NexusAgent Builder carrier.
 *
 * Deliberately minimal: no signing, no notarization, no auto-update. The app is
 * a thin Electron shell; everything dsh needs travels in `build/profile`, which
 * `scripts/prepare-runtime.mjs` just produced.
 */
const { existsSync } = require('node:fs')
const { join } = require('node:path')

// Reuse the Electron that pnpm already installed instead of letting
// electron-builder download its own copy: one less large download (it matters
// on this network) and the version is the one `package.json` pins. Both CI jobs
// and local builds run host-native, so the installed dist always matches the
// target being packaged.
const electronDist = join(__dirname, 'node_modules', 'electron', 'dist')

module.exports = {
  appId: 'com.nexusai.builder',
  productName: 'NexusAgent Builder',
  copyright: 'NexusAI',
  ...(existsSync(electronDist) ? { electronDist } : {}),
  directories: { output: 'dist', buildResources: 'resources' },
  // The shell is one CommonJS file plus its manifest; the runtime rides in
  // extraResources so it stays outside the asar (dsh reads it as real files).
  files: ['src/**/*', 'package.json'],
  // The runtime is copied by the afterPack hook, not by extraResources: see
  // scripts/after-pack.cjs for why electron-builder's own copier cannot carry a
  // pnpm-installed profile.
  afterPack: 'scripts/after-pack.cjs',
  asar: true,
  compression: 'maximum',
  removePackageScripts: true,
  mac: {
    // `identity: null` = unsigned. Users open it with right-click → 打开 the
    // first time; that is the accepted trade-off for shipping without a
    // Developer ID.
    identity: null,
    category: 'public.app-category.developer-tools',
    // Both icons are generated from resources/icon.svg by scripts/make-icons.mjs.
    icon: join(__dirname, 'resources', 'icon.icns'),
    target: [{ target: 'dmg', arch: ['arm64'] }],
  },
  dmg: { title: 'NexusAgent Builder' },
  win: {
    icon: join(__dirname, 'resources', 'icon.ico'),
    target: [{ target: 'nsis', arch: ['x64'] }],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    shortcutName: 'NexusAgent Builder',
  },
}
