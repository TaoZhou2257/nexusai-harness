/**
 * electron-builder configuration for the NexusAIHarness carrier.
 *
 * Deliberately minimal: no signing, no notarization, no auto-update. The app is
 * a thin Electron shell; everything dsh needs travels in `build/profile`, which
 * `scripts/prepare-runtime.mjs` just produced.
 *
 * White-label: `NEXUSAI_CUSTOMER=<name>` selects `branding/<name>/brand.json`,
 * and every user-visible identity derives from it — app/product name, macOS
 * and Windows icons, DMG volume title, Windows shortcut, installer file names.
 * The icon sources are plain ≥512 PNGs; electron-builder converts them to
 * icns/ico itself, so no platform icon tooling joins the pipeline. Without the
 * variable this is byte-for-byte the default build.
 */
const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

// Reuse the Electron that pnpm already installed instead of letting
// electron-builder download its own copy: one less large download (it matters
// on this network) and the version is the one `package.json` pins. Both CI jobs
// and local builds run host-native, so the installed dist always matches the
// target being packaged.
const electronDist = join(__dirname, 'node_modules', 'electron', 'dist')

const customer = (process.env.NEXUSAI_CUSTOMER ?? '').trim()
let brand
if (customer !== '') {
  const manifest = join(__dirname, 'branding', customer, 'brand.json')
  if (!existsSync(manifest)) {
    throw new Error(`NEXUSAI_CUSTOMER=${customer}: ${manifest} not found — create branding/${customer}/ first`)
  }
  brand = { dir: join(__dirname, 'branding', customer), ...JSON.parse(readFileSync(manifest, 'utf8')) }
}
/** The display name every surface shows; ASCII fallback for file names. */
const brandName = brand?.name
const filePrefix = brand?.artifactPrefix ?? 'NexusAIHarness'

module.exports = {
  // Distinct appId per customer: two white-label builds on one machine keep
  // separate NSIS upgrade identities; brand.json may pin its own.
  appId: brand === undefined ? 'com.nexusai.builder' : brand.appId ?? `com.nexusai.builder.${customer}`,
  productName: brandName ?? 'NexusAIHarness',
  copyright: 'NexusAI',
  ...(existsSync(electronDist) ? { electronDist } : {}),
  // Artifact file names carry no spaces and use the brand's spelling
  // (`NexusAIHarness`): GitHub replaces spaces in Release asset names with dots,
  // so a spaced name reads differently on the download page than it does
  // locally. The *app* keeps its spaced product name; only the files differ.
  // A customer brand overrides the prefix with its ASCII `artifactPrefix`
  // (Chinese display names must not land in installer file names).
  artifactName: `${filePrefix}-\${version}-\${arch}.\${ext}`,
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
    // Default icons are generated from resources/icon.svg by make-icons.mjs; a
    // customer build points at its own committed icon.icns (make-icons
    // --source/--out generates them, same pipeline, no build-time conversion).
    icon: brand === undefined
      ? join(__dirname, 'resources', 'icon.icns')
      : join(brand.dir, brand.icns ?? 'icon.icns'),
    target: [{ target: 'dmg', arch: ['arm64'] }],
  },
  // `title` is the mounted volume's name, so it is the first brand string a
  // macOS user sees (Finder sidebar, desktop, eject menu). Keep it identical to
  // productName; the Carrier's only remaining use of the old name is
  // LEGACY_APP_NAME in src/main.cjs, which finds data from older installs.
  dmg: { title: brandName ?? 'NexusAIHarness' },
  win: {
    icon: brand === undefined
      ? join(__dirname, 'resources', 'icon.ico')
      : join(brand.dir, brand.ico ?? 'icon.ico'),
    // `Setup` kept in the Windows file name: it is an installer, and the name is
    // the only thing a user sees before running it.
    artifactName: `${filePrefix}-Setup-\${version}-\${arch}.\${ext}`,
    target: [{ target: 'nsis', arch: ['x64'] }],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    shortcutName: brandName ?? 'NexusAIHarness',
  },
}
