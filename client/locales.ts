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
  | 'sourceCustom'
  | 'sourceBuiltin'
  | 'emptyBuiltin'
  | 'sourceLocal'
  | 'sourceSkillHub'
  | 'sourceRemote'
  | 'localEmptyHint'
  | 'skillhubHint'
  | 'skillhubSearchPlaceholder'
  | 'localSearchPlaceholder'
  | 'remoteSearchPlaceholder'
  | 'noMatchHint'
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
  | 'cancelAction'
  | 'cancelled'
  | 'close'
  | 'loading'
  | 'menu'
  | 'signedInAs'
  | 'openSettings'
  | 'signOutIdle'
  | 'signOutRunning'
  | 'signOutUnknown'
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
  | 'addSkillFind'
  | 'addSkillUpload'
  | 'uploadTitle'
  | 'uploadDropHint'
  | 'uploadAutoInstall'
  | 'uploadRequirements'
  | 'uploadRequirementFolder'
  | 'uploadRequirementMarkdown'
  | 'uploadPicked'
  | 'uploadInstall'
  | 'uploadDone'
  | 'uploadExists'
  | 'uploadOverwrite'
  | 'uploadNoSkillFile'
  | 'uploadBadMarkdown'
  | 'uploadBadName'
  | 'uploadTooLarge'
  | 'customConnector'
  | 'connectorQuickCreate'
  | 'connectorImportJson'
  | 'connectorImportDxt'
  | 'connectorImportMcpb'
  | 'connectorName'
  | 'connectorTransport'
  | 'connectorCommand'
  | 'connectorCommandHint'
  | 'connectorArgs'
  | 'connectorArgsHint'
  | 'connectorEnv'
  | 'connectorEnvHint'
  | 'connectorUrl'
  | 'connectorHeaders'
  | 'connectorHeadersHint'
  | 'connectorJsonHint'
  | 'connectorSubmit'
  | 'connectorBundleHint'
  | 'connectorBundlePick'
  | 'connectorBundleFields'
  | 'connectorBundlePicked'
  | 'connectorPickDir'
  | 'connectorPickFile'
  | 'connectorNeedDesktop'
  | 'connectorSearchPlaceholder'
  | 'connectorNoMatch'
  | 'connectorSseHint'
  | 'connectorTimeout'
  | 'connectorTimeoutHint'
  | 'connectorDetailTools'
  | 'connectorDetailNoTools'
  | 'connectorDetailCopy'
  | 'connectorCopied'
  | 'connectorToolsUnit'
  | 'connectorEdit'
  | 'connectorRemove'
  | 'connectorConfirmRemove'
  | 'connectorInfo'
  | 'connectorParamRequired'
  | 'connectorNoParams'
  | 'connectorRemoved'
  | 'connectorConnected'
  | 'connectorDisconnected'
  | 'connectorOff'
  | 'enableConnector'
  | 'disableConnector'

export const zh: Record<NexusaiLocaleKey, string> = {
  nav: 'NexusAI',
  panel: '专家 · 技能 · 连接器',
  signedOutTitle: '登录后开始使用',
  tabExperts: '专家',
  tabSkills: '技能',
  tabConnectors: '连接器',
  tabExpertsDesc: '来自 {name} 的自定义工具与内置工具。',
  sourceCustom: '自定义',
  sourceBuiltin: '内置',
  emptyBuiltin: '服务器没有返回内置工具。',
  tabSkillsDesc: '浏览 {name} 技能包并下载到本地。',
  tabConnectorsDesc: '来自 {name} 的 MCP 服务及其可用工具。',
  emptyTitle: '这里还没有内容',
  emptyHintSync: '登录后会自动同步；若仍为空，可在左下角切换组织或重新登录后再看',
  toolsUnit: '个工具',
  sourceLocal: '本地',
  sourceSkillHub: 'SkillHub',
  sourceRemote: '远程获取',
  localEmptyHint: '尚未安装技能，可先从「远程获取」获取。',
  skillhubHint: '搜索 SkillHub 技能市场（skillhub.cn）并查看技能详情。',
  skillhubSearchPlaceholder: '搜索技能',
  localSearchPlaceholder: '搜索本地技能',
  remoteSearchPlaceholder: '搜索远程技能',
  noMatchHint: '没有匹配的技能，换个关键词试试。',
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
  cancelAction: '取消',
  cancelled: '已取消登录',
  close: '关闭',
  loading: '加载中…',
  menu: 'NexusAI 账号',
  signedInAs: '已登录：',
  openSettings: '打开设置',
  signOutIdle: '退出登录不会丢失任何数据，你仍可以登录此账号。',
  signOutRunning: '当前有任务正在执行，退出登录会打断它们。确定退出登录？',
  signOutUnknown: '暂时无法确认任务状态，退出登录可能会打断正在执行的任务，是否继续？',
  logout: '登出',
  loggedInAs: '已登录',
  switchOrg: '切换组织',
  sessionLost: '登录状态已失效（Token 过期或被服务器拒绝），请重新登录。',
  expires: '有效期至',
  org: '组织',
  signedOutHint: '登录账号后，可在这里管理同步过来的自定义工具、MCP 服务与技能。',
  connectorsSignedOut: '登录后可同步 NexusAI 的 MCP 服务（创建与导入）。',
  localConnectorsEmpty: '本机还没有本地 MCP 服务，可用右上角「自定义连接器」添加。',
  tools: '自定义工具',
  mcpServers: 'MCP 服务',
  skills: '技能',
  download: '下载',
  downloaded: '已下载',
  notLoggedIn: '未登录',
  addSkillFind: '查找技能',
  addSkillUpload: '上传技能',
  uploadTitle: '导入技能',
  uploadDropHint: '拖拽文件或点击上传',
  uploadAutoInstall: '非高风险自动安装',
  uploadRequirements: '文件要求',
  uploadRequirementFolder: '文件夹或者 .zip 需要包含 SKILL.md 文件',
  uploadRequirementMarkdown: '.md 文件需包含 YAML 格式的技能名称和描述',
  uploadPicked: '已选择',
  uploadInstall: '安装',
  uploadDone: '已上传并安装',
  uploadExists: '已存在同名技能',
  uploadOverwrite: '覆盖安装',
  uploadNoSkillFile: '没有找到 SKILL.md：请选择包含 SKILL.md 的技能文件夹或压缩包',
  uploadBadMarkdown: '.md 需要以 YAML 前置信息（---）开头，并包含 name 与 description',
  uploadBadName: '技能名称只支持小写字母、数字与连字符（如 my-skill）',
  uploadTooLarge: '上传内容过大（上限 8MB），请改用更小的技能包',
  customConnector: '自定义连接器',
  connectorQuickCreate: '快速创建',
  connectorImportJson: '从 JSON 导入',
  connectorImportDxt: '导入 DXT 包',
  connectorImportMcpb: '导入 MCPB 包',
  connectorName: '名称',
  connectorTransport: '传输方式',
  connectorCommand: '启动命令',
  connectorCommandHint: '建议填绝对路径，例如 /usr/local/bin/node（dsh 启动子进程时不走 shell，PATH 里的命令可能找不到）',
  connectorArgs: '参数',
  connectorArgsHint: '每行一个参数；只有一行时按空格拆分',
  connectorEnv: '环境变量',
  connectorEnvHint: '每行一个 KEY=VALUE',
  connectorUrl: 'URL',
  connectorHeaders: '请求头',
  connectorHeadersHint: '每行一个 Name: value',
  connectorJsonHint: '粘贴 MCP 配置 JSON，如 {"mcpServers": {"名字": {"command": "npx", "args": ["-y", "包名"]}}}；支持多个服务器',
  connectorSubmit: '添加',
  connectorBundleHint: '选择 .dxt / .mcpb 插件包（MCP 插件包），安装到本机后作为连接器使用',
  connectorBundlePick: '选择 .dxt / .mcpb 文件',
  connectorBundleFields: '该插件需要以下配置',
  connectorBundlePicked: '已选择',
  connectorPickDir: '选择目录',
  connectorPickFile: '选择文件',
  connectorNeedDesktop: '导入插件包需要在桌面端操作（浏览器里读不到本地路径）',
  connectorSearchPlaceholder: '搜索连接器',
  connectorNoMatch: '没有匹配的连接器，换个关键词试试。',
  connectorSseHint: 'legacy SSE：只需填地址（dsh 本身不支持这个传输，由本插件桥接成工具）。',
  connectorTimeout: '超时',
  connectorTimeoutHint: '对该服务器单次工具调用的超时时间，单位是秒（右侧 s）。留空或 0 表示默认 60 秒。',
  connectorDetailTools: '可调用的工具',
  connectorDetailNoTools: '这个连接器当前没有注册任何工具（服务未连上或未提供工具）。',
  connectorDetailCopy: '复制工具名',
  connectorCopied: '已复制',
  connectorToolsUnit: '个工具',
  connectorEdit: '编辑',
  connectorRemove: '删除连接器',
  connectorConfirmRemove: '再次点击确认删除',
  connectorInfo: '连接信息',
  connectorParamRequired: '必填',
  connectorNoParams: '无参数',
  connectorRemoved: '已删除连接器',
  connectorConnected: '已连通',
  connectorDisconnected: '未连通或没有提供工具',
  connectorOff: '已关闭',
  enableConnector: '打开',
  disableConnector: '关闭',
}

export const en: Record<NexusaiLocaleKey, string> = {
  nav: 'NexusAI',
  panel: 'Experts · Skills · Connectors',
  signedOutTitle: 'Sign in to get started',
  tabExperts: 'Experts',
  tabSkills: 'Skills',
  tabConnectors: 'Connectors',
  tabExpertsDesc: 'Custom and built-in tools from {name}.',
  sourceCustom: 'Custom',
  sourceBuiltin: 'Built-in',
  emptyBuiltin: 'The server returned no built-in tools.',
  tabSkillsDesc: 'Browse {name} skill packages and download them locally.',
  tabConnectorsDesc: 'MCP services from {name} and their available tools.',
  emptyTitle: 'Nothing here yet',
  emptyHintSync: 'Capabilities sync automatically after sign-in; if this stays empty, switch organization from the bottom-left or sign in again.',
  toolsUnit: 'tools',
  sourceLocal: 'Local',
  sourceSkillHub: 'SkillHub',
  sourceRemote: 'Remote',
  localEmptyHint: 'No skills installed yet — get them from the Remote tab.',
  skillhubHint: 'Search the SkillHub marketplace (skillhub.cn) and open a skill page.',
  skillhubSearchPlaceholder: 'Search skills',
  localSearchPlaceholder: 'Search local skills',
  remoteSearchPlaceholder: 'Search remote skills',
  noMatchHint: 'No matching skills — try another keyword.',
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
  cancelAction: 'Cancel',
  cancelled: 'Sign-in cancelled',
  close: 'Close',
  loading: 'Loading…',
  menu: 'NexusAI account',
  signedInAs: 'Signed in: ',
  openSettings: 'Open settings',
  signOutIdle: 'Signing out will not delete any data. You can sign in to this account again.',
  signOutRunning: 'Tasks are currently running. Signing out will interrupt them. Sign out now?',
  signOutUnknown: 'Could not check running tasks. Signing out may interrupt tasks using this account. Continue?',
  logout: 'Sign out',
  loggedInAs: 'Signed in',
  switchOrg: 'Switch organization',
  sessionLost: 'Your session expired or was rejected by the server — please sign in again.',
  expires: 'Valid until',
  org: 'Organization',
  signedOutHint: 'Sign in to manage the synced custom tools, MCP servers, and skills here.',
  connectorsSignedOut: 'Sign in to sync the NexusAI MCP servers (created and imported).',
  localConnectorsEmpty: 'No local MCP connector yet — add one with 自定义连接器 in the toolbar.',
  tools: 'Custom tools',
  mcpServers: 'MCP servers',
  skills: 'Skills',
  download: 'Download',
  downloaded: 'Downloaded',
  notLoggedIn: 'Not signed in',
  addSkillFind: 'Find skills',
  addSkillUpload: 'Upload skill',
  uploadTitle: 'Import skill',
  uploadDropHint: 'Drop files here or click to upload',
  uploadAutoInstall: 'Install automatically when low risk',
  uploadRequirements: 'File requirements',
  uploadRequirementFolder: 'A folder or .zip must contain a SKILL.md file',
  uploadRequirementMarkdown: 'A .md file must carry the skill name and description as YAML',
  uploadPicked: 'Selected',
  uploadInstall: 'Install',
  uploadDone: 'Uploaded and installed',
  uploadExists: 'A skill with this name already exists',
  uploadOverwrite: 'Overwrite',
  uploadNoSkillFile: 'No SKILL.md found — pick a skill folder or archive that contains one',
  uploadBadMarkdown: 'A .md must open with YAML front matter (---) carrying name and description',
  uploadBadName: 'A skill name may only contain lowercase letters, digits and hyphens (e.g. my-skill)',
  uploadTooLarge: 'Upload is too large (8MB limit) — use a smaller skill package',
  customConnector: 'Custom connector',
  connectorQuickCreate: 'Quick create',
  connectorImportJson: 'Import from JSON',
  connectorImportDxt: 'Import DXT package',
  connectorImportMcpb: 'Import MCPB package',
  connectorName: 'Name',
  connectorTransport: 'Transport',
  connectorCommand: 'Command',
  connectorCommandHint: 'Prefer an absolute path, e.g. /usr/local/bin/node (dsh spawns without a shell, so PATH lookups may fail)',
  connectorArgs: 'Arguments',
  connectorArgsHint: 'One per line; a single line splits on spaces',
  connectorEnv: 'Environment',
  connectorEnvHint: 'One KEY=VALUE per line',
  connectorUrl: 'URL',
  connectorHeaders: 'Headers',
  connectorHeadersHint: 'One Name: value per line',
  connectorJsonHint: 'Paste an MCP config JSON, e.g. {"mcpServers": {"name": {"command": "npx", "args": ["-y", "pkg"]}}}; several servers are fine',
  connectorSubmit: 'Add',
  connectorBundleHint: 'Pick a .dxt / .mcpb package (an MCP bundle); it installs locally and becomes a connector',
  connectorBundlePick: 'Choose a .dxt / .mcpb file',
  connectorBundleFields: 'This package asks for the following',
  connectorBundlePicked: 'Selected',
  connectorPickDir: 'Choose a directory',
  connectorPickFile: 'Choose a file',
  connectorNeedDesktop: 'Installing a package needs the desktop app (a browser cannot read local paths)',
  connectorSearchPlaceholder: 'Search connectors',
  connectorNoMatch: 'No connector matches — try another keyword.',
  connectorSseHint: 'Legacy SSE: the URL is all it needs (dsh cannot host this transport, so the plugin bridges it into tools).',
  connectorTimeout: 'Timeout',
  connectorTimeoutHint: 'Per-tool-call timeout for this server, in seconds (the s on the right). Blank or 0 keeps the 60 s default.',
  connectorDetailTools: 'Tools it offers',
  connectorDetailNoTools: 'This connector currently registers no tools (the server is down or offers none).',
  connectorDetailCopy: 'Copy tool name',
  connectorCopied: 'Copied',
  connectorToolsUnit: 'tools',
  connectorEdit: 'Edit',
  connectorRemove: 'Delete connector',
  connectorConfirmRemove: 'Click again to confirm',
  connectorInfo: 'Connection',
  connectorParamRequired: 'required',
  connectorNoParams: 'No parameters',
  connectorRemoved: 'Connector deleted',
  connectorConnected: 'Connected',
  connectorDisconnected: 'Not connected or exposes no tools',
  connectorOff: 'Disabled',
  enableConnector: 'Enable',
  disableConnector: 'Disable',
}
