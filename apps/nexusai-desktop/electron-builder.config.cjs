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
  // Artifact file names carry no spaces on purpose: GitHub replaces spaces in
  // Release asset names with dots, so a spaced name reads differently on the
  // download page than it does locally (NexusAgent Builder-… → NexusAgent.Builder-…)
  // and looks like a mismatched download. The *app* keeps its spaced product
  // name; only the files are hyphenated.
  artifactName: 'NexusAgentBuilder-${version}-${arch}.${ext}',
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
    // Ad-hoc sign (`'-'`) rather than no signature at all. The afterPack hook
    // adds the whole runtime to Contents/Resources *after* the Electron
    // framework is copied, so without re-signing the bundle has no
    // `_CodeSignature` and Gatekeeper rejects a downloaded copy with
    // "已损坏，无法打开" — the misleading message for a broken seal, not a
    // virus. Ad-hoc signing reseals the final contents, which turns that into
    // the documented "unidentified developer" flow (System Settings → Privacy &
    // Security → 仍要打开). A Developer ID here replaces this entirely.
    identity: '-',
    category: 'public.app-category.developer-tools',
    // Ad-hoc signing does not get electron-builder's default entitlements, and
    // without `disable-library-validation` the hardened runtime refuses to load
    // the runtime's third-party natives and the app dies at launch.
    entitlements: join(__dirname, 'resources', 'entitlements.mac.plist'),
    entitlementsInherit: join(__dirname, 'resources', 'entitlements.mac.plist'),
    // Both icons are generated from resources/icon.svg by scripts/make-icons.mjs.
    icon: join(__dirname, 'resources', 'icon.icns'),
    target: [{ target: 'dmg', arch: ['arm64'] }],
  },
  dmg: { title: 'NexusAgent Builder' },
  win: {
    icon: join(__dirname, 'resources', 'icon.ico'),
    // `Setup` kept in the Windows file name: it is an installer, and the name is
    // the only thing a user sees before running it.
    artifactName: 'NexusAgentBuilder-Setup-${version}-${arch}.${ext}',
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
