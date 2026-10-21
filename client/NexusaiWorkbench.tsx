/**
 * The NexusAI workbench panel: one sidebar entry (专家 · 技能 · 连接器) with
 * three capability tabs — 专家 (custom and built-in tools), 技能 (skills), 连接器 (MCP
 * servers) — laid out like the reference product's capability panels
 * (cap-header with cap-tabs, section head with h1 + border-bottom, card grid on
 * the host's --dsw-alias-* tokens, centered empty states).
 *
 * Signed out, the tabs hide and the page shows the sign-in CTA; signed in,
 * all three lists load once and the 同步能力 action refreshes them.
 */
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button, IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular, IconDownloadOutlineRegular, IconLinkOutlineMedium, IconLoadingOutlineRegular, IconNewChatOutlineRegular, IconPlusOutlineRegular, IconSearchOutlineRegular, IconSparkleMedium, IconUserOutlineMedium, IconQuestionOutlineRegular, IconWarningOutlineRegular, Input, Checkbox, Menu, Modal, Switch, Tooltip, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { useBranding } from './NexusaiBrand'
import { NexusaiSignInDialog } from './NexusaiSignInDialog'
import type { NexusaiLocaleKey } from './locales'
import type { ConnectorAuthorRequestFace, ConnectorBundleSummaryFace, ConnectorToolsResultFace, LocalSkillEntryFace, LocalSkillInstallRequestFace, NexusaiAuthOps, NexusaiCapabilitiesOps, NexusaiSnapshot, SkillHubCardFace, SkillHubDetailFace, SlashSkillFace, SlashSkillsOps } from './face'

/** The three capability tabs, in the reference product's order. Labels come
 * from the locale dictionary (`tabExperts`/`tabSkills`/`tabConnectors`). */
const TABS = ['experts', 'skills', 'connectors'] as const
type TabKey = (typeof TABS)[number]

/** One glyph per capability tab, matching the reference product's tabs. */
const TAB_ICONS: Record<TabKey, ReactNode> = {
  experts: <IconUserOutlineMedium size={16} />,
  skills: <IconSparkleMedium size={16} />,
  connectors: <IconLinkOutlineMedium size={16} />,
}

/** The workbench's spread props from the `main` slot registration. */
export interface NexusaiWorkbenchProps {
  readonly useNexusai?: (selector: (snapshot: NexusaiSnapshot) => NexusaiSnapshot) => NexusaiSnapshot
  readonly auth?: NexusaiAuthOps
  readonly capabilities?: NexusaiCapabilitiesOps
  /** The conversation "/" menu catalog, exactly as the slash menu lists it. */
  readonly slashSkills?: SlashSkillsOps
  readonly t?: (key: NexusaiLocaleKey) => string
}

interface ToolCard { name: string; description: string; intranet?: boolean }
interface BuiltinToolCard { toolSquareId: string; name: string; description: string; tags: string[]; intranet?: boolean }
interface SkillCard { skillId: string; name: string; description: string; author: string }
/** One 本地 connector card: a patch row (with the raw config the editor needs)
 * or a custom SSE connector's bridge state. */
interface LocalConnector {
  id: string
  name: string
  transport: string
  url: string
  serverName?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  headers?: Record<string, string>
  enabled: boolean
  connected: boolean
  toolCount: number
  /** Per-call budget in seconds as stored (0 = the 60 s default). */
  timeoutSeconds?: number
  bridgeError?: string
}
type LocalConnectorRow = LocalConnector

interface ConnectorCard {
  /** Catalogue id; the host derives the row's serverName from it. */
  id?: string
  mcpServerId: string
  name: string
  desc: string
  toolNum: number
  source: 'created' | 'imported'
  transport: string
  url: string
  connectable: boolean
  /** True when this plugin bridged an SSE server's tools into dsh. */
  bridged: boolean
  /** Whether its tools are registered right now, and how many. */
  connected?: boolean
  toolCount?: number
}

/** The 专家 · 技能 · 连接器 workbench (main panel). */
export function NexusaiWorkbench({ useNexusai, auth, capabilities, slashSkills: slashSkillsOps, t }: NexusaiWorkbenchProps): ReactNode {
  const resolve = (key: NexusaiLocaleKey) => t?.(key) ?? key
  const snapshot = useNexusai?.(value => value)
  const view = snapshot?.view
  const signedIn = view?.loggedIn === true
  const [activeTab, setActiveTab] = useState<TabKey>('experts')
  const [tools, setTools] = useState<ToolCard[]>([])
  const [builtinTools, setBuiltinTools] = useState<BuiltinToolCard[]>([])
  const [expertSource, setExpertSource] = useState<'custom' | 'builtin'>('custom')
  const [intranetHint, setIntranetHint] = useState<{ x: number; y: number; maxWidth: number } | null>(null)
  const showIntranetHint = (event: MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setIntranetHint({
      x: rect.left + rect.width / 2,
      y: rect.bottom - 12,
      maxWidth: Math.max(120, rect.width - 28),
    })
  }
  useEffect(() => {
    if (intranetHint === null) return
    const hide = () => { setIntranetHint(null) }
    window.addEventListener('scroll', hide, true)
    return () => { window.removeEventListener('scroll', hide, true) }
  }, [intranetHint])
  const [skills, setSkills] = useState<SkillCard[]>([])
  const [connectors, setConnectors] = useState<ConnectorCard[]>([])
  // 连接器 has the same two sources as 技能: 本地 (this machine's own
  // mcp-client rows) and 远程获取 (the NexusAI catalog).
  const [connectorSource, setConnectorSource] = useState<'local' | 'remote'>('remote')
  const [localConnectors, setLocalConnectors] = useState<LocalConnectorRow[]>([])
  // 连接器 search, one query per source (same shape as 技能).
  const [localConnectorQuery, setLocalConnectorQuery] = useState('')
  const [remoteConnectorQuery, setRemoteConnectorQuery] = useState('')
  // 自定义连接器: a four-item menu, then one dialog per route.
  const [addConnectorOpen, setAddConnectorOpen] = useState(false)
  const [connectorDialog, setConnectorDialog] = useState<'quick' | 'json' | 'bundle' | undefined>(undefined)
  /** Which of the two bundle labels opened the dialog (DXT / MCPB — the same format). */
  const [bundleRoute, setBundleRoute] = useState<'dxt' | 'mcpb'>('mcpb')
  const [connectorBusy, setConnectorBusy] = useState(false)
  // 连接器详情：which connector is open, its tools, and its card's "…" menu.
  const [connectorDetail, setConnectorDetail] = useState<{ id: string; name: string; transport: string; url: string; source: 'local' | 'remote'; authored: boolean } | undefined>(undefined)
  const [connectorToolList, setConnectorToolList] = useState<ConnectorToolsResultFace | undefined>(undefined)
  const [connectorDetailLoading, setConnectorDetailLoading] = useState(false)
  const [connectorMenuId, setConnectorMenuId] = useState('')
  /** The connector an open dialog is editing ('' when adding a new one). */
  const [editTarget, setEditTarget] = useState('')
  const [connectorConfirmRemove, setConnectorConfirmRemove] = useState('')
  const [copiedTool, setCopiedTool] = useState('')
  const [connectorError, setConnectorError] = useState('')
  const [quickForm, setQuickForm] = useState({
    name: '', transport: 'stdio', command: '', args: '', env: '', url: '', headers: '',
    // 超时（秒）；空串表示默认 60 秒
    timeoutSeconds: '',
  })
  const [connectorJson, setConnectorJson] = useState('')
  const [bundlePath, setBundlePath] = useState('')
  const [bundleSummary, setBundleSummary] = useState<ConnectorBundleSummaryFace | undefined>(undefined)
  const [bundleValues, setBundleValues] = useState<Record<string, string>>({})
  const connectorFileInput = useRef<HTMLInputElement | null>(null)
  const fieldFileInput = useRef<HTMLInputElement | null>(null)
  const fieldFileTarget = useRef('')
  const [downloaded, setDownloaded] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  // Login-page branding from the server (GET /v1/base/custom, the same source
  // the web frontend renders from); {name} slots in the tab descriptions. Read
  // through the shared hook so this and the sidebar cannot disagree: one cache,
  // and one invalidation point (the address change in the sign-in dialog).
  const branding = useBranding(auth)
  const productName = (branding?.name ?? '').trim()
  // Skill sources: 本地 = the conversation "/" menu catalog (read live on
  // each visit), SkillHub = not integrated yet, 远程 = the NexusAI catalog
  // (fetched, downloadable).
  const [skillSource, setSkillSource] = useState<'local' | 'skillhub' | 'remote'>('remote')
  const [slashList, setSlashList] = useState<SlashSkillFace[]>([])
  // One query per skill source: the box searches whatever list is on screen
  // (本地 / SkillHub / 远程获取), not always the marketplace.
  const [localQuery, setLocalQuery] = useState('')
  const [remoteQuery, setRemoteQuery] = useState('')
  const [slashLoading, setSlashLoading] = useState(false)
  // 本地 tab: 关闭-ed skills live on disk only (`SKILL.md.disabled`), plus the
  // per-card switch / hover "…" actions, and the local skill detail view.
  const [localDisabled, setLocalDisabled] = useState<LocalSkillEntryFace[]>([])
  // Just-enabled skills, kept visible until the registry catalog catches up
  // with the rename (it lags the filesystem by a moment).
  const [localPending, setLocalPending] = useState<LocalSkillEntryFace[]>([])
  // Skill files the registry still lists but that are gone from disk.
  const [localMissing, setLocalMissing] = useState<string[]>([])
  const [localBusy, setLocalBusy] = useState('')
  const [localMenuPath, setLocalMenuPath] = useState('')
  const [localConfirmRemove, setLocalConfirmRemove] = useState('')
  const [localDetail, setLocalDetail] = useState<{ entry: LocalSkillEntryFace; content: string; loading: boolean } | undefined>(undefined)
// SkillHub marketplace (api.skillhub.cn): featured list loads on first visit,
  // search and category chips refine it, "+" installs into the local root.
  // Cards paginate on scroll: the grid is the only region that scrolls, and
  // scrolling near the bottom appends the next page.
  const [hubKeyword, setHubKeyword] = useState('')
  const [hubCategory, setHubCategory] = useState('')
  const [hubPage, setHubPage] = useState(1)
  const [hubTotal, setHubTotal] = useState(0)
  const [hubCards, setHubCards] = useState<SkillHubCardFace[] | undefined>(undefined)
  const [hubLoading, setHubLoading] = useState(false)
  const [hubEnd, setHubEnd] = useState(false)
  const [hubCategories, setHubCategories] = useState<{ key: string; label: string }[]>([])
  const [hubInstalling, setHubInstalling] = useState('')
  const [hubInstalled, setHubInstalled] = useState<Record<string, string>>({})
  const hubScrollRef = useRef<HTMLDivElement | null>(null)
  // The category row scrolls horizontally (the taxonomy is wider than the
  // panel); arrows page it a viewport at a time and dim at the ends.
  const chipsRef = useRef<HTMLDivElement | null>(null)
  const [chipEdges, setChipEdges] = useState({ overflow: false, left: false, right: false })
  // Card → detail view (a full-panel page with a back button, like the
  // reference product): header from the card immediately, then the fetched
  // detail, then the SKILL.md preview.
  const [hubDetail, setHubDetail] = useState<SkillHubDetailFace | undefined>(undefined)
  const [hubDetailLoading, setHubDetailLoading] = useState(false)
  const [hubPreview, setHubPreview] = useState<string | undefined>(undefined)
  const [hubPreviewLoading, setHubPreviewLoading] = useState(false)
  const [hubPreviewMode, setHubPreviewMode] = useState<'preview' | 'code'>('preview')
  const [hubSummaryExpanded, setHubSummaryExpanded] = useState(false)

  // ＋添加技能: a two-item menu (查找技能 / 上传技能) plus the upload dialog.
  // The dialog stays open on failure so a retry needs no reopening; a name
  // that already exists comes back as `exists` and only 覆盖安装 re-sends.
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [uploadPicked, setUploadPicked] = useState('')
  // What a staged upload came from: a host path (the desktop panel) or an
  // in-memory request (a drop, or a pick without the path bridge). The 覆盖安装
  // retry re-sends the same one.
  const [uploadSource, setUploadSource] = useState<UploadSource | undefined>(undefined)
  const [uploadExists, setUploadExists] = useState('')
  // 非高风险自动安装: a staged upload starts installing on its own. An existing
  // skill name still stops for the 覆盖安装 confirmation.
  const [uploadAuto, setUploadAuto] = useState(false)
  const [uploadDragging, setUploadDragging] = useState(false)
  // A successful install reads back as a panel-level notice (the dialog is
  // closed by then): what was installed, and where the 本地 list shows it.
  const [notice, setNotice] = useState('')
  const fileInput = useRef<HTMLInputElement | null>(null)
  // 查找技能 hands the cursor to the search box; the token re-runs the focus
  // effect even when the source was already SkillHub.
  const searchInput = useRef<HTMLInputElement | null>(null)
  const [searchFocus, setSearchFocus] = useState(0)

  /** Re-measure the category row: overflow at all, and reachable ends. */
  const measureChips = (): void => {
    const el = chipsRef.current
    if (el === null) return
    const overflow = el.scrollWidth > el.clientWidth + 1
    const left = overflow && el.scrollLeft > 1
    const right = overflow && el.scrollLeft < el.scrollWidth - el.clientWidth - 1
    setChipEdges(current => current.overflow === overflow && current.left === left && current.right === right
      ? current
      : { overflow, left, right })
  }

  const pageChips = (direction: -1 | 1): void => {
    const el = chipsRef.current
    if (el === null) return
    el.scrollBy({ left: direction * Math.max(Math.round(el.clientWidth * 0.8), 160), behavior: 'smooth' })
  }

  // Measure once the row is painted (and again when the taxonomy lands).
  useEffect(() => {
    const frame = requestAnimationFrame(measureChips)
    const onResize = (): void => { measureChips() }
    window.addEventListener('resize', onResize)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', onResize) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubCategories, skillSource])

  // The server total counts every matching row; dedupe may drop some, so an
  // empty page also means the end — otherwise the list would fetch forever.
  const hubHasMore = !hubEnd && (hubCards?.length ?? 0) < hubTotal

  const fetchHub = async (keyword: string, category: string, page: number, mode: 'replace' | 'append'): Promise<void> => {
    if (capabilities === undefined) return
    setHubLoading(true)
    setError('')
    try {
      const result = await capabilities.searchSkillHub(keyword, category, page)
      setHubTotal(result.total)
      setHubPage(page)
      if (mode === 'append' && result.cards.length === 0) setHubEnd(true)
      if (mode === 'replace') setHubEnd(false)
      setHubCards(current => {
        if (mode === 'replace' || current === undefined) return result.cards
        const seen = new Set(current.map(card => card.id))
        return [...current, ...result.cards.filter(card => !seen.has(card.id))]
      })
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? String(cause))
      if (mode === 'replace') setHubCards([])
    } finally {
      setHubLoading(false)
    }
  }

  /** Replace with a fresh first page (search / category change) and go to top. */
  const hubRefresh = (keyword: string, category: string): void => {
    hubScrollRef.current?.scrollTo({ top: 0 })
    void fetchHub(keyword, category, 1, 'replace')
  }

  /** Infinite scroll: near the bottom, append the next page. */
  const onHubScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    const el = event.currentTarget
    if (hubLoading || !hubHasMore) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
      void fetchHub(hubKeyword, hubCategory, hubPage + 1, 'append')
    }
  }

  // Entering the SkillHub tab: load the taxonomy, the featured list, and the
  // local catalog (so installed skills can be marked).
  const enterHub = async (): Promise<void> => {
    if (capabilities === undefined) return
    void loadSlashSkills()
    if (hubCategories.length === 0) {
      void capabilities.skillhubCategories().then(setHubCategories, () => undefined)
    }
    if (hubCards === undefined) await fetchHub('', '', 1, 'replace')
  }

  const installHub = async (id: string): Promise<void> => {
    if (capabilities === undefined) return
    setHubInstalling(id)
    setError('')
    try {
      const result = await capabilities.installSkillHub(id)
      setHubInstalled(current => ({ ...current, [id]: result.path }))
      void loadSlashSkills()
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? String(cause))
    } finally {
      setHubInstalling('')
    }
  }

  // ＋添加技能 → 查找技能: the marketplace is the search surface, so the source
  // switches there and the cursor lands in its box (the token re-runs the
  // focus effect even when SkillHub was already selected).
  const findSkill = (): void => {
    setAddMenuOpen(false)
    setSkillSource('skillhub')
    void enterHub()
    setSearchFocus(value => value + 1)
  }

  const startUpload = (): void => {
    setAddMenuOpen(false)
    setUploadOpen(true)
    setUploadError('')
    setUploadPicked('')
    setUploadExists('')
    setUploadSource(undefined)
  }

  const closeUpload = (): void => {
    if (uploadBusy) return
    setUploadOpen(false)
  }

  /** Stage one upload. With 非高风险自动安装 on it installs straight away; an
   * existing name still stops at the 覆盖安装 confirmation either way. */
  const stageUpload = (label: string, source: UploadSource): void => {
    setUploadPicked(label)
    setUploadSource(source)
    if (uploadAuto) void submitUpload(false, source)
  }

  /** Reset the previous attempt's outcome before a new pick or drop. */
  const clearUploadAttempt = (): void => {
    setUploadError('')
    setUploadExists('')
    setUploadSource(undefined)
    setUploadPicked('')
  }

  /** Send a staged upload. `overwrite` is the dialog's explicit second attempt
   * after the host reported that the skill directory already exists. */
  const submitUpload = async (overwrite: boolean, source: UploadSource | undefined = uploadSource): Promise<void> => {
    if (capabilities === undefined || source === undefined) return
    setUploadBusy(true)
    setUploadError('')
    try {
      const result = source.kind === 'path'
        ? await capabilities.installUploadedPath(source.path, overwrite)
        : await capabilities.installUploadedSkill(source.request, overwrite)
      if (!result.installed) {
        setUploadExists(result.name)
        return
      }
      setUploadOpen(false)
      setUploadExists('')
      setUploadSource(undefined)
      setNotice(`${resolve('uploadDone')}：${result.name}`)
      setSkillSource('local')
      // The registry discovers a new skill directory on its own; a few silent
      // reads put it in the 本地 list without the user leaving the tab.
      refreshLocalUntilSettled()
    } catch (cause) {
      setUploadError((cause as { message?: string })?.message ?? String(cause))
    } finally {
      setUploadBusy(false)
    }
  }

  /** A skill folder — picked through the directory picker or dropped on the
   * zone. The SKILL.md and name checks run here so the dialog answers
   * immediately; the host re-validates everything before writing. */
  const stageFolder = async (entries: readonly DroppedEntry[]): Promise<void> => {
    clearUploadAttempt()
    if (entries.length === 0) return
    const paths = entries.map(entry => entry.path)
    if (!paths.some(path => path.split('/').includes('SKILL.md'))) {
      setUploadError(resolve('uploadNoSkillFile'))
      return
    }
    if (entries.reduce((sum, entry) => sum + entry.file.size, 0) > MAX_UPLOAD_BYTES) {
      setUploadError(resolve('uploadTooLarge'))
      return
    }
    try {
      // Read every file once; the SKILL.md text also feeds the name check, so
      // an unusable bundle is refused before anything is sent.
      const read = await Promise.all(entries.map(async entry => ({
        path: entry.path,
        bytes: new Uint8Array(await entry.file.arrayBuffer()),
      })))
      const skill = read.find(entry => entry.path.split('/').includes('SKILL.md'))
      const front = skill === undefined ? { name: '', description: '' } : frontmatterOf(new TextDecoder().decode(skill.bytes))
      if (front.name === '' || front.description === '') {
        setUploadError(resolve('uploadBadMarkdown'))
        return
      }
      if (!SKILL_NAME.test(front.name)) {
        setUploadError(`${resolve('uploadBadName')}：${front.name}`)
        return
      }
      stageUpload(paths[0]?.split('/')[0] ?? '', {
        kind: 'request',
        request: {
          kind: 'folder',
          name: front.name,
          files: read.map(entry => ({ path: entry.path, base64: base64Of(entry.bytes) })),
        },
      })
    } catch (cause) {
      setUploadError((cause as { message?: string })?.message ?? String(cause))
    }
  }

  /** A single picked or dropped file — the one 「点击上传」 entry. The desktop
   * bridge knows the pick's real path, and a path is strictly more informative
   * than its bytes: the host can then recognise a folder's SKILL.md, a .zip or
   * a .md without the panel needing a second, folder-only button. Without the
   * bridge (a browser) the bytes are all we have. */
  const stagePickedFile = async (file: File): Promise<void> => {
    const path = hostPathOf(file)
    if (path !== '') {
      clearUploadAttempt()
      stageUpload(file.name, { kind: 'path', path })
      return
    }
    await stageFile(file)
  }

  /** A single .zip or .md. The zip is validated on the host (it is unzipped
   * there); the markdown's front matter is checked here. */
  const stageFile = async (file: File): Promise<void> => {
    clearUploadAttempt()
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError(resolve('uploadTooLarge'))
      return
    }
    if (!/\.zip$/i.test(file.name) && !/\.md$/i.test(file.name)) {
      setUploadError(resolve('uploadNoSkillFile'))
      return
    }
    try {
      if (/\.zip$/i.test(file.name)) {
        stageUpload(file.name, {
          kind: 'request',
          request: {
            kind: 'zip',
            name: file.name.replace(/\.zip$/i, ''),
            base64: base64Of(new Uint8Array(await file.arrayBuffer())),
          },
        })
        return
      }
      const text = await file.text()
      const front = frontmatterOf(text)
      if (front.name === '' || front.description === '') {
        setUploadError(resolve('uploadBadMarkdown'))
        return
      }
      if (!SKILL_NAME.test(front.name)) {
        setUploadError(`${resolve('uploadBadName')}：${front.name}`)
        return
      }
      stageUpload(file.name, { kind: 'request', request: { kind: 'markdown', name: front.name, text } })
    } catch (cause) {
      setUploadError((cause as { message?: string })?.message ?? String(cause))
    }
  }

  const onFilePicked = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    await stagePickedFile(file)
  }

  /** A drop carries files, or folders that have to be walked: Chromium exposes
   * a directory as a `FileSystemDirectoryEntry`, and its contents carry their
   * path relative to the drop, so a dropped skill folder stages exactly like a
   * picked one. Falls back to the plain file list when the entry API is absent
   * (a drop of loose files, or a platform without it). */
  const onDrop = async (event: DragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault()
    setUploadDragging(false)
    if (uploadBusy) return
    const transfer = event.dataTransfer
    const dropped = Array.from(transfer?.files ?? [])
    const entries = Array.from(transfer?.items ?? [])
      .map(item => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
      .filter((entry): entry is FileSystemEntry => entry !== null)
    if (entries.length === 0) {
      if (dropped.length === 1) await stagePickedFile(dropped[0] as File)
      else if (dropped.length > 1) await stageFolder(dropped.map(file => ({ path: file.name, file })))
      return
    }
    const walked = await collectDropped(entries)
    if (walked.length === 0) return
    if (walked.length === 1 && walked[0]?.path.split('/').length === 1 && !/\.(zip|md)$/i.test(walked[0].path)) {
      await stageFolder(walked)
      return
    }
    if (walked.length === 1) {
      await stagePickedFile(walked[0].file)
      return
    }
    await stageFolder(walked)
  }

  // ---------- 自定义连接器 ----------
  /** Open one of the four authoring routes. */
  const startConnector = (route: 'quick' | 'json' | 'bundle', kind: 'dxt' | 'mcpb' = 'mcpb'): void => {
    setAddConnectorOpen(false)
    setConnectorError('')
    setEditTarget('')
    setConnectorDialog(route)
    if (route === 'bundle') {
      setBundleRoute(kind)
      setBundlePath('')
      setBundleSummary(undefined)
      setBundleValues({})
    }
  }

  const closeConnector = (): void => {
    if (connectorBusy) return
    setConnectorDialog(undefined)
  }

  /** Every route ends in the same call, so success reads the same everywhere:
   * close, notice, reload the 本地 list the new row lands in. */
  const runConnector = async (request: ConnectorAuthorRequestFace): Promise<void> => {
    if (capabilities === undefined) return
    setConnectorBusy(true)
    setConnectorError('')
    try {
      const result = await capabilities.authorConnector(request)
      setConnectorDialog(undefined)
      setNotice(result.message)
      setConnectorSource('local')
      await loadLocalConnectors()
      // A row's instance mounts — and registers its tools — a moment after dsh
      // reloads the patch, so the card's status dot settles on its own.
      for (const delay of [900, 1800, 3000]) {
        window.setTimeout(() => { void loadLocalConnectors() }, delay)
      }
    } catch (cause) {
      setConnectorError((cause as { message?: string })?.message ?? String(cause))
    } finally {
      setConnectorBusy(false)
    }
  }

  /** A picked bundle: read its manifest before installing, so the dialog can
   * show what it is and what it asks for. */
  const onBundlePicked = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined || capabilities === undefined) return
    setConnectorError('')
    setBundleSummary(undefined)
    const path = hostPathOf(file)
    if (path === '') {
      setConnectorError(resolve('connectorNeedDesktop'))
      return
    }
    setBundlePath(path)
    setConnectorBusy(true)
    try {
      const summary = await capabilities.describeConnectorBundle(path)
      setBundleSummary(summary)
      const values: Record<string, string> = {}
      for (const field of summary.fields) values[field.key] = field.defaultValue
      setBundleValues(values)
    } catch (cause) {
      setConnectorError((cause as { message?: string })?.message ?? String(cause))
    } finally {
      setConnectorBusy(false)
    }
  }

  /** A `directory` / `file` user_config field: the desktop bridges answer with
   * real paths, which is exactly what the manifest's placeholders want. */
  const pickUserPath = async (key: string, kind: 'directory' | 'file'): Promise<void> => {
    if (kind === 'directory') {
      const picker = (globalThis as { __DSH_DIRECTORY_PICKER__?: { pick?: () => Promise<string | null> } }).__DSH_DIRECTORY_PICKER__
      try {
        const path = await picker?.pick?.()
        if (typeof path === 'string' && path !== '') setBundleValues(current => ({ ...current, [key]: path }))
      } catch {
        // A dismissed chooser is not an error.
      }
      return
    }
    fieldFileTarget.current = key
    fieldFileInput.current?.click()
  }

  const onFieldFilePicked = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    const path = hostPathOf(file)
    const key = fieldFileTarget.current
    if (path === '' || key === '') {
      setConnectorError(resolve('connectorNeedDesktop'))
      return
    }
    setBundleValues(current => ({ ...current, [key]: path }))
  }

  /** Open one connector: its tools come from the dsh registry (see
   * `ConnectorTools`) — the same schemas the model is given. */
  const openConnectorDetail = async (entry: { id: string; name: string; transport: string; url: string; source: 'local' | 'remote'; authored: boolean }): Promise<void> => {
    setConnectorDetail(entry)
    setConnectorMenuId('')
    setConnectorConfirmRemove('')
    setConnectorToolList(undefined)
    if (capabilities === undefined) return
    setConnectorDetailLoading(true)
    try {
      setConnectorToolList(await capabilities.connectorTools(entry.id))
    } catch (cause) {
      setConnectorToolList({ tools: [], error: (cause as { message?: string })?.message ?? String(cause) })
    } finally {
      setConnectorDetailLoading(false)
    }
  }

  /** 删除连接器: only connectors authored here are removable (the host refuses
   * the rest, so a hand-written config row cannot be lost from this panel). */
  const removeConnector = async (id: string): Promise<void> => {
    if (capabilities === undefined) return
    setConnectorBusy(true)
    setError('')
    try {
      const result = await capabilities.removeConnector(id)
      setNotice(result.removed ? resolve('connectorRemoved') : resolve('connectorDetailNoTools'))
      setConnectorConfirmRemove('')
      setConnectorMenuId('')
      setConnectorDetail(undefined)
      await loadLocalConnectors()
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? String(cause))
    } finally {
      setConnectorBusy(false)
    }
  }

  /** 编辑: reopen the authoring form with this connector's values; submitting
   * replaces it in place (previousId) instead of adding a second one. */
  const editConnector = (entry: LocalConnectorRow): void => {
    setConnectorMenuId('')
    setConnectorDetail(undefined)
    setConnectorError('')
    setConnectorDialog(entry.transport === 'sse' ? 'quick' : 'quick')
    setQuickForm({
      name: entry.name,
      transport: entry.transport === '' ? 'stdio' : entry.transport,
      command: entry.command ?? '',
      args: (entry.args ?? []).join('\n'),
      env: Object.entries(entry.env ?? {}).map(([key, value]) => `${key}=${value}`).join('\n'),
      url: entry.url,
      headers: Object.entries(entry.headers ?? {}).map(([key, value]) => `${key}: ${value}`).join('\n'),
      timeoutSeconds: entry.timeoutSeconds !== undefined && entry.timeoutSeconds > 0 ? String(entry.timeoutSeconds) : '',
    })
    setEditTarget(entry.id)
  }

  /** 打开/关闭 one local connector: a row's `disabled` flag, or the SSE entry's
   * stored flag (its bridge session is dropped or re-established). The list is
   * re-read a few times: a re-enabled row's instance mounts — and registers its
   * tools — a moment after dsh reloads the patch. */
  const toggleConnector = async (entry: LocalConnectorRow): Promise<void> => {
    if (capabilities === undefined) return
    setConnectorBusy(true)
    setError('')
    try {
      await capabilities.setConnectorEnabled(entry.id, !entry.enabled)
      await loadLocalConnectors()
      for (const delay of [900, 1800, 3000]) {
        window.setTimeout(() => { void loadLocalConnectors() }, delay)
      }
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? String(cause))
    } finally {
      setConnectorBusy(false)
    }
  }

  // 查找技能's cursor: runs after the source switch has rendered the toolbar.
  useEffect(() => {
    if (searchFocus === 0 || skillSource !== 'skillhub') return
    searchInput.current?.focus()
    searchInput.current?.select()
  }, [searchFocus, skillSource])

  // An install notice is a receipt, not a state: it retires on its own.
  useEffect(() => {
    if (notice === '') return undefined
    const timer = window.setTimeout(() => { setNotice('') }, 8000)
    return () => { window.clearTimeout(timer) }
  }, [notice])

  /** Open a card's detail view: an instant header from the card itself, the
   * fetched detail, and the SKILL.md preview (loaded separately so the header
   * never waits on the package download). */
  const openDetail = (card: SkillHubCardFace): void => {
    if (capabilities === undefined) return
    setHubDetail(detailFromCard(card))
    setHubDetailLoading(true)
    setHubPreview(undefined)
    setHubPreviewMode('preview')
    setHubSummaryExpanded(false)
    setError('')
    void capabilities.skillhubDetail(card.id).then(
      detail => { setHubDetail(current => current?.id === card.id ? detail : current) },
      (cause: unknown) => {
        setError((cause as { message?: string })?.message ?? String(cause))
        setHubDetailLoading(false)
      },
    ).finally(() => { setHubDetailLoading(false) })
    setHubPreviewLoading(true)
    void capabilities.skillhubPreview(card.id).then(
      text => { setHubPreview(text) },
      () => { setHubPreview('') },
    ).finally(() => { setHubPreviewLoading(false) })
  }

  const closeDetail = (): void => {
    setHubDetail(undefined)
    setHubPreview(undefined)
    setHubPreviewLoading(false)
  }

  /** Read the "/" catalog. Refreshes run silently: a list that is already on
   * screen must not flick back to the loading placeholder, and an unchanged
   * list keeps its previous array so React skips the re-render entirely. */
  const sameSkillList = (left: SlashSkillFace[], right: SlashSkillFace[]): boolean => left.length === right.length
    && left.every((skill, index) => skill.name === right[index]?.name
      && skill.path === right[index]?.path
      && skill.description === right[index]?.description)

  const loadSlashSkills = async (): Promise<void> => {
    if (slashSkillsOps === undefined) return
    setSlashLoading(true)
    try {
      const listed = await slashSkillsOps.list()
      setSlashList(current => sameSkillList(current, listed) ? current : listed)
      void loadDisabledLocal()
      void loadMissingLocal(listed.map(skill => skill.path).filter((path): path is string => path !== undefined))
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? String(cause))
    } finally {
      setSlashLoading(false)
    }
  }

  /** Poll the catalog a few times while the registry catches up with a rename
   * or a delete — silent refreshes, so nothing flashes meanwhile. */
  const refreshLocalUntilSettled = (attempts = 4): void => {
    const tick = (left: number): void => {
      window.setTimeout(() => {
        void loadSlashSkills().then(() => { if (left > 1) tick(left - 1) })
      }, 800)
    }
    tick(attempts)
  }

/** Skill roots: the directories of the enabled skills the registry reports. */
  const skillRoots = (): string[] => {
    const roots = new Set<string>()
    for (const skill of slashList) {
      if (skill.path === undefined) continue
      const parts = skill.path.split('/')
      if (parts.length >= 3) roots.add(parts.slice(0, -2).join('/'))
    }
    for (const entry of localDisabled) {
      const parts = entry.path.split('/')
      if (parts.length >= 3) roots.add(parts.slice(0, -2).join('/'))
    }
    return [...roots]
  }

  /** 本地 tab rows: enabled skills from the registry + 关闭-ed ones from disk.
   * The registry can lag a rename by a moment, so a directory that carries a
   * `SKILL.md.disabled` wins over a still-listed enabled entry (no duplicates). */
  const directoryOf = (file: string): string => file.split('/').slice(0, -1).join('/')
  /** The instruction file a 关闭-ed skill gets back when it is 启用-ed. */
  const enabledPathOf = (file: string): string => file.endsWith('/SKILL.md.disabled')
    ? file.slice(0, -'.disabled'.length)
    : file
  const localEntries = (): LocalSkillEntryFace[] => {
    const offDirectories = new Set(localDisabled.map(entry => directoryOf(entry.path)))
    const catalogDirectories = new Set(slashList
      .filter(skill => skill.path !== undefined)
      .map(skill => directoryOf(skill.path as string)))
    const enabled = slashList
      .filter(skill => skill.path === undefined
        || (!offDirectories.has(directoryOf(skill.path)) && !localMissing.includes(skill.path)))
      .map(skill => ({
        name: skill.name,
        description: skill.description,
        path: skill.path ?? '',
        enabled: true,
      }))
    const pending = localPending.filter(entry => !catalogDirectories.has(directoryOf(entry.path))
      && !offDirectories.has(directoryOf(entry.path)))
    // Name order throughout: a skill that is 关闭-ed keeps its place in the
    // list (it does not jump to the end), so toggling never reshuffles rows.
    return [...enabled, ...pending, ...localDisabled].sort((left, right) => left.name.localeCompare(right.name))
  }
  const localList = localEntries()
  const matchesQuery = (text: string, query: string): boolean =>
    query.trim() === '' || text.toLowerCase().includes(query.trim().toLowerCase())
  const localMatches = localQuery.trim() === ''
    ? localList
    : localList.filter(entry => matchesQuery(`${entry.name} ${entry.description} ${entry.path}`, localQuery))
  const remoteMatches = remoteQuery.trim() === ''
    ? skills
    : skills.filter(skill => matchesQuery(`${skill.name} ${skill.description} ${skill.author}`, remoteQuery))
  const localConnectorMatches = localConnectorQuery.trim() === ''
    ? localConnectors
    : localConnectors.filter(server => matchesQuery(`${server.name} ${server.transport} ${server.url}`, localConnectorQuery))
  const remoteConnectorMatches = remoteConnectorQuery.trim() === ''
    ? connectors
    : connectors.filter(server => matchesQuery(`${server.name} ${server.desc} ${server.source}`, remoteConnectorQuery))
  const connectorSearchValue = connectorSource === 'local' ? localConnectorQuery : remoteConnectorQuery
  const searchValue = skillSource === 'skillhub' ? hubKeyword : skillSource === 'local' ? localQuery : remoteQuery
  // 远程来源的占位符与来源标签同样拼接动态品牌名（品牌为空则退回纯文案）。
  const remotePlaceholder = resolve('remoteSearchPlaceholder')
  const searchPlaceholder = skillSource === 'skillhub'
    ? resolve('skillhubSearchPlaceholder')
    : skillSource === 'local'
      ? resolve('localSearchPlaceholder')
      : productName === '' ? remotePlaceholder : `${remotePlaceholder} · ${productName}`
  const onSearchChange = (value: string): void => {
    if (skillSource === 'skillhub') setHubKeyword(value)
    else if (skillSource === 'local') setLocalQuery(value)
    else setRemoteQuery(value)
  }
  const onSearchEnter = (): void => {
    // Only the marketplace search hits the server; the other two filter locally.
    if (skillSource === 'skillhub') hubRefresh(hubKeyword, hubCategory)
  }

  const loadDisabledLocal = async (): Promise<void> => {
    if (capabilities === undefined) return
    try {
      setLocalDisabled(await capabilities.disabledLocalSkills(skillRoots()))
    } catch {
      setLocalDisabled([])
    }
  }

  /** Drop entries the registry still lists although their file is gone. */
  const loadMissingLocal = async (paths: string[]): Promise<void> => {
    if (capabilities === undefined || paths.length === 0) {
      setLocalMissing([])
      return
    }
    try {
      setLocalMissing(await capabilities.missingLocalSkills(paths))
    } catch {
      setLocalMissing([])
    }
  }

  const toggleLocal = async (entry: LocalSkillEntryFace): Promise<void> => {
    if (capabilities === undefined || entry.path === '') return
    setLocalBusy(entry.path)
    setError('')
    try {
      const next = !entry.enabled
      await capabilities.setLocalSkillEnabled(entry.path, next, skillRoots())
      setLocalPending(current => next
        ? [...current.filter(item => directoryOf(item.path) !== directoryOf(entry.path)),
            { ...entry, path: enabledPathOf(entry.path), enabled: true }]
        : current.filter(item => directoryOf(item.path) !== directoryOf(entry.path)))
      await loadDisabledLocal()
      refreshLocalUntilSettled()
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? String(cause))
    } finally {
      setLocalBusy('')
    }
  }

  const openLocalDetail = async (entry: LocalSkillEntryFace): Promise<void> => {
    if (capabilities === undefined) return
    setLocalMenuPath('')
    // Built-in skills ship with the app and have no file of their own, so
    // there is nothing to read (and nothing to toggle).
    if (entry.path === '') {
      setLocalDetail({ entry, content: '', loading: false })
      return
    }
    setLocalDetail({ entry, content: '', loading: true })
    try {
      const content = await capabilities.readLocalSkill(entry.path, skillRoots())
      setLocalDetail(current => current?.entry.path === entry.path ? { entry, content, loading: false } : current)
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? String(cause))
      setLocalDetail(current => current?.entry.path === entry.path ? { entry, content: '', loading: false } : current)
    }
  }

  const removeLocal = async (entry: LocalSkillEntryFace): Promise<void> => {
    if (capabilities === undefined || entry.path === '') return
    setLocalBusy(entry.path)
    setError('')
    try {
      await capabilities.removeLocalSkill(entry.path, skillRoots())
      setLocalMenuPath('')
      setLocalConfirmRemove('')
      setLocalPending(current => current.filter(item => directoryOf(item.path) !== directoryOf(entry.path)))
      await loadDisabledLocal()
      refreshLocalUntilSettled()
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? String(cause))
    } finally {
      setLocalBusy('')
    }
  }

  const spinner = <IconLoadingOutlineRegular size={14} className="nexusai-spinner" />

  const loadLocalConnectors = async (): Promise<void> => {
    if (capabilities === undefined) return
    try {
      setLocalConnectors(await capabilities.listLocalMcpServers())
    } catch {
      setLocalConnectors([])
    }
  }

  const loadLists = async (): Promise<void> => {
    if (capabilities === undefined) return
    setLoading(true)
    setError('')
    try {
      const [toolList, builtinList, skillList, connectorList] = await Promise.all([
        capabilities.listCustomTools().catch(() => []),
        capabilities.listBuiltinTools().catch(() => []),
        capabilities.listSkills().catch(() => []),
        capabilities.listMcpServers().catch(() => []),
      ])
      setTools(toolList ?? [])
      setBuiltinTools(builtinList ?? [])
      setSkills(skillList ?? [])
      setConnectors(connectorList ?? [])
    } finally {
      setLoading(false)
    }
  }

  // A sign-out (or sign-in) can hide the active tab / source; fall back to one
  // that is still there instead of rendering a hidden view.
  useEffect(() => {
    if (!visibleTabs.includes(activeTab)) setActiveTab('skills')
    if (!visibleSources.includes(skillSource)) setSkillSource('local')
    if (!visibleConnectorSources.includes(connectorSource)) setConnectorSource('local')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn])

  useEffect(() => {
    if (capabilities === undefined) return
    void loadLocalConnectors()
    if (!signedIn) {
      // NexusAI-backed lists are meaningless without a session; the local
      // catalog and the marketplace still load.
      setTools([])
      setBuiltinTools([])
      setSkills([])
      setConnectors([])
      setDownloaded({})
      void loadSlashSkills()
      if (hubCards === undefined) void enterHub()
      return
    }
    void loadLists()
    // Switching the organization re-syncs the host; reload the lists too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, view?.orgId])

  // Signed out the panel still works: 本地 skills and the SkillHub marketplace
  // need no account, so only the NexusAI-backed pieces (专家 tab, 远程获取,
  // synced connector data) step aside.
  if (capabilities === undefined) {
    return (
      <section className="nexusai-wb">
        <style>{WORKBENCH_CSS}</style>
        <div className="nexusai-empty">
          <strong>{resolve('signedOutTitle')}</strong>
          <p className="muted">{resolve('signedOutHint')}</p>
          <div className="empty-actions">
            <Button variant="primary" onClick={() => { setDialogOpen(true) }}>{resolve('login')}</Button>
          </div>
        </div>
        {dialogOpen && auth !== undefined && (
          <NexusaiSignInDialog auth={auth} getView={() => snapshot?.view} t={resolve} close={() => { setDialogOpen(false) }} />
        )}
      </section>
    )
  }

  const download = async (skillId: string): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const result = await capabilities.downloadSkill(skillId)
      setDownloaded(current => ({ ...current, [skillId]: result.path }))
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? String(cause))
    } finally {
      setBusy(false)
    }
  }

  // How many skills each source currently holds (the SkillHub number grows
// as its list pages in, hence "dynamic").
  const sourceCount: Record<'local' | 'skillhub' | 'remote', number> = {
    local: localList.length,
    skillhub: hubCards?.length ?? 0,
    remote: skills.length,
  }
  // Capability tabs carry the live counts (the page title row above the
  // source tabs used to repeat them, so it is gone).
  // 专家 (NexusAI tools) and 远程获取 (the NexusAI catalog) need the account;
  // everything else is local or the public marketplace.
  const visibleTabs: readonly TabKey[] = signedIn ? TABS : TABS.filter(key => key !== 'experts')
  const visibleSources: readonly ('local' | 'skillhub' | 'remote')[] = signedIn
    ? (['local', 'skillhub', 'remote'] as const)
    : (['local', 'skillhub'] as const)
  const visibleConnectorSources: readonly ('local' | 'remote')[] = signedIn
    ? (['local', 'remote'] as const)
    : (['local'] as const)
  const tabLabel: Record<TabKey, string> = {
    experts: `${resolve('tabExperts')} (${expertSource === 'builtin' ? builtinTools.length : tools.length})`,
    skills: `${resolve('tabSkills')} (${sourceCount[skillSource]})`,
    connectors: `${resolve('tabConnectors')} (${connectorSource === 'local' ? localConnectors.length : connectors.length})`,
  }

  const grid = (children: ReactNode) => (
    <div className="nexusai-grid">{children}</div>
  )

  // Is this skill already on disk (this session's install, or a local skill
  // whose directory matches the id we install under)?
  const isInstalled = (id: string, slug: string): boolean => hubInstalled[id] !== undefined
    || slashList.some(skill => skill.path !== undefined
      && [slugDir(id), slug].includes(skill.path.split('/').slice(-2, -1)[0] ?? ''))

  const capHeader = (
    <header className="cap-header">
      {visibleTabs.map(key => (
        <button
          key={key}
          className={`cap-tab ${activeTab === key ? 'active' : ''}`}
          aria-current={activeTab === key ? 'page' : undefined}
          onClick={() => {
            setActiveTab(key)
            // The 已安装(n) counter in the skills toolbar and the source-tab
            // counts read live catalogs, so refresh them on entry.
            if (key === 'skills') {
              void loadSlashSkills()
              if (hubCards === undefined) void enterHub()
            }
            if (key === 'connectors') void loadLocalConnectors()
          }}
        >
          {TAB_ICONS[key]}
          {tabLabel[key]}
        </button>
      ))}
      {/* SkillHub controls sit on the capability-tab row, right-aligned —
          the reference product's layout (search / installed / add). They
          stay put across the skills sub-tabs; searching from 本地/远程
          switches to the SkillHub source. */}
      {activeTab === 'skills' && (
        <div className="hub-toolbar">
          <Input
            ref={searchInput}
            className="hub-search-input"
            icon={<IconSearchOutlineRegular size={16} />}
            value={searchValue}
            placeholder={searchPlaceholder}
            onChange={event => { onSearchChange(event.target.value) }}
            onKeyDown={event => {
              if (event.key === 'Enter') onSearchEnter()
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSkillSource('local')
              void loadSlashSkills()
            }}
          >
            <IconDownloadOutlineRegular size={14} />
            {resolve('installed')}({slashList.length})
          </Button>
          {/* ＋添加技能: find (marketplace search) or upload (folder / .zip / .md). */}
          <Menu
            open={addMenuOpen}
            side="bottom"
            align="end"
            portal
            autoFocus
            anchor={(
              <Button
                variant="primary"
                size="sm"
                aria-haspopup="menu"
                aria-expanded={addMenuOpen}
                onClick={() => { setAddMenuOpen(value => !value) }}
              >
                <IconPlusOutlineRegular size={14} />
                {resolve('addSkill')}
              </Button>
            )}
            items={[
              { id: 'find', label: resolve('addSkillFind'), icon: <IconSearchOutlineRegular size={16} /> },
              { id: 'upload', label: resolve('addSkillUpload'), icon: <IconDownloadOutlineRegular size={16} /> },
            ]}
            onSelect={id => {
              if (id === 'find') findSkill()
              if (id === 'upload') startUpload()
            }}
            onClose={() => { setAddMenuOpen(false) }}
          />
        </div>
      )}
      {activeTab === 'connectors' && (
        <div className="hub-toolbar">
          <Input
            className="hub-search-input"
            icon={<IconSearchOutlineRegular size={16} />}
            value={connectorSearchValue}
            placeholder={resolve('connectorSearchPlaceholder')}
            onChange={event => {
              if (connectorSource === 'local') setLocalConnectorQuery(event.target.value)
              else setRemoteConnectorQuery(event.target.value)
            }}
          />
          {/* 自定义连接器: four ways to author a local MCP connector. */}
          <Menu
            open={addConnectorOpen}
            side="bottom"
            align="end"
            portal
            autoFocus
            anchor={(
              <Button
                variant="primary"
                size="sm"
                aria-haspopup="menu"
                aria-expanded={addConnectorOpen}
                onClick={() => { setAddConnectorOpen(value => !value) }}
              >
                <IconPlusOutlineRegular size={14} />
                {resolve('customConnector')}
              </Button>
            )}
            items={[
              { id: 'quick', label: resolve('connectorQuickCreate') },
              { id: 'json', label: resolve('connectorImportJson') },
              { id: 'dxt', label: resolve('connectorImportDxt') },
              { id: 'mcpb', label: resolve('connectorImportMcpb') },
            ]}
            onSelect={id => {
              if (id === 'quick') startConnector('quick')
              if (id === 'json') startConnector('json')
              // Both are the same format under two names (DXT is MCPB's former
              // name), so both routes share the dialog — only its title differs.
              if (id === 'dxt' || id === 'mcpb') startConnector('bundle', id)
            }}
            onClose={() => { setAddConnectorOpen(false) }}
          />
        </div>
      )}
      {/* 上传技能's three pickers, mounted once in the shared header: a folder
          (`webkitdirectory`), and a .zip/.md chosen through the normal picker.
          Both are hidden; the dialog's buttons drive them. */}
      {/* The one picker behind 「点击上传」: no accept filter, because the host
          recognises whatever was picked (a SKILL.md means its folder). */}
      <input
        ref={fileInput}
        type="file"
        hidden
        onChange={event => { void onFilePicked(event) }}
      />
      {uploadOpen && (
        <Modal
          open
          title={resolve('uploadTitle')}
          closeLabel={resolve('close')}
          onClose={closeUpload}
          className="nexusai-import"
          footer={(uploadSource !== undefined || uploadExists !== '') && (
            <div className="nexusai-actions">
              <Button variant="outline" disabled={uploadBusy} onClick={closeUpload}>{resolve('cancelAction')}</Button>
              {uploadExists !== ''
                ? (
                    <Button variant="primary" disabled={uploadBusy} onClick={() => { void submitUpload(true) }}>
                      {uploadBusy ? <IconLoadingOutlineRegular size={14} className="nexusai-spinner" /> : null}
                      {resolve('uploadOverwrite')}
                    </Button>
                  )
                : (
                    <Button variant="primary" disabled={uploadBusy} onClick={() => { void submitUpload(false) }}>
                      {uploadBusy ? <IconLoadingOutlineRegular size={14} className="nexusai-spinner" /> : null}
                      {resolve('uploadInstall')}
                    </Button>
                  )}
            </div>
          )}
        >
          {/* One entry for everything: the drop takes files and folders, and a
              click opens the host's picker — whatever comes back (a folder's
              SKILL.md, a .zip, a .md) is recognised on the host by its path. */}
          <div
            className={`import-drop ${uploadDragging ? 'is-drag' : ''} ${uploadPicked === '' ? '' : 'is-picked'}`}
            role="button"
            tabIndex={0}
            aria-label={resolve('uploadDropHint')}
            onClick={() => { if (!uploadBusy) fileInput.current?.click() }}
            onKeyDown={event => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              if (!uploadBusy) fileInput.current?.click()
            }}
            onDragOver={event => {
              event.preventDefault()
              if (!uploadBusy) setUploadDragging(true)
            }}
            onDragLeave={() => { setUploadDragging(false) }}
            onDrop={event => { void onDrop(event) }}
          >
            <ImportIcon size={44} />
            <span className="import-drop-hint">
              {uploadPicked === '' ? resolve('uploadDropHint') : `${resolve('uploadPicked')}：${uploadPicked}`}
            </span>
          </div>
          <Checkbox
            className="import-auto"
            checked={uploadAuto}
            disabled={uploadBusy}
            onChange={setUploadAuto}
            label={resolve('uploadAutoInstall')}
          />
          <h3 className="import-req-title">{resolve('uploadRequirements')}</h3>
          <ul className="import-req">
            <li>{resolve('uploadRequirementFolder')}</li>
            <li>{resolve('uploadRequirementMarkdown')}</li>
          </ul>
          {uploadError !== '' && (
            <p className="nexusai-alert is-error" role="alert">
              <IconWarningOutlineRegular size={14} />{uploadError}
            </p>
          )}
          {uploadExists !== '' && (
            <p className="nexusai-alert is-warn" role="alert">
              <IconWarningOutlineRegular size={14} />{resolve('uploadExists')}：{uploadExists}
            </p>
          )}
        </Modal>
      )}
      {/* 自定义连接器: one dialog per authoring route. All three end in
          runConnector(), so success and failure read the same everywhere. */}
      <input
        ref={connectorFileInput}
        type="file"
        hidden
        accept=".dxt,.mcpb"
        onChange={event => { void onBundlePicked(event) }}
      />
      <input
        ref={fieldFileInput}
        type="file"
        hidden
        onChange={onFieldFilePicked}
      />
      {connectorDialog === 'quick' && (
        <Modal
          open
          title={resolve('connectorQuickCreate')}
          closeLabel={resolve('close')}
          onClose={closeConnector}
          className="nexusai-connector"
          footer={(
            <div className="nexusai-actions">
              <Button variant="outline" disabled={connectorBusy} onClick={closeConnector}>{resolve('cancelAction')}</Button>
              <Button
                variant="primary"
                disabled={connectorBusy}
                onClick={() => {
                  void runConnector({
                    kind: 'quick',
                    ...(editTarget === '' ? {} : { previousId: editTarget }),
                    name: quickForm.name,
                    transport: quickForm.transport,
                    command: quickForm.command,
                    args: quickForm.args,
                    env: quickForm.env,
                    url: quickForm.url,
                    headers: quickForm.headers,
                    timeoutSeconds: quickForm.timeoutSeconds,
                  })
                }}
              >
                {connectorBusy ? <IconLoadingOutlineRegular size={14} className="nexusai-spinner" /> : null}
                {resolve('connectorSubmit')}
              </Button>
            </div>
          )}
        >
          <div className="connector-field">
            <span>{resolve('connectorName')}</span>
            <Input
              value={quickForm.name}
              onChange={event => { setQuickForm(form => ({ ...form, name: event.target.value })) }}
            />
          </div>
          <div className="connector-field">
            <span>{resolve('connectorTransport')}</span>
            <div className="connector-transports">
              {(['stdio', 'streamable-http', 'sse'] as const).map(transport => (
                <button
                  key={transport}
                  type="button"
                  className={`connector-transport ${quickForm.transport === transport ? 'active' : ''}`}
                  aria-pressed={quickForm.transport === transport}
                  onClick={() => { setQuickForm(form => ({ ...form, transport })) }}
                >
                  {transport}
                </button>
              ))}
            </div>
          </div>
          {quickForm.transport === 'sse' ? (
            <>
              <p className="nexusai-note">{resolve('connectorSseHint')}</p>
              <div className="connector-field">
                <span>{resolve('connectorUrl')}</span>
                <Input
                  value={quickForm.url}
                  spellCheck={false}
                  onChange={event => { setQuickForm(form => ({ ...form, url: event.target.value })) }}
                />
              </div>
              <div className="connector-field">
                <span>{resolve('connectorHeaders')}</span>
                <textarea
                  className="connector-textarea"
                  value={quickForm.headers}
                  spellCheck={false}
                  placeholder={resolve('connectorHeadersHint')}
                  onChange={event => { setQuickForm(form => ({ ...form, headers: event.target.value })) }}
                />
              </div>
            </>
          ) : quickForm.transport === 'stdio' ? (
            <>
              <div className="connector-field">
                <span>{resolve('connectorCommand')}</span>
                <Input
                  value={quickForm.command}
                  spellCheck={false}
                  placeholder={resolve('connectorCommandHint')}
                  onChange={event => { setQuickForm(form => ({ ...form, command: event.target.value })) }}
                />
              </div>
              <div className="connector-field">
                <span>{resolve('connectorArgs')}</span>
                <textarea
                  className="connector-textarea"
                  value={quickForm.args}
                  spellCheck={false}
                  placeholder={resolve('connectorArgsHint')}
                  onChange={event => { setQuickForm(form => ({ ...form, args: event.target.value })) }}
                />
              </div>
              <div className="connector-field">
                <span>{resolve('connectorEnv')}</span>
                <textarea
                  className="connector-textarea"
                  value={quickForm.env}
                  spellCheck={false}
                  placeholder={resolve('connectorEnvHint')}
                  onChange={event => { setQuickForm(form => ({ ...form, env: event.target.value })) }}
                />
              </div>
            </>
          ) : (
            <>
              <div className="connector-field">
                <span>{resolve('connectorUrl')}</span>
                <Input
                  value={quickForm.url}
                  spellCheck={false}
                  onChange={event => { setQuickForm(form => ({ ...form, url: event.target.value })) }}
                />
              </div>
              <div className="connector-field">
                <span>{resolve('connectorHeaders')}</span>
                <textarea
                  className="connector-textarea"
                  value={quickForm.headers}
                  spellCheck={false}
                  placeholder={resolve('connectorHeadersHint')}
                  onChange={event => { setQuickForm(form => ({ ...form, headers: event.target.value })) }}
                />
              </div>
            </>
          )}
          {/* Shared by every transport: one row per setting, the label carrying a
              click-to-open question mark (the reference product's layout). */}
          <div className="settings-rows">
            <div className="setting-row">
              <span className="setting-label">
                {resolve('connectorTimeout')}
                <ExplainHint text={resolve('connectorTimeoutHint')} label={resolve('connectorTimeout')} />
              </span>
              <span className="setting-control">
                <Input
                  className="setting-number"
                  value={quickForm.timeoutSeconds}
                  spellCheck={false}
                  inputMode="numeric"
                  placeholder="60"
                  onChange={event => { setQuickForm(form => ({ ...form, timeoutSeconds: event.target.value })) }}
                />
                <span className="setting-unit">s</span>
              </span>
            </div>
          </div>
          {connectorError !== '' && (
            <p className="nexusai-alert is-error" role="alert">
              <IconWarningOutlineRegular size={14} />{connectorError}
            </p>
          )}
        </Modal>
      )}
      {connectorDialog === 'json' && (
        <Modal
          open
          title={resolve('connectorImportJson')}
          closeLabel={resolve('close')}
          onClose={closeConnector}
          className="nexusai-connector"
          footer={(
            <div className="nexusai-actions">
              <Button variant="outline" disabled={connectorBusy} onClick={closeConnector}>{resolve('cancelAction')}</Button>
              <Button
                variant="primary"
                disabled={connectorBusy || connectorJson.trim() === ''}
                onClick={() => { void runConnector({ kind: 'json', text: connectorJson }) }}
              >
                {connectorBusy ? <IconLoadingOutlineRegular size={14} className="nexusai-spinner" /> : null}
                {resolve('connectorSubmit')}
              </Button>
            </div>
          )}
        >
          <p className="nexusai-note">{resolve('connectorJsonHint')}</p>
          <textarea
            className="connector-textarea is-json"
            value={connectorJson}
            spellCheck={false}
            onChange={event => { setConnectorJson(event.target.value) }}
          />
          {connectorError !== '' && (
            <p className="nexusai-alert is-error" role="alert">
              <IconWarningOutlineRegular size={14} />{connectorError}
            </p>
          )}
        </Modal>
      )}
      {connectorDialog === 'bundle' && (
        <Modal
          open
          title={resolve(bundleRoute === 'dxt' ? 'connectorImportDxt' : 'connectorImportMcpb')}
          closeLabel={resolve('close')}
          onClose={closeConnector}
          className="nexusai-connector"
          footer={(
            <div className="nexusai-actions">
              <Button variant="outline" disabled={connectorBusy} onClick={closeConnector}>{resolve('cancelAction')}</Button>
              <Button
                variant="primary"
                disabled={connectorBusy || bundleSummary === undefined}
                onClick={() => { void runConnector({ kind: 'bundle', path: bundlePath, values: bundleValues }) }}
              >
                {connectorBusy ? <IconLoadingOutlineRegular size={14} className="nexusai-spinner" /> : null}
                {resolve('connectorSubmit')}
              </Button>
            </div>
          )}
        >
          <p className="nexusai-note">{resolve('connectorBundleHint')}</p>
          <div className="connector-pick-row">
            <Button variant="outline" size="sm" disabled={connectorBusy} onClick={() => { connectorFileInput.current?.click() }}>
              {resolve('connectorBundlePick')}
            </Button>
            {bundlePath !== '' && (
              <span className="connector-picked" title={bundlePath}>
                {resolve('connectorBundlePicked')}：{bundlePath.split('/').pop()}
              </span>
            )}
          </div>
          {bundleSummary !== undefined && (
            <>
              <div className="connector-bundle-head">
                <strong>{bundleSummary.displayName}</strong>
                <small>
                  {bundleSummary.kind.toUpperCase()} {bundleSummary.version}
                  {bundleSummary.author !== '' ? ` · ${bundleSummary.author}` : ''}
                  {` · ${bundleSummary.serverType}`}
                </small>
              </div>
              {bundleSummary.description !== '' && <p className="muted connector-desc">{bundleSummary.description}</p>}
              {bundleSummary.fields.length > 0 && (
                <>
                  <h3 className="connector-section">{resolve('connectorBundleFields')}</h3>
                  {bundleSummary.fields.map(field => (
                    <div className="connector-field" key={field.key}>
                      <span>{field.title}{field.required ? ' *' : ''}</span>
                      {field.type === 'boolean' ? (
                        <Checkbox
                          checked={bundleValues[field.key] === 'true'}
                          onChange={next => { setBundleValues(current => ({ ...current, [field.key]: String(next) })) }}
                          label={field.description || field.title}
                        />
                      ) : field.type === 'directory' || field.type === 'file' ? (
                        <div className="connector-pick-row">
                          <Input value={bundleValues[field.key] ?? ''} readOnly />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { void pickUserPath(field.key, field.type as 'directory' | 'file') }}
                          >
                            {field.type === 'directory' ? resolve('connectorPickDir') : resolve('connectorPickFile')}
                          </Button>
                        </div>
                      ) : (
                        <Input
                          value={bundleValues[field.key] ?? ''}
                          spellCheck={false}
                          type={field.sensitive ? 'password' : 'text'}
                          onChange={event => { setBundleValues(current => ({ ...current, [field.key]: event.target.value })) }}
                        />
                      )}
                      {field.description !== '' && field.type !== 'boolean' && (
                        <small className="connector-hint">{field.description}</small>
                      )}
                    </div>
                  ))}
                </>
              )}
            </>
          )}
          {connectorError !== '' && (
            <p className="nexusai-alert is-error" role="alert">
              <IconWarningOutlineRegular size={14} />{connectorError}
            </p>
          )}
        </Modal>
      )}
    </header>
  )

  // A connector's detail page: what it is, what it can do (the tools with their
  // parameter schemas, read from the same registry the model is given), and the
  // actions for connectors authored here.
  if (connectorDetail !== undefined) {
    const entry = connectorDetail
    const tools = connectorToolList?.tools ?? []
    return (
      <section className="nexusai-wb">
        <style>{WORKBENCH_CSS}</style>
        {capHeader}
        <div className="wb-body">
          <div className="tab-scroll">
            <div className="hub-detail">
              <button type="button" className="hub-detail-back" onClick={() => { setConnectorDetail(undefined) }}>
                <IconChevronLeftOutlineRegular size={16} />
                {resolve('back')}
              </button>
              <div className="hub-detail-header">
                <span className="hub-detail-icon" aria-hidden>{entry.name.charAt(0).toUpperCase()}</span>
                <div className="hub-detail-head">
                  <h2 className="hub-detail-title" title={entry.name}>{entry.name}</h2>
                  <div className="hub-detail-sub">
                    {entry.transport || 'mcp'}
                    {' · '}
                    {tools.length} {resolve('connectorToolsUnit')}
                    {entry.source === 'remote' ? ` · ${resolve('sourceRemote')}` : ` · ${resolve('sourceLocal')}`}
                  </div>
                </div>
                {entry.authored && (
                  <div className="detail-actions">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={connectorBusy}
                      onClick={() => {
                        const row = localConnectors.find(candidate => candidate.id === entry.id)
                        if (row !== undefined) editConnector(row)
                      }}
                    >
                      {resolve('connectorEdit')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={connectorBusy}
                      onClick={() => {
                        if (connectorConfirmRemove === entry.id) void removeConnector(entry.id)
                        else setConnectorConfirmRemove(entry.id)
                      }}
                    >
                      {connectorConfirmRemove === entry.id ? resolve('connectorConfirmRemove') : resolve('connectorRemove')}
                    </Button>
                  </div>
                )}
              </div>
              <div className="hub-detail-meta">
                <div className="hub-detail-meta-row">
                  <span>{resolve('connectorInfo')}</span>
                  <strong title={entry.url}>{entry.url !== '' ? entry.url : '—'}</strong>
                </div>
                {tools.length > 0 && (
                  <div className="hub-detail-meta-row">
                    <span>{resolve('detailIdentity')}</span>
                    <strong title={tools[0]?.name}>{tools[0]?.name.split('__').slice(0, 2).join('__')}__…</strong>
                  </div>
                )}
              </div>
              <div className="hub-detail-section">
                <h3 className="hub-detail-section-title">{resolve('connectorDetailTools')}</h3>
                {connectorDetailLoading && tools.length === 0 ? (
                  <div className="nexusai-loading">{spinner}{resolve('loading')}</div>
                ) : tools.length === 0 ? (
                  <p className="muted">
                    {resolve('connectorDetailNoTools')}
                    {connectorToolList?.error !== undefined && connectorToolList.error !== '' ? `（${connectorToolList.error}）` : ''}
                  </p>
                ) : (
                  <div className="tool-list">
                    {tools.map(tool => (
                      <article className="tool-item" key={tool.name}>
                        <div className="tool-head">
                          <strong>{tool.rawName}</strong>
                          <button
                            type="button"
                            className="tool-copy"
                            onClick={() => {
                              void writeClipboard(tool.name).then(() => {
                                setCopiedTool(tool.name)
                                window.setTimeout(() => { setCopiedTool(current => current === tool.name ? '' : current) }, 2000)
                              }, () => undefined)
                            }}
                          >
                            {copiedTool === tool.name ? resolve('connectorCopied') : resolve('connectorDetailCopy')}
                          </button>
                        </div>
                        <code className="tool-name" title={tool.name}>{tool.name}</code>
                        {tool.description !== '' && <p className="muted tool-desc">{tool.description}</p>}
                        {parameterRows(tool.parameters).length === 0 ? (
                          <p className="muted tool-params-empty">{resolve('connectorNoParams')}</p>
                        ) : (
                          <ul className="tool-params">
                            {parameterRows(tool.parameters).map(row => (
                              <li key={row.name}>
                                <code>{row.name}</code>
                                {row.type !== '' && <span className="tool-param-type">{row.type}</span>}
                                {row.required && <span className="tool-param-required">{resolve('connectorParamRequired')}</span>}
                                {row.description !== '' && <span className="muted"> — {row.description}</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    )
  }

  // A local skill's detail page: the same frame as the marketplace detail
  // (back / icon / title / meta) over the skill's own SKILL.md.
  if (localDetail !== undefined) {
    const entry = localDetail.entry
    return (
      <section className="nexusai-wb">
        <style>{WORKBENCH_CSS}</style>
        {capHeader}
        <div className="wb-body">
          <div className="tab-scroll">
            <div className="hub-detail">
              <button type="button" className="hub-detail-back" onClick={() => { setLocalDetail(undefined) }}>
                <IconChevronLeftOutlineRegular size={16} />
                {resolve('back')}
              </button>
              <div className="hub-detail-header">
                <span className="hub-detail-icon" aria-hidden>{entry.name.charAt(0).toUpperCase()}</span>
                <div className="hub-detail-head">
                  {/* 详情页不放启用/关闭开关：开关只在卡片上（用户要求）。 */}
                  <h2 className="hub-detail-title" title={entry.name}>{entry.name}</h2>
                </div>
              </div>
              <div className="hub-detail-meta">
                <div className="hub-detail-meta-row"><span>{resolve('detailIdentity')}</span><strong title={entry.path}>{entry.path !== '' ? entry.path : resolve('builtinSkill')}</strong></div>
                <div className="hub-detail-meta-row"><span>{resolve('stateLabel')}</span><strong>{entry.enabled ? resolve('skillEnabled') : resolve('skillDisabled')}</strong></div>
              </div>
              {entry.description !== '' && (
                <div className="hub-detail-section">
                  <h3 className="hub-detail-section-title"><IconSparkleMedium size={15} />{resolve('detailSummary')}</h3>
                  <p className="hub-detail-summary">{entry.description}</p>
                </div>
              )}
              <div className="hub-detail-section">
                <h3 className="hub-detail-section-title"><IconSparkleMedium size={15} />{resolve('detailContent')}</h3>
                {localDetail.loading ? (
                  <div className="hub-detail-skeleton" aria-hidden><span /><span /><span /></div>
                ) : localDetail.content === '' ? (
                  <p className="muted">{entry.path === '' ? resolve('builtinSkill') : resolve('detailNoContent')}</p>
                ) : (
                  <pre className="hub-detail-code">{localDetail.content}</pre>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    )
  }

  // The card detail view: a full-panel page with a back button, the way the
  // reference product presents a skill.
  if (hubDetail !== undefined) {
    return (
      <section className="nexusai-wb">
        <style>{WORKBENCH_CSS}</style>
        {capHeader}
        <div className="wb-body">
          <div className="tab-scroll">
            <div className="hub-detail">
              <button type="button" className="hub-detail-back" onClick={closeDetail}>
                <IconChevronLeftOutlineRegular size={16} />
                {resolve('back')}
              </button>
              <div className="hub-detail-header">
                <span className="hub-detail-icon" aria-hidden>
                  {hubDetail.name.charAt(0).toUpperCase()}
                  {hubDetail.iconUrl !== undefined && (
                    <img
                      src={hubDetail.iconUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      onError={event => { event.currentTarget.remove() }}
                    />
                  )}
                </span>
                <div className="hub-detail-head">
                  <h2 className="hub-detail-title" title={hubDetail.name}>{hubDetail.name}</h2>
                  {(hubDetail.requiresApiKey || hubDetail.pricing !== '') && (
                    <div className="hub-detail-chips">
                      {hubDetail.requiresApiKey && (
                        <span className="hub-detail-chip is-key" title={resolve('needsApiKeyHint')}>
                          <KeyIcon size={12} />
                          {resolve('needsApiKey')}
                        </span>
                      )}
                      {hubDetail.pricing !== '' && (
                        <span className="hub-detail-chip is-paid" title={resolve('paidSkillHint')}>
                          {resolve('paidSkill')}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="hub-detail-actions">
                    {isInstalled(hubDetail.id, hubDetail.slug) ? (
                      <span className="hub-added">{resolve('installedMark')}</span>
                    ) : (
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={hubInstalling === hubDetail.id}
                        onClick={() => { void installHub(hubDetail.id) }}
                      >
                        {hubInstalling === hubDetail.id ? spinner : <IconPlusOutlineRegular size={14} />}
                        {resolve('install')}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { window.open(hubDetail.pageUrl, '_blank', 'noopener,noreferrer') }}
                    >
                      {resolve('openInSkillHub')}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="hub-detail-metrics">
                <span title={resolve('statDownloads')}><IconDownloadOutlineRegular size={14} />{formatCount(hubDetail.downloads)} {resolve('statDownloads')}</span>
                <span title={resolve('statStars')}><StarIcon size={14} />{formatCount(hubDetail.stars)} {resolve('statStars')}</span>
                <span title={resolve('statInstalls')}><IconPlusOutlineRegular size={14} />{formatCount(hubDetail.installs)} {resolve('statInstalls')}</span>
                {hubDetail.comments > 0 && (
                  <span title={resolve('statComments')}><IconNewChatOutlineRegular size={14} />{formatCount(hubDetail.comments)} {resolve('statComments')}</span>
                )}
              </div>
              <div className="hub-detail-meta">
                <div className="hub-detail-meta-row"><span>{resolve('detailOwner')}</span><strong>{hubDetail.owner || '—'}</strong></div>
                <div className="hub-detail-meta-row"><span>{resolve('detailCategory')}</span><strong>{hubDetail.category || '—'}</strong></div>
                {hubDetail.subCategories.length > 0 && (
                  <div className="hub-detail-meta-row"><span>{resolve('detailSubCategories')}</span><strong>{hubDetail.subCategories.join(' · ')}</strong></div>
                )}
                <div className="hub-detail-meta-row"><span>{resolve('detailVersion')}</span><strong>{hubDetail.version || '—'}</strong></div>
                {hubDetail.updatedAt > 0 && (
                  <div className="hub-detail-meta-row"><span>{resolve('detailUpdated')}</span><strong>{new Date(hubDetail.updatedAt).toLocaleString()}</strong></div>
                )}
                <div className="hub-detail-meta-row"><span>{resolve('detailIdentity')}</span><strong title={hubDetail.id}>{hubDetail.canonicalName || hubDetail.slug}</strong></div>
                {hubDetail.source !== '' && (
                  <div className="hub-detail-meta-row"><span>{resolve('detailSource')}</span><strong>{hubDetail.source}</strong></div>
                )}
              </div>
              {hubDetailLoading && (
                <div className="hub-detail-skeleton" aria-hidden>
                  <span /><span /><span />
                </div>
              )}
              {hubDetail.summary !== '' && (
                <div className="hub-detail-section">
                  <h3 className="hub-detail-section-title"><IconSparkleMedium size={15} />{resolve('detailSummary')}</h3>
                  <p className={`hub-detail-summary ${hubSummaryExpanded ? '' : 'clamped'}`}>{hubDetail.summary}</p>
                  <button type="button" className="hub-detail-toggle-text" onClick={() => { setHubSummaryExpanded(value => !value) }}>
                    {hubSummaryExpanded ? resolve('detailCollapse') : resolve('detailExpand')}
                  </button>
                </div>
              )}
              <div className="hub-detail-section">
                <div className="hub-detail-section-head">
                  <h3 className="hub-detail-section-title"><IconSparkleMedium size={15} />{resolve('detailContent')}</h3>
                  <div className="hub-detail-mode">
                    <button
                      type="button"
                      className={hubPreviewMode === 'preview' ? 'active' : ''}
                      onClick={() => { setHubPreviewMode('preview') }}
                    >
                      {resolve('detailPreview')}
                    </button>
                    <button
                      type="button"
                      className={hubPreviewMode === 'code' ? 'active' : ''}
                      onClick={() => { setHubPreviewMode('code') }}
                    >
                      {resolve('detailCode')}
                    </button>
                  </div>
                </div>
                {hubPreviewLoading ? (
                  <div className="hub-detail-skeleton" aria-hidden><span /><span /><span /><span /></div>
                ) : hubPreview === undefined || hubPreview === '' ? (
                  <p className="muted">{resolve('detailNoContent')}</p>
                ) : hubPreviewMode === 'code'
                  ? <pre className="hub-detail-code">{hubPreview}</pre>
                  : <div className="hub-detail-preview">{renderMarkdown(hubPreview)}</div>}
              </div>
              {hubDetail.changelog !== '' && (
                <div className="hub-detail-section">
                  <h3 className="hub-detail-section-title">{resolve('detailChangelog')}</h3>
                  <p className="muted">{hubDetail.changelog}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="nexusai-wb">
      <style>{WORKBENCH_CSS}</style>
      {intranetHint !== null && createPortal(
        <span className="nx-hint" role="tooltip" style={{ left: intranetHint.x, top: intranetHint.y, maxWidth: intranetHint.maxWidth }}>{resolve('intranetUnsupported')}</span>,
        document.body,
      )}
      {capHeader}
      <div className="wb-body">
        {error !== '' && (
          <p className="nexusai-alert is-error" role="alert"><IconWarningOutlineRegular size={14} />{error}</p>
        )}
        {notice !== '' && (
          <p className="nexusai-alert is-ok" role="status">{notice}</p>
        )}
        {loading ? (
          <div className="tab-scroll">
            <div className="nexusai-grid">
              {[0, 1, 2, 3].map(i => <article key={i} className="card skeleton" />)}
            </div>
          </div>
        ) : activeTab === 'experts' ? (
          <>
            <div className="nexusai-source-tabs" role="tablist">
              {([
                ['custom', resolve('sourceCustom'), tools.length],
                ['builtin', resolve('sourceBuiltin'), builtinTools.length],
              ] as const).map(([key, label, count]) => (
                <button
                  key={key}
                  className={`source-tab ${expertSource === key ? 'active' : ''}`}
                  aria-selected={expertSource === key}
                  onClick={() => { setExpertSource(key) }}
                >
                  {label} ({count})
                </button>
              ))}
            </div>
            <div className="tab-scroll">
              {expertSource === 'builtin'
                ? (builtinTools.length === 0
                  ? <div className="nexusai-empty"><strong>{resolve('emptyTitle')}</strong><p className="muted">{resolve('emptyBuiltin')}</p></div>
                  : grid(builtinTools.map(tool => {
                    return (
                      <article
                        key={tool.toolSquareId}
                        className={tool.intranet === true ? 'card is-disabled' : 'card'}
                        aria-disabled={tool.intranet === true || undefined}
                        onMouseEnter={tool.intranet === true ? showIntranetHint : undefined}
                        onMouseLeave={tool.intranet === true ? () => { setIntranetHint(null) } : undefined}
                      >
                        <div className="card-top">
                          <span className="mark" aria-hidden>{tool.name.charAt(0).toUpperCase()}</span>
                          <span className="card-title"><strong title={tool.name}>{tool.name}</strong></span>
                        </div>
                        <p className="muted clamp">{tool.description || '—'}</p>
                        {tool.tags.length > 0 && <p className="muted clamp">{tool.tags.join(' · ')}</p>}
                      </article>
                    )
                  })))
                : (tools.length === 0
                  ? <div className="nexusai-empty"><strong>{resolve('emptyTitle')}</strong><p className="muted">{resolve('emptyHintSync')}</p></div>
                  : grid(tools.map(tool => {
                    return (
                      <article
                        key={tool.name}
                        className={tool.intranet === true ? 'card is-disabled' : 'card'}
                        aria-disabled={tool.intranet === true || undefined}
                        onMouseEnter={tool.intranet === true ? showIntranetHint : undefined}
                        onMouseLeave={tool.intranet === true ? () => { setIntranetHint(null) } : undefined}
                      >
                        <div className="card-top">
                          <span className="mark" aria-hidden>{tool.name.charAt(0).toUpperCase()}</span>
                          <span className="card-title"><strong title={tool.name}>{tool.name}</strong></span>
                        </div>
                        <p className="muted clamp">{tool.description || '—'}</p>
                      </article>
                    )
                  })))}
            </div>
          </>
        ) : activeTab === 'skills' ? (
        <>
          <div className="nexusai-source-tabs" role="tablist">
            {([
              ['local', resolve('sourceLocal')],
              ['skillhub', resolve('sourceSkillHub')],
              // The remote catalog comes from the server, so the tab carries
              // its brand name (same dynamic branding as the copy above).
              ['remote', productName !== ''
                ? `${resolve('sourceRemote')} · ${productName}`
                : resolve('sourceRemote')],
            ] as const).filter(([key]) => visibleSources.includes(key)).map(([key, label]) => (
              <button
                key={key}
                className={`source-tab ${skillSource === key ? 'active' : ''}`}
                aria-selected={skillSource === key}
                onClick={() => {
                  setSkillSource(key)
                  // 本地 and SkillHub read live: re-read the "/" catalog /
                  // featured list so just-landed skills show up immediately.
                  if (key === 'local') { void loadSlashSkills(); void loadDisabledLocal() }
                  if (key === 'skillhub') void enterHub()
                }}
              >
                {label} ({sourceCount[key]})
              </button>
            ))}
          </div>
          {skillSource === 'local' ? (
            <div className="tab-scroll">
              {slashLoading && localMatches.length === 0 ? (
                <div className="nexusai-loading">{spinner}{resolve('loading')}</div>
              ) : localList.length === 0
                ? <div className="nexusai-empty"><strong>{resolve('emptyTitle')}</strong><p className="muted">{resolve('localEmptyHint')}</p></div>
                : localMatches.length === 0
                ? <div className="nexusai-empty"><strong>{resolve('emptyTitle')}</strong><p className="muted">{resolve('noMatchHint')}</p></div>
                : grid(localMatches.map(entry => {
                  const busy = localBusy !== '' && localBusy === entry.path
                  return (
                    <article
                      key={`${entry.name}#${entry.path}`}
                      className={`card local-card ${entry.enabled ? '' : 'is-off'}`}
                      role="button"
                      tabIndex={0}
                      title={entry.name}
                      onClick={() => { void openLocalDetail(entry) }}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          void openLocalDetail(entry)
                        }
                      }}
                    >
                      <div className="card-top">
                        <span className="mark" aria-hidden>{entry.name.charAt(0).toUpperCase()}</span>
                        <span className="card-title">
                          <strong title={entry.name}>{entry.name}</strong>
                        </span>
                        {/* Hover actions: 启用/关闭 switch + "…" menu (the
                            reference product's installed-skill affordances).
                            Built-in skills have no file of their own, so they
                            carry neither. */}
                        {entry.path !== '' && (
                        <span className="local-actions" onClick={event => { event.stopPropagation() }}>
                          <Menu
                            open={localMenuPath === entry.path}
                            align="end"
                            anchor={(
                              <button
                                type="button"
                                className="local-more"
                                aria-label={resolve('moreActions')}
                                title={resolve('moreActions')}
                                onClick={() => {
                                  setLocalConfirmRemove('')
                                  setLocalMenuPath(current => current === entry.path ? '' : entry.path)
                                }}
                              >
                                <MoreIcon />
                              </button>
                            )}
                            items={[
                              { id: 'detail', label: resolve('viewContent') },
                              { id: 'copy', label: resolve('copyPath') },
                              { type: 'separator', id: 'sep' },
                              {
                                id: 'remove',
                                label: localConfirmRemove === entry.path ? resolve('confirmRemove') : resolve('removeSkill'),
                                danger: true,
                              },
                            ]}
                            onSelect={id => {
                              if (id === 'detail') void openLocalDetail(entry)
                              if (id === 'copy') void writeClipboard(entry.path)
                              if (id === 'remove') {
                                if (localConfirmRemove === entry.path) void removeLocal(entry)
                                else setLocalConfirmRemove(entry.path)
                              }
                            }}
                            onClose={() => { setLocalMenuPath(''); setLocalConfirmRemove('') }}
                          />
                          <Switch
                            checked={entry.enabled}
                            disabled={busy || entry.path === ''}
                            label={entry.enabled ? resolve('disableSkill') : resolve('enableSkill')}
                            title={entry.enabled ? resolve('disableSkill') : resolve('enableSkill')}
                            onChange={() => { void toggleLocal(entry) }}
                          />
                        </span>
                        )}
                      </div>
                      <p className="muted clamp">{entry.description || '—'}</p>
                      {entry.path !== '' && <p className="muted path" title={entry.path}>{entry.path}</p>}
                    </article>
                  )
                }))}
            </div>
          ) : skillSource === 'skillhub' ? (
            <>
              <div className="hub-chips-row">
                <button
                  type="button"
                  className="hub-chips-arrow"
                  aria-label={resolve('chipsPrev')}
                  title={resolve('chipsPrev')}
                  disabled={!chipEdges.left}
                  onClick={() => { pageChips(-1) }}
                >
                  <IconChevronLeftOutlineRegular size={16} />
                </button>
                <div className="hub-chips" ref={chipsRef} onScroll={measureChips}>
                  {[{ key: '', label: resolve('all') }, ...hubCategories].map(category => (
                    <button
                      key={category.key === '' ? 'all' : category.key}
                      className={`hub-chip ${hubCategory === category.key ? 'active' : ''}`}
                      onClick={() => {
                        setHubCategory(category.key)
                        hubRefresh(hubKeyword, category.key)
                      }}
                    >
                      {category.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="hub-chips-arrow"
                  aria-label={resolve('chipsNext')}
                  title={resolve('chipsNext')}
                  disabled={!chipEdges.right}
                  onClick={() => { pageChips(1) }}
                >
                  <IconChevronRightOutlineRegular size={16} />
                </button>
              </div>
              <div className="hub-scroll" ref={hubScrollRef} onScroll={onHubScroll}>
                {hubCards === undefined || (hubLoading && hubCards.length === 0) ? (
                  <div className="nexusai-grid hub-grid">
                    {[0, 1, 2, 3].map(i => <article key={i} className="card skeleton" />)}
                  </div>
                ) : hubCards.length === 0 ? (
                  <div className="nexusai-empty">
                    <strong>{resolve('emptyTitle')}</strong>
                    <p className="muted">{resolve('skillhubEmptyHint')}</p>
                  </div>
                ) : (
                  <>
                    <div className="nexusai-grid hub-grid">
                      {hubCards.map((card, index) => {
                        // Installed = this session's install (by package id), or a local
                        // skill whose install directory matches the id/canonical name
                        // we install under (or a bare-slug directory from an older
                        // install). Different publishers share bare slugs, so the
                        // canonical name is the identity that counts.
                        const installedAt = hubInstalled[card.id]
                          ?? (slashList.some(skill => skill.path !== undefined
                            && [slugDir(card.id), card.slug].includes(skill.path.split('/').slice(-2, -1)[0] ?? '')) ? 'installed' : undefined)
                        const busy = hubInstalling === card.id
                        return (
                          <article
                            key={`${card.id}#${String(index)}`}
                            className="card hub-card"
                            role="button"
                            tabIndex={0}
                            title={card.name}
                            onClick={() => { openDetail(card) }}
                            onKeyDown={event => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                openDetail(card)
                              }
                            }}
                          >
                            <span className="hub-icon" aria-hidden>
                              {card.name.charAt(0).toUpperCase()}
                              {card.iconUrl !== undefined && (
                                <img
                                  src={card.iconUrl}
                                  alt=""
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                  onError={event => { event.currentTarget.remove() }}
                                />
                              )}
                            </span>
                            <div className="hub-info">
                              <span className="hub-title-row">
                                <strong className="hub-title" title={card.name}>{card.name}</strong>
                                {card.requiresApiKey && (
                                  <span className="hub-key" title={resolve('needsApiKey')} aria-label={resolve('needsApiKey')}>
                                    <KeyIcon />
                                  </span>
                                )}
                              </span>
                              <p className="muted hub-desc" title={card.description}>{card.description || '—'}</p>
                              <div className="hub-stats">
                                <span title={resolve('downloads')}>
                                  <IconDownloadOutlineRegular size={13} />
                                  {formatCount(card.downloads)}
                                </span>
                                <span title={resolve('stars')}>
                                  <StarIcon size={13} />
                                  {formatCount(card.installs > 0 ? card.installs : card.stars)}
                                </span>
                              </div>
                            </div>
                            {installedAt !== undefined ? (
                              <span className="hub-added" title={installedAt}>{resolve('installedMark')}</span>
                            ) : (
                              <button
                                type="button"
                                className="hub-add"
                                disabled={busy}
                                title={resolve('install')}
                                aria-label={`${resolve('install')} ${card.name}`}
                                onClick={event => { event.stopPropagation(); void installHub(card.id) }}
                              >
                                {busy ? <IconLoadingOutlineRegular size={14} className="nexusai-spinner" /> : <IconPlusOutlineRegular size={16} />}
                              </button>
                            )}
                          </article>
                        )
                      })}
                    </div>
                    {hubLoading && (
                      <div className="hub-loading-row">{spinner}{resolve('loading')}</div>
                    )}
                    {!hubHasMore && (
                      <div className="hub-end-row">{resolve('noMore')}</div>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="tab-scroll">
              {skills.length === 0
                ? <div className="nexusai-empty"><strong>{resolve('emptyTitle')}</strong><p className="muted">{resolve('emptyHintSync')}</p></div>
                : remoteMatches.length === 0
                ? <div className="nexusai-empty"><strong>{resolve('emptyTitle')}</strong><p className="muted">{resolve('noMatchHint')}</p></div>
                : grid(remoteMatches.map(skill => (
                  <article key={skill.skillId} className="card">
                    <div className="card-top">
                      <span className="mark" aria-hidden>{skill.name.charAt(0).toUpperCase()}</span>
                      <span className="card-title"><strong title={skill.name}>{skill.name}</strong><small>{skill.author}</small></span>
                    </div>
                    <p className="muted clamp">{skill.description || '—'}</p>
                    <div className="card-foot">
                      <Button
                        variant={downloaded[skill.skillId] !== undefined ? 'outline' : 'primary'}
                        size="sm"
                        disabled={busy}
                        onClick={() => { void download(skill.skillId) }}
                      >
                        {downloaded[skill.skillId] !== undefined ? resolve('downloaded') : resolve('download')}
                      </Button>
                      {downloaded[skill.skillId] !== undefined && (
                        <small className="muted" title={downloaded[skill.skillId]}>{downloaded[skill.skillId]}</small>
                      )}
                    </div>
                  </article>
                )))}
            </div>
          )}
        </>
      ) : (
        <>
          {/* 连接器 sources, the same shape as 技能: 本地 = this machine's own
              mcp-client rows, 远程获取 = the NexusAI catalog. */}
          <div className="nexusai-source-tabs" role="tablist">
            {([
              ['local', `${resolve('sourceLocal')} (${localConnectors.length})`],
              ['remote', productName !== ''
                ? `${resolve('sourceRemote')} · ${productName} (${connectors.length})`
                : `${resolve('sourceRemote')} (${connectors.length})`],
            ] as const).filter(([key]) => visibleConnectorSources.includes(key)).map(([key, label]) => (
              <button
                key={key}
                className={`source-tab ${connectorSource === key ? 'active' : ''}`}
                aria-selected={connectorSource === key}
                onClick={() => {
                  setConnectorSource(key)
                  if (key === 'local') void loadLocalConnectors()
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="tab-scroll">
          {connectorSource === 'local' ? (
            localConnectors.length === 0
              ? <div className="nexusai-empty"><strong>{resolve('emptyTitle')}</strong><p className="muted">{resolve('localConnectorsEmpty')}</p></div>
              : localConnectorMatches.length === 0
              ? <div className="nexusai-empty"><strong>{resolve('emptyTitle')}</strong><p className="muted">{resolve('connectorNoMatch')}</p></div>
              : grid(localConnectorMatches.map(server => {
                const authored = server.id.startsWith('custom-mcp-') || server.id.startsWith('custom-sse-')
                return (
                <article
                  key={server.id}
                  className={`card ${server.enabled ? '' : 'is-off'}`}
                  role="button"
                  tabIndex={0}
                  title={server.name}
                  onClick={() => { void openConnectorDetail({ id: server.id, name: server.name, transport: server.transport, url: server.url, source: 'local', authored }) }}
                  onKeyDown={event => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    void openConnectorDetail({ id: server.id, name: server.name, transport: server.transport, url: server.url, source: 'local', authored })
                  }}
                >
                  <div className="card-top">
                    <span className="mark" aria-hidden>{server.name.charAt(0).toUpperCase()}</span>
                    <span className="card-title">
                      <span className="title-row">
                        <i
                          className={`status-dot ${server.enabled ? (server.connected ? 'is-on' : 'is-off') : 'is-idle'}`}
                          aria-hidden={true}
                          title={connectorStateLabel(resolve, server)}
                        />
                        <strong title={server.name}>{server.name}</strong>
                      </span>
                      <small>
                        {server.transport || 'mcp'}
                        {' · '}
                        {server.toolCount} {resolve('connectorToolsUnit')}
                      </small>
                    </span>
                    {/* Same actions column as the skills cards: one wrapper,
                        skills' own `local-more` button (a bare `card-more`
                        picked up the browser's default button chrome). */}
                    <span className="local-actions" onClick={event => { event.stopPropagation() }}>
                    {authored && (
                      <Menu
                        open={connectorMenuId === server.id}
                        side="bottom"
                        align="end"
                        portal
                        autoFocus
                        anchor={(
                          <button
                            type="button"
                            className="local-more"
                            aria-label={resolve('connectorInfo')}
                            aria-haspopup="menu"
                            aria-expanded={connectorMenuId === server.id}
                            onClick={event => {
                              event.stopPropagation()
                              setConnectorConfirmRemove('')
                              setConnectorMenuId(current => current === server.id ? '' : server.id)
                            }}
                          >
                            <MoreIcon />
                          </button>
                        )}
                        items={[
                          { id: 'tools', label: resolve('connectorDetailTools') },
                          { id: 'edit', label: resolve('connectorEdit') },
                          { id: 'remove', label: connectorConfirmRemove === server.id ? resolve('connectorConfirmRemove') : resolve('connectorRemove'), danger: true },
                        ]}
                        onSelect={id => {
                          if (id === 'tools') void openConnectorDetail({ id: server.id, name: server.name, transport: server.transport, url: server.url, source: 'local', authored })
                          if (id === 'edit') editConnector(server)
                          if (id === 'remove') {
                            if (connectorConfirmRemove === server.id) void removeConnector(server.id)
                            else setConnectorConfirmRemove(server.id)
                          }
                        }}
                        onClose={() => { setConnectorMenuId('') }}
                      />
                    )}
                    {/* The skills cards' own switch: same order (menu, then
                        switch) and same 36×20 control. */}
                      <Switch
                        checked={server.enabled}
                        disabled={connectorBusy}
                        label={server.enabled ? resolve('disableConnector') : resolve('enableConnector')}
                        title={server.enabled ? resolve('disableConnector') : resolve('enableConnector')}
                        onChange={() => { void toggleConnector(server) }}
                      />
                    </span>
                  </div>
                  <p className="muted path" title={server.url}>{server.url || '—'}</p>
                </article>
                )
              }))
          ) : !signedIn
            ? (
                <div className="nexusai-empty">
                  <strong>{resolve('signedOutTitle')}</strong>
                  <p className="muted">{resolve('connectorsSignedOut')}</p>
                  <div className="empty-actions">
                    <Button variant="primary" onClick={() => { setDialogOpen(true) }}>{resolve('login')}</Button>
                  </div>
                </div>
              )
            : connectors.length === 0
            ? <div className="nexusai-empty"><strong>{resolve('emptyTitle')}</strong><p className="muted">{resolve('emptyHintSync')}</p></div>
            : remoteConnectorMatches.length === 0
            ? <div className="nexusai-empty"><strong>{resolve('emptyTitle')}</strong><p className="muted">{resolve('connectorNoMatch')}</p></div>
            : grid(remoteConnectorMatches.map(server => (
              <article
                key={server.name}
                className="card"
                role="button"
                tabIndex={0}
                title={server.name}
                onClick={() => { void openConnectorDetail({ id: server.id ?? server.mcpServerId, name: server.name, transport: server.transport, url: server.url ?? '', source: 'remote', authored: false }) }}
                onKeyDown={event => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  void openConnectorDetail({ id: server.id ?? server.mcpServerId, name: server.name, transport: server.transport, url: server.url ?? '', source: 'remote', authored: false })
                }}
              >
                <div className="card-top">
                  <span className="mark" aria-hidden>{server.name.charAt(0).toUpperCase()}</span>
                  <span className="card-title">
                    <span className="title-row">
                      <i
                        className={`status-dot ${connectorDotClass(server)}`}
                        aria-hidden={true}
                        title={server.connected === true
                          ? `${resolve('connectorConnected')} · ${server.toolCount ?? server.toolNum} ${resolve('toolsUnit')}`
                          : resolve('connectorDisconnected')}
                      />
                      <strong title={server.name}>{server.name}</strong>
                    </span>
                    <small>
                      {server.transport || 'mcp'}
                      {' · '}
                      {server.source === 'imported' ? resolve('mcpImported') : resolve('mcpCreated')}
                      {' · '}
                      {server.connected === true ? server.toolCount ?? server.toolNum : 0} {resolve('toolsUnit')}
                    </small>
                  </span>
                </div>
                <p className="muted clamp">{server.desc || '—'}</p>
              </article>
            )))}
          </div>
        </>
      )}
      </div>
      {dialogOpen && auth !== undefined && (
        <NexusaiSignInDialog auth={auth} getView={() => snapshot?.view} t={resolve} close={() => { setDialogOpen(false) }} />
      )}
    </section>
  )
}

/** Ceiling for one upload, mirrored by the host before it writes anything. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

/** dsh's skill-name grammar: the registry ignores a skill whose frontmatter
 * `name` is not kebab-case ASCII, so uploads are checked against it here (and
 * again on the host) instead of installing something the app never lists. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** A picked file's path relative to the picked folder (`webkitRelativePath`),
 * which is what the host strips the wrapping directory from. Files picked
 * through the plain picker have no relative path and arrive as their name. */
function relativePathOf(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
}

/** base64 for the wire. Chunked: spreading a whole file into one call would
 * blow the argument limit on anything but a toy skill. */
function base64Of(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

/** The `name:` and `description:` of a markdown file's YAML front matter — the
 * same two fields the host requires before accepting a `.md` upload. */
function frontmatterOf(text: string): { name: string; description: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (match === null) return { name: '', description: '' }
  const body = match[1] ?? ''
  const read = (key: string): string => {
    const line = new RegExp(`^${key}:[ \t]*(.*)$`, 'm').exec(body)
    return line === null ? '' : (line[1] ?? '').trim().replace(/^["']|["']$/g, '')
  }
  return { name: read('name'), description: read('description') }
}

/** Where a staged upload came from: an absolute host path (the desktop's own
 * panel, where the host reads the pick itself) or an in-memory request (a drop,
 * or a pick with no path bridge — the browser). */
type UploadSource =
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'request'; readonly request: LocalSkillInstallRequestFace }

/** One file of a dropped or picked skill folder: its path relative to the
 * folder, plus the file itself. */
interface DroppedEntry {
  readonly path: string
  readonly file: File
}

/** The pick's real path on the host, when the desktop bridge can tell us (its
 * `webUtils.getPathForFile`). Empty in a browser, or for a File the user
 * pasted rather than picked — those upload as bytes instead. */
function hostPathOf(file: File): string {
  const bridge = (globalThis as { __DSH_HOST_PATHS__?: { pathFor?: (file: File) => string } }).__DSH_HOST_PATHS__
  try {
    return bridge?.pathFor?.(file) ?? ''
  } catch {
    return ''
  }
}

/** Resolve one dropped file entry; a failed read drops the file rather than
 * failing the whole drop. */
function fileOfEntry(entry: FileSystemEntry): Promise<File | null> {
  return new Promise(resolve => {
    (entry as FileSystemFileEntry).file(file => { resolve(file) }, () => { resolve(null) })
  })
}

/** Every child of a dropped directory. `readEntries` returns batches, so it is
 * called until it answers empty. */
function readDirectory(entry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = entry.createReader()
  return new Promise(resolve => {
    const all: FileSystemEntry[] = []
    const read = (): void => {
      reader.readEntries(batch => {
        if (batch.length === 0) { resolve(all); return }
        all.push(...batch)
        read()
      }, () => { resolve(all) })
    }
    read()
  })
}

/** Flatten dropped entries into files with folder-relative paths — the same
 * shape the directory picker produces via `webkitRelativePath`. */
async function collectDropped(entries: readonly FileSystemEntry[], parent = ''): Promise<DroppedEntry[]> {
  const out: DroppedEntry[] = []
  for (const entry of entries) {
    const path = parent === '' ? entry.name : `${parent}/${entry.name}`
    if (entry.isFile) {
      const file = await fileOfEntry(entry)
      if (file !== null) out.push({ path, file })
      continue
    }
    if (entry.isDirectory) out.push(...await collectDropped(await readDirectory(entry as FileSystemDirectoryEntry), path))
  }
  return out
}

/** The 导入技能 drop zone's glyph: a tray with an up arrow. The primitives
 * library has no import/upload icon (93 glyphs, none of them). */
function ImportIcon({ size = 44 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden={true}>
      <path d="M4 13.5v4A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-4" />
      <path d="M12 15.5V4.5" />
      <path d="M8 8.5 12 4.5l4 4" />
    </svg>
  )
}

/** A catalogue connector's status dot: a bridged SSE server is connected when
 * the bridge holds it, a streamable one when its tools are registered. */
function connectorDotClass(entry: { bridged: boolean; connected?: boolean }): string {
  return entry.bridged || entry.connected === true ? 'is-on' : 'is-off'
}

/** A circled question mark that explains the setting it sits next to: hover
 * previews, click pins (the reference product's affordance). */
function ExplainHint({ text, label }: { text: string; label: string }): ReactNode {
  return (
    <Tooltip label={text} openOnClick side="top" align="center" maxWidth={300} gap={8}>
      <button type="button" className="setting-help" aria-label={`${label}：说明`}>
        <IconQuestionOutlineRegular size={14} />
      </button>
    </Tooltip>
  )
}

/** What a connector's status dot means, for its tooltip. */
function connectorStateLabel(resolve: (key: NexusaiLocaleKey) => string, entry: { enabled: boolean; connected: boolean; toolCount: number; bridgeError?: string }): string {
  if (!entry.enabled) return resolve('connectorOff')
  if (!entry.connected) return entry.bridgeError === undefined ? resolve('connectorDisconnected') : `${resolve('connectorDisconnected')}：${entry.bridgeError}`
  return `${resolve('connectorConnected')} · ${entry.toolCount} ${resolve('connectorToolsUnit')}`
}

/** One parameter row of a tool's JSON Schema, flattened for the detail view. */
interface ToolParameterRow {
  readonly name: string
  readonly type: string
  readonly required: boolean
  readonly description: string
}

/** Flatten a tool's `parameters` schema: name, JSON type, required, description.
 * Anything that is not an object schema reports its own type instead. */
function parameterRows(schema: unknown): ToolParameterRow[] {
  if (schema === null || typeof schema !== 'object') return []
  const record = schema as { type?: unknown; properties?: unknown; required?: unknown }
  const properties = record.properties
  if (properties === null || typeof properties !== 'object') return []
  const required = Array.isArray(record.required) ? record.required.map(String) : []
  return Object.entries(properties as Record<string, unknown>).map(([name, value]) => {
    const field = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
    const type = typeof field.type === 'string'
      ? field.type
      : Array.isArray(field.enum) ? field.enum.map(String).join(' | ') : ''
    return {
      name,
      type,
      required: required.includes(name),
      description: typeof field.description === 'string' ? field.description : '',
    }
  })
}

/** Compact marketplace counts: 20500 → 2.05w (the marketplace's own style). */
function formatCount(value: number): string {
  if (value >= 10_000) return `${(value / 10_000).toFixed(2)}w`
  return String(value)
}

/** Mirror of the host's install-directory naming, so a card matches the skill
 * directory it would land in (`@owner/name` → `owner-name`). */
function slugDir(value: string): string {
  return value.replace(/[^A-Za-z0-9-_.]/g, '-').replace(/^[.-]+/, '').replace(/-+$/, '') || 'skill'
}

/** The reference product's key glyph (lucide-style key): marks skills that
 * need their own API key configured. */
function KeyIcon({ size = 13 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      <circle cx="7.5" cy="15.5" r="4" />
      <path d="M10.5 12.5 20 3" />
      <path d="M17 6l2.5 2.5" />
    </svg>
  )
}

/** The hover "…" menu trigger glyph (no ellipsis icon in the primitives). */
function MoreIcon({ size = 16 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  )
}

/** The familiar five-pointed star for 收藏/stars (the primitives library has
 * no star glyph), matching the reference product's card stat. */
function StarIcon({ size = 13 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

/** An instant detail header from the card, before (or without) the fetch. */
function detailFromCard(card: SkillHubCardFace): SkillHubDetailFace {
  return {
    id: card.id,
    slug: card.slug,
    name: card.name,
    summary: card.description,
    category: card.category,
    subCategories: [],
    version: card.version,
    changelog: '',
    downloads: card.downloads,
    stars: card.stars,
    installs: card.installs,
    comments: 0,
    versions: 0,
    owner: card.owner,
    canonicalName: card.id.startsWith('@') ? card.id : '',
    updatedAt: 0,
    source: '',
    pageUrl: card.pageUrl,
    requiresApiKey: card.requiresApiKey,
    pricing: card.pricing,
    ...(card.iconUrl !== undefined ? { iconUrl: card.iconUrl } : {}),
  }
}

/** A compact markdown renderer for SKILL.md previews: headings, lists, fenced
 * code, quotes, hr, bold / inline code / links. */
function renderMarkdown(text: string): ReactNode {
  const inline = (value: string, key: string): ReactNode => {
    const parts = value.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g)
    return parts.map((part, index) => {
      const partKey = `${key}-${String(index)}`
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={partKey}>{part.slice(1, -1)}</code>
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={partKey}>{part.slice(2, -2)}</strong>
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
      if (link !== null) return <a key={partKey} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>
      return part
    })
  }
  const blocks: ReactNode[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const key = `md-${String(index)}`
    if (/^```/.test(line)) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !/^```/.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      index += 1
      blocks.push(<pre key={key} className="md-code">{code.join('\n')}</pre>)
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      const level = heading[1]?.length ?? 1
      const Tag = (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const)[Math.min(level, 6) - 1] ?? 'h3'
      blocks.push(<Tag key={key} className="md-heading">{inline(heading[2] ?? '', key)}</Tag>)
      index += 1
      continue
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*([-*+]|\d+\.)\s+/, ''))
        index += 1
      }
      blocks.push(<ul key={key} className="md-list">{items.map((item, at) => <li key={`${key}-${String(at)}`}>{inline(item, `${key}-${String(at)}`)}</li>)}</ul>)
      continue
    }
    if (/^>\s?/.test(line)) {
      blocks.push(<blockquote key={key} className="md-quote">{inline(line.replace(/^>\s?/, ''), key)}</blockquote>)
      index += 1
      continue
    }
    if (/^(---|\*\*\*)\s*$/.test(line)) {
      blocks.push(<hr key={key} className="md-rule" />)
      index += 1
      continue
    }
    if (line.trim() === '') {
      index += 1
      continue
    }
    const paragraph: string[] = []
    while (index < lines.length && (lines[index] ?? '').trim() !== ''
      && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+\.)\s|---|\*\*\*)/.test(lines[index] ?? '')) {
      paragraph.push(lines[index] ?? '')
      index += 1
    }
    blocks.push(<p key={key} className="md-paragraph">{inline(paragraph.join(' '), key)}</p>)
  }
  return blocks
}

/** Panel styling following the reference product's capability panels (host --dsw-alias-* tokens). */
const WORKBENCH_CSS = `
.nexusai-wb { height: 100%; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  font: 14px/22px "PingFang SC", "Microsoft YaHei", sans-serif; }
/* This panel's content reaches the window's top-left corner — the class the
   frame's own entry pages (插件管理 etc.) belong to — so it must stay clear of
   the window chrome. The frame publishes both insets for exactly that: the
   fixed top band (48px on macOS), and, while the sidebar is collapsed and its
   traffic lights plus reopen/New Session controls sit in the corner, the inline
   band they occupy (160px). Unpublished (i.e. a browser tab, or the sidebar
   expanded) both fall back to this panel's own 24px inset. */
.nexusai-wb { padding: calc(24px + var(--dsh-frame-top-clearance, 0px)) 24px 24px;
  padding-inline-start: max(24px, var(--dsh-frame-leading-clearance, 0px)); }
.nexusai-wb .wb-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.nexusai-wb .tab-scroll, .nexusai-wb .hub-scroll { flex: 1; min-height: 0; overflow-y: auto; }
.nexusai-wb .cap-header, .nexusai-wb .nexusai-source-tabs,
.nexusai-wb .hub-chips-row, .nexusai-wb .nexusai-alert { flex: none; }
.hub-loading-row, .hub-end-row { display: flex; align-items: center; justify-content: center;
  gap: 6px; padding: 14px 0; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.hub-card[role="button"] { cursor: pointer; }
.hub-card[role="button"]:hover { border-color: var(--dsw-alias-border-l3, var(--dsw-alias-label-tertiary)); }
.hub-card:focus-visible { outline: 2px solid var(--dsw-alias-brand-text, var(--dsw-alias-label-primary)); outline-offset: 2px; }
.hub-detail { display: flex; flex-direction: column; gap: 18px; max-width: 880px; }
.hub-detail-back { align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px 4px 4px;
  border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 13px; cursor: pointer; }
.hub-detail-back:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.hub-detail-header { display: flex; align-items: flex-start; gap: 16px; }
.hub-detail-icon { position: relative; flex: none; display: flex; align-items: center; justify-content: center;
  width: 68px; height: 68px; border-radius: 50%; overflow: hidden; font-size: 24px; font-weight: 600;
  background: var(--dsw-alias-interactive-bg-hover); }
.hub-detail-icon img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.hub-detail-head { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.hub-detail-title { margin: 0; font-size: 20px; line-height: 27px; font-weight: 600; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.hub-detail-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.hub-detail-metrics { display: flex; flex-wrap: wrap; gap: 18px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.hub-detail-metrics span { display: inline-flex; align-items: center; gap: 5px; }
.hub-detail-meta { display: flex; flex-direction: column; gap: 10px; padding: 16px 18px; border-radius: 14px;
  background: var(--dsw-alias-bg-layer-2); }
.hub-detail-meta-row { display: flex; gap: 16px; font-size: 13px; line-height: 20px; }
.hub-detail-meta-row > span { flex: none; width: 72px; color: var(--dsw-alias-label-secondary); }
.hub-detail-meta-row > strong { font-weight: 500; overflow-wrap: anywhere; }
.hub-detail-section { display: flex; flex-direction: column; gap: 10px; }
.hub-detail-section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.hub-detail-section-title { display: inline-flex; align-items: center; gap: 6px; margin: 0; font-size: 15px; font-weight: 600; }
.hub-detail-summary { margin: 0; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); }
.hub-detail-toggle-text { align-self: flex-start; border: 0; background: transparent; padding: 0; font: inherit;
  font-size: 13px; color: var(--dsw-alias-brand-text, var(--dsw-alias-label-primary)); cursor: pointer; }
.hub-detail-mode { display: inline-flex; gap: 2px; padding: 2px; border-radius: 8px; background: var(--dsw-alias-interactive-bg-hover); }
.hub-detail-mode button { border: 0; border-radius: 6px; background: transparent; padding: 4px 12px; font: inherit;
  font-size: 12.5px; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.hub-detail-mode button.active { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-weight: 500; }
.hub-detail-preview, .hub-detail-code { box-sizing: border-box; max-height: 460px; margin: 0; padding: 18px 20px;
  border-radius: 16px; background: var(--dsw-alias-bg-layer-2); overflow-y: auto; }
.hub-detail-preview { font-size: 14px; line-height: 22px; }
.hub-detail-code { white-space: pre-wrap; word-break: break-word; font-family: "SF Mono", Menlo, Monaco, monospace;
  font-size: 12.5px; line-height: 1.7; }
.hub-detail-preview .md-heading { margin: 14px 0 6px; font-size: 15px; font-weight: 600; }
.hub-detail-preview .md-paragraph { margin: 6px 0; }
.hub-detail-preview .md-list { margin: 6px 0; padding-left: 20px; }
.hub-detail-preview .md-quote { margin: 6px 0; padding-left: 12px; border-left: 3px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary); }
.hub-detail-preview .md-code { margin: 8px 0; padding: 12px 14px; border-radius: 10px; overflow-x: auto;
  background: var(--dsw-alias-bg-base); font-family: "SF Mono", Menlo, Monaco, monospace; font-size: 12.5px; line-height: 1.6; }
.hub-detail-preview code { padding: 1px 5px; border-radius: 5px; background: var(--dsw-alias-interactive-bg-hover); font-size: 12.5px; }
.hub-detail-preview a { color: var(--dsw-alias-brand-text, var(--dsw-alias-label-primary)); }
.hub-detail-preview .md-rule { margin: 12px 0; border: 0; border-top: 1px solid var(--dsw-alias-border-l2); }
.hub-detail-skeleton { display: flex; flex-direction: column; gap: 10px; padding: 18px 20px; border-radius: 16px;
  background: var(--dsw-alias-bg-layer-2); }
.hub-detail-skeleton span { height: 12px; border-radius: 6px; background: linear-gradient(100deg,
  var(--dsw-alias-bg-layer-2) 40%, var(--dsw-alias-interactive-bg-hover) 50%, var(--dsw-alias-bg-layer-2) 60%) 0 0 / 200% 100%;
  animation: nexusai-shimmer 1.4s linear infinite; }
.hub-detail-skeleton span:nth-child(1) { width: 60%; }
.hub-detail-skeleton span:nth-child(2) { width: 90%; }
.hub-detail-skeleton span:nth-child(3) { width: 75%; }
.hub-detail-skeleton span:nth-child(4) { width: 45%; }
.cap-header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
.cap-tab { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 6px 14px;
  border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary);
  font: inherit; cursor: pointer; }
.cap-tab:hover { background: var(--dsw-alias-interactive-bg-hover); }
.cap-tab.active { background: var(--dsw-alias-interactive-bg-hover); font-weight: 600; }
.nexusai-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
@media (max-width: 1400px) { .nexusai-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 1100px) { .nexusai-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 600px) { .nexusai-grid { grid-template-columns: minmax(0, 1fr); } }
.card { box-sizing: border-box; display: flex; flex-direction: column; gap: 8px; min-height: 128px;
  padding: 14px; border-radius: 17px; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2); }
.card.is-disabled { cursor: not-allowed; }
.card.is-disabled > * { opacity: 0.45; filter: grayscale(1); }
.nx-hint { position: fixed; z-index: 80; box-sizing: border-box; width: max-content; margin: 0; padding: 4px 8px;
  border-radius: 6px; background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary);
  font-size: 12px; font-weight: 400; line-height: 16px; white-space: nowrap; text-align: center; pointer-events: none;
  box-shadow: 0 0 0 1px var(--dsw-alias-border-l2), 0 4px 12px rgba(16, 24, 40, 0.08);
  transform: translate(-50%, -100%); animation: nx-hint-in 140ms ease-out; }
@keyframes nx-hint-in { from { opacity: 0; transform: translate(-50%, calc(-100% + 4px)); } }
@media (prefers-reduced-motion: reduce) { .nx-hint { animation: none; } }
.card-top { display: flex; align-items: center; gap: 10px; min-width: 0; }
.mark { flex: none; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px;
  border-radius: 10px; background: var(--dsw-alias-interactive-bg-hover); font-weight: 600; }
.card-title { display: flex; flex-direction: column; min-width: 0; }
.card-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-title small { font-size: 11px; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.muted { margin: 0; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.card-foot { margin-top: auto; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
.card-foot small { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card .path { font-size: 11px; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nexusai-empty { display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 64px 24px; text-align: center; }
.nexusai-empty strong { font-size: 16px; }
.empty-actions { display: flex; gap: 8px; margin-top: 8px; }
.nexusai-alert { display: flex; align-items: flex-start; gap: 6px; margin: 0 0 12px; padding: 8px 10px;
  border-radius: 8px; font-size: 13px; line-height: 18px; overflow-wrap: anywhere; }
.nexusai-alert.is-error { color: var(--dsw-alias-state-error-primary, #d33);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d33) 10%, transparent); }
.nexusai-alert.is-ok { color: var(--dsw-alias-state-success-primary, #2a9d5c);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2a9d5c) 10%, transparent); }
.nexusai-alert.is-warn { color: var(--dsw-alias-state-warning-primary, #b8860b);
  background: color-mix(in srgb, var(--dsw-alias-state-warning-primary, #b8860b) 12%, transparent); }
.nexusai-alert svg { flex: none; margin-top: 2px; }
/* 导入技能 dialog: the dashed drop zone, its folder link, the auto-install
   checkbox and the requirements list. The note/actions rules the Modal chrome
   expects live here too (the sign-in dialog's stylesheet is not mounted while
   this one is open). */
.nexusai-import { width: 560px; max-width: calc(100vw - 32px); }
.nexusai-note { margin: 0 0 14px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.nexusai-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
.import-drop { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  min-height: 180px; padding: 20px; box-sizing: border-box; border-radius: 14px;
  border: 1.5px dashed var(--dsw-alias-border-l2, rgba(128,128,128,0.35));
  color: var(--dsw-alias-label-secondary); cursor: pointer; transition: border-color 0.15s, background 0.15s; }
.import-drop:hover { border-color: var(--dsw-alias-border-l3, var(--dsw-alias-label-tertiary)); background: var(--dsw-alias-interactive-bg-hover); }
.import-drop:focus-visible { outline: 2px solid var(--dsw-alias-brand-text, var(--dsw-alias-label-primary)); outline-offset: 2px; }
.import-drop.is-drag { border-style: solid; border-color: var(--dsw-alias-brand-text, var(--dsw-alias-label-primary));
  background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.import-drop.is-picked { border-color: var(--dsw-alias-state-success-primary, #2a9d5c); color: var(--dsw-alias-label-primary); }
.import-drop > svg { flex: none; }
.import-drop-hint { font-size: 15px; line-height: 22px; text-align: center; overflow-wrap: anywhere; }
.import-auto { margin: 18px 0; }
/* 自定义连接器 dialogs: the same field rhythm as 导入技能, with a couple of
   local pieces (transport picker, bundle header, path picker row). */
.nexusai-connector { width: 560px; max-width: calc(100vw - 32px); }
.connector-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.connector-field > span { font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.connector-field input { width: 100%; box-sizing: border-box; }
.connector-hint { font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.connector-textarea { width: 100%; box-sizing: border-box; min-height: 72px; padding: 8px 10px;
  border-radius: 10px; border: 0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3));
  background: var(--dsw-alias-bg-layer-2, transparent); color: var(--dsw-alias-label-primary);
  font: 13px/20px ui-monospace, SFMono-Regular, Menlo, monospace; resize: vertical; }
.connector-textarea.is-json { min-height: 200px; }
.connector-textarea:focus-visible { outline: 2px solid var(--dsw-alias-brand-text, var(--dsw-alias-label-primary)); outline-offset: 1px; }
.connector-transports { display: flex; gap: 6px; }
.connector-transport { min-height: 30px; padding: 4px 12px; border: 0; border-radius: 999px;
  background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; cursor: pointer; }
.connector-transport:hover { background: var(--dsw-alias-interactive-bg-hover); }
.connector-transport.active { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); font-weight: 600; }
.connector-pick-row { display: flex; align-items: center; gap: 8px; }
.connector-pick-row > :first-child { flex: 1; min-width: 0; }
.connector-picked { font-size: 13px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.connector-bundle-head { display: flex; flex-direction: column; gap: 2px; margin: 14px 0 6px; }
.connector-bundle-head small { color: var(--dsw-alias-label-secondary); }
.connector-desc { margin: 0 0 10px; font-size: 13px; line-height: 19px; }
.connector-section { margin: 14px 0 8px; font-size: 14px; line-height: 20px; font-weight: 600; }
/* 连接设置：一行一项（左标签 + 圈问号，右控件），行间一条细线（参考图布局） */
.settings-rows { margin: 14px 0 4px; border-top: 0.5px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.18)); }
.setting-row { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  min-height: 48px; padding: 6px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.18)); }
.setting-label { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; line-height: 20px;
  color: var(--dsw-alias-label-primary); }
.setting-help { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px;
  padding: 0; border: 0; border-radius: 50%; background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.setting-help:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.setting-control { display: inline-flex; align-items: center; gap: 6px; flex: none; }
.setting-number { width: 96px; }
.setting-number input { width: 100%; box-sizing: border-box; text-align: right; }
.setting-unit { font-size: 13px; color: var(--dsw-alias-label-secondary); }
/* 连接器详情：工具清单（名称/说明/参数 schema） */
.tool-list { display: flex; flex-direction: column; gap: 12px; }
.tool-item { padding: 12px 14px; border-radius: 12px; background: var(--dsw-alias-bg-layer-2, transparent);
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2)); }
.tool-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.tool-copy { border: 0; padding: 0; background: transparent; font: inherit; font-size: 12px;
  color: var(--dsw-alias-label-secondary); text-decoration: underline; cursor: pointer; }
.tool-name { display: block; margin: 4px 0 6px; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); overflow-wrap: anywhere; }
.tool-desc { margin: 0 0 8px; font-size: 13px; line-height: 19px; }
.tool-params { margin: 0; padding-left: 18px; font-size: 13px; line-height: 20px; }
.tool-params li { list-style: disc; margin-bottom: 3px; }
.tool-params code { font-size: 12px; }
.tool-param-type { margin-left: 6px; padding: 0 6px; border-radius: 999px; font-size: 11px;
  background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
.tool-param-required { margin-left: 6px; padding: 0 6px; border-radius: 999px; font-size: 11px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d33) 12%, transparent);
  color: var(--dsw-alias-state-error-primary, #d33); }
.tool-params-empty { margin: 0; font-size: 12px; }
/* 连接器状态点：名字前的绿/红/灰点（与本地技能卡片的开关同排） */
.card-title .title-row { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.status-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.6)); }
.status-dot.is-on { background: var(--dsw-alias-state-success-primary, #2a9d5c); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-success-primary, #2a9d5c) 22%, transparent); }
.status-dot.is-off { background: var(--dsw-alias-state-error-primary, #d33); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-error-primary, #d33) 20%, transparent); }
.status-dot.is-idle { background: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.5)); }
.card.is-off { opacity: 0.7; }
.detail-actions { display: flex; flex: none; align-items: center; gap: 8px; }
.hub-detail-sub { margin-top: 2px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.import-req-title { margin: 0 0 8px; font-size: 15px; line-height: 22px; font-weight: 600; }
.import-req { margin: 0 0 4px; padding-left: 22px; font-size: 13px; line-height: 22px;
  color: var(--dsw-alias-label-secondary); }
.import-req li { list-style: disc; }
.nexusai-source-tabs { display: flex; gap: 6px; margin-bottom: 14px; }
.source-tab { min-height: 30px; padding: 4px 12px; border: 0; border-radius: 999px;
  background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; cursor: pointer; }
.source-tab:hover { background: var(--dsw-alias-interactive-bg-hover); }
.source-tab.active { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); font-weight: 600; }
.hub-search { display: flex; gap: 8px; margin-bottom: 14px; max-width: 480px; }
.hub-search > :first-child { flex: 1; min-width: 0; }
.hub-toolbar { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.hub-toolbar .hub-search-input { width: 230px; flex: none; }
.hub-chips-row { display: flex; align-items: center; gap: 6px; margin-bottom: 16px; }
.hub-chips { display: flex; flex: 1; min-width: 0; flex-wrap: nowrap; gap: 6px; overflow-x: auto;
  scrollbar-width: none; -ms-overflow-style: none; }
.hub-chips::-webkit-scrollbar { display: none; }
.hub-chips-arrow { flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border: 0; border-radius: 999px; background: transparent;
  color: var(--dsw-alias-label-secondary); cursor: pointer; padding: 0; }
.hub-chips-arrow:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.hub-chips-arrow:disabled { opacity: 0.3; cursor: default; }
.hub-chip { flex: none; height: 28px; padding: 4px 12px; border: 0; border-radius: 6px; background: transparent;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer; }
.hub-chip:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.hub-chip.active { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.nexusai-grid.hub-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
@media (max-width: 900px) { .nexusai-grid.hub-grid { grid-template-columns: minmax(0, 1fr); } }
.hub-card { flex-direction: row; align-items: flex-start; gap: 12px; min-height: 96px; padding: 16px; }
.hub-icon { position: relative; flex: none; display: flex; align-items: center; justify-content: center; width: 44px; height: 44px;
  border-radius: 12px; overflow: hidden; background: var(--dsw-alias-interactive-bg-hover); font-weight: 600; }
.hub-icon img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.hub-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
/* 本地技能的启用开关：只改配色——打开时是产品自己的绿色胶囊 + 白旋钮；
 * 尺寸/位移沿用 dsh 原生（36x20、旋钮 16、位移 16px），状态挂 ARIA 属性
 * 而不是 CSS module 的哈希类名。 */
/* Every switch in this panel (local skills, local connectors) is the product
   green when on, dsh's own 36x20 geometry, state on the ARIA attribute. */
[role='switch'][aria-checked='true'] { background: #00c29a; }
[role='switch'][aria-checked='true'] > span { background: #ffffff; }
[role='switch'][aria-checked='true'] > span { transform: translateX(16px); }
.local-card { cursor: pointer; }
.local-card.is-off { opacity: 0.62; }
.local-actions { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; flex: none; }
.local-more { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px;
  border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; padding: 0; }
.local-more:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.hub-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hub-title-row { display: flex; align-items: center; gap: 5px; min-width: 0; }
.hub-key { flex: none; display: inline-flex; align-items: center; color: var(--dsw-alias-state-warning-primary, #c04100); }
.hub-detail-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.hub-detail-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 6px;
  font-size: 12px; line-height: 1.4; background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary); }
.hub-detail-chip.is-key { background: color-mix(in srgb, var(--dsw-alias-state-warning-primary, #c04100) 12%, transparent);
  color: var(--dsw-alias-state-warning-primary, #c04100); }
.hub-desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; }
.hub-stats { display: flex; gap: 14px; margin-top: 2px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.hub-stats span { display: inline-flex; align-items: center; gap: 4px; }
.hub-add { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px;
  border: 0; border-radius: 10px; background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary); cursor: pointer; }
.hub-add:hover { background: var(--dsw-alias-border-l2); }
.hub-add:disabled { opacity: 0.6; cursor: default; }
.hub-added { flex: none; display: inline-flex; align-items: center; justify-content: center; min-width: 30px; height: 30px;
  padding: 0 8px; border-radius: 999px; font-size: 12px; color: var(--dsw-alias-state-success-primary, #2a9d5c);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2a9d5c) 12%, transparent); }
.hub-foot { flex-direction: row; align-items: baseline; gap: 8px; justify-content: space-between; }
.hub-link { font-size: 13px; color: var(--dsw-alias-brand-text, var(--dsw-alias-label-primary)); text-decoration: underline; }
@keyframes nexusai-wb-spin { to { transform: rotate(360deg); } }
.nexusai-spinner { flex: none; animation: nexusai-wb-spin 1s linear infinite; }
.card.skeleton { background: linear-gradient(100deg, var(--dsw-alias-bg-layer-2) 40%,
  var(--dsw-alias-interactive-bg-hover) 50%, var(--dsw-alias-bg-layer-2) 60%) 0 0 / 200% 100%;
  animation: nexusai-shimmer 1.4s linear infinite; }
@keyframes nexusai-shimmer { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .nexusai-spinner, .card.skeleton { animation: none; } }
`
