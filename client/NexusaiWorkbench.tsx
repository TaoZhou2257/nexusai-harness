/**
 * The NexusAI workbench panel: one sidebar entry (专家 · 技能 · 连接器) with
 * three capability tabs — 专家 (custom tools), 技能 (skills), 连接器 (MCP
 * servers) — styled after workdsh's capability panels (cap-header with
 * cap-tabs, section head with h1 + border-bottom, card grid on the host's
 * --dsw-alias-* tokens, centered empty states).
 *
 * Signed out, the tabs hide and the page shows the sign-in CTA; signed in,
 * all three lists load once and the 同步能力 action refreshes them.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular, IconDownloadOutlineRegular, IconLinkOutlineMedium, IconLoadingOutlineRegular, IconNewChatOutlineRegular, IconPlusOutlineRegular, IconSearchOutlineRegular, IconSparkleMedium, IconUserOutlineMedium, IconWarningOutlineRegular, Input, Menu, Switch, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { NexusaiSignInDialog } from './NexusaiSignInDialog'
import type { NexusaiLocaleKey } from './locales'
import type { LocalSkillEntryFace, NexusaiAuthOps, NexusaiCapabilitiesOps, NexusaiSnapshot, SkillHubCardFace, SkillHubDetailFace, SlashSkillFace, SlashSkillsOps } from './face'

/** The three capability tabs, in workdsh's order. */
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

interface ToolCard { name: string; description: string }
interface SkillCard { skillId: string; name: string; description: string; author: string }
interface LocalConnector { id: string; name: string; transport: string; url: string }

interface ConnectorCard {
  name: string
  desc: string
  toolNum: number
  source: 'created' | 'imported'
  transport: string
  connectable: boolean
  /** True when this plugin bridged an SSE server's tools into dsh. */
  bridged: boolean
}

/** The 专家 · 技能 · 连接器 workbench (main panel). */
export function NexusaiWorkbench({ useNexusai, auth, capabilities, slashSkills: slashSkillsOps, t }: NexusaiWorkbenchProps): ReactNode {
  const resolve = (key: NexusaiLocaleKey) => t?.(key) ?? key
  const snapshot = useNexusai?.(value => value)
  const view = snapshot?.view
  const signedIn = view?.loggedIn === true
  const [activeTab, setActiveTab] = useState<TabKey>('experts')
  const [tools, setTools] = useState<ToolCard[]>([])
  const [skills, setSkills] = useState<SkillCard[]>([])
  const [connectors, setConnectors] = useState<ConnectorCard[]>([])
  // 连接器 has the same two sources as 技能: 本地 (this machine's own
  // mcp-client rows) and 远程获取 (the NexusAI catalog).
  const [connectorSource, setConnectorSource] = useState<'local' | 'remote'>('remote')
  const [localConnectors, setLocalConnectors] = useState<LocalConnector[]>([])
  const [downloaded, setDownloaded] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  // Login-page branding from the server (GET /v1/base/custom, the same source
  // the web frontend renders from); {name} slots in the tab descriptions.
  const [productName, setProductName] = useState('')
  // Skill sources: 本地 = the conversation "/" menu catalog (read live on
  // each visit), SkillHub = not integrated yet, 远程 = the NexusAI catalog
  // (fetched, downloadable).
  const [skillSource, setSkillSource] = useState<'local' | 'skillhub' | 'remote'>('remote')
  const [slashList, setSlashList] = useState<SlashSkillFace[]>([])
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

  // The brand name belongs to the address currently in effect, so it is read
  // again whenever the session flips (a fresh sign-in may be a different
  // server) — not just on mount.
  useEffect(() => {
    void auth?.getBranding().then(branding => setProductName(branding.name), () => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn])

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
      const [toolList, skillList, connectorList] = await Promise.all([
        capabilities.listCustomTools().catch(() => []),
        capabilities.listSkills().catch(() => []),
        capabilities.listMcpServers().catch(() => []),
      ])
      setTools(toolList ?? [])
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
    experts: `${resolve('tabExperts')} (${tools.length})`,
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
            className="hub-search-input"
            icon={<IconSearchOutlineRegular size={16} />}
            value={hubKeyword}
            placeholder={resolve('skillhubSearchPlaceholder')}
            onChange={event => setHubKeyword(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter') return
              if (skillSource !== 'skillhub') {
                setSkillSource('skillhub')
                if (hubCategories.length === 0) {
                  void capabilities.skillhubCategories().then(setHubCategories, () => undefined)
                }
              }
              hubRefresh(hubKeyword, hubCategory)
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
          <Button
            variant="primary"
            size="sm"
            onClick={() => { window.open('https://skillhub.cn', '_blank', 'noopener,noreferrer') }}
          >
            <IconPlusOutlineRegular size={14} />
            {resolve('addSkill')}
          </Button>
        </div>
      )}
    </header>
  )

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
      {capHeader}
      <div className="wb-body">
        {error !== '' && (
          <p className="nexusai-alert is-error" role="alert"><IconWarningOutlineRegular size={14} />{error}</p>
        )}
        {loading ? (
          <div className="tab-scroll">
            <div className="nexusai-grid">
              {[0, 1, 2, 3].map(i => <article key={i} className="card skeleton" />)}
            </div>
          </div>
        ) : activeTab === 'experts' ? (
          <div className="tab-scroll">
            {tools.length === 0
              ? <div className="nexusai-empty"><strong>{resolve('emptyTitle')}</strong><p className="muted">{resolve('emptyHintSync')}</p></div>
              : grid(tools.map(tool => (
                <article key={tool.name} className="card">
                  <div className="card-top">
                    <span className="mark" aria-hidden>{tool.name.charAt(0).toUpperCase()}</span>
                    <span className="card-title"><strong title={tool.name}>{tool.name}</strong></span>
                  </div>
                  <p className="muted clamp">{tool.description || '—'}</p>
                </article>
              )))}
          </div>
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
              {slashLoading && localList.length === 0 ? (
                <div className="nexusai-loading">{spinner}{resolve('loading')}</div>
              ) : localList.length === 0
                ? <div className="nexusai-empty"><strong>{resolve('emptyTitle')}</strong><p className="muted">{resolve('localEmptyHint')}</p></div>
                : grid(localList.map(entry => {
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
                : grid(skills.map(skill => (
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
              : grid(localConnectors.map(server => (
                <article key={server.id} className="card">
                  <div className="card-top">
                    <span className="mark" aria-hidden>{server.name.charAt(0).toUpperCase()}</span>
                    <span className="card-title">
                      <strong title={server.name}>{server.name}</strong>
                      <small>{server.transport || 'mcp'}</small>
                    </span>
                  </div>
                  <p className="muted path" title={server.url}>{server.url || '—'}</p>
                </article>
              )))
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
            : grid(connectors.map(server => (
              <article key={server.name} className="card">
                <div className="card-top">
                  <span className="mark" aria-hidden>{server.name.charAt(0).toUpperCase()}</span>
                  <span className="card-title">
                    <strong title={server.name}>{server.name}</strong>
                    <small>
                      {server.source === 'imported' ? resolve('mcpImported') : resolve('mcpCreated')}
                      {' · '}
                      {server.toolNum} {resolve('toolsUnit')}
                    </small>
                  </span>
                  {!server.connectable && (
                    server.bridged
                      ? <span className="mcp-flag is-on" title={resolve('mcpSseBridgedHint')}>{resolve('mcpSseBridged')}</span>
                      : <span className="mcp-flag" title={resolve('mcpSseHint')}>{resolve('mcpSseOnly')}</span>
                  )}
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

/** Panel styling following workdsh's capability panels (host --dsw-alias-* tokens). */
const WORKBENCH_CSS = `
.nexusai-wb { height: 100%; box-sizing: border-box; padding: 24px; display: flex; flex-direction: column; overflow: hidden;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  font: 14px/22px "PingFang SC", "Microsoft YaHei", sans-serif; }
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
.nexusai-alert svg { flex: none; margin-top: 2px; }
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
.local-card [role='switch'][aria-checked='true'] { background: #00c29a; }
.local-card [role='switch'][aria-checked='true'] > span { background: #ffffff; }
.local-card [role='switch'][aria-checked='true'] > span { transform: translateX(16px); }
.local-card { cursor: pointer; }
.local-card.is-off { opacity: 0.62; }
.local-card .local-actions { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; flex: none; }
.local-more { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px;
  border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; padding: 0; }
.local-more:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.mcp-flag { flex: none; margin-left: auto; padding: 1px 7px; border-radius: 5px; font-size: 11px;
  color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-interactive-bg-hover); }
.mcp-flag.is-on { color: var(--dsw-alias-state-success-primary, #2a9d5c);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2a9d5c) 12%, transparent); }
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
