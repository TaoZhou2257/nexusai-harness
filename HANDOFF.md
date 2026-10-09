# HANDOFF — 交接摘要（2026-10-09 · 全量重写）

## 一句话现状
`@toby/dsh-plugin-nexusai`（0.1.0，dsh 基线 **0.2.0-rc.2**）已把 NexusAI 登录、能力同步、侧栏工作台与品牌体系全部跑通并逐项真机验证；**dsh 源码零改动**（检出为 tag `dsh-v0.2.0-rc.2`，`git status` 干净），NexusAI 侧的东西只落在：插件仓库、dev home 的 `cordis.patch.yml`、生成的 `.desktop-build` 里的软链/补丁。tsc 0 错误、无遗留调试日志。**发行版/产品化与 Windows 试用按用户指示暂停**（见文末待办），功能开发继续。

## 当前能力清单（全部真机验证）
**登录与账号**
- NexusAI 登录取代 dsh 内置账号 UI：官方 seam（`ctx.authorization.registerFlow` + 凭据 `nexusai/session`），左下角同一位置；登录弹窗打开即取验证码、动态品牌、服务器地址可改（脏值才可点的「应用」按钮 → 连通性测试 → 应用后**品牌立即刷新**）、空字段抖动校验、错误提示在表单下方、失败自动重发且**保留密码**
- 左下角启动器：未登录点一下直接开弹窗；已登录显示**圆形头像（首字母）+ 账号名 + 组织胶囊**（点击切换组织，宿主持久化 orgId 并重同步能力，工作台列表随 orgId 刷新）；菜单 = **打开设置（带 ⌘ , 快捷键提示）/ 登出**（「同步能力」入口已去掉，理由见下）
- **登出前确认框**（对齐 dsh 内置账号菜单，2026-10-09 补）：点「登出」先弹 `Modal`，三态文案 —— 有任务在跑「当前有任务正在执行，退出登录会打断它们」/ 列表未就绪「暂时无法确认任务状态…」/ 空闲「退出登录不会丢失任何数据」；确认按钮复用同一 `auth.logout()`。判定在读菜单点击**那一刻**采样（`runtime.hasRunningTasks()`），弹窗期间新起任务不会让文案失真
- 会话失效（401/过期）会自动登出：清理工具 / MCP 行 / SSE 桥接，并在左下角提示「登录状态已失效…」

**工作台（侧栏「专家 · 技能 · 连接器」）**
- 布局对齐 WorkBuddy 真机：能力标签行右端常驻 搜索框 / `已安装(N)` / `＋添加技能`；计数挂在能力标签与来源标签上
- **贴着窗口左上角的让位内边距**（2026-10-09 修）：`.nexusai-wb` 顶部 = `24px + var(--dsh-frame-top-clearance)`、起始边 = `max(24px, var(--dsh-frame-leading-clearance))` —— 侧边栏收起时内容自动让开红绿灯与「打开侧边栏 / 新建会话」悬浮控件（详见坑第 19 条）
- **专家** = NexusAI 自定义工具卡片
- **技能** 三来源：**本地**（对话「/」目录同源，卡片带启用/关闭开关「开=产品绿 `#00C29A` + 白旋钮，尺寸沿用 dsh 36×20」，「…」菜单 = 查看内容 / 复制路径 / 删除技能(二次确认)；详情页不放开关）/ **SkillHub**（腾讯市场：分类芯片 13+全部，带左右箭头翻页、向下无限翻页、卡片钥匙图标标「需 APIKey」、★收藏、点卡片进详情含 SKILL.md 预览|源码）/ **远程获取 · <品牌>**（NexusAI 目录，可下载）
- **连接器** 两来源：**本地**（本机 profile 的 mcp-client 行）/ **远程获取 · <品牌>**（创建 + 导入两套 MCP；legacy SSE 的由插件桥接成 dsh 工具，卡片显「SSE 已桥接」）
- 未登录时：隐藏「专家」与两个「远程获取」来源，其余照常（本地/SkillHub 无需登录）

**品牌（全部来自 `GET /v1/base/custom`）**
- 登录弹窗：logo、欢迎语、按钮色（平台配置）、底部平台版本（`about.version`；不显示版权）
- 侧栏左上角品牌：走**官方槽位** `sidebar.brand.mark` / `sidebar.brand.name` —— mark 取服务端方形 logo（宽高比 0.8–1.25），名字取 `tab.title`，版本徽章**优先平台版本**、取不到回落 **dsh 构建串** `0.2.0-rc.2-639ed01`；远程不可达时用默认 **NexusAI DSH** + 默认 mark（**智能体节点图**：上两节点 + 下节点连线）
- 工作台/连接器的品牌名与来源标签随登录的服务器刷新

**同步能力**
- 自定义工具（OpenAPI → dsh 工具）、MCP 行（streamable）、**SSE MCP 桥接**（`src/nexus/mcp-sse.ts` + `src/sync/mcp-tools.ts`：握手 → initialize → tools/list → tools/call，按需重连；工具名 `<prefix>__mcp__<server>__<tool>`，中文服务名用短哈希避免撞名）
- 实测：agent 在新会话里真的调用了桥接工具（远端返回 403「需要 token」，证明链路通）
- **触发时机（都是自动的，故 2026-10-09 去掉了头像菜单里的「同步能力」手动入口）**：登录成功时 / 切换组织时 / 带会话启动时各跑一遍；`capabilities.sync()` 内部工具·MCP 行·SSE 桥接三步各自 try/catch 隔离，单步失败不影响其余
- 清理范围：只删了 UI 入口（`NexusaiLauncher` 的菜单项 + `runSync` + `capabilities` prop + 两个导入）。宿主的 `Capabilities.sync()` **保留**（auth 仍在调），其 Typert Remote 描述符也**故意保留**：宿主 16 个公开方法与 16 条描述符严格 1:1，删描述符会让「公开方法无描述符」这一未经 dsh 验证的状态上线，得不偿失
- 去掉入口的真机验证（CDP 驱动）：菜单现在只剩 `["打开设置","登出"]`；把组织 `--- 系统 ---` → `nexusai` → `--- 系统 ---` 往返，技能与连接器计数随之变化并复原 —— 系统组织 `技能(1) / 远程获取·NexusAgent Builder(5)`（博查 / 百炼联网搜索 / 智能问数 / toolbox_databases…），`nexusai` 组织 `技能(0) / 连接器(0)`，切回后计数与卡片名**逐一复原**，说明切组织确实重新拉取了组织维度的数据

## 技能页搜索框按来源分开（2026-10-09）
用户报：技能页的搜索框不管在「本地」还是「远程获取」，搜的都是 SkillHub。原因：输入框一直绑在 `hubKeyword`（SkillHub 的关键词），且回车会**切到 SkillHub 来源**。
修法（`NexusaiWorkbench.tsx`）：
- 每个来源**各自一个搜索词**（`hubKeyword` / `localQuery` / `remoteQuery`），输入框按当前来源绑定；切换来源时各自保留、互不串
- 占位符随来源变化：`搜索本地技能` / `搜索技能`（SkillHub）/ **`搜索远程技能 · <品牌>`**（与来源标签同款动态拼接，品牌为空时退回 `搜索远程技能`）
- **只有 SkillHub 走服务端搜索**（回车 + 分类芯片）；本地与远程都是**本地过滤**（匹配 name/description/path 与 name/description/author，大小写不敏感），无匹配时显示「没有匹配的技能，换个关键词试试」
- 去掉了"在本地/远程打字回车就跳去 SkillHub"的行为（那正是串味的根源）

真机验证：本地 21 条 → 输入 `ppt` 得 5 条（baoyu-slide-deck / html-ppt / office-pptx / ppt-generator / pptx）；输入 `zzzz` 显示无匹配提示；远程（1 条 web-search）输入 `zzzz` 列表清空并提示无匹配、输入 `web` 命中；占位符三态分别为 `搜索本地技能` / `搜索技能` / `搜索远程技能 · NexusAgent Builder`；切 SkillHub 时输入框为空、24 张卡、搜 `excel` 走服务端；各来源搜索词互相独立、切回来还在。

⚠️ 教训（本次踩到）：远程分支的过滤**第一次没生效**，原因是我的脚本化替换锚点写错、又没断言，于是**静默没改**（渲染仍是 `skills.map`）。凡是脚本改代码，都应在替换后 `assert '<新片段>' in s` 复核。

## 启动器对齐 dsh 原生账号菜单（2026-10-09）
dsh 原生的头像菜单（`packages/client/ui-settings-account/src/client/AccountMenu.tsx`，注册在 `settings.launcher`）其实有：**设置（带快捷键提示）/ 意见反馈（飞书问卷，prefill uid+版本+设备）/ 退出登录（先查运行中任务再弹确认框）**，外加会话失效 toast、模型需登录 toast、充值赠送卡片，头像取 `profile.avatarUrl`，设置里还有「账号与余额」面板。而我们这边 **`ui-settings-account` 在 dev home 就是 `disabled: true`**，原生菜单根本不渲染（`priority: -1` 只是第二道保险）。
于是按用户要求补齐其中两项（其余——意见反馈指向 DeepSeek 问卷、余额面板、赠送卡片——不适用于 NexusAI，故意不补）：
1. **快捷键提示**：接住 owner props 里的 `settingsShortcut`，透传给菜单项 `shortcut` → 项上渲染 `⌘ ,` 键帽并带 `aria-keyshortcuts`
2. **登出确认框**：`Modal` + 三态文案；判定用 `runtime.hasRunningTasks()`（读客户端 `sessions.list` 快照的 `running`，`phase !== 'ready'` → `'unknown'`）。**没有**照搬原生那个 `remote.account.hasRunningTasks()`（那是 DeepSeek 账号专属 RPC，我们不该依赖）

真机验证（CDP，重启后）：
- 菜单项文案 = `打开设置 ⌘ ,`，`aria-keyshortcuts="Meta+,"`✓
- 空闲态：点登出弹框，文案「退出登录不会丢失任何数据…」，点「取消」→ 弹窗关闭且**仍为已登录**、组织不变✓
- **运行中态**：发一条真消息让 agent 跑起来，1.5 秒后开同一条路径 → 文案变「当前有任务正在执行，退出登录会打断它们」✓（任务跑完后同路径又回到空闲文案，说明判定跟的是实时状态）
- **确认登出真的生效**：点确认 → 弹窗关闭、启动器变「登录」✓；随后 `cp` 回备份凭据 + 重启 → 恢复「已登录：admin」、专家 11 / 技能 1 / 连接器 5、本地 21 / SkillHub 24 / 远程获取·NexusAgent Builder 1 全部复原✓（`logout()` 只清本地不调服务端，故旧 session 仍可用）
- **头像改圆形**：原本 `border-radius: 50%` 也被 dsh 的 `corner-shape: superellipse(1.5)`（根节点、可继承）画成圆角方块；加 `corner-shape: round` 后整窗截图核对为**正圆**✓（坑第 17 条）。组织胶囊保持 dsh 的 superellipse 风格不动

## 架构与关键接缝
| 环节 | 实现 |
|---|---|
| 授权 flow | `NexusaiAuthService` 注册 `ctx.authorization.registerFlow`（key `nexusai/session`）：captcha → 等提交 → bff login → `session.commit(grant)` |
| 尝试状态机 | initializing/waiting-input/verifying/committing/succeeded/cancelled/failed，`@Remote({mode:'stream'}) watch` 下发 |
| 凭据 | flow 唯一提交者（`nexusai/session`）；`nexusai/endpoint` 存 base url 覆盖；401 → api-client `persist(undefined)` → credentials 广播 `record-updated` → auth 清缓存/翻转视图/`sessionLost()` 清理注册并提示 |
| 客户端 fiber | mount/consumer 双 fiber：顶层只 inject 基础服务并 `$mount`，消费者 `ctx.plugin({inject:['remote.nexusaiAuth','remote.nexusaiCapabilities','theme','sessions','remote.skills']})` |
| 状态共享 | 一条 watch 流 → 共享快照 store → `useNexusai(selector)` |
| 本地读取（非 Remote） | `runtime.hasRunningTasks()` 直接读 dsh 客户端 `sessions.list` 快照的 `running`（`phase !== 'ready'` 返回 `'unknown'`）——刻意不走 Remote，免得给宿主加描述符 |
| Typert Remote | 手写描述符 **29 条**（`client/remote.ts`） |
| 槽位 | `sidebar.panellist` + `main`（键控面板 `nexusai`）+ `settings.launcher`（priority -1 遮蔽内置）+ **`sidebar.brand.mark` / `sidebar.brand.name`**（single/root，官方品牌槽）；**`settings.section` 已按要求删除**（组织切换挪到左下角） |

## 文件地图
```
src/                        宿主半
  index.ts                  apply：装配 + inject ['credentials','tools','authorization'] + LocalSkills / SkillHubClient / McpSseToolRegistry
  config.ts                 行配置（baseUrl、aesKey/aesIv、mcp.*、skills.*、skillhub.*、profilePatchFile…）
  service/auth.ts           登录服务（flow/状态机/watch/品牌+dsh 版本/连通测试/组织切换/会话丢失处理）
  service/capabilities.ts   能力 Remote：列表/同步（工具·MCP 行·SSE 桥接各自容错）/下载/技能详情预览/本地技能操作
  nexus/api-client.ts       bff 客户端（可变 base、/service/api 前缀、envelope 解码、assetUrl、401 语义）
  nexus/model.ts            接口类型（含导入 MCP、CustomInfoResponse 品牌全字段）
  nexus/skillhub.ts         SkillHub 客户端（搜索/分类/详情/安装/预览；canonicalName 唯一标识）
  nexus/mcp-sse.ts          legacy SSE 的 MCP 客户端（握手超时、CRLF 归一、按需重连）
  sync/custom-tools.ts      OpenAPI → dsh 工具
  sync/mcp-list.ts          两套 MCP 目录归一（创建 + 导入，判定 connectable）
  sync/mcp-tools.ts         SSE MCP 工具注册（JSON Schema → dsh 参数；名字防撞；按需重连）
  sync/mcp-rows.ts          mcp-client 行写入（YAML 保注释 + 原子写；isSeq 判定）
  sync/local-skills.ts      本地技能启用/关闭（改名）/扫描/读取/删除（路径守卫）
  sync/{skills,endpoint-store,session-store,openapi}.ts
client/                     浏览器半
  index.ts                  双 fiber + 快照 store + 6 个槽位注册 + controller
  face.ts / remote.ts       DTO / 29 条 Typert 描述符 / locales.ts 中英字典
  NexusaiWorkbench.tsx      三选项卡工作台（详情页、本地开关菜单、SkillHub 列表详情、连接器卡片）
  NexusaiSignInDialog.tsx   登录弹窗（品牌/服务器地址/校验/错误位置/失败重发）
  NexusaiLauncher.tsx       左下角入口（账号名 + 组织胶囊 + 菜单 = 打开设置 ⌘, / 登出 + 登出确认框）
  NexusaiBrand.tsx          侧栏品牌两个槽位的贡献（远程 mark/名字/版本；默认 NexusAI DSH + 节点图 mark）
  NexusaiPanelIcon.tsx      侧栏图标（工具箱字形）
scripts/
  build.mjs                 esbuild 双产物（宿主 ESM / 客户端 CJS + ModuleLoader 包裹）
  check-dsh-version.mjs     版本基线检查（npm run check:dsh）
  verify/cdp-eval.mjs       CDP 驱动运行中的桌面端（读 DSH_CDP_PORT，默认 9222）
  dev/install-into-dsh.mjs  新机器接线（构建 + 软链 + patch 行，幂等）
  dev/brand-dev-app.mjs     dev 包改名 + 换访达/Dock 图标（取服务端品牌，幂等）
  dev/{center-window.mjs,start-desktop.sh,watch-window.sh}   窗口摆放（macOS 专属，需辅助功能权限）
dist/windows-trial/         Windows 试用包（一键脚本 + 离线插件包 + 说明；未实测）
```

## 红线与坑（务必遵守）
1. **不改 dsh 源码**；配置只进 dev home 的 `cordis.patch.yml`（应用运行时会改写该文件，手改前先停应用）。宿主 `deepseek-account` 行**永远不禁用**（欢迎窗 RPC 硬依赖，禁用=启动 fatal；禁客户端 `ui-settings-account` 安全）
2. 改 client/src/patch 后必须重启桌面端；**不要 Page.reload**（会搞挂宿主）
3. **esbuild 会重命名宿主 Remote 方法的参数**（与外层标识符冲突时）→ Typert 按编译后签名校验，报 `args fields do not match the descriptor`；改参数后 `grep "async <method>(" lib/index.js` 核对
4. **React 列表 key 必须唯一**：上游「天然主键」不可想当然（SkillHub 的 `publicSlug` 一页内就有重复，曾表现为「筛选失效」→ 改用 `namespace.canonicalName`）
5. **外部接口空值**不能只判 undefined/''：JSON `null` 与字面量 `"null"` 都出现过（图标裂图）
6. **yaml 库解析结果是节点类型**（`YAMLSeq`/`YAMLMap`），判断集合要用 `isSeq/isMap`，`Array.isArray` 永远 false
7. **技能注册表对文件变更的响应不一致**：改名（SKILL.md ↔ .disabled）会刷新目录，**整目录删除不会** → 列表另用 `missingLocalSkills(paths)` 按磁盘核对
8. **dsh mcp-client 只支持 stdio / streamable-http**：legacy SSE 必须走本插件的桥接；SSE 帧可能是 CRLF，且 Node 的 `fetch` 默认无超时（都要处理）
9. **dsh 对工具参数 schema 校验严格**：`description` 缺失（undefined）会被拒（`must be lossless JSON data`）
10. **语言包无法被插件覆盖**：`ctx.locale.register` 对同 namespace+locale 重复注册直接抛错 → 改 Shell 文案只能用官方槽位（侧栏品牌即如此）或改 dsh 源码
11. **dev 包的 Dock 图标改不动**：Electron 未打包模式用自带图标；`CFBundleIconFile` 只影响访达，名称（plist）与访达图标可改，打包版（isPackaged）不受限；dsh 重建 dev 包后需重跑 `brand-dev-app.mjs`
12. **凭据磁盘与进程内状态（已用插桩定案）**：干净运行下会话**不会自己消失**——插桩验证 75 秒内无 401、无 `sessionLost`、磁盘记录完好、界面保持已登录。之前几次"磁盘没 session"**是我自己的测试引起的**：把 endpoint 换成另一台服务器（或恢复了对不上服务器的备份）→ 下一次 API 调用 401 → 插件按设计清会话并登出（现在还会在左下角提示「登录状态已失效…」）。恢复登录 = `cp` 回**同服务器**且含 session 的备份 + **重启**；备份时先 `grep -c 'nexusai/session'` 确认里有，且比对 `baseUrl:` 一致
13. 环境：**9222 常被 WorkBuddy 占用** → dsh 用 `DSH_DESKTOP_RENDERER_DEBUG_PORT=9223` 启动、验证脚本读 `DSH_CDP_PORT`；**同时只跑一个实例**（残留实例占 19387 → 新实例报 `DesktopHostFatalError: 2 required plugins did not activate`）；被强杀的实例留 `Singleton*` 导致秒退（删掉即可）
14. 权限：截屏看用户屏幕需**屏幕录制**；外部脚本移动窗口需**辅助功能**（两者当前已授权）
15. dsh 基线 **0.2.0-rc.2**（developer preview）：升级后跑 `npm run check:dsh` + tsc + CDP 回归，再更新 `dshBaseline`
16. **CDP 目标必须按 `dsh-app` 选**：`/json/list` 里可能有**两个 page 目标**——`devtools://…devtools_app.html`（DevTools 前端，0 个按钮）和 `dsh-app://app/`（我们的界面）。临时探针若按 `url.includes('index.html')` 匹配（永远匹配不到）再回落到「第一个 page」，会**静默驱动 DevTools 前端**，得到「找不到启动器／菜单为空」这类假失败。`scripts/verify/cdp-eval.mjs` 已按 `dsh-app` 选，照抄它的选法
17. **`border-radius: 50%` 在 dsh 里画不出圆形**：dsh 在根节点设了 `corner-shape: superellipse(1.5)`，该属性**可继承**，所以再正的 50% 圆角也会被描成「圆角方块」（表现为左下角头像不是圆的）。要真圆就在元素上写 `corner-shape: round`（Chromium 计算值归一为 `superellipse(1)`）；注意 `cornerShape` 还不在 csstype 的 `CSSProperties` 里，样式对象要放宽成 `React.CSSProperties & { cornerShape?: string }`。排查用 `getComputedStyle(el).cornerShape`
18. **截图核对的可靠姿势**：`Page.captureScreenshot` 的 `clip` 按 CSS px 传，但返回图会按 `dpr × scale` 放大（本机 dpr=2），别按像素直接读；最稳是**整窗截图**（不传 clip）再用 `sips -c <高> <宽> --cropOffset <top> <left>` 裁剪，然后放大看。**注意 `--cropOffset 0 0` 等同没传**（sips 会退化成居中裁剪，极易误判），要传 `1 1` 之类非零值。直接改 DOM 做视觉实验后记得还原（React 只 patch 变化的 style key，手改的值不会被自动清掉）
19. **主面板贴着左上角时必须用框架的「让位」变量**（否则会被窗口 chrome 压住）：dsh 框架（`ui-layout`，契约写在 `packages/client/ui-layout/README.zh.md`）发布两个变量 —— `--dsh-frame-top-clearance`（macOS 恒为 **48px**，Windows 为标题栏高）与 `--dsh-frame-leading-clearance`（**只在侧边栏收起时发布**，macOS **160px** = 红绿灯到 x68 + 控件 x88–152 + 8px 余量；全屏下 84px）。入口型页面（插件管理器/任务管理器/对话）都拿它们做内边距。我们的 `.nexusai-wb` 原先写死 `padding: 24px`，收起侧边栏后内容直接压在「打开侧边栏 / 新建会话」两个悬浮控件和红绿灯下面（表现为那排能力标签与控件重叠）。修法即契约写法：
    ```css
    .nexusai-wb { padding: calc(24px + var(--dsh-frame-top-clearance, 0px)) 24px 24px;
      padding-inline-start: max(24px, var(--dsh-frame-leading-clearance, 0px)); }
    ```
    （变量未发布时回落到自身 24px，浏览器里打开也不受影响；右侧不加，避免收起时右边也多出 160px）
20. **测「被挡住/点不动」必须用真实鼠标事件**：`el.click()` 走不到命中测试（hit testing），被遮挡的按钮照样"点得动"，会漏掉遮挡类 bug。要 `Input.dispatchMouseEvent`（mouseMoved → mousePressed → mouseReleased），并配合 `document.elementsFromPoint(x,y)` 看该点实际落在谁身上

## 验证操作手册
```bash
# 起桌面端（9222 可能被占）
cd ~/IdeaProjects/deepseek-harness && DSH_DESKTOP_RENDERER_DEBUG_PORT=9223 pnpm run start:desktop
# 驱动/检查运行中的页面（自动找 dsh-app 目标）
cd ~/GoLandProjects/nexusai-harness && DSH_CDP_PORT=9223 node scripts/verify/cdp-eval.mjs "<js表达式>"
# 构建与静态检查
node scripts/build.mjs && npx tsc --noEmit && npm run check:dsh
# 新机器接线 / 改名换图标 / 窗口居中
node scripts/dev/install-into-dsh.mjs
node scripts/dev/brand-dev-app.mjs            # 可选 --name X --icon path/to.png --bg 111113
./scripts/dev/start-desktop.sh                # 或 ./scripts/dev/watch-window.sh center
```

## 换机器 / 新环境部署
- **带源码（开发用）**：克隆 dsh（`git checkout dsh-v0.2.0-rc.2`）→ `pnpm install` → 跑一次 `start:desktop` 生成 `.desktop-build` → 克隆本插件 → `node scripts/dev/install-into-dsh.mjs`（幂等：构建 + 软链 + patch 行）→ 启动 → 登录
- **不带源码（体验用）**：本机 `pnpm run package:desktop:mac:arm64` 出 dsh 安装包 + `npm pack` 出插件 tgz → 新机器装应用 → 侧栏「插件」页安装（dsh 支持 registry / 本地路径 / tgz / git 四种来源）→ 在 profile 的 user 层 patch 补 `nexusai` 行 → 登录
  - ⚠️ **Windows 包只能在 Windows 构建机/CI 上打**（dsh 打包脚本硬性要求，且预检需 VS C++ 工具链；GitHub release 无官方安装包）
- Windows 试用包见 `dist/windows-trial/`（一键 dev 接线 ps1 + 离线插件包 + 说明；**未实测**，PowerShell 未做语法校验）

## 自定义应用名 / 图标（2026-10-09）
| 层面 | 来源 | 可否自定义 |
|---|---|---|
| Dock / 菜单栏 / 访达的**应用名** | dev 包 plist 硬编码 `Harness Dev` | ✅ 改生成出来的 .app（`scripts/dev/brand-dev-app.mjs`） |
| **访达里的图标** | dev 包继承 Electron 图标 | ✅ 同上（下载服务端 logo → sips 补方 → iconutil → icns → 重签名） |
| **Dock 图标（dev）** | Electron 未打包模式自带图标 | ❌ 需 `app.dock.setIcon()`（改 dsh）；打包版正常 |
| 应用内品牌（侧栏左上角） | 官方槽位 `sidebar.brand.mark/name` | ✅ 已做（远程 → 默认 NexusAI DSH + 节点图） |
| 打包版 `productName` / 图标 | dsh 源码硬编码 `DeepSeek Harness` / `resources/icon-macos.png` | ❌ 需产品化（自有壳）或改 dsh |

## 待办
| 优先级 | 任务 | 状态 |
|--------|------|------|
| 暂缓 | **发行版 / 产品化**：薄载体（自有 Electron 壳 ≈250 行 + 构建期组装 profile + electron-builder；macOS 本机出、Windows 走 CI windows runner）+ 插件自带 `dsh.bundle.patch` 与配置表单；产物目标 ~500MB；品牌 NexusAgent Builder、占位图标、不签名、窗口默认居中 | ⏸ 用户暂缓 |
| 暂缓 | Windows 试用包实测 | ⏸ 用户暂缓 |
| 暂缓 | SSE 桥接的凭据跟进（智能问数需 token：服务端 `mcp_start` 换取 / 插件配置默认 token） | ⏸ 用户暂缓 |
| 暂缓 | agent 实调 NexusAI 自定义工具（MCP 侧已验过整条链路） | ⏸ 用户暂缓 |
| 杂 | 「删除技能」是否改移入废纸篓；`package.json` 的 `types` 指向不存在的 d.ts | ⏸ 用户暂缓 |
| 可选 | 强登录门槛：shell.overlay 全屏拦截层（未实施） | ⬜ |

### 清洁项
- 测试用临时技能（zz-scratch-skill / mm-scratch-skill / aa-delete-target / zz-bystander / zz-tag-check）均已删除；误删的 `indiv-ebandao-dev-expert` 已重装
- 代码内无 `TEMP-DEBUG` 残留（已全量 grep 确认）；`mcp-rows` 重复行已收敛为 1 个 insert
- **语言包有 18 个已无引用的 key**（`nav`/`tabExpertsDesc`/`tabSkillsDesc`/`tabConnectorsDesc`/`skillhubHint`/`search`/`featuredSkills`/`searchResults`/`shuffle`/`mcpSseTools`/`pathCopied`/`captchaPlaceholder`/`loggedInAs`/`expires`/`org`/`tools`/`mcpServers`/`notLoggedIn`），是历次删 UI 的残留；已确认无动态拼 key 的用法，可安全删（本次未删，避免超出改动范围）
- 应用当前状态：endpoint `http://agent.nexusai.net.cn:8081`、已登录 admin、专家 11 / 技能 1 / 连接器 5、侧栏品牌 `NexusAgent Builder ｜ v1.5.0.3`
- 可用的凭据备份（含 session）在 `/tmp/creds-*.yaml`（临时目录，重启机器会清）；`/tmp/creds-presignout-1009-1616.yaml` 是 2026-10-09 登出验证前所备、**已验证可完整还原登录态**（`logout()` 只清本地，不调服务端，所以旧 session 仍然可用）。恢复手法见「坑」第 12 条
