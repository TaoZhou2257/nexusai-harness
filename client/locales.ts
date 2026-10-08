/**
 * NexusAI surface dictionaries (launcher, sign-in dialog, settings section).
 * One namespace; every surface's `t` draws from this key union.
 */
export type NexusaiLocaleKey =
  | 'nav'
  | 'panel'
  | 'signedOutTitle'
  | 'tabExperts'
  | 'tabSkills'
  | 'tabConnectors'
  | 'tabExpertsDesc'
  | 'tabSkillsDesc'
  | 'tabConnectorsDesc'
  | 'emptyTitle'
  | 'emptyHintSync'
  | 'toolsUnit'
  | 'sourceLocal'
  | 'sourceSkillHub'
  | 'sourceRemote'
  | 'localEmptyHint'
  | 'skillhubHint'
  | 'skillhubSearchPlaceholder'
  | 'skillhubEmptyHint'
  | 'openInSkillHub'
  | 'search'
  | 'installed'
  | 'installedMark'
  | 'install'
  | 'downloads'
  | 'stars'
  | 'featuredSkills'
  | 'searchResults'
  | 'shuffle'
  | 'all'
  | 'noMore'
  | 'chipsPrev'
  | 'chipsNext'
  | 'needsApiKey'
  | 'needsApiKeyHint'
  | 'paidSkill'
  | 'paidSkillHint'
  | 'enableSkill'
  | 'disableSkill'
  | 'skillDisabled'
  | 'skillEnabled'
  | 'stateLabel'
  | 'builtinSkill'
  | 'mcpCreated'
  | 'mcpImported'
  | 'mcpSseOnly'
  | 'mcpSseHint'
  | 'mcpSseBridged'
  | 'mcpSseBridgedHint'
  | 'mcpSseTools'
  | 'moreActions'
  | 'viewContent'
  | 'copyPath'
  | 'removeSkill'
  | 'confirmRemove'
  | 'pathCopied'
  | 'back'
  | 'detailSummary'
  | 'detailContent'
  | 'detailPreview'
  | 'detailCode'
  | 'detailNoContent'
  | 'detailExpand'
  | 'detailCollapse'
  | 'detailOwner'
  | 'detailCategory'
  | 'detailSubCategories'
  | 'detailVersion'
  | 'detailUpdated'
  | 'detailIdentity'
  | 'detailSource'
  | 'detailChangelog'
  | 'statDownloads'
  | 'statStars'
  | 'statInstalls'
  | 'statComments'
  | 'addSkill'
  | 'loginTitle'
  | 'loginTitleBare'
  | 'loginHint'
  | 'loginHintBare'
  | 'server'
  | 'apply'
  | 'connected'
  | 'username'
  | 'password'
  | 'captcha'
  | 'captchaPlaceholder'
  | 'login'
  | 'refreshCaptcha'
  | 'cancel'
  | 'cancelled'
  | 'close'
  | 'loading'
  | 'menu'
  | 'signedInAs'
  | 'openSettings'
  | 'sync'
  | 'syncing'
  | 'logout'
  | 'loggedInAs'
  | 'switchOrg'
  | 'sessionLost'
  | 'expires'
  | 'org'
  | 'signedOutHint'
  | 'connectorsSignedOut'
  | 'localConnectorsEmpty'
  | 'tools'
  | 'mcpServers'
  | 'skills'
  | 'download'
  | 'downloaded'
  | 'notLoggedIn'

export const zh: Record<NexusaiLocaleKey, string> = {
  nav: 'NexusAI',
  panel: '专家 · 技能 · 连接器',
  signedOutTitle: '登录后开始使用',
  tabExperts: '专家',
  tabSkills: '技能',
  tabConnectors: '连接器',
  tabExpertsDesc: '来自 {name} 的自定义工具，可被助手直接调用。',
  tabSkillsDesc: '浏览 {name} 技能包并下载到本地。',
  tabConnectorsDesc: '来自 {name} 的 MCP 服务及其可用工具。',
  emptyTitle: '这里还没有内容',
  emptyHintSync: '可在左下角菜单或设置页同步能力后再查看',
  toolsUnit: '个工具',
  sourceLocal: '本地',
  sourceSkillHub: 'SkillHub',
  sourceRemote: '远程获取',
  localEmptyHint: '尚未安装技能，可先从「远程获取」获取。',
  skillhubHint: '搜索 SkillHub 技能市场（skillhub.cn）并查看技能详情。',
  skillhubSearchPlaceholder: '搜索技能',
  skillhubEmptyHint: '没有匹配的技能，换个关键词试试。',
  installed: '已安装',
  installedMark: '已安装',
  install: '安装',
  downloads: '下载量',
  stars: '收藏数',
  featuredSkills: '精选技能',
  searchResults: '搜索结果',
  shuffle: '换一批',
  all: '全部',
  noMore: '没有更多了',
  chipsPrev: '向前翻看分类',
  chipsNext: '向后翻看分类',
  needsApiKey: '需 APIKey',
  needsApiKeyHint: '使用前需要配置你自己的 API Key',
  paidSkill: '付费技能',
  paidSkillHint: '该技能在市场中标注为付费',
  enableSkill: '启用技能',
  disableSkill: '关闭技能',
  skillDisabled: '已关闭',
  skillEnabled: '已启用',
  stateLabel: '状态',
  builtinSkill: '内置技能（随应用分发，没有独立文件）',
  mcpCreated: '创建',
  mcpImported: '导入',
  mcpSseOnly: 'SSE 未接入',
  mcpSseHint: '该 MCP 是 legacy SSE 连接，dsh 暂不支持，未注册为工具',
  mcpSseBridged: 'SSE 已桥接',
  mcpSseBridgedHint: '该 MCP 走 legacy SSE：已由本插件桥接为 dsh 工具，agent 可直接调用',
  mcpSseTools: 'SSE 桥接工具',
  moreActions: '更多操作',
  viewContent: '查看技能内容',
  copyPath: '复制技能路径',
  removeSkill: '删除技能',
  confirmRemove: '再次点击确认删除',
  pathCopied: '路径已复制',
  back: '返回',
  detailSummary: '技能介绍',
  detailContent: '技能内容',
  detailPreview: '预览',
  detailCode: '源码',
  detailNoContent: '该技能暂无可预览的内容',
  detailExpand: '展开',
  detailCollapse: '收起',
  detailOwner: '作者',
  detailCategory: '分类',
  detailSubCategories: '子分类',
  detailVersion: '版本',
  detailUpdated: '更新时间',
  detailIdentity: '标识',
  detailSource: '来源',
  detailChangelog: '更新说明',
  statDownloads: '下载',
  statStars: '收藏',
  statInstalls: '安装',
  statComments: '评论',
  addSkill: '添加技能',
  openInSkillHub: '在 SkillHub 打开',
  search: '搜索',
  loginTitle: '登录 {name}',
  loginTitleBare: '登录',
  loginHint: '输入 {name} 账号、密码和验证码完成登录。',
  loginHintBare: '输入账号、密码和验证码完成登录。',
  server: '服务器地址',
  apply: '应用',
  connected: '已连通，验证码已更新',
  username: '用户名',
  password: '密码',
  captcha: '验证码',
  captchaPlaceholder: '输入图中字符',
  login: '登录',
  refreshCaptcha: '换一张',
  cancel: '取消登录',
  cancelled: '已取消登录',
  close: '关闭',
  loading: '加载中…',
  menu: 'NexusAI 账号',
  signedInAs: '已登录：',
  openSettings: '打开设置',
  sync: '同步能力',
  syncing: '同步中…',
  logout: '登出',
  loggedInAs: '已登录',
  switchOrg: '切换组织',
  sessionLost: '登录状态已失效（Token 过期或被服务器拒绝），请重新登录。',
  expires: '有效期至',
  org: '组织',
  signedOutHint: '登录账号后，可在这里管理同步过来的自定义工具、MCP 服务与技能。',
  connectorsSignedOut: '登录后可同步 NexusAI 的 MCP 服务（创建与导入）。',
  localConnectorsEmpty: '本机还没有配置本地 MCP 服务（可在配置文件里添加 mcp-client 行）。',
  tools: '自定义工具',
  mcpServers: 'MCP 服务',
  skills: '技能',
  download: '下载',
  downloaded: '已下载',
  notLoggedIn: '未登录',
}

export const en: Record<NexusaiLocaleKey, string> = {
  nav: 'NexusAI',
  panel: 'Experts · Skills · Connectors',
  signedOutTitle: 'Sign in to get started',
  tabExperts: 'Experts',
  tabSkills: 'Skills',
  tabConnectors: 'Connectors',
  tabExpertsDesc: 'Custom tools from {name}, callable by your assistants.',
  tabSkillsDesc: 'Browse {name} skill packages and download them locally.',
  tabConnectorsDesc: 'MCP services from {name} and their available tools.',
  emptyTitle: 'Nothing here yet',
  emptyHintSync: 'Sync capabilities from the bottom-left menu or the settings page, then check again.',
  toolsUnit: 'tools',
  sourceLocal: 'Local',
  sourceSkillHub: 'SkillHub',
  sourceRemote: 'Remote',
  localEmptyHint: 'No skills installed yet — get them from the Remote tab.',
  skillhubHint: 'Search the SkillHub marketplace (skillhub.cn) and open a skill page.',
  skillhubSearchPlaceholder: 'Search skills',
  skillhubEmptyHint: 'No matching skills — try another keyword.',
  installed: 'Installed',
  installedMark: 'Installed',
  install: 'Install',
  downloads: 'Downloads',
  stars: 'Stars',
  featuredSkills: 'Featured skills',
  searchResults: 'Search results',
  shuffle: 'Shuffle',
  all: 'All',
  noMore: 'No more results',
  chipsPrev: 'Scroll categories back',
  chipsNext: 'Scroll categories forward',
  needsApiKey: 'API Key required',
  needsApiKeyHint: 'Configure your own API key before using this skill.',
  paidSkill: 'Paid skill',
  paidSkillHint: 'The marketplace marks this skill as paid.',
  enableSkill: 'Enable skill',
  disableSkill: 'Disable skill',
  skillDisabled: 'Disabled',
  skillEnabled: 'Enabled',
  stateLabel: 'State',
  builtinSkill: 'Built-in skill (ships with the app; no file of its own)',
  mcpCreated: 'Created',
  mcpImported: 'Imported',
  mcpSseOnly: 'SSE only',
  mcpSseHint: 'This MCP uses legacy SSE, which dsh does not support; it is not registered as tools.',
  mcpSseBridged: 'SSE bridged',
  mcpSseBridgedHint: 'Legacy-SSE MCP bridged into dsh tools by this plugin — the agent can call them.',
  mcpSseTools: 'SSE bridged tools',
  moreActions: 'More actions',
  viewContent: 'View skill content',
  copyPath: 'Copy skill path',
  removeSkill: 'Delete skill',
  confirmRemove: 'Click again to confirm deletion',
  pathCopied: 'Path copied',
  back: 'Back',
  detailSummary: 'About',
  detailContent: 'Skill content',
  detailPreview: 'Preview',
  detailCode: 'Source',
  detailNoContent: 'No previewable content for this skill yet.',
  detailExpand: 'Show more',
  detailCollapse: 'Show less',
  detailOwner: 'Author',
  detailCategory: 'Category',
  detailSubCategories: 'Subcategories',
  detailVersion: 'Version',
  detailUpdated: 'Updated',
  detailIdentity: 'Identifier',
  detailSource: 'Source',
  detailChangelog: 'Changelog',
  statDownloads: 'downloads',
  statStars: 'stars',
  statInstalls: 'installs',
  statComments: 'comments',
  addSkill: 'Add skill',
  openInSkillHub: 'Open in SkillHub',
  search: 'Search',
  loginTitle: 'Sign in to {name}',
  loginTitleBare: 'Sign in',
  loginHint: 'Enter your {name} account, password, and captcha to sign in.',
  loginHintBare: 'Enter your account, password, and captcha to sign in.',
  server: 'Server URL',
  apply: 'Apply',
  connected: 'Connected, captcha refreshed',
  username: 'Username',
  password: 'Password',
  captcha: 'Captcha',
  captchaPlaceholder: 'Characters in the image',
  login: 'Sign in',
  refreshCaptcha: 'New image',
  cancel: 'Cancel sign-in',
  cancelled: 'Sign-in cancelled',
  close: 'Close',
  loading: 'Loading…',
  menu: 'NexusAI account',
  signedInAs: 'Signed in: ',
  openSettings: 'Open settings',
  sync: 'Sync capabilities',
  syncing: 'Syncing…',
  logout: 'Sign out',
  loggedInAs: 'Signed in',
  switchOrg: 'Switch organization',
  sessionLost: 'Your session expired or was rejected by the server — please sign in again.',
  expires: 'Valid until',
  org: 'Organization',
  signedOutHint: 'Sign in to manage the synced custom tools, MCP servers, and skills here.',
  connectorsSignedOut: 'Sign in to sync the NexusAI MCP servers (created and imported).',
  localConnectorsEmpty: 'No local MCP server configured on this machine yet (add an mcp-client row to the profile).',
  tools: 'Custom tools',
  mcpServers: 'MCP servers',
  skills: 'Skills',
  download: 'Download',
  downloaded: 'Downloaded',
  notLoggedIn: 'Not signed in',
}
