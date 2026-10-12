# NexusAgent Builder — the carrier app

A thin Electron shell that ships one self-contained desktop app: **dsh (version
pinned by `../../upstream.json`) + this repo's NexusAI plugin**, already wired,
so a user installs one thing and signs in.

```
apps/nexusai-desktop/
  src/main.cjs                 the whole shell (~180 lines, CommonJS, no build step)
  scripts/prepare-runtime.mjs  builds build/profile (dsh + plugin) for a target
  scripts/smoke-runtime.mjs    headless check: boots the bundled runtime, waits for the web URL
  scripts/after-pack.cjs       copies the runtime into the packaged app
  electron-builder.config.cjs  unsigned dmg / nsis, no auto-update
```

## How it works

```
  launch ─▶ materialize profile ─▶ spawn bundled dsh ─▶ read token URL ─▶ open window
             <userData>/dsh-home    Electron-as-Node      127.0.0.1:<port>    centered
```

1. **Home** — everything lives in `<userData>/dsh-home` (`~/Library/Application
   Support/NexusAgent Builder/dsh-home` on macOS, `%APPDATA%\NexusAgent
   Builder\dsh-home` on Windows). `NEXUSAI_DSH_HOME` overrides it, which is how
   the smoke tests and a second instance stay out of the way.
2. **Profile** — the bundle carries `build/profile`, a plain pnpm project:
   `@deepseek-ai/dsh` at `upstream.json`'s version, the two official bundles it
   activates, and this repo's plugin tarball. On first launch (and whenever
   `runtime-version.txt` changes) the shell copies the small manifest files into
   the home and links `node_modules` at the bundle, so a launch never copies
   hundreds of megabytes. A `node_modules` the app did not create is refused
   rather than clobbered.
3. **Runtime** — the app's own Electron binary doubles as Node
   (`ELECTRON_RUN_AS_NODE=1`), so there is no second runtime to ship. dsh is
   started as `dsh --profile nexusai --no-open`.
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
pnpm run make:icons                # only when resources/icon.svg changes (macOS tools)
pnpm run dist:mac                  # → dist/NexusAgent Builder-<version>-arm64.dmg (unsigned)
```

**Icons** — `resources/icon.svg` is the source of truth; `pnpm run make:icons`
derives `icon.png` (1024), `icon.icns` and `icon.ico` from it with macOS's
`qlmanage`/`sips`/`iconutil`. The generated binaries are committed on purpose so
the Windows runner (which cannot run those tools) still packages the real icon.

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

## Runtime diagnostics

The runtime's output is appended to `<home>/logs/runtime.log` (rotated once at
2 MB, tokens redacted) and the menu carries **帮助 → 打开日志目录 / 查看运行日志**
plus an **关于** item showing the app version, the bundled runtime version and
the home path. There is no terminal in a packaged app, so this file is the
artifact to ask a user for when something goes wrong.

The app also offers sign-in by itself: on a start that is signed out, the login
dialog opens once, a moment after the shell settles. Closing it is remembered for
the session. (`scripts/check-auto-signin.mjs <port>` checks this over CDP against
a running instance.)

## v1.0 status

Verified on macOS (arm64): `prepare:runtime` composes the profile with the plugin
row present, `smoke:runtime` reaches the web URL, the packaged `.app` boots from a
clean home and opens its window, the DMG mounts with the full runtime inside, the
sign-in dialog offers itself on a signed-out start, and closing it keeps it
closed. CI builds both platforms and a tag publishes them as a Release.
**Not yet verified:** the Windows installer end to end on a real Windows machine
(the CI job produces it, nobody has installed it yet), and the app builds with
Electron's default icon-free branding beyond the generated icon.
