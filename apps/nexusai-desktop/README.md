# NexusAIHarness — the carrier app

A thin Electron shell that ships one self-contained desktop app: **dsh (version
pinned by `../../upstream.json`) + this repo's NexusAI plugin**, already wired,
so a user installs one thing and signs in.

```
apps/nexusai-desktop/
  src/main.cjs                     the shell (~660 lines, CommonJS, no build step)
  scripts/prepare-runtime.mjs      builds build/profile (dsh + plugin) for a target
  scripts/prepare-primary-runtime.mjs  builds build/runtime/primary-runtime (Node + Python + office libs)
  scripts/smoke-runtime.mjs        headless check: boots the bundled runtime, waits for the web URL
  scripts/after-pack.cjs           copies the runtime into the packaged app
  electron-builder.config.cjs      unsigned dmg / nsis, no auto-update
```

## How it works

```
  launch ─▶ materialize profile ─▶ spawn bundled dsh ─▶ read token URL ─▶ open window
             <userData>/dsh-home    Electron-as-Node      127.0.0.1:<port>    centered
```

1. **Home** — everything lives in `<userData>/dsh-home` (`~/Library/Application
   Support/NexusAIHarness/dsh-home` on macOS, `%APPDATA%\NexusAIHarness\dsh-home`
   on Windows). `NEXUSAI_DSH_HOME` overrides it, which is how
   the smoke tests and a second instance stay out of the way. The home is derived
   from the app name, so the shell carries the previous name
   (`LEGACY_APP_NAME`) and adopts that directory on first launch when the new one
   does not exist yet — an upgrade is invisible to the user.
2. **Profile** — the bundle carries `build/profile`, a plain pnpm project:
   `@deepseek-ai/dsh` at `upstream.json`'s version, the two official bundles it
   activates, and this repo's plugin tarball. On first launch (and whenever
   `runtime-version.txt` changes) the shell copies the small manifest files into
   the home and links `node_modules` at the bundle, so a launch never copies
   hundreds of megabytes. A `node_modules` the app did not create is refused
   rather than clobbered.
3. **Runtime** — the app's own Electron binary doubles as Node
   (`ELECTRON_RUN_AS_NODE=1`), so the host needs no second runtime of its own.
   dsh is started as `dsh --profile nexusai --no-open`. A *separate* payload
   (`<resources>/nexusai-runtime/primary-runtime`, built by
   `scripts/prepare-primary-runtime.mjs`) travels beside it and is handed to dsh
   as `DSH_BUNDLED_PRIMARY_RUNTIME`: Node + pnpm + Python + the office libraries
   (python-docx / python-pptx / openpyxl / Pillow / lxml), which is what lets the
   bundled document skills run offline on a machine that has none of them.
4. **Ready line** — the shell watches stdout for
   `dsh web: http://127.0.0.1:<port>/?token=…` and opens a centered window on
   exactly that URL. Nothing else is parsed, so a dsh change to that one line is
   the only thing that can break this seam.

## Building

```bash
cd apps/nexusai-desktop
pnpm install                       # electron + electron-builder (use ELECTRON_MIRROR on this network)
cp .env.example .env               # NEXUSAI_BASE_URL + NEXUSAI_AES_KEY/IV — secrets stay out of git
pnpm run prepare:runtime           # → build/profile, build/runtime-version.txt
pnpm run smoke:runtime             # headless: proves the bundle boots
pnpm start                         # run the shell from source
pnpm run make:icons                # only when the brand mark changes (macOS tools)
pnpm run dist:mac                  # → dist/NexusAIHarness-<version>-arm64.dmg (unsigned)
```

**Icons** — two steps, one source each: `scripts/compose-icon.py` puts the brand's
transparent glyph (`resources/icon-source.png`) on the product's dark rounded
plate and writes `resources/icon.png` (1024); `pnpm run make:icons` then derives
`icon.icns` and `icon.ico` from it with macOS's `sips`/`iconutil`. Only the second
step is needed in a build — the PNG is committed, so CI (and the Windows runner)
package the real icon without Python or those tools.

The source glyph is 256 px, so the 1024 icon is an upscale: crisp at Dock/taskbar
sizes, soft in Finder previews. Drop a 1024 px (or vector) export in as
`resources/icon-source.png` and re-run both commands to fix that.

`prepare:runtime` is the only step that touches the network: it packs the plugin
(`npm pack`) and installs the profile with pnpm. `--target=win-x64` runs the same
steps for Windows — pnpm's `supportedArchitectures` is what makes the Windows
native optional dependencies resolve correctly, so this is the one place a
cross-target build is even attempted. **In practice the Windows bundle is built
on Windows** (`.github/workflows/build.yml`), because that is where everything is
host-native and where dsh's own packaging would refuse to cross-build anyway.

## Two traps worth knowing

- **`node_modules` cannot ride in `extraResources`.** electron-builder routes any
  directory containing `node_modules` through its app-file copier, which copies
  the *declared dependency tree*; a pnpm-installed flat profile comes out empty
  and the app ships without its runtime, silently. The runtime is copied by the
  `afterPack` hook with a plain recursive `cpSync` instead
  (`scripts/after-pack.cjs`).
- **`@electron/get` must be a single major (v5).** electron-builder 26 imports
  `ElectronDownloadCacheMode` from it, which older majors do not export — the DMG
  step then dies with `Cannot read properties of undefined (reading 'ReadWrite')`.
  `pnpm-workspace.yaml` pins it via `overrides`.
- **This bundle's profile is called `nexusai`, not `desktop`.** Anything that
  addresses a profile by name has to use that one. The plugin resolves it by
  finding the profile whose patch mounts it (`src/sync/patch-file.ts`) rather
  than assuming `desktop`, which is what a development checkout uses — getting
  this wrong writes MCP rows and custom connectors into a file the running host
  never loads, so the UI lists connectors whose tools never appear.

## macOS signing

The app is **ad-hoc signed** (`mac.identity: '-'`), not unsigned. That is not
cosmetic: the `afterPack` hook adds the whole runtime to `Contents/Resources`
after Electron's framework is copied, so without re-signing the bundle has no
`_CodeSignature` at all. macOS then calls a *downloaded* copy "已损坏，无法打开"
— the "damaged" wording for a broken seal — and there is no UI path around it.
Ad-hoc signing reseals the final contents, which turns that into the ordinary
"unidentified developer" flow: the first launch is blocked once, then
**系统设置 → 隐私与安全性 → 仍要打开**.

`resources/entitlements.mac.plist` is required alongside it: hardened runtime's
library validation would otherwise refuse the runtime's third-party natives
(sherpa-onnx, node-pty, ripgrep) and the app would die on launch.
electron-builder only applies its default entitlements template for real
identities, so ours is spelled out explicitly.

Removing the one-time approval entirely needs a Developer ID certificate plus
notarization (`CSC_LINK`, `APPLE_API_KEY*`); dsh's own packaging has that path,
and this config's only change would be swapping `'-'` for that identity.

## Window placement

Default size is **1200×800** (clamped to the display), positioned explicitly
against the display's *work area* — menu bar and Dock already excluded — rather
than with Electron's `center: true`, which measured 41 px above the real middle
on macOS.

| value | result |
|---|---|
| `center` (default) | middle of the work area |
| `bottom` | same size, bottom edge resting on the Dock |
| `fill` | the whole work area |

Pick it with `NEXUSAI_WINDOW_PLACEMENT=…` when running from a shell, or — for the
installed app, which has no shell — by writing the single word into
`<home>/window-placement`. The chosen value and its source are logged at startup,
as is the resulting geometry.

## Runtime diagnostics

The runtime's output is appended to `<home>/logs/runtime.log` (rotated once at
2 MB, tokens redacted) and the menu carries **帮助 → 打开日志目录 / 查看运行日志**
plus an **关于** item showing the app version, the bundled runtime version and
the home path. There is no terminal in a packaged app, so this file is the
artifact to ask a user for when something goes wrong.

Sign-in is entirely user-driven: the app never opens the login dialog on its own.
On a signed-out start the bottom-left launcher is the entry (its label is the
sign-in copy), and the workbench shows a sign-in call to action beside it. The
launcher carries a stable `data-nexusai="launcher"` marker, which is what the CI
gates assert on to prove the client half mounted (`scripts/check-client-mounted.mjs`).

**First run shows the product, not dsh's onboarding popup.** dsh displays a
preview notice until the user acknowledges it, keeping the acknowledged version
in `ui-settings-general.welcomeNoticeVersion` and comparing it for *exact
equality*. The bundled patch therefore carries that acknowledgement, and
`prepare-runtime.mjs` reads the version out of the installed
`dsh-client-ui-settings-models` bundle rather than hardcoding it — when dsh is
upgraded, a new notice version means the popup returns once, which is the
intended behaviour and not a bug.

## Status

Verified on macOS (arm64): `prepare:runtime` composes the profile with the plugin
row present, `smoke:runtime` reaches the web URL, the packaged `.app` boots from a
clean home and opens its window, the DMG mounts with the full runtime inside, and
a signed-out start shows the sign-in launcher without opening any dialog by
itself.

Verified by CI on every push (see `scripts/ci/`): the DMG's app launches with a
clean home and materializes its profile; the Windows installer installs silently,
the installed app launches, its bundled runtime comes up, the client plugin
mounts, and the uninstaller removes it again.

Verified by a person: the Windows installer runs on a real Windows machine
(2026-10-13). Still manual, and the only things CI cannot reach: the macOS
"unidentified developer" approval (a CI-built file carries no download
quarantine), SmartScreen on a downloaded `.exe`, and signing in with a real
account (the captcha blocks automation on purpose).
