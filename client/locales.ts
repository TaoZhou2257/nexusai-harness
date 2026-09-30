/**
 * NexusAI surface dictionaries (launcher, sign-in dialog, settings section).
 * One namespace; every surface's `t` draws from this key union.
 */
export type NexusaiLocaleKey =
  | 'nav'
  | 'loginTitle'
  | 'loginHint'
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
  | 'expires'
  | 'org'
  | 'signedOutHint'
  | 'tools'
  | 'mcpServers'
  | 'skills'
  | 'download'
  | 'downloaded'
  | 'notLoggedIn'

export const zh: Record<NexusaiLocaleKey, string> = {
  nav: 'NexusAI',
  loginTitle: '登录 NexusAI',
  loginHint: '输入 NexusAI 账号、密码和验证码完成登录。',
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
  expires: '有效期至',
  org: '组织',
  signedOutHint: '登录 NexusAI 账号后，可在这里管理同步过来的自定义工具、MCP 服务与技能。',
  tools: '自定义工具',
  mcpServers: 'MCP 服务',
  skills: '技能',
  download: '下载',
  downloaded: '已下载',
  notLoggedIn: '未登录',
}

export const en: Record<NexusaiLocaleKey, string> = {
  nav: 'NexusAI',
  loginTitle: 'Sign in to NexusAI',
  loginHint: 'Enter your NexusAI account, password, and captcha to sign in.',
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
  expires: 'Valid until',
  org: 'Organization',
  signedOutHint: 'Sign in to your NexusAI account to manage the synced custom tools, MCP servers, and skills.',
  tools: 'Custom tools',
  mcpServers: 'MCP servers',
  skills: 'Skills',
  download: 'Download',
  downloaded: 'Downloaded',
  notLoggedIn: 'Not signed in',
}
