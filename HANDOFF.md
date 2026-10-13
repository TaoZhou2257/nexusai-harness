# HANDOFF — 交接摘要（2026-10-13 · 发行版 0.1.1）

> 读者：接手这个项目的**新 AI 工具或新同事**。本文自包含，读完即可开工。所有"已验证"都是真机验证（CDP 驱动运行中的桌面端 + 截图），不是推理。

## 本次交接（2026-10-13）

**做了什么**：把 v1.0 的载体推成**可发布状态**，并发了第一个 Release。

- **修发行阻断 bug（profile 名）**：插件解析 patch 文件时默认 `profiles/desktop`，而打包版的 profile 叫 `nexusai` —— dev 环境恰好是 `desktop`，把这个错误盖住了。后果是打包版里 **NexusAI 的 MCP 行与自定义连接器全部写到宿主不加载的文件**（卡片有、工具不挂载）。现改为"找承载本插件行的那个 profile"（显式 `profilePatchFile` 仍优先），并加启动日志打印解析结果。
- **运行时日志落盘**：`<home>/logs/runtime.log`（2MB 轮转一次，token 统一脱敏），菜单加 **帮助 → 打开日志目录 / 查看运行日志 / 关于**（关于显示应用版本、内置运行时版本、home 路径）。打包版没有终端，这是用户唯一能给回来的东西。
- **登录完全由用户发起**（2026-10-13 按用户要求改）：应用**从不**自己弹登录框；未登录时入口是左下角启动器（标签即登录文案）+ 工作台里的登录 CTA。原先那版「未登录启动自动弹一次」已移除 —— 它同时是 CI 的 Windows 验收闸判断「client 半已挂载」的证据，现改判启动器上的 `data-nexusai="launcher"` 标记（不依赖文案与语言），见 `scripts/check-client-mounted.mjs`。
- **CI 两处失败修复**：`npm ci` 的 peer 图 ERESOLVE（仓库 `.npmrc` → `legacy-peer-deps`）；`prepare-runtime` 读 `upstream/package.json` 在 CI 上 ENOENT（CI 不检出 submodule）。
- **类型依赖显式钉住**：16 个 dsh 类型包进 `devDependencies`（不进 `dependencies`，不影响产物），因为 `legacy-peer-deps` 让干净克隆不再装 peer，本地 `tsc` 会缺类型。
- **Release 流程**：`.github/workflows/build.yml` 加 release job —— 打 tag（`v*`）后两端产物自动挂到 Release；分支推送仍只产 artifact。

**已验证（本机 macOS arm64 + CI）**：`prepare:runtime` 组合通过；无 GUI 冒烟到达 web URL；**打包版 `.app` 从干净 home 启动开窗**；**profile 解析在打包布局与 dev home 分别得到 `profiles/nexusai` 与 `profiles/desktop`**（套件补 3 例，共 66 例）；**日志落盘且 token 无残留**；**未登录启动弹窗 1 次、点关闭后不再弹**（CDP 实测）；CI 全绿（mac DMG 225MB / win exe 211MB）；tag `v0.1.0` 的 Release 已发布。

**未验证**：产物精简（内置 profile ~490MB）。**Windows 真机已由用户验证：安装后可正常启动**（2026-10-13，v0.1.2）；macOS v0.1.2 的「仍要打开」路径仍待用户确认（v0.1.1 那次是签名损坏，已在 0.1.2 修）。

**密钥现状**：仓库已私有；那个曾公开过的 AES key 建议在服务端轮换一次。

## 0. 这是什么

`@toby/dsh-plugin-nexusai`（0.1.0）—— dsh（DeepSeek Harness）桌面端的一个 Cordis 插件，把 **NexusAI 平台**接进 dsh 侧栏：NexusAI 登录、自定义工具（专家）、技能（本地 / SkillHub / NexusAI 远程）、连接器（本地 MCP / NexusAI MCP，含 legacy SSE 桥接）、以及全站品牌。

**三个坐标**
| 位置 | 路径 |
|---|---|
| 插件仓库（本项目，可自由改） | `~/GoLandProjects/nexusai-harness` |
| dsh 源码（**不要改**） | `~/IdeaProjects/deepseek-harness`（检出 tag `dsh-v0.2.0-rc.2`，git 干净） |
| dsh 运行目录（dev home，配置文件在这） | `~/IdeaProjects/deepseek-harness/apps/desktop/.desktop-build/development/home` |
| NexusAI 服务器（当前用） | `http://agent.nexusai.net.cn:8081`（另有 `http://221.226.155.134:8081`；SkillHub 用公网 `api.skillhub.cn`） |

**三条硬红线**（源自 `AGENTS.md`，违反即返工）
1. **不改 nexusai-server 任何代码** —— 只通过它的 REST API（bff，nginx 前缀 `/service/api`，envelope `{code,data,msg}`）。
2. **尽量不改 dsh 源码** —— 需要改行为时，只动 dev home 的 `cordis.patch.yml`；改 `pnpm-workspace.yaml` 等源码会与上游 git 冲突。目前**源码零改动**。
3. **不在插件里写死密钥** —— 凭据走 dsh credentials 机制（`.credentials.yaml`）。

## 1. 环境自检（接手先跑这四条）

```bash
cd ~/GoLandProjects/nexusai-harness
npx tsc --noEmit        # 期望：无输出（0 错误）
node scripts/build.mjs  # 期望：lib/index.js（宿主）+ lib/client.js（客户端）两个产物
npm run check:dsh       # 期望：check-dsh-version: ok (dsh 0.2.0-rc.2)
DSH_CDP_PORT=9223 node scripts/verify/cdp-eval.mjs "'ok'"   # 期望："ok"（能连上运行中的桌面端）
```

桌面端没在跑时，第 4 条会报 `no dsh-app page target`。启动方式（**9222 常被 WorkBuddy 占用，固定用 9223**）：

```bash
cd ~/IdeaProjects/deepseek-harness && DSH_DESKTOP_RENDERER_DEBUG_PORT=9223 nohup pnpm run start:desktop > /tmp/dsh-9223.log 2>&1 & disown
# 约 60 秒后日志出现 "dsh web: http://127.0.0.1:19387/?token=..." 即就绪
```

**同时只能跑一个实例**（详见坑 A3）。

## 2. 当前运行状态（2026-10-09 收尾）

| 项 | 值 |
|---|---|
| 服务器 | `http://agent.nexusai.net.cn:8081` |
| 登录 | 已登录 `admin`，组织 `--- 系统 ---` |
| 侧栏品牌 | `NexusAgent Builder ｜ v1.5.0.3`（远程取到；取不到回默认 `NexusAI DSH` + 节点图 mark） |
| 工作台计数 | 专家 11 / 技能 1 / 连接器 5 |
| 技能来源计数 | 本地 21 / SkillHub 24 / 远程获取 · NexusAgent Builder 1 |
| 侧边栏 | 展开；面板选中「专家 · 技能 · 连接器」 |

## 3. 已实现能力（全部真机验证）

**登录与账号**（取代 dsh 内置 DeepSeek 账号 UI，用官方 seam `ctx.authorization.registerFlow` + 凭据 `nexusai/session`）
- 登录弹窗：打开即取验证码、动态品牌（logo/欢迎语/按钮色/平台版本）、服务器地址可改（脏值才可点的「应用」→ 连通性测试 → 应用后**品牌立即刷新**）、空字段抖动校验、错误在表单下方、失败自动重发且**保留密码**
- 左下角启动器：未登录点一下直接开弹窗；已登录 = **圆形头像（首字母）+ 账号名 + 组织胶囊**（点胶囊切组织，宿主持久化 orgId 并重同步，工作台列表随之刷新）；菜单 = **打开设置（带 `⌘ ,` 快捷键提示）/ 登出**
- **登出前确认框**：`Modal` 三态文案 —— 有任务在跑「当前有任务正在执行，退出登录会打断它们」/ 会话列表未就绪「暂时无法确认任务状态…」/ 空闲「退出登录不会丢失任何数据」。判定在点菜单**那一刻**采样
- 会话失效（401/过期）自动登出：清工具 / MCP 行 / SSE 桥接，左下角提示「登录状态已失效…」

**工作台（侧栏「专家 · 技能 · 连接器」，键控面板 `nexusai`）**
- 布局对齐 WorkBuddy：能力标签行右端常驻 搜索框 / `已安装(N)` / `＋添加技能`；计数挂在能力标签与来源标签上
- **搜索按来源分开**：本地 / SkillHub / 远程各一个搜索词互不串味；占位符随来源变化（`搜索本地技能` / `搜索技能` / `搜索远程技能 · <品牌>`）；**只有 SkillHub 走服务端搜索**（回车 + 分类芯片），本地与远程是本地过滤
- **专家** = NexusAI 自定义工具卡片
- **技能** 三来源：**本地**（与对话「/」目录同源；卡片带启用/关闭开关「开 = 产品绿 `#00C29A` + 白旋钮，尺寸沿用 dsh 36×20」，「…」菜单 = 查看内容 / 复制路径 / 删除技能(二次确认)；详情页不放开关；顺序稳定、切换不闪）/ **SkillHub**（腾讯市场：13 个分类芯片 + 全部，左右箭头翻页 + 向下无限翻页，钥匙图标标「需 APIKey」，★收藏，点卡片进详情含 SKILL.md 预览）/ **远程获取 · <品牌>**（NexusAI 目录，可下载）
- **连接器** 两来源：**本地**（本机 profile 的 mcp-client 行）/ **远程获取 · <品牌>**（创建 + 导入两套 MCP；legacy SSE 的由插件桥接成 dsh 工具，卡片显「SSE 已桥接」）
- **连接器工具栏**（2026-10-09，布局与技能一致）：搜索框（按来源各自过滤，含「没有匹配的连接器」）+ **自定义连接器** 四项菜单
  - **快速创建**：名称 + 传输方式（stdio / streamable-http），stdio 填 命令 / 参数 / 环境变量，http 填 URL / 请求头。参数「每行一个」（只有一行时按空格拆），环境变量「每行 KEY=VALUE」，请求头「每行 Name: value」
  - **从 JSON 导入**：粘贴 MCP 配置 JSON，认四种形状 —— `{mcpServers:{…}}`（Claude/Cursor）、`{servers:{…}}`（VS Code）、裸的 `{名字:{…}}` 映射、单个带 name 的对象；一次可加多个。有 `command` 走 stdio、有 `url` 走 streamable-http；`type:"sse"` 明确拒绝（dsh 无 legacy SSE 传输）
  - **legacy SSE 也支持**（2026-10-09）：快速创建多了 `sse` 传输（只填 URL），JSON 里 `type:"sse"` 不再被拒 —— 它们**不写行**（dsh 的 mcp-client 没有这个传输），而是存进 `<dshHome>/mcp-sse-connectors.json` 并由本插件的桥接注册成 dsh 工具（与 NexusAI 那些 SSE 服务器同一条桥）。本地卡片对它们显示「SSE 已桥接 / 仅 SSE」旗标，出问题带 bridgeError
  - **导入 DXT 包 / 导入 MCPB 包**：同一个格式的两个名字（MCPB 是现名，DXT 是旧名，manifest 字段分别是 `manifest_version` / `dxt_version`）。选包后先读 manifest 展示名称/版本/作者/类型，再把 `user_config` 声明渲染成表单（string/number/boolean/directory/file，sensitive 掩码，default 预填，必填校验），确认后解包到 `<dshHome>/mcp-bundles/<name>` 并写行
  - **每个连接器的连接设置**（三种传输都有）：**超时（秒）**（默认 60，写进行的 `toolCallTimeoutMs` / 桥的每次调用预算，**原样写，不缩放**）、以及 **SSE 的请求头**（`Name: value` 每行一个，握手与每次 POST 都带上）。JSON 导入认 `timeout`（秒）；编辑时全部预填。
    ⚠️ **长时间运行模式已删除**（2026-10-10，用户拍板）：dsh 的 MCP 客户端只有**一个**超时字段、且不支持按进度重置计时器，开关无法在运行时生效 —— 它只是插件侧的一纸声明，所以整个功能（存储 `mcp-connector-prefs.json`、表单开关、语言键）一并移除了。想跑长任务的连接器直接把「超时」填大即可。
  - **连接器详情页**（点卡片进入）：连接信息（地址/命令、工具命名空间）+ **可调用的工具清单** —— 每个工具给服务器自己的名字、dsh 全名（`mcp__…`，可一键复制）、说明，以及**参数 schema**（参数名/类型/必填/说明）。清单来自 `ctx.tools.schemas()`，与模型看到的是同一份
  - **连通状态点**（名字前）：**绿=已连通**（title 里带工具数）、**红=未连通**（title 里带桥的报错）、**灰=已关闭**；远程卡片同样有点
  - **打开/关闭开关**（本地卡片，模仿技能卡片的 36×20 胶囊，位置也在「…」右侧）：行式连接器写 dsh 自己的 `disabled: true`（dsh 的加载器随后卸载实例、撤掉工具，无需重启）；自定义 SSE 写存储里的 `enabled` 并重跑桥。**已实测**：关掉后状态点变灰、工具数归 0（实例被回收），打开后状态点变绿、工具回来。NexusAI 自己的行不给关（同步维护），宿主会拒绝
  - **卡片「…」菜单**（只有本页添加的才有）：可调用的工具 / 编辑 / 删除连接器。编辑按原值预填，改名**原地替换**（旧行随之删除）；删除需二次确认；配置文件里手写的行**不给删除入口**，宿主也会拒绝
  - 三者都落到 `<profile>/cordis.patch.yml` 的 **`custom-mcp-*` 行**（插件自己的 insert 项），**登出不会被清**（NexusAI 的 `nexusai-mcp-*` 才会）；同名再加 = 覆盖更新那一行（id 由名字派生）。实测：删掉行 → dsh 的 HMR 立刻回收实例（夹具进程随之退出）
- **＋添加技能**（2026-10-09）＝ 两项菜单：**查找技能**（切到 SkillHub 来源 + 光标落进搜索框）/ **上传技能**（打开「导入技能」弹窗）
- **导入技能弹窗**（按用户给的参考图重做）：标题 + 右上 X、**虚线拖拽区**（托盘+上箭头自绘字形 + 「拖拽文件或点击上传」）、`非高风险自动安装` 复选框、`文件要求` 两条（文件夹或 .zip 需含 SKILL.md；.md 需含 YAML 名称与描述）；另加一行 `选择文件夹` 下划线链接 —— 一个原生文件对话框无法同时选文件和选目录，所以拖拽与链接各管一类
  - 拖拽：`dragEnter/dragOver` 高亮（`is-drag`），`drop` 时用 `webkitGetAsEntry()` 递归展开文件夹（路径与目录选择器的 `webkitRelativePath` 同形），拿不到 entry 就退回 `dataTransfer.files`
  - **只有一个入口**（2026-10-09 合并）：拖拽收下一切，点区域开一个选择面板，**由「选中项的真实路径」自动判断**拿回来的是什么
  - 点击上传为什么一个入口能通吃：桌面 preload 暴露 `window.__DSH_HOST_PATHS__.pathFor(file)`（= 主进程 `webUtils.getPathForFile`），拿到真实磁盘路径后交给宿主 `installFromPath()` 判断 —— 目录=技能文件夹；名为 `SKILL.md`=它的整个文件夹；`.zip`=压缩包；`.md`=单文件技能；其他文件=同目录若有 SKILL.md 就按那个文件夹装，否则明确拒绝。于是不再需要第二个「选择文件夹」按钮（**原生面板一次只能选文件或选目录**，dsh 自己的 `ctx.directoryPicker` / `__DSH_DIRECTORY_PICKER__` 也只有目录一种）
  - 没有路径桥时（浏览器打开 dsh web、或粘贴来的 File）回落成按字节上传，此时只有 .zip/.md 能被识别
  - `非高风险自动安装` 勾选后，选中即装（不再点「安装」）；**但同名冲突仍然停下来问**（弹「已存在同名技能」→ 覆盖安装）——实测确认，不会静默覆盖
  - 校验（客户端先拦、宿主再核）：文件夹与 .zip 必须含 **SKILL.md**（允许整体多包一层目录，自动剥掉）；.md 与 SKILL.md 本身都要有 YAML 前置信息的 **name + description**，且 name 必须符合 **dsh 的 kebab-case 语法**（见坑 B8）
  - 落盘 = `<技能根>/<name>/`（name 即目录名，用户输入不触达路径），先写 staging 再 `rename` 换入；同名返回 `exists`；上限 8MB；路径穿越（`..`/绝对路径/盘符）拒绝
- 未登录时：隐藏「专家」与两个「远程获取」来源，本地/SkillHub 照常
- 贴着窗口左上角的**让位内边距**：顶部 `24px + var(--dsh-frame-top-clearance)`、起始边 `max(24px, var(--dsh-frame-leading-clearance))` —— 侧边栏收起时自动避开红绿灯与悬浮控件（坑 B4）

**品牌（全部来自 `GET /v1/base/custom`）**
- 登录弹窗：logo、欢迎语、按钮色、底部平台版本（`about.version`，不显示版权）
- 侧栏左上角：走**官方槽位** `sidebar.brand.mark` / `sidebar.brand.name` —— mark 取服务端方形 logo（宽高比 0.8–1.25），名字取 `tab.title`，版本徽章优先平台版本、取不到回落 dsh 构建串；远程不可达时用默认 **NexusAI DSH** + 默认 mark（节点图）
- 工作台/连接器的品牌名与来源标签随登录服务器刷新

**能力同步**（全部自动：登录成功 / 切换组织 / 带会话启动各跑一遍）
- 自定义工具（OpenAPI → dsh 工具）、MCP 行（streamable，写 profile patch）、**SSE MCP 桥接**（`src/nexus/mcp-sse.ts` + `src/sync/mcp-tools.ts`：握手 → initialize → tools/list → tools/call，按需重连；工具名 `<prefix>__mcp__<server>__<tool>`，中文服务名用短哈希防撞）
- `capabilities.sync()` 内部三步各自 try/catch 隔离，单步失败不影响其余
- 实测：agent 在新会话真的调用了桥接工具（远端 403「需要 token」，证明链路通）
- 头像菜单里的手动「同步能力」入口已删（因为同步全自动）；宿主 `Capabilities.sync()` 与它的 Remote 描述符**保留**（宿主 17 个公开方法 ↔ 17 条描述符严格 1:1，删描述符会引入 dsh 未验证状态）

## 4. 架构与关键接缝

| 环节 | 实现 |
|---|---|
| 授权 flow | `NexusaiAuthService` 注册 `ctx.authorization.registerFlow`（key `nexusai/session`）：captcha → 等提交 → bff login → `session.commit(grant)` |
| 尝试状态机 | initializing/waiting-input/verifying/committing/succeeded/cancelled/failed，`@Remote({mode:'stream'}) watch` 下发 |
| 凭据 | flow 是唯一提交者；`nexusai/endpoint` 存 base url 覆盖；401 → api-client `persist(undefined)` → credentials 广播 `record-updated` → auth 清缓存/翻视图/`sessionLost()` |
| 客户端双 fiber | mount/consumer：顶层只 inject 基础服务并 `$mount`，消费者 `ctx.plugin({inject:['remote.nexusaiAuth','remote.nexusaiCapabilities','theme','sessions','remote.skills']})`（避免自死锁） |
| 状态共享 | 一条 watch 流 → 共享快照 store → `useNexusai(selector)` |
| 本地读取（非 Remote） | `runtime.hasRunningTasks()` 直接读 dsh 客户端 `sessions.list` 快照的 `running`（`phase !== 'ready'` → `'unknown'`）——刻意不加 Remote 描述符 |
| 结论：工具数就是连通性的唯一来源 | dsh 不暴露 mcp-client 实例的连接状态，所以「绿/红点」只能以**工具是否注册**为准：绿=有工具；灰=已关闭；红=没工具（**可能是连不上，也可能是服务端本来就没给工具**——远程的 `百炼联网搜索` 就是后者，直连 curl 该 endpoint 返回 `{"tools":[]}`）。红点的 title 因此写「未连通或没有提供工具」 |
| 工具清单读取 | `src/sync/connector-tools.ts` 读 `ctx.tools.schemas()`（dsh 注册表，模型同源）：行式连接器按 `mcp__<serverName>__` 前缀匹配，桥接式按桥记录的 `{rawName, dshName}` 精确匹配；远程卡片用目录 id，宿主折算成我们写的那行 |
| 连接器行 | `<profile>/cordis.patch.yml` 里的 mcp-client 行：**NexusAI 的 `nexusai-mcp-*`**（登出清）与**用户自定义 `custom-mcp-*`**（永不清）分属两个 insert 项；共用 `src/sync/patch-file.ts` 的保注释 + 原子写 |
| 桌面 preload 桥（可用接缝） | `window.__DSH_HOST_PATHS__.pathFor(file)` → 选中项的绝对路径；`window.__DSH_DIRECTORY_PICKER__.pick()` → 原生**目录**选择器。都出自 `apps/desktop/src/preload-app.ts`，contextBridge 冻结、只读不可改写 |
| Typert Remote | 手写描述符 **32 条**（`client/remote.ts`）；宿主 `capabilities` **20 公开方法 ↔ 20 描述符**（曾有一条孤儿描述符 `listLocalSkills`：无方法、无调用者，已删） |
| 槽位（5 个） | `sidebar.panellist` + `main`（键控面板 `nexusai`）+ `settings.launcher`（priority -1 遮蔽内置账号菜单）+ `sidebar.brand.mark` / `sidebar.brand.name`；`settings.section` 已按要求删除（组织切换挪到左下角） |
| 构建 | `scripts/build.mjs`：esbuild 双产物（宿主 ESM / 客户端 CJS + `__ModuleLoader__` 包裹） |

## 5. 文件地图

```
src/                        宿主半
  index.ts                  apply：装配 + inject ['credentials','tools','authorization'] + LocalSkills / SkillHubClient / McpSseToolRegistry
  config.ts                 行配置（baseUrl、aesKey/aesIv、mcp.*、skills.*、skillhub.*、profilePatchFile…）
  service/auth.ts           登录服务（flow/状态机/watch/品牌+dsh 版本/连通测试/组织切换/会话丢失处理）
  service/capabilities.ts   能力 Remote：列表/同步（三步各自容错）/下载/技能详情预览/本地技能操作（含上传安装）
  nexus/api-client.ts       bff 客户端（可变 base、/service/api 前缀、envelope 解码、assetUrl、401 语义）
  nexus/model.ts            接口类型（含导入 MCP、CustomInfoResponse 品牌全字段）
  nexus/skillhub.ts         SkillHub 客户端（搜索/分类/详情/安装/预览；canonicalName 唯一标识）
  nexus/mcp-sse.ts          legacy SSE 的 MCP 客户端（握手超时、CRLF 归一、按需重连）
  sync/custom-tools.ts      OpenAPI → dsh 工具
  sync/mcp-list.ts          两套 MCP 目录归一（创建 + 导入，判定 connectable）
  sync/mcp-tools.ts         SSE MCP 工具注册（JSON Schema → dsh 参数；名字防撞；按需重连）
  sync/mcp-rows.ts          mcp-client 行写入（YAML 保注释 + 原子写；isSeq 判定）
  sync/local-skills.ts      本地技能：启用/关闭（改名）/扫描/读取/删除（路径守卫）/安装（按请求或按路径；校验 name 类型+语法；staging 换入）
  sync/patch-file.ts        profile patch 的共用读写（保注释、原子 0600、解析失败即拒绝、serverName 生成）
  sync/connector-rows.ts    自定义连接器行（custom-mcp-*，与 NexusAI 行分开的 insert 项，登出不清）
  sync/mcp-bundle.ts        DXT/MCPB 包：manifest 校验、user_config 表单字段、变量替换、平台覆盖、解包安装
  sync/sse-connectors.ts    自定义 legacy-SSE 连接器清单（JSON，原子写；enabled/超时/请求头；`bridgeInputOf` 是唯一映射入口）
  sync/connector-tools.ts   连接器 → 工具清单（读 dsh 注册表；行式按前缀、桥接按记录名）
  sync/connector-rows.ts    另含 `connectorTimeoutMs()`：超时（秒）→ 毫秒预算的唯一换算处
  sync/mcp-rows.ts          另含 `setEnabled`：写/清行的 `disabled` 标志（dsh 的插件开关同一机制）
  service/connector-author.ts  三条录入路径的解析与落行（快速/JSON/包），供 capabilities 调用
  sync/{skills,endpoint-store,session-store,openapi}.ts
client/                     浏览器半
  index.ts                  双 fiber + 快照 store + 5 个槽位注册 + controller（auth/capabilities/runtime/hooks）
  face.ts / remote.ts       DTO / 29 条 Typert 描述符 / locales.ts 中英字典（135 key，其中 18 个已无引用）
  NexusaiWorkbench.tsx      三选项卡工作台（详情页、本地开关菜单、SkillHub 列表详情、连接器卡片、＋添加技能菜单与上传弹窗）
  NexusaiSignInDialog.tsx   登录弹窗（品牌/服务器地址/校验/错误位置/失败重发）
  NexusaiLauncher.tsx       左下角入口（圆形头像 + 账号名 + 组织胶囊 + 菜单 + 登出确认框）
  NexusaiBrand.tsx          侧栏品牌两槽贡献（远程 mark/名字/版本；默认 NexusAI DSH + 节点图）
  NexusaiPanelIcon.tsx      侧栏图标（工具箱字形）
scripts/
  build.mjs                 esbuild 双产物
  check-dsh-version.mjs     版本基线检查（npm run check:dsh）
  verify/cdp-eval.mjs       CDP 驱动运行中的桌面端（读 DSH_CDP_PORT，按 dsh-app 选目标）
  verify/local-skills-paths.mjs  技能按路径安装的回归套件（16 例；esbuild 打包成 CJS + 临时技能根）
  verify/connector-authoring.mjs  自定义连接器回归套件（66 例；临时 $DSH_HOME，覆盖包解析/替换/JSON 形状/表单解析/SSE 存储/开关两路/超时与表头/无变化不重写/工具 schema DSL 一致性）
  dev/install-into-dsh.mjs  新机器接线（构建 + 软链 + patch 行，幂等）
  dev/brand-dev-app.mjs     dev 包改名 + 换访达/Dock 图标（取服务端品牌，幂等）
  dev/{center-window.mjs,start-desktop.sh,watch-window.sh}  窗口摆放（macOS 专属，需辅助功能权限）
upstream.json / upstream/   锁定的 dsh（submodule → 官方 GitHub，commit 639ed015 = 0.2.0-rc.2）
apps/nexusai-desktop/       **v1.0 carrier**：薄 Electron 壳 + 运行时准备 + electron-builder（未签名）
  src/main.cjs              壳：home → 预置 profile → spawn 内置 dsh（Electron-as-Node）→ 读 token URL → 开居中窗
  scripts/prepare-runtime.mjs  npm pack 插件 + pnpm 装 profile（含 supportedArchitectures 与 allowBuilds）
  scripts/smoke-runtime.mjs    无 GUI 冒烟：起内置运行时并等 `dsh web:` 行（CI 用）
  scripts/after-pack.cjs       把 build/profile 拷进包（见 §7 坑：extraResources 带不动 node_modules）
.github/workflows/build.yml  mac + win 两个 job，各自宿主原生构建，产物传 artifact
dist/windows-trial/         （旧）Windows 试用包：源码路线，已被 carrier 取代；含密钥的文件待处理
```

## 6. 红线（重复一遍，最常见的事故源）

1. **不改 dsh 源码**；配置只进 dev home 的 `cordis.patch.yml`（应用运行时会改写该文件，**手改前先停应用**）。
2. 宿主 `deepseek-account` 行**永远不禁用**（欢迎窗 RPC 硬依赖，禁用 = 启动 fatal）；禁客户端 `ui-settings-account` 是安全的（我们现在就禁着）。
3. 改 client/src/patch 后**必须重启桌面端**；**不要 Page.reload**（会搞挂宿主）。
4. 不加 Remote 描述符就别改宿主公开方法（宿主 `capabilities` 保持 18 方法 ↔ 18 描述符）。

## 7. 坑（按类别，全部踩过）

### A. 环境与工具链
1. **9222 常被 WorkBuddy 占用** → dsh 用 `DSH_DESKTOP_RENDERER_DEBUG_PORT=9223` 启动，验证脚本读 `DSH_CDP_PORT`。
2. **同时只跑一个实例**：残留实例占 19387 → 新实例报 `DesktopHostFatalError: 2 required plugins did not activate`。被强杀的实例会留下 `Singleton*` 锁文件导致秒退（删掉即可）。彻底重启姿势：`pkill -f "Harness Dev.app"` + kill `scripts/dev.ts --skip-build`，确认 `pgrep -f 'Harness Dev'` 为 0、19387/9223 无占用，再起。
3. **CDP 目标必须按 `dsh-app` 选**：`/json/list` 里有两个 page 目标 —— `devtools://…`（DevTools 前端，0 个按钮）和 `dsh-app://app/`（我们的界面）。探针若按 `index.html` 匹配（永远匹配不到）再回落到「第一个 page」，会**静默驱动 DevTools 前端**，得到「找不到启动器/菜单为空」这类假失败。照抄 `scripts/verify/cdp-eval.mjs` 的选法。
4. **测「被挡住/点不动」必须用真实鼠标事件**：`el.click()` 走不到命中测试，被遮挡的按钮照样"点得动"，会漏掉遮挡类 bug。用 `Input.dispatchMouseEvent`（mouseMoved → mousePressed → mouseReleased），配合 `document.elementsFromPoint(x,y)` 看该点实际落在谁身上。
5. **截图核对的可靠姿势**：`Page.captureScreenshot` 的 `clip` 按 CSS px 传但返回图按 `dpr × scale` 放大（本机 dpr=2），别按像素直接读；最稳是**整窗截图**（不传 clip）+ `sips -c <高> <宽> --cropOffset <top> <left>` 裁剪再放大看。**`--cropOffset 0 0` 等同没传**（sips 退化成居中裁剪，极易误判），要传 `1 1`。用 DOM 直接改样式做实验后记得还原（React 只 patch 变化的 key，手改值不会被自动清掉）。
6. **`DOM.setFileInputFiles` 在本机 Electron 上无效**（返回成功但 `input.files.length` 仍为 0，objectId/nodeId 两种传法都试过）：要测文件上传，就在页面里**自造 FileList** —— `new File([bytes], name)` → `DataTransfer` → `input.files = dt.files` → `input.dispatchEvent(new Event('change', { bubbles: true }))`。夹具字节从 node 侧 base64 注入（免起 HTTP 服务，也不受 CSP 影响）；想模拟「选文件夹」的 `webkitRelativePath`，用 `Object.defineProperty(file, 'webkitRelativePath', { value: 'dir/SKILL.md' })` 影子覆盖即可
7. 权限：截屏看屏幕需**屏幕录制**；外部脚本移动窗口需**辅助功能**（当前均已授权）。
8. **模拟拖拽要发全序列**：CDP `Input.dispatchDragEvent` 必须先 `dragEnter` → `dragOver` → 再 `drop`（`data: { items: [], files: [绝对路径], dragOperationsMask: 1 }`）；只发 `drop` 会被丢弃，表现为「拖了但没反应」。另：程序化构造的 `DataTransferItem` **没有** `webkitGetAsEntry()`，所以「拖入文件夹」这条分支只能靠真人从访达拖，自动化只能覆盖「拖入文件」。**CDP 注入的拖拽不带磁盘路径**（`pathFor` 返回空），所以「按路径安装」这条分支在自动化里走不到 —— 要验它得绕开 UI：用 esbuild 单独打包 `src/sync/local-skills.ts`（**打成 CJS**；`yaml` 是 CJS 包，打成 ESM 会死在 `Dynamic require of "process"`），这一步已固化成可重复回归 **`scripts/verify/local-skills-paths.mjs`**（16 例，自带打包到临时 CJS，不依赖桌面端）
9. 从后台任务启动的 GUI 应用会被一起收走 → 用 `nohup … & disown` 启动。
10. **CDP 造的 File 没有磁盘路径**：`__DSH_HOST_PATHS__.pathFor()` 对 CDP 注入/程序化构造的 File 返回空串，所以「按路径」的功能（技能导入、DXT/MCPB 选包）在自动化里点不到真实面板 —— 它们的**宿主逻辑**要用独立套件验（见验证手册），UI 侧只能验到"弹窗/入口/按钮状态"。
11. **空 patch 文件会被写成 flow 风格**：patch 不存在时读到的是 `'[]'`，`yaml` 库把整份文档按 flow 打印（`insert: [{…}]`），与真实 patch 的块风格不一致，也让按行匹配的断言失效 → 两个写入方加完行都设 `document.contents.flow = false`。

### B. dsh 平台行为
1. **`border-radius: 50%` 画不出圆形**：dsh 在根节点设 `corner-shape: superellipse(1.5)`，该属性**可继承**，所以 50% 圆角也被描成圆角方块（表现为左下角头像不是圆的）。要真圆就在元素上写 `corner-shape: round`（计算值归一为 `superellipse(1)`）；`cornerShape` 还不在 csstype 里，样式对象要放宽成 `React.CSSProperties & { cornerShape?: string }`。排查用 `getComputedStyle(el).cornerShape`。
2. **语言包无法被插件覆盖**：`ctx.locale.register` 对同 namespace+locale 重复注册直接抛错 → 改 Shell 文案只能用官方槽位（侧栏品牌即如此）或改 dsh 源码。
3. **esbuild 会重命名宿主 Remote 方法的参数**（与外层标识符冲突时）→ Typert 按编译后签名校验，报 `args fields do not match the descriptor`；改参数后 `grep "async <method>(" lib/index.js` 核对。
4. **主面板贴着左上角必须用框架的「让位」变量**（否则被窗口 chrome 压住）：框架（`ui-layout`，契约见 `packages/client/ui-layout/README.zh.md`）发布 `--dsh-frame-top-clearance`（macOS 恒 48px）与 `--dsh-frame-leading-clearance`（**只在侧边栏收起时发布**，macOS 160px = 红绿灯 + 悬浮控件 + 8px 余量；全屏 84px）。入口型页面都拿它们做内边距：
   ```css
   .nexusai-wb { padding: calc(24px + var(--dsh-frame-top-clearance, 0px)) 24px 24px;
     padding-inline-start: max(24px, var(--dsh-frame-leading-clearance, 0px)); }
   ```
5. **dsh 工具参数是受限 DSL，不是完整 JSON Schema**（`packages/core/tools/src/schema.ts`）：每个节点只允许自己的词汇表 —— object：`type`/`properties`/`additionalProperties`；array：`type`/`items`；标量：`type`/`enum`/`const`；另有 `oneOf` 与注解 `description`/`title`/`default`/`examples`。**`required` 只允许出现在属性层**（数组 `items`、`oneOf` 分支里一律拒绝），且任何节点**不能带值为 undefined 的键**（报 `… annotation must be lossless JSON`）。我们的 `toValueSpec` 曾两处违规（嵌套对象照抄 `required`、嵌套节点写 `description: undefined`）—— 表现为真实第三方 MCP（用户自己的 modelscope 连接器，17 个工具）桥接时报错、工具一个都注册不上。现已在转换器出口统一处理：嵌套 required 改为写进描述的「必填字段：…」，undefined 键递归剪掉
6. **dev 包的 Dock 图标改不动**：Electron 未打包模式用自带图标；`CFBundleIconFile` 只影响访达（名称 plist 与访达图标可改），打包版不受限；dsh 重建 dev 包后需重跑 `brand-dev-app.mjs`。
7. **dsh 不能按进度重置超时**：mcp-client 里没有任何 `progress`/`_meta.progressToken` 处理（已核对源码），`toolCallTimeoutMs` 是**一次性**预算，进度通知不会延长它。因此没有「长时间运行」开关（2026-10-10 已整体移除）—— 需要长任务就把「超时」直接填大。想真正"收到进度就续命"必须改 dsh 源码（红线不允许）
8. **dsh 的 mcp-client 行能写什么**（写连接器/自定义 MCP 必看，源码 `packages/mcp/mcp-client/src/index.ts`）：只有两种传输 —— `stdio`（`command` 必填、`args[]`、`env{}`、`cwd`、`toolCallTimeoutMs`、`failOnStartupError`）与 `streamable-http`（`url` 必填、`headers{}`）；`serverName` 限 `[A-Za-z0-9_-]{1,32}` 且**必须在活实例间唯一**（legacy SSE **没有**这个传输 —— NexusAI 的 SSE 服务器与**用户自定义的 SSE 连接器**都靠本插件桥接成 dsh 工具；区别是前者来自目录、后者存在 `<dshHome>/mcp-sse-connectors.json` 并在每次 sync 时并入桥的输入）（工具名 `mcp__<serverName>__<tool>`）；行本身只有 `id`/`name`/`config`（**没有显示名字段**，所以我们的自定义连接器把显示名放进 id：`custom-mcp-<名字>`，面板读 id 后缀当标签）。`env` 是**叠加在净化过的环境上**，且 dsh **不走 shell** 启动子进程 → 命令要用绝对路径（PATH 里的 `npx`/`node` 可能找不到）；我们的 DXT/MCPB 安装对 `node` 包自动换成 `process.execPath` + `ELECTRON_RUN_AS_NODE=1`（用本应用自带的运行时，不依赖系统 node）
9. **技能名与前置信息是硬约束**（写上传/导入类功能必看）：`packages/skill/skill-filesystem` 只认 `<root>/<目录>/SKILL.md`（或根下裸 `.md`），且要求 YAML 前置信息含 **name + description**，name 还要满足 `packages/skill/skill` 的 `^[a-z0-9]+(?:-[a-z0-9]+)*$`（**kebab-case ASCII**）。任何一条不满足 → **只写一条 logger 警告、技能被忽略**（界面完全不显示，磁盘上却躺着文件）。所以上传功能必须拦：中文名「测试上传技能A」就是被这条静默丢弃的。**还有一条更隐蔽**：dsh 用 YAML 解析后要求 name/description 是 **string** —— `name: 12306`（未加引号）会被解析成**数字**，同样被静默忽略（这台机器的 skills/ 里现在就躺着这样一个技能 `12306`，改成 `name: "12306"` 即可恢复）。本插件现已按 YAML 类型 + kebab-case 双重校验，并在错误里直接提示加引号
10. **profile 名不是常量**（写任何"按 profile 定位文件"的代码必看）：dev 检出跑 `profiles/desktop`，而本项目的打包版内置 profile 叫 `nexusai`（`dsh --profile nexusai`）。**任何默认成 `desktop` 的路径都会在打包版里静默写错文件** —— 表现为连接器卡片在、工具永不挂载，dev 环境完全正常（因为恰好就是 `desktop`）。本插件已改为"找承载自己那一行的 profile"（`src/sync/patch-file.ts`，显式 `profilePatchFile` 仍优先），并在启动日志打印解析结果；套件有 3 例覆盖（真实打包 home 与 dev home 各验一次）

11. **home 比安装活得久，运行时链接会失效**（现场报过 `bundled dsh CLI is missing`）：用户目录里的 `profiles/nexusai/node_modules` 是指向**安装目录内**那份 profile 的链接（Windows 上是 junction）。应用被卸载、移动或换目录重装后，这个链接就指向别处/指向不存在的路径；而 **Windows 的 junction 即使目标没了也仍然占着这个名字**（`existsSync` 会沿链接解析 → 返回 false，于是"以为没人占"，真去创建又 EEXIST）。做法：标记里带上**应用版本**（升级/搬迁必然重链）、占用与否用 **`lstat`** 判断（能看到失效链接）、并在启动前**校验 CLI 是否存在**，缺了就重建链接一次；只有"不是本应用创建的目录"才拒绝（用户自己的运行时，绝不删）。CI 的 Windows 验收闸现在**第二个场景**就专门造一个"junction 指向别处 + 旧标记"的 home，断言它自愈启动（`scripts/ci/install-and-launch-check.ps1`）

12. **品牌是模块级缓存，换服务器地址后不会自己更新**（用户问过"左上角是不是改坏了"）：`client/NexusaiBrand.tsx` 把品牌放在模块级 `cached` 里（当初为省一次往返），`useBranding` 见到缓存就早退；而登录弹窗的「应用」只刷新**弹窗自己**那份（`NexusaiSignInDialog` 里的 `refreshBranding`）。于是换地址后：弹窗是新服务器的品牌、**侧栏还是旧服务器的**。修法：导出 `invalidateBranding()`（清缓存并通知所有已挂载的读取方重取），在 `applyServer` 里 `setBaseUrl` 之后调用 —— 侧栏与首启 hero 一并跟随。这**不是**某一轮改坏的：缓存一直都在，只是品牌槽修好（`priority: -1`）之后我们自己的品牌才真正显示出来，这个"不跟随"才变得可见

13. **打包版的窗口可能"创建了但从不显示"**（自查时撞到）：原来靠 `loadURL(url).then(() => window.show())` —— 页面加载的 promise 在某些情况下**永不 settle**（本次实测：日志有 `window: center …`、无任何报错、System Events 报 0 个窗口、页面 `visibilityState` 为 hidden），于是应用看起来"启动即死"。改为事件驱动：`did-finish-load` → `show()`，并加 `did-fail-load` 与 `.catch` 两条路径**无论如何都显示窗口**（失败也可见）+ 打一行 `window shown` 到日志。修完 System Events 能读到 1 个窗口且标题正确。注意：`document.visibilityState` 在窗口被其他窗口完全遮挡时也会是 `hidden`，**它不能当作"窗口没显示"的判据**，要看 System Events 的窗口数

14. **别覆盖 `DSH_AGENTS_HOME`（会屏蔽全机器技能库）**：dsh 的技能发现里，`dsh-skill-filesystem` 用 `config.agentsHome ?? process.env.DSH_AGENTS_HOME ?? ~/.agents` 定位**机器级技能根** —— 这是本机所有 agent 工具共享的目录（本机 `~/.agents/skills` 有 32 个技能）。壳里当初照抄参考实现写了 `DSH_AGENTS_HOME: join(home, 'agents')`，等于把它指到一个空目录：**对话里敲 `/` 什么都不列、技能页"本地"为 0**（现场反馈"以前能看到 dsh 自带的 skills，现在没有了"）。修法：**不要设这个变量**，让 dsh 用默认的 `~/.agents`。验证：去掉后打包版"本地 (31)"、`/` 菜单从"无"变回 40 项（命令 + 技能）。

15. **GUI 启动的应用 PATH 只有四个目录，必须补登录 shell 的 PATH**：从访达/Dock 启动时 macOS 只给 `/usr/bin:/bin:/usr/sbin:/sbin`，于是用户装的 `node`/`python3`/`git`/`ripgrep`/brew 工具对 agent 的 shell **全部不可见**。dsh 自己的桌面端用 `apps/desktop/src/login-shell-environment.ts` 读账号登录 shell 的环境来解决；我们的壳现在也做（`enrichedPath()`：依次试 `$SHELL`、`/bin/zsh`、`/bin/bash`、`/bin/sh`，`-ilc 'printf %s "$PATH"'`，5s 超时，取第一个成功的并把继承的 PATH 接在后面去重；Windows 不需要——GUI 进程从注册表继承用户 PATH）。**本机因为 GUI 会话 PATH 恰好很全而看不出问题**，属潜在坑；验证方式：用 `env PATH=/usr/bin:/bin:/usr/sbin:/sbin` 启动，检查子进程 PATH 里 node/python3/git/rg 均可解析。

### C. 数据与接口
1. **React 列表 key 必须唯一**：上游「天然主键」不可想当然（SkillHub 的 `publicSlug` 一页内重复，曾表现为「筛选失效」）→ 统一用 `namespace.canonicalName` 作身份。
2. **外部接口空值**不能只判 undefined/''：JSON `null` 与字面量 `"null"` 都出现过（曾导致图标裂图）。
3. **yaml 库解析结果是节点类型**（`YAMLSeq`/`YAMLMap`）：判断集合要 `isSeq/isMap`，`Array.isArray` 永远 false（曾导致 patch 里 231 行重复累积）。
4. **技能注册表对文件变更响应不一致**：改名（`SKILL.md` ↔ `.disabled`）会刷新目录，**整目录删除不会** → 列表另用 `missingLocalSkills(paths)` 按磁盘核对。
5. **SSE 帧可能是 CRLF**，且 Node 的 `fetch` 默认无超时（一个不可达的服务器会挂住整个 sync）→ 归一 + `AbortSignal.timeout`。

### D. 流程纪律
1. **脚本化改代码必须断言**：曾因为锚点写错又没断言，替换静默失败（渲染仍是旧的 `skills.map`）。改完 `assert '<新片段>' in s` 复核。
2. **凭据磁盘/进程内状态一致**（已用插桩定案）：干净运行下会话**不会自己消失**。历史上几次"磁盘没 session"都是测试自己造的：把 endpoint 换成另一台服务器（或恢复了不匹配的备份）→ 下次调用 401 → 插件按设计清会话并登出。恢复 = `cp` 回**同服务器**且含 session 的备份 + **重启**；备份前先 `grep -c 'nexusai/session'` 确认，并比对 `baseUrl:` 一致。
3. **环境：dsh 基线 0.2.0-rc.2（developer preview）**：升级 dsh 后要跑 `npm run check:dsh` + tsc + CDP 回归，再更新 `dshBaseline`。

## 8. 改动后的标准流程

```bash
# 1) 改代码（client/*.tsx|ts、src/**）
# 2) 静态检查 + 构建
npx tsc --noEmit && node scripts/build.mjs && npm run check:dsh
# 3) 重启桌面端（client 改动必须重启，禁止 Page.reload）
pkill -f "Harness Dev.app"; sleep 1; kill $(pgrep -f "scripts/dev.ts --skip-build") 2>/dev/null; sleep 4
cd ~/IdeaProjects/deepseek-harness && DSH_DESKTOP_RENDERER_DEBUG_PORT=9223 nohup pnpm run start:desktop > /tmp/dsh-9223.log 2>&1 & disown
sleep 60   # 等 "dsh web: http://127.0.0.1:19387/?token=..."
# 4) 真机验证（CDP：数值 + 命中测试；必要时整窗截图裁剪核对）
cd ~/GoLandProjects/nexusai-harness && DSH_CDP_PORT=9223 node scripts/verify/cdp-eval.mjs "<js表达式>"
# 4b) 技能「按路径安装」的回归：不需要桌面端，自带打包 + 临时目录，16 例
node scripts/verify/local-skills-paths.mjs
# 4c) 自定义连接器录入 / 开关 / 工具 schema 一致性的回归（不需要桌面端；用临时 $DSH_HOME）
node scripts/verify/connector-authoring.mjs
# 5) 更新本文件（改了哪些文件、验证到了什么、卡在哪、下一步）
```

驱动页面的常用套路（写在临时 `*.mjs` 里，照抄 `scripts/verify/cdp-eval.mjs` 的连接骨架）：
- 选目标：`list.find(t => t.type === 'page' && t.url.includes('dsh-app'))`
- 求值：`Runtime.evaluate` 必须带 `returnByValue: true, awaitPromise: true`（异步 IIFE 否则返回 `{}`）
- 取结果：响应形状是 `{ result: { result: { value }, exceptionDetails? } }`，写错层级会拿到 `undefined`
- 真点击：`Input.dispatchMouseEvent`

其他脚本：
```bash
node scripts/dev/install-into-dsh.mjs          # 新机器接线（构建 + 软链 + patch 行，幂等）
node scripts/dev/brand-dev-app.mjs             # 改 dev 包应用名 + 访达图标（可选 --name X --icon p.png --bg 111113）
./scripts/dev/start-desktop.sh                 # 或 ./scripts/dev/watch-window.sh center  # 窗口摆放（macOS）
```

## 8b. 发行版（carrier）怎么出包与发版

载体在 `apps/nexusai-desktop`（详见其 README）。本机一次完整出包：

```bash
cd apps/nexusai-desktop
corepack pnpm install                    # 首次（国内加 ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/）
cp .env.example .env                     # NEXUSAI_BASE_URL / AES_KEY / AES_IV（.env 已被 gitignore）
node scripts/prepare-runtime.mjs         # → build/profile（dsh 按 upstream.json 版本 + 本插件 tgz）
node scripts/smoke-runtime.mjs           # 无 GUI：起运行时并等 web URL（改壳后必跑）
corepack pnpm exec electron-builder --config electron-builder.config.cjs --mac --arm64
#   ↑ 这条常被网络卡住，加 ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
node scripts/check-client-mounted.mjs 9224 3000  # 可选：对带 --remote-debugging-port 的实例查 client 半是否挂载（看 data-nexusai 标记）
```

**发版**：改 `apps/nexusai-desktop/package.json` 的 version → 提交 → `git tag -a vX.Y.Z` → `git push github v1.0 vX.Y.Z`。CI 两个平台构建，release job 自动把 dmg/exe 挂到 Release（仓库私有 → 下载需登录）。

**CI 需要的 secret**：`NEXUSAI_BASE_URL` / `NEXUSAI_AES_KEY` / `NEXUSAI_AES_IV`（仓库 Settings → Secrets；值与本机 `.env` 相同）。

**两个只在打包版才暴露的坑**（本机 dev 掩盖，CI/发行必踩）：profile 名不是 `desktop`（见 §7-坑 B10）；`prepare-runtime` 不能读 `upstream/`（CI 不检出 submodule）。

## 8c. 构建走 GitHub（默认也是唯一轨道）；CI 步骤的唯一真源在 `scripts/ci/`

**决策（2026-10-13）**：构建默认走 GitHub。原因是核实过云效之后它并不合适 —— 见下方"为什么不迁云效"。

**触发**（`git push github v1.0` 即自动跑；`git push origin` 只同步代码，不会构建）：

| 你做什么 | 结果 |
|---|---|
| `git push github v1.0`（日常） | 两个平台各跑「构建 + 验收闸」，产出 artifacts |
| `git push github vX.Y.Z`（打 tag） | 同上，并由 release job 发布 GitHub Release |
| Actions 页 **Run workflow** | 手动重跑（排查用） |

**唯一真源在 `scripts/ci/`**，工作流只做「拉代码 → 调脚本 → 传产物」，因此换轨道不用改构建：

| 脚本 | 干什么 |
|---|---|
| `build-app.sh`（macOS） / `build-app.ps1`（Windows） | toolchain → 根 `npm ci` → 载体 `pnpm install` → `prepare:runtime` → `smoke:runtime` → `electron-builder`。**镜像默认值写在脚本里**（npm registry / COREPACK_NPM_REGISTRY / ELECTRON_MIRROR / ELECTRON_BUILDER_BINARIES_MIRROR），可用环境覆盖 |
| `check-mac-app.sh` | 挂 DMG → 拷出 app → 干净 home 启动 → 断言运行时就绪 + profile 落位且含插件行。**验证不了 Gatekeeper**（CI 产物无 quarantine，人工「仍要打开」仍需一次） |
| `install-and-launch-check.ps1` | 静默安装 → 断言落位 → 启动 → 断言 `runtime ready` → CDP 断言登录框（证明宿主 + client + 插件全挂上）→ 静默卸载。**验证不了 SmartScreen**，也不做真实账号登录（验证码） |

首跑实测：macOS 6m40s、Windows 16m20s，Windows 侧打印完整证据链（installer exit 0 → 落位 → 运行时 ready → profile 含插件行 → `{"dialogs":1}` → 卸载干净）。

**为什么不迁云效**（2026-10-13 抓官方文档核实，别重复调研）：
1. **云效托管（公共）构建机只有 Linux**（对比表：公共=Linux、VPC托管=Linux、私有=Linux/Windows/macOS；默认环境 Linux/amd64、容器环境 Linux/amd64·arm64）。Windows 走私有集群（手动 Runner **或阿里云 ECS**），macOS 走私有集群且**仅手动 Runner**（macOS 不在 ECS 上）→ 迁过去要自备 Windows 机器/ECS **加**一台常开的 Mac，构建时都必须在线。GitHub 这两样都是免费托管的。
2. **Codeup 发行版装不下安装包**：单个附件 **<50MB**（≤10 个、单库 <1GB），我们产物 213–228MB → 只能用制品仓库或 OSS 托管，发行版页只放说明。
3. 结论：除非将来有"构建必须在内网平台"的合规要求，否则不迁。**真要迁**时照这套做法即可：新建流水线（代码源不要勾递归子模块）→ Windows/ macOS 各接一台私有构建节点 → 跑 `scripts/ci/*` 同两个脚本 → 变量组加三个 `NEXUSAI_*` → 产物传制品仓库。构建脚本无需改动。

**若日后做"产物也留公司平台"**：最省事的是在 GitHub 这边加一步把 `dist/*.dmg|exe` 推到云效制品仓库（约 0.5 天），而不是把构建搬过去。

## 8e. 打包版的界面语言（为什么默认英文、怎么改成中文）

**机制**：dsh 用页面里的 `navigator.languages` 去匹配它自己的字典 id（**只有 `en` 与 `zh`**，见 `dsh-client-locale/lib/types/locales/`），匹配不到就回退 `"en"`（源码：`resolveInitialLocale(locales, languages) ?? "en"`，`FALLBACK_LOCALE = "en"`）。那个语言列表**只有外壳交给它时才反映系统** —— dsh 自己的桌面壳会传，我们只开窗口加载它的网页。

**为什么打包版是英文而 dev 是中文**（实测对照）：

| 运行方式 | `navigator.languages` | 界面 |
|---|---|---|
| 开发模式（`electron .`，语言跟随系统） | `["zh-CN","zh-Hans-CN"]` | 中文 |
| **打包版** | `["en-US","zh-Hans-CN"]` | **英文** ← 因为 `.app` 只声明英文 localization，macOS 把 en 排第一 |

**修法**：预置 patch 里钉一行语言偏好（与 `ui-theme` 的 `preference: system` 同一"已存设置"机制）：

```yaml
- id: locale
  name: '@deepseek-ai/dsh-client-locale'
  config:
    preference: 'zh'
```

界面里**没有**语言选择项，所以这一行就是默认语言的唯一来源。验证：打包版 `document.documentElement.lang === 'zh-CN'`、界面中文、无英文残留（`navigator.languages` 仍是 `["en-US","zh-Hans-CN"]`，根因可见）。

**若以后要"跟随系统语言"**（英文系统给英文）：不是删这行，而是给 `.app` 声明中文 localization（`mac.extendInfo.CFBundleLocalizations: ['zh-Hans','en']` + afterPack 里放一个空的 `zh-Hans.lproj`），让 macOS 按系统偏好排序，再删掉这行偏好。

## 8e-2. 动态展示项盘点（名称 / logo / 版本）与"换服务器"验收清单

所有随服务器变化的展示都来自**同一个**品牌载荷（`GET /v1/base/custom`），且现在**只有一个缓存**（`client/NexusaiBrand.tsx` 的模块级 `cached`，由 `invalidateBranding()` 清空并在 `setBaseUrl` 后触发重取）：

| 展示项 | 取值 | 取不到时（首开/服务器不可达） |
|---|---|---|
| 侧栏名称 | `branding.name`（服务端 `tab.title`） | 回落 `NexusAI DSH` |
| 侧栏字标 | `branding.markUrl`（方形 logo） | 回落插件自带 SVG 字标（不会裂图） |
| 侧栏版本徽章 | `branding.version` → 回落 `branding.dshVersion` | 显示 dsh 构建串（如 `0.2.0-rc.2`），宿主持有该值 |
| 首启 hero 版本徽章 | 同上（同一 hook） | 同上 |
| 工作台「远程获取 · 名称」 | `branding.name` | 只显示「远程获取」，不带名称 |
| 登录弹窗标题/欢迎语/logo/按钮色/版本 | 弹窗**自己**那份（要显示"待应用地址"的品牌） | 标题用不含名称的默认文案；logo/welcome/版本为空则整段不渲染 |
| 应用图标 / 窗口图标 / About 里的版本 | **本地资产**（`resources/icon*`、`runtime-version.txt`） | 与服务器无关，不涉及动态获取 |

**变更检测（换服务器地址后应逐项变）**：侧栏名称 + 字标、工作台「远程获取」标签、hero 徽章（版本号是否变取决于两台服务器的 `about.version` 是否不同 —— 曾遇到两台都报 `v1.5.0.3`，属正常）。**首启不可达**时应看到：默认名 `NexusAI DSH` + dsh 构建号 + 插件自带 SVG 字标，且**无裂图、无 `undefined`**（已实测）。

## 8f. 应用图标与首启画面（品牌素材落地）

**图标链路**（单一真源，全部脚本化）：

```
品牌字标（透明 PNG）──scripts/compose-icon.py──▶ resources/icon.png (1024，深色圆角底)
resources/icon.png ──scripts/make-icons.mjs──▶ icon.icns / icon.ico
```

- 素材来源：`~/Desktop/favicon/favicon_256.ico`（导出为 `resources/icon-source.png`）。它是**透明底字标**（非图标）：macOS 应用图标需要实心圆角方形，所以 `compose-icon.py` 把字标放在产品自己的深色底（#111113）上、按约 60% 内容占比居中 —— **若以后想换底色/占比，只改这个脚本重跑**。
- **已知限制**：源图只有 256px，1024 图标是放大的（~4x）：Dock/任务栏尺寸清晰，Finder 预览偏软。要更好只需提供 1024 PNG 或矢量图，替换 `resources/icon-source.png` 后重跑两行命令。
- 首启 hero 的字标用的是 128px 版本（`client/assets/icon-mark-128.png`，由 build.mjs 以 data URL 内联进 client bundle），所以插件保持"一个 JS 文件"即可分发。

**首启 hero 的三处改动**（`client/NexusaiHero.tsx`）：

| 元素 | 做法 | 依据 |
|---|---|---|
| 字标 | 贡献官方槽位 `conversation.hero.brand.mark`（dsh 的鱼是它的 fallback） | 该处代码是 `renderSlot(..., { fallback: <HeroFish/> })`，属支持的扩展点 |
| 标题 → `探索 AGI 之无限可能` | **DOM 改写**（在槽位挂载期间生效，用 MutationObserver 幂等重写） | 该文案是 `hero.headline` 字典项，**插件无法覆盖**（同 namespace+locale 再注册会 throw），且没有槽位 |
| 徽章 `预览版` → 版本号 | 同上改写 | 同上（`hero.preview`）；取值规则与左上角一致：平台版本（`branding.version`）优先，回落 dsh 构建号（`branding.dshVersion`，宿主本地补，连不上也有值） |

选择器用 **CSS module 的局部名后缀**匹配（`[class*="_titleGroup"]:has(> [class*="_previewBadge"]) > span:first-child`、`[class*="_previewBadge"]`）：哈希每次构建会变，局部名稳定；且只在"包含 previewBadge 的 titleGroup"上动手，避免误伤别处同名类。dsh 若哪天改掉这些局部名，补丁会静默失效（退回 dsh 原文案），不会把界面改坏。

**实测（打包版）**：远程可达 → 标题 `探索 AGI 之无限可能`、徽章 `v1.5.0.3`、字标为我们的 IMG；远程不可达 → 徽章 `0.2.0-rc.2`（dsh 构建号），标题与字标不变。

## 8d. 产物精简（内置 profile 的体积构成与已做的剪裁）

`prepare-runtime.mjs` 在装完 profile 后跑 `pruneProfile(target)`，只删**这个目标平台永远加载不到**的东西，三类都有依据：

| 删什么 | mac-arm64 可省 | 依据 |
|---|---|---|
| 源码映射 `*.map` | 49 MB | 发布产物不解析它，只影响栈回溯可读性 |
| 其它平台的 `prebuilds/*`（node-pty 等） | 26 MB | 加载器按运行时平台取一份，别的平台永远不会被读；只删形如 `darwin-*`/`linux-*`/`win32-*` 的目录，命名怪的一律保留 |
| ~~本 profile 不挂载的功能包（语音/STT 链 46 MB）~~ | — | **已按用户要求保留**（2026-10-13）：语音输入要开箱可用，所以 `UNMOUNTED_FEATURE_PACKAGES` 现在是**空的**，别照着旧记录再删一次 |

**实测（当前状态：只做前两项）**：profile 493 MB → **421 MB**（保留语音后），DMG 228 MB → **217 MB**。语音链 33 MB 原始体积只让安装包 +9 MB（原生库本就不太压得动）。

**刻意没删**（各有硬理由，别手滑）：
- `@opentelemetry/*`（17 MB）：`otel` 行是**挂着**的（经 `dsh-base` 进来），删了起不来；
- `@img/sharp*`（18 MB）：`dsh-base` → `dsh-attachment-local`，附件功能要用；
- `openai` / `@anthropic-ai/sdk` / `@google/genai`：用户自配置模型时对应的 provider SDK。

**体积大头（都按用户决定保留）**：
- **办公** `libreoffice-kit-darwin-arm64` **148 MB** + 文档预览 UI 15 MB —— 与 `office-to-pdf`（挂载中的行）和办公技能绑定，**保留**；若哪天要瘦，做法是预置 patch 里 `disabled: true` 那两行 + 把包加进 `UNMOUNTED_FEATURE_PACKAGES`（约再降 67 MB 安装包，实测压缩后 163 MB→67 MB）。
- **语音** 33 MB（sherpa-onnx）+ 实验性语音包 —— **保留**（用户要求开箱可用）。
- 17 MB 遥测（otel 行挂着，删了起不来）、18 MB sharp（附件功能）、开放模型 SDK（openai/anthropic/google）—— 都保留。

## 8g. 首启体验：预置 patch 里到底设了什么

生成的 `cordis.patch.yml` 共 5 段，每段对应一件产品决定（改这些都在 `prepare-runtime.mjs` 的 `profilePatch()`）：

| 行 | 设置 | 为什么 |
|---|---|---|
| `ui-settings-account` | `disabled: true` | 隐藏 dsh 内置的 DeepSeek 账号 UI（NexusAI 登录替代它）；**宿主 `deepseek-account` 行不能禁**（见 §7 坑 B2） |
| `ui-settings-general` | `welcomeNoticeVersion: <当前>` | 代用户确认 dsh 的「预览版说明」，首启不弹（版本从装好的 client bundle 读出，不硬编码） |
| `locale` | `preference: 'zh'` | 界面默认中文。dsh 只有 `en`/`zh` 两个 id 且取不到就回退 `en`；打包版因只声明英文 localization 会被判成 `en`（详见 §8e） |
| `ui-settings-models` | `credentialOnboarding: false` | **关掉 dsh 首启的「添加一个 API Key 开始使用」引导**（该行的配置项，宿主会发布成页面全局 `__DSH_MODELS_ONBOARDING__`）。用户自己在「设置 → 模型」配模型 —— 与"模型由用户自配"的产品口径一致 |
| `insert: nexusai` | 本插件行 | baseUrl + AES key/iv |

**首启实测（干净 home）**：无预览说明、无 API Key 引导、无登录框（登录完全手动）、侧栏显示远程品牌与版本、hero 显示品牌字标 + 「探索 AGI 之无限可能」+ 版本徽章。

## 8h. 产物命名约定

安装包文件名**不含空格**（`artifactName`，见 `electron-builder.config.cjs`）：

| 层面 | 值 | 来源 |
|---|---|---|
| 安装包文件名 | `NexusAIHarness-<version>-arm64.dmg` / `NexusAIHarness-Setup-<version>-x64.exe` | electron-builder `artifactName` |
| **应用名**（菜单栏首项 / Dock / 访达 / 窗口标题 / Windows 安装目录与 exe 名） | **`NexusAIHarness`** | `productName`（构建期）+ 壳里的 `APP_NAME`（窗口标题，可用 `NEXUSAI_APP_NAME` 覆盖） |
| 应用内品牌（侧栏名称/字标/版本） | 登录服务器的品牌 | 远程 `GET /v1/base/custom`（见 §8e-2） |

⚠️ **改名会移动 home**：dsh home 在 `app.getPath('userData')` 下，而 userData 由应用名派生。壳里加了 `adoptLegacyHome()`：新 home 不存在而旧名（`NexusAgent Builder`）的那份存在时，把它**移动**过来（同卷 rename），使升级对用户无感；移动失败则保持原地不动（宁可"看起来全新"，也不冒丢数据的风险）。

命名用品牌写法 `NexusAIHarness`（用户选定，与侧栏品牌同一拼写），不是带空格的产品显示名 —— 应用在 Finder / Dock / 开始菜单里仍叫 `NexusAgent Builder`（`productName`），两者独立。同时**不含空格**：GitHub Release 会把资源名里的空格换成点，带空格的旧命名在下载页显示成 `NexusAgent.Builder-…`，与本地不一致、容易让人以为下错了。

## 9. 换机器 / 新环境部署

- **带源码（开发用）**：克隆 dsh（`git checkout dsh-v0.2.0-rc.2`）→ `pnpm install` → 跑一次 `start:desktop` 生成 `.desktop-build` → 克隆本插件 → `node scripts/dev/install-into-dsh.mjs` → 启动 → 登录
- **不带源码（体验用）**：本机 `pnpm run package:desktop:mac:arm64` 出 dsh 安装包 + `npm pack` 出插件 tgz → 新机器装应用 → 侧栏「插件」页安装（支持 registry / 本地路径 / tgz / git 四种来源）→ 在 profile user 层 patch 补 `nexusai` 行 → 登录
- ⚠️ **Windows 包只能在 Windows 构建机/CI 上打**（dsh 打包脚本硬性要求，预检还需 VS C++ 工具链；GitHub release 没有官方安装包）
- Windows 试用包见 `dist/windows-trial/`（一键 ps1 + 离线插件包 + 说明；**未实测**）

## 10. 自定义应用名 / 图标

| 层面 | 来源 | 可否自定义 |
|---|---|---|
| Dock / 菜单栏 / 访达的**应用名** | dev 包 plist 硬编码 `Harness Dev` | ✅ `scripts/dev/brand-dev-app.mjs` |
| **访达里的图标** | dev 包继承 Electron 图标 | ✅ 同上（服务端 logo → sips 补方 → iconutil → icns → 重签名） |
| **Dock 图标（dev）** | Electron 未打包模式自带 | ❌ 需 `app.dock.setIcon()`（改 dsh）；打包版正常 |
| 应用内品牌（侧栏左上角） | 官方槽位 `sidebar.brand.mark/name` | ✅ 已做 |
| 打包版 `productName` / 图标 | dsh 源码硬编码 | ❌ 需产品化（自有壳）或改 dsh |

## 11. 待办

| 优先级 | 任务 | 状态 |
|---|---|---|
| **高** | **推 GitHub 前先处理密钥**：`dist/windows-trial/nexusai.patch.yml` 被 git 跟踪且含 AES key/iv。公开仓库 = 密钥进公网（不可撤回）。建议 `git rm --cached` 该文件 + 改 server 端密钥（历史里仍有旧值）；运行时配置本就改成从 env/`.env` 生成（carrier 已如此） | 🔴 等决策 |
| 高 | 跑 CI 的 `windows` job 验证 NSIS 产物（本机无法产出）；需先在仓库配 3 个 secret（`NEXUSAI_BASE_URL`/`NEXUSAI_AES_KEY`/`NEXUSAI_AES_IV`） | ⬜ |
| 中 | carrier 品牌/图标（现为 Electron 默认图标与 `NexusAgent Builder` 名）；首启交互打磨 | ⬜ |
| 中 | carrier 产物精简：内置 profile 现 ~490MB（含 python 工具链与未用的官方 bundle），可裁剪 | ⬜ |
| 暂缓 | SSE 桥接的凭据跟进（智能问数需 token：服务端 `mcp_start` 换取 / 插件配置默认 token） | ⏸ 用户暂缓 |
| 暂缓 | agent 实调 NexusAI 自定义工具（MCP 侧已验过整条链路） | ⏸ 用户暂缓 |
| 杂 | 「删除技能」是否改移入废纸篓；`package.json` 的 `types` 指向不存在的 d.ts | ⏸ 用户暂缓 |
| 可选 | 强登录门槛：`shell.overlay` 全屏拦截层（未实施） | ⬜ |

## 12. 清洁项 / 事故记录

- 测试用临时技能（zz-scratch-skill / mm-scratch-skill / aa-delete-target / zz-bystander / zz-tag-check）已删；误删的 `indiv-ebandao-dev-expert` 已重装
- 代码内无 `TEMP-DEBUG` 残留；profile patch 里 mcp 行已收敛为 1 个 insert
- 删除了一条**孤儿 Remote 描述符** `listLocalSkills`（无宿主方法、无客户端调用者）；上传功能验证用的测试技能（upload-folder-test / upload-zip-test / upload-md-test）已全部清理
- **语言包有 16 个已无引用的 key**（`nav`/`tabExpertsDesc`/`tabSkillsDesc`/`tabConnectorsDesc`/`skillhubHint`/`search`/`featuredSkills`/`searchResults`/`shuffle`/`pathCopied`/`captchaPlaceholder`/`loggedInAs`/`expires`/`org`/`tools`/`mcpServers`/`notLoggedIn` 中除已删者外），是历次删 UI 的残留；已确认无动态拼 key，可安全删。随「文字旗标→状态点」一起删掉的 6 个（`mcpSseOnly`/`mcpSseHint`/`mcpSseBridged`/`mcpSseBridgedHint`/`mcpSseTools`/`connectorParamType`）已清理
- **可用凭据备份**：`/tmp/creds-presignout-1009-1616.yaml`（含 session，**已验证能完整还原登录态** —— `logout()` 只清本地不调服务端，旧 session 服务端仍有效）。恢复手法见坑 D2。注意 `/tmp` 重启机器会清
- 事故：曾误报「MCP 行没写入」（插桩证明写入了）；曾因锚点错+无断言静默改无效；曾把组织切换探针打到 DevTools 前端得出假失败 —— 三条都已进坑表

## 13. 近期变更（倒序，压缩）

| 日期 | 变更 | 验证 |
|---|---|---|
| 10-14 | **补登录 shell 的 PATH**（承接"还有没有别的丢失"的自查）：GUI 启动的进程只有 `/usr/bin:/bin:/usr/sbin:/sbin`，dsh 的桌面端会读登录 shell 环境，我们没做 → 用户装的 node/python3/git/ripgrep 对 agent 不可见。新增 `enrichedPath()`（多候选 shell + 5s 超时 + 去重合并，Windows 跳过） | 以 `env PATH=/usr/bin:/bin:/usr/sbin:/sbin` 启动：日志出现 `PATH from /bin/zsh: …`，子进程 PATH 里 node/python3/git/rg **全部可解析**（修复前只有系统四个目录） |
| 10-13 | **修「对话里敲 `/` 没有技能了」**（现场反馈）：根因是壳覆盖了 `DSH_AGENTS_HOME`，把它指向自建空目录，于是 dsh 的机器级技能根（默认 `~/.agents`）被屏蔽 → 技能目录/斜杠菜单全空。改为不设该变量 | 修复前：本地 0、`/` 无菜单；修复后（源码与重新打包的打包版各测一次）：**本地 (31)**（= `~/.agents/skills` 的合法条目）、`/` 菜单 40 项（命令 + 技能）；列表内容与 `~/.agents/skills` 一致（`academic-paper-writer-pro`、`architecting-solutions`…） |
| 10-13 | **应用名改为 `NexusAIHarness`**（用户指出菜单栏与窗口标题仍是旧名）：`productName` + 壳的 `APP_NAME` 同步；新增 `adoptLegacyHome()` —— 应用名变化会移动 userData 下的 dsh home，故首次启动把旧名（`NexusAgent Builder`）的 home **移动**过来，升级对用户无感。CI 里写死的安装目录/exe 名、workflow 发布说明与标题一并更新 | 本机打包实测：`NexusAIHarness.app`、`CFBundleName=NexusAIHarness`、**菜单栏截图显示 `NexusAIHarness`**、System Events 读到窗口名为 `NexusAIHarness`；接手测试：在旧目录放 `SENTINEL.txt` → 启动后日志 `adopted the home of NexusAgent Builder from …`、文件出现在新目录、旧目录已移走 |
| 10-13 | **修「打包版窗口创建了但从不显示」**（自查发现）：`loadURL().then(show)` 在 promise 不 settle 时不显示，且无任何日志。改为 `did-finish-load` 事件驱动 + `did-fail-load`/`.catch` 兜底显示，并记录 `window shown` | 修前：System Events 报 0 个窗口、`visibilityState=hidden`、日志无报错；修后：`window shown` 打印、System Events 报 1 个窗口且标题为 `NexusAIHarness` |
| 10-13 | **品牌统一为单一缓存**：工作台原先自己抓一份品牌（只在"登录状态翻转"时重取，漏掉"未登录时改地址"），现改用共享的 `useBranding` —— 侧栏/hero/工作台三者不会再各说各话。同时系统盘点所有动态展示项（名称/logo/版本/欢迎语/按钮色）与其取不到时的降级，写进 §8e-2 | 三场景实测：①换地址 → 侧栏 `KyloTynAI`、工作台标签同步；②**带已保存地址重启** → 侧栏 `KyloTynAI` + hero `v1.5.0.3`（宿主先应用覆盖值，无竞态）；③服务器不可达 → 默认名 + dsh 构建号 + 自带 SVG 字标、**裂图 0**、页面无 `undefined` |
| 10-13 | **修「换服务器地址后左上角品牌不变」**（用户反馈）：品牌缓存是模块级的，`useBranding` 见缓存即早退，而「应用」只刷新弹窗自己那份 → 侧栏留着旧服务器的名称/logo。新增 `invalidateBranding()`（清缓存 + 通知已挂载读取方重取）并在 `applyServer` 中 `setBaseUrl` 之后调用 | 两服务器对比实测（A `agent.nexusai.net.cn` / B `221.226.155.134`，品牌字段确不同：`tab.title` A=NexusAgent Builder、B=KyloTynAI）：切换前侧栏 `NexusAgent Builder` + 字标 `f7ccac8b…`；点「应用」后变为 **`KyloTynAI` + 字标 `25f4e026…`**（版本号两台都是 v1.5.0.3，故不体现差异） |
| 10-13 | **修「bundled dsh CLI is missing」（现场反馈）**：home 里的运行时链接在"应用移动/换目录重装"后失效，而旧逻辑只在版本串变化时重链、且用 `existsSync` 判占用（失效链接看到 false）→ 直接抛错。改为：标记含应用版本、`lstat` 判占用、启动前校验 CLI，缺则重建一次；用户自建目录仍拒绝覆盖。Windows 验收闸新增"残留 home 自愈"场景 | 本机（macOS）用"链接指向不存在路径 + 旧标记"的 home 实测：日志 `runtime link needs rebuilding (… cli missing)` → `runtime ready`，链接重建且 CLI 在位；反向用例（真实目录 + 无标记）实测仍拒绝并保住用户文件 |
| 10-13 | **产物命名**（用户选定）：用仓库名且不含空格 —— mac `NexusAIHarness-<v>-arm64.dmg`、win `NexusAIHarness-Setup-<v>-x64.exe`；约定与理由记入 §8h。CI 的 glob（`dist/*.dmg`、`*Setup*.exe`）不受影响 | 本机打包实测 `NexusAIHarness-0.1.4-arm64.dmg`；Windows 命名由下次 CI 产出验证 |
| 10-13 | **关掉 dsh 首启的「添加一个 API Key」引导**（用户要求）：该引导是 `ui-settings-models` 行的 `credentialOnboarding`（宿主发布成页面全局 `__DSH_MODELS_ONBOARDING__`），预置配置里设 `false` 即可，不改 dsh；新增 HANDOFF §8g 汇总预置 patch 的 5 段设置 | 干净 home 启动实测：`添加一个 API Key` 与 `稍后配置` 文案均搜不到，hero 标题可见、无登录框、launcher=1 |
| 10-13 | **语音输入改为保留**（用户要求开箱可用）：清空 `UNMOUNTED_FEATURE_PACKAGES`，语音/STT 链（sherpa-onnx 33MB + 实验性语音包）重新装回；剪裁只剩「源码映射 + 其它平台 prebuilds」两项（零功能影响） | profile 388→421 MB、DMG 208→217 MB；冒烟 + 挂 DMG 启动 + 组合校验三闸全过；包内 `sherpa-onnx-darwin-arm64` 与语音包都在 |
| 10-13 | **Windows 真机验收通过**（用户确认 v0.1.2 安装后可正常启动）→ 载体两侧到此刻都跑在真机上；CI 每推都跑两道自动验收闸（mac 挂 DMG 启动 / win 静默安装+启动+登录框断言+卸载）。代码同步到 Codeup：`v1.0` 分支 + 三个 tag 已推 origin（Codeup 无流水线，推送不触发构建） | 用户真机确认；Codeup `refs/heads/v1.0` = 5bf98d4 与本地一致 |
| 10-13 | **构建轨道定为 GitHub**（默认也是唯一）：核实云效后决定不迁（托管构建机只有 Linux；Codeup 发行版附件上限 50MB 装不下安装包）——结论与"将来真要迁怎么做"写进 §8c | 分支推送触发全量跑，tag 仍发 Release |
| 10-13 | **CI 抽真源 + 验收闸**：构建步骤迁入 `scripts/ci/*`（镜像默认值内置）；新增两道闸 —— mac「挂 DMG → 启动 → 断言就绪/插件行」、win「静默安装 → 启动 → 断言就绪 → CDP 断言登录框 → 静默卸载」；`prepare-runtime` 的 Windows 目录 symlink 改 junction | 手动 run 全绿：macOS 6m40s；**Windows 16m20s 打印完整证据链**（installer exit 0 → 落位 → 运行时 ready → profile 含插件行 → `{"dialogs":1}` → 卸载干净）。首跑即抓到两个真问题：`$home`/`$profile` 撞 PowerShell 只读自动变量 |
| 10-13 | **修「mac 装不上」的根因：产物没有自己的签名**。`identity: null` 时 electron-builder 不做任何签名，而 afterPack 又在签名时机之后往 `Contents/Resources` 塞了 490MB 运行时 —— 结果 `.app` 连 `_CodeSignature` 都不存在（`spctl`：`code has no resources but signature indicates they must be present`）。**从网页下载的副本（带 quarantine）会被 Gatekeeper 以「已损坏，无法打开」拒掉**，且该对话框没有任何"仍要打开"入口 → 用户只能得出"没安装成功"。改为 ad-hoc 签名（`identity: '-'`）+ 显式权限文件（`disable-library-validation` 等，否则 hardened runtime 会拒绝载入运行时里的第三方原生库而启动即崩） | 签名后：`_CodeSignature/CodeResources` 生成、`codesign --verify --deep --strict` 报 valid、`spctl` 由"签名损坏"变为标准的"未受信任开发者"；**打包版实跑通过**（菜单 + 运行时 ready，无库校验错误）。带 quarantine 的副本仍被拦一次——这是未公证应用的正常流程，可用「系统设置 → 隐私与安全性 → 仍要打开」放行 |
| 10-13 | 本机 shell 受限说明：`xattr -dr com.apple.quarantine` 在**沙箱化进程**里会被内核拒绝（`System Policy: deny file-write-xattr`），用户自己的终端不受此限 | 日志实证（syspolicyd/kernel Sandbox 拒写 xattr） |
| 10-13 | **窗口默认尺寸改为 1200×800**（与团队使用的参照编辑器窗口同尺寸；此前是按屏幕比例算的 1352×714，偏矮）。摆放逻辑不变（center/bottom/fill），尺寸按显示器裁剪 | 实测窗口 1200×800 @ 156,70；同机参照窗口为 1200×800 @161,106（只对齐宽高，位置仍按我们的居中/贴底规则） |
| 10-13 | **窗口摆放改为按工作区精确计算**：原 `center: true` 实测比工作区真正的中线高 41pt（y=73，应然 114）。改为自己取 `screen.getPrimaryDisplay().workArea` 算 x/y，支持 `center`（默认）/`bottom`（底边压 Dock）/`fill`（撑满）；来源优先级 env `NEXUSAI_WINDOW_PLACEMENT` > `<home>/window-placement` 文件 > 默认（文件是给双击启动的发行版用的，它没有 shell） | 三种模式各自实测（渲染进程读回屏幕坐标）：center `1352x714@80,114` 与理论 113 吻合；bottom `1352x712@80,194`（194+712=906=工作区底）；fill `1352x872@80,34`；文件模式日志显示 `from /tmp/…/window-placement` |
| 10-13 | **修品牌槽失效**：`sidebar.brand.{mark,name}` 会渲染优先级最低的贡献，我们的注册漏写 `priority`（默认 0）→ 一直输给 dsh 自带的本地构建标签，服务端品牌从未生效。补 `priority: -1`（与同文件 settings.launcher 同一规则） | 同机同 home 重启实测：侧栏变 `NexusAgent Builder ｜ v1.5.0.3`，dsh 标签消失（页面上搜不到 deepseek 文案） |
| 10-13 | **首启不弹 dsh 的「预览版说明」**：该提示用 `ui-settings-general.welcomeNoticeVersion` 与当前版本**精确相等**判定，预置配置里替用户确认即可。版本常量由 `prepare-runtime.mjs` 从装好的 `dsh-client-ui-settings-models` 包里读出（不硬编码；dsh 升级后新说明会再显一次，属预期） | 全新 home 启动：页面上 `预览版说明` / `预览阶段` 文案均搜不到；同一份 profile 的 patch 里出现 `welcomeNoticeVersion: '2026-09-28.1'` |
| 10-13 | 新增 `scripts/capture-ui.mjs`（CDP 截应用自身界面，只含应用内容、不含桌面）+ `scripts/check-client-mounted.mjs`（按 `data-nexusai` 标记判定 client 半是否挂载） | 本轮全部截图与断言都用它们产出 |
| 10-13 | **发行阻断修复：profile 名**。插件默认解析 `profiles/desktop/cordis.patch.yml`，打包版 profile 叫 `nexusai` → MCP 行与自定义连接器写进宿主不加载的文件（dev 恰好是 `desktop`，掩盖了它）。改为解析"承载本插件行的 profile"，显式配置仍优先；启动日志打印解析结果 | 打包布局 home → `profiles/nexusai/…`、dev home → `profiles/desktop/…`（同一脚本对两个真实 home 各跑一次）；套件 +3 例（66 例全绿） |
| 10-13 | **运行时日志落盘 + 菜单**：`<home>/logs/runtime.log`（2MB 轮转、token 脱敏）、帮助菜单（打开日志目录 / 查看运行日志 / 关于） | 日志文件含启动横幅/menu/ready 行且 token 残留计数 0；`--check` 语法与启动均通过 |
| 10-13 | ~~首启自动弹登录~~ → 当晚按用户要求**改回完全手动**（应用不自己弹登录框；验收闸改判 `data-nexusai="launcher"` 标记） | 打包版实测：未登录启动 `signInDialog` 计数 0、`launcher` 标记为 1 |
| 10-13 | **Release 流程**：tag（`v*`）触发 release job，把两端安装包挂到 Release；分支推送仍只产 artifact | tag `v0.1.0` → 三个 job 全绿，Release 含 dmg 226MB + exe 213MB |
| 10-13 | **CI 修复**：`npm ci` peer 图 ERESOLVE（`.npmrc` legacy-peer-deps）；`prepare-runtime` 读 `upstream/package.json` 在 CI 上 ENOENT；devDependencies 显式钉 16 个 dsh 类型包 | 干净 clone：`npm ci` 94 包 + `tsc` 通过；CI 两次全绿 |
| 10-13 | **carrier 发行化三件**：①应用图标/品牌（`resources/icon.svg` 派生 png/icns/ico，两端共用）②菜单收敛（去掉 Reload/Force Reload/DevTools 快捷键，另吞 ⌘R/Ctrl+R/F5）③运行时失败开窗显示输出（不再静默退出） | 打包版 .app 的 `CFBundleIconFile=icon.icns` 且与源一致；启动打印 `menu: minimal installed (5 top-level, no reload)`；干净 home 启动到 web URL 无失败 |
| 10-13 | **修发行阻断 bug：独立 profile 必须装 peer**。dsh 把 `@deepseek-ai/cordis-plugin-{group,include,loader}` 等声明为 peerDependencies，而 `dsh-app-boot` 直接 import 它们；照抄 dev profile 的 `autoInstallPeers: false` 会让打包版启动即 `ERR_MODULE_NOT_FOUND`。改 `true`，并把 `@deepseek-ai/dsh-subprocess-local` 加进 allowBuilds（与 dsh 同决定） | 本机打包版从干净 home 启动成功；修前失败日志已捕获 |
| 10-13 | **修 CI 首跑：`npm ci` 因 peer 图 ERESOLVE** → 仓库级 `.npmrc` 设 `legacy-peer-deps=true` | 从 GitHub 真实 clone 的干净副本：`npm ci` 通过（68 包）、`build.mjs` 出两产物、`npm pack` 出 tgz |
| 10-12 | **v1.0 carrier（单仓载体架构）**：dsh 以 submodule 锁版本封装进仓库（`upstream.json` + `upstream/`）；新增 `apps/nexusai-desktop` 薄壳（Electron-as-Node 跑内置 dsh）+ `prepare-runtime`（按版本装 dsh 进 profile）+ `after-pack` + `smoke-runtime`；`.github/workflows/build.yml` 出 mac/win 未签名包 | macOS 真机：profile 组合通过、无 GUI 冒烟到达 web URL、**打包版 .app 从干净 home 启动开窗**、DMG 237MB 挂载含完整运行时 |
| 10-10 | **删除「长时间运行模式」**（用户拍板：dsh 只有一个超时字段、无进度重置，开关无法在运行时生效）：移除 `sync/connector-prefs.ts` 整个存储、表单开关 UI、2 个语言键、`CONNECTOR_LONG_RUNNING_SECONDS`；超时保持「秒，默认 60，原样写」 | tsc + build + check:dsh + 套件全绿（长任务 = 直接填大超时） |
| 10-09 | **＋添加技能**：两项菜单（查找技能 → 切 SkillHub+聚焦搜索框 / 上传技能 → 文件夹·zip·md 弹窗，校验 + 同名覆盖） | 三路径真机上装并确认出现在本地列表；拒绝路径（无 SKILL.md / 无前置信息 / 中文名）逐个核对；覆盖安装后磁盘内容替换、旧文件移除 |
| 10-09 | 导入技能弹窗按参考图重做（虚线拖拽区 + 自动安装开关 + 文件要求），新增拖拽上传与文件夹展开 | 真实拖拽事件：高亮 → 拖入 .zip 装上、拖入 .md 装上；自动安装勾选后免点安装；同名时仍停下确认 |
| 10-09 | **连接器连通状态点 + 打开/关闭开关**（模仿技能卡片布局）：绿/红/灰点放在名字前，开关走 dsh 自己的 `disabled` 机制（行）或存储标志（SSE） | 用户连接器绿点「已连通 · 17 个工具」；死命令的连接器红点；关掉一个可用连接器 → 灰点 + 工具数 0（实例被回收），打开 → 绿点 + 工具回来；SSE 连接器同样三态；套件补 8 例开关断言 |
| 10-10 | **把「超时」与「长时间运行」拆成两个独立参数**（用户纠正）：开关不再改写超时输入框、行式连接器的开关不再从预算反推，开关存进独立 JSON；`connectorTimeoutMs()` 收窄成只认秒数 | 实测：填 90 → 打开开关 → 超时仍是 90；再改成 45 → 开关仍是开。套件改为断言"开关不参与数字"与"改一项不动另一项" |
| 10-10 | **连接设置的样式按参考图重做**：一项一行（左标签 + 圈问号，右控件），超时是右对齐数字框 + 外侧 `s` 单位，行间细线；说明收进「点击问号」的气泡（primitives `Tooltip openOnClick`） | 实测两行结构（switch / 右对齐 input + `s`、0.5px 分隔线）、问号点击弹说明气泡，截图核对 |
| 10-10 | **连接设置**：超时（秒，默认 60）、长时间运行模式（上限抬到 10 分钟）、SSE 请求头；JSON 导入认 `timeout`；编辑全预填 | 夹具服务器**实际收到** `x-fixture: hello` + `authorization: Bearer t0ken`（含握手与 POST）；6 秒预算下 8 秒的工具调用报 `timed out after 6000ms`，改成 20 秒后同一调用 `slow-echo: ok`；打开长时间开关表单自动变 600；套件 63 例全绿 |
| 10-10 | 修「设置只在一条路径生效」：新增设置后 `refreshSse`（编辑/新增走的那条）漏传 → 超时看似无效。现两条路径共用 `bridgeInputOf()` | 先用真实夹具复现（6s 预算下 8s 调用居然成功），修完复测超时生效 |
| 10-10 | 本地连接器卡片的「…」与开关**样式对齐技能卡片**：按钮改用 `local-more`（原来用的 `card-more` 没有任何 CSS → 带浏览器默认灰底）、菜单与开关同放一个 `local-actions`、绿色开关规则从 `.local-card` 收窄改为全局 | 实测几何与技能卡片一致（26×26、radius 8、透明底、与 36 宽开关间距 6px），开关也是产品绿 + 白旋钮；截图对比通过 |
| 10-09 | **同步不再无谓重写行**：`mcp-rows.write()` 先比对现有行，完全一致就不写文件 | 起因：切组织触发同步 → 重写 → dsh 重载 patch → 每个 MCP 实例卸载重连，约一分钟内全部显示未连通。现已跳过无变化写入，套件加 3 例 |
| 10-09 | **连接器工具详情 + 编辑/删除**：详情页列工具（名字/说明/参数 schema + 复制全名）；卡片「…」菜单支持编辑（原地替换）与删除（二次确认，仅限本页添加的） | 夹具详情列出 2 个工具与参数（`text string 必填`）；编辑预填正确、改名后无重复；删除二次确认生效；**用户自己的 modelscope 连接器从「SSE 未接入」变为「已桥接」并列出 17 个工具** |
| 10-09 | 修两处 schema 转换违规（嵌套 `required`、`description: undefined`）—— 真实第三方 MCP 工具全部注册失败的真因 | 套件新增「按 DSL 词汇表逐节点核对」一节；用用户的真实连接器端到端确认 |
| 10-09 | **自定义 legacy SSE**：快速创建加 `sse` 传输、JSON 的 `type:"sse"` 改为存进 SSE 清单并并入桥；本地卡片显示桥接旗标 | 起了一个本地 legacy-SSE MCP 夹具：面板添加 → 落到**连接器·本地**且旗标「SSE 已桥接」 → **agent 真调用 `sse_echo` 返回 `sse-echo: ok`**；宿主套件补 SSE 存储/并集/替换 5 例 |
| 10-09 | **连接器工具栏 + 自定义连接器**（快速创建 / 从 JSON 导入 / 导入 DXT 包 / 导入 MCPB 包），按来源搜索；行写进插件自己的 insert 项，登出不清 | 四项入口逐个验；快速创建与 JSON 导入各加成功；**agent 真调用夹具连接器的 echo 工具**，返回 `echo: ok \| note=quick-create`（证明命令/参数/env/握手/工具注册全通）；35 例宿主套件覆盖包解析与替换；删行后 HMR 回收实例 |
| 10-09 | 导入技能**合并成单入口**：去掉「选择文件夹」，改由宿主按选中项真实路径自动判断（目录/SKILL.md/zip/md/同目录兜底） | 宿主侧 13 例全绿（含压缩包路径穿越拒绝、纯数字名拒绝、加引号后成功）；UI 侧确认单入口、0 个第二控件、无路径回退仍可装 |
| 10-09 | 侧栏收起时面板被窗口 chrome 压住 → 按框架契约加让位内边距 | 两态几何 + 真实鼠标点击 + 截图 |
| 10-09 | 头像改圆形（`corner-shape: round`） | 整窗截图核对为正圆 |
| 10-09 | 补登出确认框（三态文案）+ 设置项快捷键提示 `⌘ ,` | 空闲/运行中/确认登出/凭据恢复全部实测 |
| 10-09 | 删头像菜单里的手动「同步能力」入口（同步本就全自动） | 菜单只剩两项；切组织往返计数与卡片名复原 |
| 10-09 | 技能页搜索按来源分开（此前一律搜 SkillHub） | 三态占位符 + 本地/远程过滤 + SkillHub 服务端搜索 |
| 10-09 | 左上角品牌改走官方槽位（远程取，带默认兜底） | 远程/不可达两种情形都核过布局不变 |
| 10-08 | 连接器拆本地/远程；导入 MCP 纳入；未登录隐藏远程来源 | 计数与卡片核对 |
| 10-07 | SSE MCP 桥接打通（含 CRLF/超时/重连/schema 兼容） | agent 真调用工具，链路通 |