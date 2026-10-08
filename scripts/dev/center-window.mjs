#!/usr/bin/env node
/**
 * Place the running dsh desktop window (default: vertically centered) without
 * touching dsh's source.
 *
 * Why this exists: dsh creates its window as 1280x820 with no `x`/`y` in
 * `apps/desktop/src/main.ts`, and the dev launcher passes no position either.
 * macOS then applies its default for a positionless window: horizontally
 * centered, but flush against the **top** of the work area — and with an 820px
 * window on a 874px work area that top alignment is very visible. dsh persists
 * no window frame, exposes no geometry config, and Electron does not implement
 * CDP's Browser.setWindowBounds, so the position has to be applied from the
 * outside (or by editing dsh, which this repo's rules forbid).
 *
 * Placement modes:
 *   center  (default) — equal margins inside the work area (menu bar → Dock)
 *   bottom            — flush against the Dock (the work area's bottom edge)
 *   top N             — pin the top edge N pixels below the screen top
 *
 * The work area comes from the running app over CDP (`screen.availTop` …), so
 * it matches the menu-bar/Dock geometry exactly; if CDP is unreachable the
 * screen bounds are used as a fallback.
 *
 * Moving another app's window needs **Accessibility** permission for whatever
 * runs this script (System Settings → Privacy & Security → Accessibility).
 * Without it macOS answers `-1719 …not allowed assistive access`.
 *
 * Usage:
 *   node scripts/dev/center-window.mjs                        # vertical + horizontal center
 *   node scripts/dev/center-window.mjs --mode bottom           # hug the Dock
 *   node scripts/dev/center-window.mjs --top 120               # pin the top edge
 *   node scripts/dev/center-window.mjs --window "DSH 本地构建"   # another window title
 *   node scripts/dev/center-window.mjs --wait 180              # poll until the window exists
 *   node scripts/dev/center-window.mjs --probe                 # report the position, move nothing
 */
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const readFlag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}

const windowTitle = readFlag('window', 'DSH 本地构建')
const topPin = readFlag('top', '')
/** `center` (default) or `bottom`; `--top N` takes precedence. */
const mode = topPin !== '' ? 'top' : readFlag('mode', 'center')
/** Seconds to keep polling for the window before giving up (0 = single try). */
const waitSeconds = Number(readFlag('wait', '0'))
/** Report the current position and exit (exit 1 when the window is absent). */
const probeOnly = args.includes('--probe')
const configuredPort = readFlag('port', process.env.DSH_CDP_PORT ?? process.env.DSH_DESKTOP_RENDERER_DEBUG_PORT ?? '')
/** Ports to try when the configured one has no dsh page (dsh's inspector port
 * moves around, and other Electron apps squat on 9222). */
const candidatePorts = configuredPort === ''
  ? ['9222', '9223', '9224', '9225', '9231']
  : [configuredPort, '9222', '9223', '9224', '9225']

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const osa = script => execFileSync('osascript', ['-e', script], { encoding: 'utf8', timeout: 15_000 }).trim()

/** The work area (menu bar and Dock excluded) as the app itself sees it. */
async function workArea() {
  try {
    let page
    for (const port of candidatePorts) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        page = list.find(target => target.type === 'page' && target.url.includes('dsh-app'))
        if (page !== undefined) break
      } catch {
        continue
      }
    }
    if (page === undefined) throw new Error('no dsh-app target on any known inspector port')
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
    const answer = await new Promise(resolve => {
      ws.onmessage = event => resolve(JSON.parse(event.data))
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: 'JSON.stringify({ top: screen.availTop, left: screen.availLeft, width: screen.availWidth, height: screen.availHeight, screenWidth: screen.width, screenHeight: screen.height })',
          returnByValue: true,
        },
      }))
    })
    ws.close()
    const value = answer.result?.result?.value
    if (typeof value !== 'string') throw new Error('unexpected CDP answer')
    return JSON.parse(value)
  } catch (error) {
    console.error(`note: work area unavailable over CDP (${String(error.message)}); falling back to the screen bounds`)
    return undefined
  }
}

/** Screen bounds straight from Finder (menu bar and Dock included). */
const screenBounds = () => osa('tell application "Finder" to return bounds of window of desktop').split(', ').map(Number)

/** Foreground applications' name plus window title/position/size, as AppleScript sees them. */
const windowQuery = `tell application "System Events"
  repeat with p in (every process whose background only is false)
    try
      repeat with w in (every window of p)
        if (name of w) contains "${windowTitle}" then
          RESULT
        end if
      end repeat
    end try
  end repeat
end tell
return ""`

// AppleScript: `item 1 of (size of w)` yields nothing (the coercion is
// swallowed by the surrounding try) and `size of w as text` concatenates the
// numbers — assign to a variable first, then read its items.
const pairOf = field => `set s to ${field} of w
          return ((item 1 of s) as text) & "," & ((item 2 of s) as text)`

const windowSize = () => {
  const answer = osa(windowQuery.replace('RESULT', pairOf('size')))
  if (answer === '') {
    const error = new Error(`no window titled ${windowTitle}`)
    error.noWindow = true
    throw error
  }
  return answer.split(',').map(Number)
}

const position = () => osa(windowQuery.replace('RESULT', pairOf('position')))
const place = (x, y) => osa(windowQuery.replace('RESULT', `set position of w to {${String(x)}, ${String(y)}}`))

const target = (area, winW, winH) => {
  const region = area ?? (() => {
    const [x0, y0, x1, y1] = screenBounds()
    return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 }
  })()
  const x = region.left + Math.round((region.width - winW) / 2)
  if (mode === 'top') return { x, y: Number(topPin) }
  if (mode === 'bottom') return { x, y: region.top + region.height - winH }
  return { x, y: region.top + Math.round((region.height - winH) / 2) }
}

try {
  const deadline = Date.now() + waitSeconds * 1000
  let size
  for (;;) {
    try {
      size = windowSize()
      break
    } catch (error) {
      const message = String(error.stderr ?? error.message)
      const missing = error.noWindow === true || message.includes('-1728') || message.includes('-2700') || message.includes('no window titled')
      if (!missing || Date.now() > deadline) throw error
      await sleep(2000)
    }
  }

  if (probeOnly) {
    console.log(position().replace(',', ' '))
    process.exit(0)
  }

  const area = await workArea()
  const want = target(area, size[0] ?? 0, size[1] ?? 0)
  place(want.x, want.y)

  // The app can still be placing its window while it boots, which overrides the
  // first move; re-apply until the position sticks.
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(waitSeconds > 0 ? 1200 : 250)
    const now = position().split(',').map(Number)
    if (Math.abs((now[0] ?? 0) - want.x) <= 2 && Math.abs((now[1] ?? 0) - want.y) <= 2) break
    place(want.x, want.y)
  }
  const areaText = area === undefined ? 'screen' : `work area (${String(area.left)},${String(area.top)}) ${String(area.width)}x${String(area.height)}`
  console.log(`mode=${mode} window=${size.join('x')} ${areaText} -> ${position()} (wanted ${want.x},${want.y})`)
} catch (error) {
  const message = String(error.stderr ?? error.message)
  if (message.includes('-1719') || message.includes('assistive access')) {
    console.error('需要「辅助功能」权限：系统设置 → 隐私与安全性 → 辅助功能，勾选运行本脚本的程序（终端 / ZCode），然后重试。')
  } else {
    console.error(message.trim())
  }
  process.exit(1)
}