# HANDOFF — 交接摘要（2026-10-07 · 全量重写）

## 排查：「磁盘 session 与内存状态不一致」的真相 + 两处真问题修复（2026-10-09）
**结论：登录状态本身没有不一致的问题**——之前那句话是我自己的错读。用确定性复现验证（把 `nexusai/session` 的 token 换成无效值 → 重启 → 任一次 API 调用必然 401）：
| 观察点 | 结果 |
|---|---|
| 磁盘 `.credentials.yaml` 的 `nexusai/session` | 被删除（0） |
| 界面 | 同一轮内变成「登录」（launcher aria-label = 登录） |
机制链是完整的：`api-client` 收到 401 → `store.persist(undefined)` → credentials-local `deleteRecord` → 广播 `credentials/record-updated` → auth 订阅者 `invalidate()` + `load()` → 视图翻转。之前的"不一致"来自我在同一段时间里连续做登出/换服务器/恢复凭据文件，**读磁盘的时刻与读界面的时刻不是同一状态**。

**但排查中发现两个真问题，已修**：
1. **401 登出没有清理注册**：`api-client` 只删凭据记录，`logout()` 里那套「清工具 / 清 MCP 行 / 清 SSE 桥接」不会执行 → 死会话的旧工具与 MCP 行留在 dsh 里。修法：auth 的 credentials 订阅者检测「原本有会话、重读后没了」且非主动登出（`deliberateSignOut` 标志区分），走 `sessionLost()`：执行同一套清理并置一次性提示。
2. **登出是静默的**：用户只看到变成「登录」，不知道原因。现在 `AuthView` 增加可选 `notice`（当前只有 `'nexusai: session-lost'` 一个码，客户端映射为本地化文案），未登录时显示在左下角：「登录状态已失效（Token 过期或被服务器拒绝），请重新登录。」；会话恢复（登录/静默刷新）时自动清除该提示。

真机验证（固定复现手法，可回归）：注入无效 token → 磁盘 0 条 + 界面「登录」+ **提示文案出现** + 注册清理执行；恢复有效凭据 + 重启 → 启动器「已登录：admin」、专家 3 / 技能 1 / 连接器 3、提示已清除。

## 修复：工作台品牌名不随登录的服务器变化（2026-10-09）
现象（用户报）：登录 `http://agent.nexusai.net.cn:8081` 后，工作台里仍显示 `KyloTynAI`（上一个地址 `221.226.155.134` 的品牌）——「远程获取 · KyloTynAI」。
原因：与弹窗那次同源——**工作台只在挂载时取一次 `getBranding()`**；用户是在应用新地址后重新登录的，面板挂载时还是旧地址，之后没人再取。
修法：`NexusaiWorkbench` 的品牌 effect 依赖从 `[]` 改为 `[signedIn]`——登录/登出（session 翻转）时重新读取；品牌接口按当前生效 baseUrl 取，因此换服务器后自然跟着变。

真机验证：当前 endpoint = `agent.nexusai.net.cn:8081`，重启后
- 技能页：「远程获取 · **NexusAgent Builder** (1)」（此前是 KyloTynAI）
- 连接器页：「远程获取 · **NexusAgent Builder** (5)」+ 该组织的 5 个服务器（test / 博查 / 百炼联网搜索 / 智能问数 / toolbox_databases）
⚠️ 验证范围：mount 路径已实测；「登录瞬间刷新」走的是同一个带 `signedIn` 依赖的 effect（我无法自己完成一次真实登录——没有账号密码，验证码也需人工识别），用户下次登录时可直接观察是否与所登录服务器一致。

## 修复：登录弹窗「应用」新地址后品牌即时刷新（2026-10-08）
现象（用户报）：改了服务器地址、连通性测试通过并应用后，弹窗的标题/logo/系统名/版本不变，得关掉再打开才更新。
原因：品牌只在弹窗**挂载时**取一次（`auth.getBranding()`），「应用」成功后没有重新取。
修法：抽出 `refreshBranding()`（挂载与「应用」成功都调用；失败时保留旧值不清空），在 `applyServer()` 里 `await setBaseUrl(target)` 之后立即调用——品牌接口本来就按**当前生效的 baseUrl** 取，所以重新拉一次即可。

真机验证（两台真实服务器，弹窗全程不关闭）：
| 操作 | 标题 | 欢迎语 | logo |
|---|---|---|---|
| 初始（endpoint = `221.226.155.134`） | 登录 KyloTynAI | KyloTyn墨智枢智能体开发平台 | …eb4d837796b0.png |
| 应用 `http://agent.nexusai.net.cn:8081` | 登录 NexusAgent Builder | NexusAgent Builder智能体开发平台 | …145d63c25a9e.png |
| 再应用 `http://221.226.155.134:8081` | 登录 KyloTynAI | KyloTyn墨智枢智能体开发平台 | …eb4d837796b0.png |
版本行两台都是 `v1.5.0.3`；每次应用后绿框「已连通」正常。测试结束已把 endpoint 还原为用户原值，并恢复登录态（启动器 `A admin ｜ --- 系统 ---`，专家 3 / 技能 1 / 连接器 3）。

⚠️ 又一次印证：**磁盘上的 `nexusai/session` 与进程内状态不一致**（`/tmp/creds-org-backup.yaml` 备份时已无 session；可用的备份是 `/tmp/creds-logo-backup.yaml`，endpoint 与当前一致）。恢复登录 = `cp` 该文件 + 重启。

## 侧栏左上角品牌改为远程获取（2026-10-09）
用户要求：左上角的 logo / 名字改为远程获取，取不到就用我们设计的默认，**版本号保持 dsh 原来的**，并且两条路径都不能改动原有布局。

**关键发现：dsh 为这块提供了官方槽位**（不需要 DOM hack，也不用改源码）：
- `sidebar.brand.mark`（single/root）：owner props `{size}`，回退是 `<FishLogo size={24}/>`
- `sidebar.brand.name`（single/root）：owner props `{}`，回退是「DSH 本地构建」+ 版本徽章
- 外层容器由 dsh 提供（`.brandIdentity` 24px 高 / gap 8、`.brandMark`、`.brandName` 18px·600），所以只要**按回退的内层结构 1:1 渲染**，布局完全不变

**实现**（新增 `client/NexusaiBrand.tsx` + 两个槽位注册；宿主 `getBranding()` 增两字段）：
- 远程 logo 里挑**方形**的那个当 mark：服务端给的多数是宽幅字标（3640×1002 之类），宿主对 `tab/home/login` 三个 logo 各取 PNG IHDR 头读像素尺寸，取第一个宽高比在 0.8–1.25 的；取不到就用**我们设计的默认 mark**（工具箱字形 SVG，`currentColor`，随主题）
- 名字：远程 `tab.title`；取不到用默认 **NexusAI DSH**（用户选定；候选与取舍见下）
- 版本徽章（用户澄清）：**优先显示 NexusAI 的远程版本号**（`about.version`，与登录弹窗同一个值，当前 `v1.5.0.3`）；**取不到时回落到 dsh 原来的构建串**（宿主拼 `DSH_CLIENT_VERSION`（宿主 env 有）+ commit —— 宿主 env 没有 commit，就向上找 `.git` 跑 `git rev-parse --short=7 HEAD`，当前 `0.2.0-rc.2-639ed01`）；两者都没有则省略该行
- 结构：有版本时渲染「名字(12px/13px) + 版本徽章(10px 高、6px 等宽字、圆角 2)」，与 dsh 本地构建回退**逐项同款**；无版本时退化为单行名字（dsh 回退本身也有这一分支）

**真机验证**（两条路径 + 布局）：
| 场景 | mark | 名字 | 版本徽章 |
|---|---|---|---|
| 远程可达（endpoint=agent.nexusai.net.cn） | 服务端方形 logo（200×200 → 24×24） | NexusAgent Builder | **`v1.5.0.3`**（平台版本，与登录弹窗一致） |
| 远程不可达（endpoint 临时改为 127.0.0.1:9） | 默认智能体节点图 SVG（24×24） | NexusAI DSH | `0.2.0-rc.2-639ed01`（dsh 原样回落） |
两场景下 `.brandIdentity` 都是 **24px 高**（149×24），与改造前一致；测试后恢复 endpoint 并确认登录态正常（品牌 NexusAgent Builder、专家 11 / 技能 1 / 连接器 5）。

## 自定义应用名 / 图标（2026-10-09）
三层来源与可行性（实测）：
| 层面 | 来源 | 能否自定义 |
|---|---|---|
| Dock/菜单栏/Finder 的**应用名** | dev 包由 `apps/desktop/scripts/development-app.ts` 生成，plist 里硬编码 `CFBundleName/DisplayName = Harness Dev` | ✅ 改**生成出来的 .app 包**（不动 dsh 源码） |
| **Finder 里的图标** | dev 包是 `ditto` 复制 Electron.app，图标随包继承（Electron 自带） | ✅ 同上，替换 icns + `CFBundleIconFile` |
| **Dock 图标（dev 环境）** | Electron 在**未打包模式**使用自带默认图标（进程即 `Contents/MacOS/Electron`，`app.isPackaged=false`） | ❌ 只有 `app.dock.setIcon()`（= 改 dsh main）才行；打包版不受此限（Dock 读包内 icns） |
| 应用内左上角品牌（现显示「DSH 本地构建」） | dsh 语言包 `packages/client/locale/src/locales/zh.ts` 的 `brand.localBuild` | ❌ 插件无法覆盖（locale 服务对同 namespace+locale 重复注册直接抛错） |

**已交付**：`scripts/dev/brand-dev-app.mjs`（幂等、可用参数覆盖）
- 默认取**服务端品牌**：名字 = `tab.title`、图标 = `login.logo.path`（读 `.credentials.yaml` 的 endpoint 拼 `/service/api`）；`--name` / `--icon <png>` / `--bg <hex>` / `--bundle` 可覆盖
- 图标流程：下载 logo →`sips --padToHeightWidth 1024 1024 --padColor` 补成正方形 → 生成 10 档 iconset → `iconutil -c icns` → 写入 `Contents/Resources/<Name>.icns` + `CFBundleIconFile`；再 `plutil` 改两个名字键、`codesign --force --deep --sign -` 重签名、`lsregister -f` 注册；运行中会先拒绝执行（包在用无法签名）
- 实测：菜单栏由「Harness Dev」变为 **NexusAgent Builder**；Finder 中该 .app 显示**我们的 logo 图标**；Dock 仍是 Electron 原子图标（上表第 3 行的原因）；应用启动与功能不受影响
- 注意：dsh 只在 dev 包 identity 变化（端口/路径/源 plist 变动）时才重建包，重建后重跑本脚本即可

## 其它改动（2026-10-08 · 五）
- **组织切换搬到左下角用户名后面**（用户要求，取代刚删掉的分区里的那个入口）：`NexusaiLauncher.tsx` 在账号名后渲染一个胶囊（当前组织名 + ⌄），点击弹出组织菜单（`Menu` 的 `selectedId` 标记当前组织），选中即 `auth.selectOrg(id)`（宿主会持久化 orgId 并重新同步 tools/MCP/SSE 桥接）；切换中胶囊显示「…」；只有**一个组织**时退化为纯文本（不可点）；`aria-label/aria-expanded` 齐全，键盘 Enter/Space 可开
- 工作台的列表加载依赖加了 `view?.orgId`，切换组织后 专家/技能/连接器 会随新组织刷新
- 真机验证：账号名后出现「A admin ｜ --- 系统 --- ⌄」（截图）；点开菜单列出 7 个组织；切到「联成科技」→ 胶囊变「联成科技」、面板刷新为该组织的 专家 0 / 技能 0 / 连接器 0；切回「--- 系统 ---」→ 面板恢复 专家 3 / 技能 1 / 连接器 3；切换过程中胶囊显示「…」

## 其它改动（2026-10-08 · 四）
- **删除设置里的 NexusAI 分区**（用户要求，含右侧全部功能）：`client/index.ts` 去掉 `settings.section` 注册（id `nexusai`、order 10），删除 `client/NexusaiSection.tsx`，并同步了模块头与 `registerSurfaces` 的过时注释。真机验证：设置页只剩 通用设置 / 模型 / 内置插件 / Agent 预设（无 NexusAI、无组织/同步能力字样）；左下角菜单仍是 打开设置 / 同步能力 / 登出；工作台三标签正常
- ⚠️ **副作用**：**组织切换（`selectOrg`）原本只存在于该分区**，删除后没有 UI 入口了（宿主能力仍在）。若需要，可把它移到左下角菜单或工作台里（用户暂未要求）
- 登录弹窗里的「打开设置」链接保留（它指向整个设置页，用于配模型 API key，与我们的分区无关）

## 其它改动（2026-10-08 · 三）
- **本地技能详情页去掉启用/关闭开关**（用户要求）：开关只在卡片上，详情页头部只剩圆形首字母 + 标题；状态仍可从元信息行看到（`状态：已启用 / 已关闭`）。真机验证：打开 `academic-paper-writer-pro` 详情 → 详情内 `[role=switch]` 不存在、卡片上的开关仍在、元信息两行正常（截图确认）

## 其它改动（2026-10-08 · 二）
- **本地技能卡片不再显示「已关闭」标签**（用户要求）：去掉卡片标题下的 `local-off-tag` 与它的 CSS；关闭状态仍由**灰色开关**（旋钮在左）+ 卡片变淡（`is-off`，`opacity .62`）表达。真机验证：停用 `zz-tag-check` 后卡片文本仅为技能名、`.local-off-tag` 不存在、`is-off` 生效（验证用临时技能已删除）

## 本地技能开关改成产品绿（2026-10-08，按用户截图）
- 轨道色取自用户参考图：**`#00C29A`**（截图里量得 `#00c29a` 主导色），打开时旋钮为**白色**（深色主题下 dsh 原生拇指色 `--dsw-alias-label-primary-foreground` 是深色，与参考图不符）
- **尺寸沿用 dsh 原生**（用户要求）：36×20、旋钮 16px、内边距 2px、开态位移 16px（曾按截图比例放大到 40×24，已回退；只保留配色改动）
- 只作用于本地技能卡片（`.local-card [role='switch']`），并**挂 ARIA 属性选择器**（`[aria-checked='true']`）而不是 dsh 的 CSS module 哈希类名，宿主升级也不会失效
- 真机验证：尺寸 `36x20 / padding 2px / radius 999px`，开态 `track=rgb(0,194,154)`、`knob=rgb(255,255,255)`（16px，位移 16px）；关态 `track=rgba(255,255,255,0.16)`、旋钮回左（`transform: none`）；截图确认

## 其它改动（2026-10-08）
- **左下角登录标签**：已登录时不再显示「已登录：admin」，只显示账号名（`client/NexusaiLauncher.tsx`；状态移入 `title`/`aria-label`，悬浮仍可看到「已登录：admin」，不影响可访问性）。真机验证：可见文本 `admin`（头像首字母 A + 名字），`aria-label`/`title` = 已登录：admin
- 设置分区里的「已登录: admin」保持不变（用户只要求左下角）

## 新功能：登录页 logo + 版本号（2026-10-08，来自远程接口）
`GET /v1/base/custom` 的品牌数据比原先用的更全，现在整份读取：
| 字段 | 用途 |
|---|---|
| `login.logo.path` | **登录弹窗顶部的 logo**（图片，`base + /service/api + path`） |
| `login.welcomeText` | logo 下的欢迎语（当前 =「KyloTyn墨智枢智能体开发平台」） |
| `login.loginButtonColor` | 登录按钮色（当前 `#384BF7`，实测生效） |
| `about.version` | 弹窗底部一行「v1.5.0.3」（用户要求**不显示版权**，`about.copyright` 仍读取但不渲染） |
| `login.platformDesc`、`login.background.path`、`tab/home.logo.path` | 已读取备用（当前前者为空） |

实现：
- `api-client.assetUrl(path)`：品牌图片统一转绝对 URL（相对路径走 `base + /service/api`；实测 `http://<host>:8081/service/api/v1/cache/...png` 返回 200，直接 `<host>/v1/...` 是 404）
- `getBranding()` 返回结构从 `{name}` 扩成 `Branding{name, logoUrl, backgroundUrl, welcomeText, platformDesc, buttonColor, version, copyright}`（类型在 `src/types.ts`，客户端镜像 `BrandingFace`）；拉取失败仍是全空对象，纯装饰、不阻塞登录
- 弹窗：logo 图（`max-height:44px`，加载失败自动隐藏）+ 欢迎语 + 底部版本行；登录按钮用平台配置色（内联 style 覆盖主题）

真机验证（登出态打开弹窗读取 DOM + 截图）：logo 已加载（naturalWidth>0）、欢迎语与版本行（`v1.5.0.3`，无版权）正确、按钮计算色 `rgb(56,75,247)` = `#384BF7`。验证后已恢复登录态（启动器显示「已登录：admin」，专家 3 / 技能 1 / 连接器 3）。
（附注：验证期间发现磁盘上的 `nexusai/session` 会被清掉而进程内仍保持登录——恢复登录用 `cp` 回凭据文件 + 重启即可；本次备份在 `/tmp/creds-logo-backup.yaml`。）

⚠️ 注意：品牌接口按**当前生效的 baseUrl** 取（本机存的 endpoint 是 org 自己的 `221.226.155.134:8081`，品牌名为 `KyloTynAI`；换回 `agent.nexusai.net.cn` 时品牌名/logo 会随之变化——这正是"从接口获取"的预期行为）。

## 暂停状态（2026-10-08）
用户指示：**功能开发与发行版全部暂缓**（"先开发功能吧，发行版本的功能先暂缓" → 本轮结束后 "这几个任务也暂缓"）。当前一切保持可交付状态，随时可继续：
- **代码**：`tsc` 0 错误、`node scripts/build.mjs` 产物为最新（lib/index.js、lib/client.js 均 17:56）、无 `TEMP-DEBUG` 残留
- **桌面端**：仍在运行（inspector 9223），已登录 admin，连接器 3 个（`test 可直连` + 两个 `SSE 已桥接`，共 8 个桥接工具）
- **待续事项**：见文末「待办（全部暂缓）」表；恢复时从「SSE 桥接的凭据跟进」或「发行版/产品化」入手即可
- **不使用 macOS 专属脚本时**：`scripts/dev/{center-window.mjs,start-desktop.sh,watch-window.sh}` 仅影响窗口摆放，与功能无关

## 一句话现状
NexusAI 桌面插件（`@toby/dsh-plugin-nexusai`）已把登录、能力同步与「专家 · 技能 · 连接器」工作台全部跑通并逐一真机验证：NexusAI 登录替换了 dsh 内置账号 UI（左下角同一位置）、品牌名与来源计数全部接口驱动、技能页含 本地/SkillHub/远程 三来源（本地可启用关闭、SkillHub 可搜索/翻页/看详情/真安装）、连接器已补齐「创建 + 导入」两套 MCP，且 **legacy SSE 的 MCP 已桥接成 dsh 工具**（2026-10-08，实测 agent 可调，2 台服务器 8 个工具）。tsc 0 错误，dsh 基线 0.2.0-rc.2。当前因用户指示**全部暂缓**（见上方「暂停状态」）。

## 今日进展（2026-10-07）
**工作台（侧栏「专家 · 技能 · 连接器」）**
1. 布局对齐 WorkBuddy 真机：能力标签行右端放搜索框 + `已安装(N)` + `＋添加技能`（技能页常驻）；删掉重复的页面标题行与「精选技能/换一批」行；计数改挂标签（专家 11 / 技能(当前来源) / 连接器 5）
2. 技能来源标签带动态计数：`本地 (21)` / `SkillHub (24，随翻页增长)` / `远程获取 · NexusAgent Builder (1)`；品牌名来自 `GET /v1/base/custom`
3. SkillHub：分类标签改为接口获取（`/api/v1/categories`，13 项含 Pay Skill）、左右箭头翻页、向下无限翻页（去重累积 + 空页判到底 + 「没有更多了」，头部不随滚）；**修复「筛选失效」**（根因=市场 `publicSlug` 不唯一导致 React key 重复、旧节点残留 → 改用 `namespace.canonicalName` 作唯一 id，安装/去重/已安装标记同步改用 id）
4. **技能详情页**（对齐 WorkBuddy 的详情形态）：返回 / 68px 圆图标 / 标题 / 安装或已安装 + 在 SkillHub 打开 / 指标（下载·收藏·安装·评论）/ 元信息 7 行 / 技能介绍（折叠）/ 技能内容（预览=自写轻量 markdown 渲染，源码=等宽原文）/ 更新说明；接口坑：`/api/v1/skills/<canonical>` 会 405，须「裸 slug 进路径 + `?namespace=@handle`」消歧
5. 卡片图标：修「裂图」（接口把缺失图标返回成 JSON `null`，被判成字符串 "null" → `src="null"`）；宿主规范化 + 客户端 `onError` 回落字母头像
6. 标记：需 API Key 的技能名后画**钥匙图标**（橙色，自绘 SVG；数据 `labels.requires_api_key`），详情页另有「需 APIKey / 付费技能」chip（`labels.pricing_type`）；收藏图标由对勾圆圈换成**五角星**
7. **本地标签的启用/关闭**：关闭=把 `SKILL.md` 改名 `SKILL.md.disabled`（注册表自动从「/」目录移除，真生效），启用=改名回来；卡片右侧常显 `[ … ][ 开关 ]`（顺序：更多操作在左、开关在右）；「…」菜单 = 查看技能内容（本地详情）/ 复制技能路径 / 删除技能（二次点击确认，删整个目录）；列表按名称排序，**关闭不改行位置**
8. 体验修复：切换/删除后的后台刷新改为**静默刷新**（占位只在首次加载且列表为空时出现）+ 内容不变不换数组 + 有界轮询 → MutationObserver 实测 0 次闪烁

**能力同步**
9. **连接器补齐「导入 MCP」**：NexusAI 有两套目录——创建 MCP `GET /v1/mcp/server/list`（bff 走 streamable）+ 导入 MCP `GET /v1/mcp/list`（`sseUrl`/`streamableUrl`/`transport`，工具数走 `/v1/mcp/tool/list?mcpId=`）。新增 `src/sync/mcp-list.ts` 统一两套 → 面板显示 5 个（创建 3 + 导入 2，副标题标来源）；可 streamable 的自动写 mcp-client 行，legacy SSE 的展示但标「SSE 未接入」（dsh 只支持 stdio/streamable-http）
10. **修 MCP 行重复堆积 bug**：`mcp-rows.ts` 的 `removeOwnedItems` 用 `Array.isArray` 判断 YAML 节点（`YAMLSeq` 永远不是 JS 数组）→ 旧行从未删除，patch 文件堆到 231 行（77 份重复）；改 `isSeq(insert) && insert.items` 后重启一次收敛为 1 个 insert / 3 行

## 功能形态（当前真实状态，全部真机验证）
- **侧栏一级「专家 · 技能 · 连接器」**：`sidebar.panellist` 图标行 + `main` 键控面板（`NexusaiWorkbench.tsx`）。能力标签行：`专家 (11)` / `技能 (N)` / `连接器 (5)`，技能页右端常驻搜索框 + `已安装(21)` + `＋添加技能`；**未登录时隐藏「专家」以及 技能/连接器 两个「远程获取」来源**，其余照常（见下「未登录形态」）
  - **专家** = NexusAI 自定义工具卡片（首字母头像 + 名称 + 描述）
  - **技能** 三来源：
    - **本地** = 对话「/」菜单同源目录（`remote.skills.list`，与斜杠菜单同一 Remote/过滤）＋ 已关闭项；每卡片：开关（启用/关闭）+「…」（查看技能内容 / 复制路径 / 删除技能-二次确认）；内置技能（无文件）无开关与菜单
    - **SkillHub** = 腾讯市场：搜索 / 14 个分类芯片（左右箭头翻页）/ 无限滚动 / 卡片（图标·名称·单行描述·⚡下载·☆收藏·＋安装或绿色「已安装」）；点卡片进详情（预览|源码）
    - **远程获取 · <品牌>** = NexusAI 目录（下载 SKILL.md 到本地技能根）
  - **连接器** 两来源（同技能页的子选项卡）：**本地** = 本机 profile 里的 mcp-client 行（名称 · transport · url）；**远程获取 · <品牌>** = 创建 MCP + 导入 MCP 卡片（来源 + 工具数；legacy SSE 的带「SSE 未接入」标记）；未登录时远程来源隐藏，本地照常
- **左下角 NexusAI 账号按钮**（`settings.launcher`，priority -1 遮蔽内置，内置行保留作崩溃兜底）：未登录=单击直接开登录弹窗；已登录=头像+用户名 → 菜单（打开设置 / 同步能力 / 登出）
- **登录弹窗**：打开即自动取验证码；动态品牌（`{tab.title}`）；服务器地址（裸 origin + 「应用」按钮：脏值才可点 → 连通性测试转圈 → 通过才持久化）；空字段抖动校验；错误提示在表单下方（不遮输入框）；失败自动重发且**保留密码**；取消=一步关闭
- **设置 → NexusAI 分区**：组织选择器 / 同步 / 登出；未登录显示登录入口
- **内置 DeepSeek 账号 UI 已隐藏**：`cordis.patch.yml` 禁 `ui-settings-account`（客户端行安全；**宿主 `deepseek-account` 行绝不可禁**）

**未登录形态（2026-10-07 末批）**
11. 未登录不再把整个工作台替换成登录门：**隐藏「专家」能力标签**与技能里的**「远程获取」来源**（两者都依赖 NexusAI 账号），其余照常可用——**本地**技能（文件名/开关/删除）与 **SkillHub**（搜索/分类/翻页/详情/安装）都无需登录；**连接器**标签保留但显示「登录后可同步 NexusAI 的 MCP 服务」+ 登录按钮；登出时清空 NexusAI 侧列表（工具/远程技能/连接器），并自动把活动标签、技能来源回落到仍可见的项（技能/本地）；登录弹窗在主区各分支都可打开
  - 真机复验（先备份 `.credentials.yaml` → 通过启动器菜单登出 → 验证 → 恢复凭据重启）：登出态 = 标签 `技能 (21) / 连接器 (0)`（无专家）、来源 `本地 (21) / SkillHub (24)`（无远程获取）、SkillHub 列表 24 张卡可开详情、连接器显示登录提示；恢复后 = 标签 `专家 (11) / 技能 (1) / 连接器 (5)`、来源三项齐全、MCP 行重新写回 3 行

**连接器双来源（2026-10-07 末批）**
12. 连接器与技能同构，分两个来源子选项卡：**本地 (N)** = 本机自己的 mcp-client 行（`McpRowSync.list()` 解析 profile patch，排除插件自己写的 `nexusai-mcp-*` 行），**远程获取 · <品牌> (M)** = NexusAI 两套目录（创建 + 导入）。切来源时能力标签计数跟随（同技能页）；**未登录时远程来源整个隐藏（与技能的「远程获取」一致，不再显示登录提示）**，本地来源照常（纯文件读取）；本地为空时提示「本机还没有配置本地 MCP 服务（可在配置文件里添加 mcp-client 行）」
  - 真机复验：`本地 (0) / 远程获取 · NexusAgent Builder (5)`；临时插入一条 `local-demo-fs` 行后本地标签立刻显示该服务（serverName · transport · url），**测试后已删除该行**（否则 dsh 会去连一个不存在的地址）；patch 文件仍为 3 条 nexusai-mcp 行、无重复

**侧栏图标（2026-10-07 末批）**
13. 侧栏「专家 · 技能 · 连接器」图标由 `IconGlobeOutlineRegular`（地球，不达意）换成**自绘工具箱 SVG**（`client/NexusaiPanelIcon.tsx`：箱体 + 提手 + 箱缝 + 锁扣，1.7 描边、currentColor，随侧栏选中态变色）——意象是「这一格里装着工具/能力」，且与 dsh 自带侧栏图标（插件=风车、工作区=网格）不撞。真机截图确认 16–18px 下清晰可辨

## 架构与关键接缝
| 环节 | 实现 |
|---|---|
| 授权 flow | `NexusaiAuthService` 注册 `ctx.authorization.registerFlow`（key `nexusai/session`）：captcha → 等提交 → bff login → `session.commit(grant)` |
| 尝试状态机 | initializing/waiting-input/verifying/committing/succeeded/cancelled/failed，`@Remote({mode:'stream'}) watch` 下发 |
| 凭据 | flow 唯一提交者（`nexusai/session`）；`nexusai/endpoint` 存 base url 覆盖 |
| 客户端 fiber | mount/consumer 双 fiber：顶层只 inject 基础服务并 `$mount`，消费者用 `ctx.plugin({inject:['remote.nexusaiAuth','remote.nexusaiCapabilities','theme','sessions','remote.skills']})`（避免自锁） |
| 状态共享 | 一条 watch 流 → 共享快照 store → `useNexusai(selector)` 合成 hook |
| 槽位 | `sidebar.panellist` + `main`（键控）+ `settings.launcher`（priority -1）+ `settings.section` |
| Typert Remote | 手写描述符 28 条（`client/remote.ts`）；宿主方法参数名会被 esbuild 按冲突重命名 → 改参数后必须 `grep "async <method>(" lib/index.js` 核对 |

## 文件地图
```
src/                        宿主半
  index.ts                  apply：装配 + inject ['credentials','tools','authorization'] + LocalSkills/SkillHubClient
  config.ts                 插件配置（baseUrl、AES keys、skillhub.apiBase/webBase、skills.downloadRoot…）
  service/auth.ts           登录服务（flow/状态机/watch/品牌/连通测试）+ 登录后能力同步
  service/capabilities.ts   能力 Remote：列表/同步/下载/技能详情预览/本地技能操作
  nexus/api-client.ts       bff 客户端（可变 base、/service/api 前缀、envelope 解码、连通探测、品牌）
  nexus/model.ts            接口类型（含导入 MCP：ImportedMcpServerRow / ImportedMcpToolListResponse）
  nexus/skillhub.ts         SkillHub 客户端（搜索/分类/详情/安装/预览；canonical-id 与 URL 消歧）
  sync/custom-tools.ts      自定义工具 → dsh 工具（OpenAPI → defineTool）
  sync/mcp-list.ts          两套 MCP 目录归一（创建 + 导入；connectable 判定）
  sync/mcp-rows.ts          写/清 `nexusai-mcp-*` insert 行（YAML 保注释 + 原子写）
  sync/local-skills.ts      本地技能启用/关闭（改名）、扫描已关闭、读取与删除（路径守卫）
  sync/{skills,endpoint-store,session-store,openapi}.ts
client/                     浏览器半
  index.ts                  双 fiber + 快照 store + 槽位注册 + controller（ops 透传）
  face.ts                   DTO/inject face/unwrap（含 LocalSkillEntryFace）
  remote.ts                 Typert 描述符（28 条）
  NexusaiWorkbench.tsx      三选项卡工作台（详情页、本地开关菜单、SkillHub 列表/详情、连接器卡片）
  NexusaiSignInDialog.tsx   登录弹窗     NexusaiLauncher.tsx 左下角入口
  NexusaiSection.tsx        设置分区     NexusaiPanelIcon.tsx 侧栏图标
  locales.ts                zh/en 字典
scripts/
  build.mjs                 esbuild 双产物（宿主 ESM / 客户端 CJS + ModuleLoader 包裹）
  check-dsh-version.mjs     dsh 版本基线（npm run check:dsh）
  verify/cdp-eval.mjs       CDP 驱动运行中的桌面端（读 DSH_CDP_PORT，默认 9222）
```

## 换机器 / 新环境部署（2026-10-08）
**结论：dsh 源码零改动即可迁移**——`git status` 在 dsh 检出里是干净的（tag `dsh-v0.2.0-rc.2`），所有 NexusAI 相关的东西都落在三处：① 插件仓库本身 ② 生成的 dev home 里的 profile patch ③ 指向插件的符号链接。已写成幂等安装脚本 `scripts/dev/install-into-dsh.mjs`：

```bash
# 新机器上（Node ^22.19 || ≥24，pnpm 11.7.0）
git clone <dsh 仓库> ~/IdeaProjects/deepseek-harness && cd ~/IdeaProjects/deepseek-harness
git checkout dsh-v0.2.0-rc.2          # 与插件 dshBaseline 对齐
pnpm install
pnpm run start:desktop                # 先跑一次，生成 .desktop-build/development（然后可关掉）
git clone <本插件仓库> ~/GoLandProjects/nexusai-harness
cd ~/GoLandProjects/nexusai-harness
node scripts/dev/install-into-dsh.mjs # 构建 + 建符号链接 + 写 patch 行（幂等，可重复跑）
DSH_DESKTOP_RENDERER_DEBUG_PORT=9223 pnpm --dir ~/IdeaProjects/deepseek-harness run start:desktop
```
- 脚本做四件事：`node scripts/build.mjs` 出 `lib/{index,client}.js`；把插件软链到 `<dsh>/apps/desktop/.desktop-build/development/project/node_modules/@toby/dsh-plugin-nexusai`；在 dev home 的 `profiles/desktop/cordis.patch.yml` 补 `- id: ui-settings-account / disabled: true` 与 `nexusai` 插入行（baseUrl + AES keys，可用 `DSH_BASE_URL` / `AES_KEY` / `AES_IV` 覆盖）；打印后续步骤
- **不需要拷贝**：账号凭据（新机器上登录一次即可，凭据本来就按机器存）、`.desktop-build`（自动生成）、`nexusai-mcp-*` 行（登录后由插件重写）
- **要带走的**：插件仓库（或打包 tar）、baseUrl/AES key/IV 两个值（脚本默认值即当前生产配置）、可选 `scripts/dev/` 下的窗口摆位脚本（需辅助功能权限）
- 迁移后自检：`npm run check:dsh`（版本一致）→ `npx tsc --noEmit` → 启动后侧栏出现「专家 · 技能 · 连接器」→ 登录 → 连接器显示创建+导入 MCP、技能页三来源可用
- ⚠️ 只允许跑**一个** dsh 实例：残留实例会占住 19387（web 端口），新实例启动会以 `DesktopHostFatalError: 2 required plugins did not activate`（根因 `EADDRINUSE 19387`）失败。清理：`pkill -9 -f "Harness Dev.app"; pkill -9 -f dsh-desktop-host; rm -f <dev>/electron-user-data/Singleton*`
### 不装 dsh 源码的路线（体验/试用推荐）
dsh 的**插件管理器（侧栏「插件」页）支持四种安装来源**（源码 `packages/boot/plugin-manager/src/install-spec.ts`：registry 包名 / **本地绝对路径** / **tgz 压缩包（本地或 http）** / git 仓库），装的时候用 pnpm 写进 profile 并补齐依赖——所以新机器只要有一个 **dsh 桌面应用**（打包版）+ 我们的插件包即可：
```bash
# 1) 本机产出 dsh 桌面应用（耗时较长；未签名时新机器首次打开需右键 → 打开）
cd ~/IdeaProjects/deepseek-harness && pnpm run package:desktop:mac:arm64
# 2) 本机产出插件包（147KB，已验证只含 lib/{index,client}.js + package.json）
cd ~/GoLandProjects/nexusai-harness && npm pack        # → toby-dsh-plugin-nexusai-0.1.0.tgz
# 3) 新机器：装好 dsh → 侧栏「插件」页 → 安装 → 填 tgz 绝对路径（或插件仓库的绝对路径）
#    随后在该机器 profile 的 user 层 patch 里补 nexusai 行（baseUrl + AES key/IV）；
#    插件目前未声明配置表单，所以这步需手改 YAML（后续可加配置表单一步到位）
```
- **已验证**：打包产物干净（`files: ["lib","README.md","HANDOFF.md"]`，并删掉了仓库里一个自指符号链接 `nexusai-harness -> 自己`，它会污染打包）；dsh 接受的四种 spec 形式来自其源码
- **未实测**：插件页安装这条链路没在本机跑（本机是 dev 接线，装了会双份加载）；若失败则回到下面的源码路线
- 更远的目标（给**非开发机**做品牌化的自有壳）仍走「产品化」路线（自有 Electron 壳 + 打包管线），见「架构决策」

## 新功能：SSE MCP 桥接（2026-10-08）—— 让 legacy SSE 的 MCP 真正可用
背景：dsh 的 mcp-client 只支持 stdio / streamable-http，而 org 里多个 MCP（导入的 + 部分创建的）是 **legacy SSE**，此前只能"看得见、用不了"。现在本插件把它们桥接成普通 dsh 工具，agent 可直接调用。

**实现**（3 个文件 + 接线）：
- `src/nexus/mcp-sse.ts`：最小 MCP 客户端（legacy SSE）。`GET <sseUrl>` 收 `event: endpoint` → 向该地址 POST JSON-RPC，**响应经同一条 SSE 流按 id 匹配**；`initialize` → `notifications/initialized` → `tools/list` / `tools/call`。所有 fetch（含握手）都带超时（Node 的 fetch 默认无限等待）
- `src/sync/mcp-tools.ts`：`McpSseToolRegistry`——按服务器建连、列工具、每个远端工具注册成一个 dsh 工具（`<prefix>__mcp__<server>__<tool>`），参数用 MCP 的 JSON Schema 经 `toValueSpec` 映射；**按需重连**（SSE 流会被服务端关掉，工具调用前若会话已关则重新握手并重试一次）；`clear()` 关会话 + 撤销注册（登出/重同步）
- 接线：`capabilities.sync()`（手动/启动同步）+ `auth.syncCapabilities()`（登录同步）都桥接；`SyncReport` 增 `mcpSseServers`/`mcpSseTools`；设置区同步结果文案加「SSE 桥接工具: N」
- 面板：连接器卡片对 SSE 服务器显示绿色「SSE 已桥接」+ 真实工具数（未成功仍显示「SSE 未接入」）

**过程中踩到并修掉的 4 个坑**：
1. **SSE 帧 CRLF**：有一台服务器用 `\r\n\r\n` 分隔帧，我只按 `\n\n` 切分 → 永远收不到 endpoint 事件（表现为"握手超时"）。现在先把 `\r\n` 归一成 `\n`
2. **fetch 无超时**：地址不可达时 `await fetch` 永久挂起，整个同步卡死 → 所有请求加 `AbortSignal.timeout`
3. **dsh 参数 schema 校验严格**：`description` 缺失（`undefined`）会被拒（`annotation must be lossless JSON data`）→ 映射时总是填字符串描述
4. **中文服务名 slug 退化成 `x`**：多个中文名服务器会撞工具名 → slug 为空时改用名字的短哈希（`x<base36>`），保持唯一
5. 另外把 `capabilities.sync()` 的三步（工具/写行/桥接）拆成各自 try/catch——此前 tools 同步一失败就把 MCP 与桥接整段跳过（错误只进 logger，界面无感）

**真机验证（含真实 agent 调用）**：
- 桥接结果：`bridged=2 tools=8 errors=[]`，注册名如 `nexusai__mcp__xdgx9hh__mcp_datasource_list`、`nexusai__mcp__xw6bxsk__extract_table_data`
- 连接器面板：`test 可直连 / 智能问数 SSE 已桥接 / 自动生成报告 SSE 已桥接`
- **让 agent 实际调用**：新会话里让它调 `nexusai__mcp__xdgx9hh__mcp_datasource_list` → 第一次返回 `SSE 会话未就绪`（会话已被服务端关闭，暴露了缺重连）→ 修好后重测，错误变成**远端服务器自己的** `403 Could not validate credentials`（该工具要求有效 token 参数）——证明「注册 → agent 选中 → 重连 → 调用 → 远端应答 → 回给 agent」整条链路是通的，剩下的只是该服务器要求的凭据

## 更正：MCP 行同步没有问题（2026-10-08）
早前把「profile patch 里只剩一条 nexusai-mcp-* 行」当成 bug 报告给用户，**是误判**。插桩（宿主 `console.info` 会进桌面日志，`ctx.logger` 不会）实测一次启动同步：
```
[sync] entering capabilities.sync
[sync] tools=3 errors=0
[sync] mcp catalog servers=3 notes=["MCP「智能问数」是 legacy SSE 连接…","MCP「自动生成报告」是 legacy SSE 连接…"]
[sync] mcp rows to write=1 file=<dev home>/profiles/desktop/cordis.patch.yml
[sync] mcp rows written=1
```
- 写行逻辑正确：catalog 3 个里只有 1 个可 streamable → 写 1 行，**且那行就是当前 org 的服务器**（serverName `nexusai-test-yhzc63`，url 指向 org 自己的 bff `221.226.155.134:8081`）——我此前把这条当成"残留的旧行"，其实是当前数据
- 另外两个「创建 MCP」（智能问数、自动生成报告）是 **legacy SSE**（detail 里 streamableUrl 为空），所以按设计只展示不注册；之前的 `Array.isArray` → `isSeq` 修复本身是**有效**的（当时确实堆了 231 行，修完收敛），但"行没写进去"的现象不存在
- 结论：**没有 bug**；当前 agent 侧只能用到 1 个 NexusAI MCP 服务器的工具，剩下的（2 个创建 + 若干导入）都是 SSE，要真正可用需要 SSE 桥接（P1 待办项）

## 决策记录：发行版本暂缓（2026-10-08）
用户拍板：**先开发功能，发行版/产品化暂缓**。已完成的准备工作保留、不继续推进：
- `dist/windows-trial/`（Windows 试用包：一键 dev 接线脚本 + 离线插件包 + 配置片段 + 说明）——随时可拿去用，未实测 PowerShell
- 产品化路线结论（待重启时直接照用）：推荐**薄载体 + 插件**（照 workdsh 骨架，但只保留最小步骤，产物目标 ~500MB 而非 1.7GB），第一步永远是「插件自带 `dsh.bundle.patch` + 配置表单」；Windows 包必须有 Windows 构建机或 CI windows runner（dsh 打包预检要 VS C++ 工具链）；签名/公证、更新通道待定
- workdsh 的 Windows 安装包已下到 `~/Downloads/WorkDSH-2.0.6-alpha.5-x64-Setup.exe`（436MB，SHA256 与官方 SHA256SUMS 一致），可作产品形态对照

## Windows 试用包（2026-10-08，`dist/windows-trial/`）
目标：在别人的 Windows 机器上体验当前功能，且本机（macOS）**无法交叉构建** Windows 安装包——dsh 的打包脚本硬性要求原生宿主：`desktop package: win-x64 requires a Windows x64 build host`（`apps/desktop/scripts/package-target.ts:179-181`），并且 Windows 打包预检还要求 **Visual Studio C++ Build Tools**（`desktop-toolchain-preflight.ts` 用 vswhere 校验 `Microsoft.VisualStudio.Component.VC.Tools.x86.x64`，用于编译安装器助手）。GitHub release 也没有官方安装包（`assets: []`），`download.deepseek.com/dsh-desk/**` 探测 404。

因此走**最轻路线：Windows 上跑 dev 环境**（不需要 VS 工具链），并把接线全部脚本化：
- `dist/windows-trial/setup-windows-dev.ps1`（幂等）：检查 node≥22/git → `corepack enable` → 克隆 dsh 并 `git checkout dsh-v0.2.0-rc.2` → `pnpm install` → 首次启动一次生成 `.desktop-build\development` → 把 `plugin-offline.zip` 解到 dev 工程 `node_modules\` → 把配置行追加到 dev home 的 `profiles\desktop\cordis.patch.yml`
- `dist/windows-trial/plugin-offline.zip`（550KB）：插件本体（`lib/index.js` + `lib/client.js` + package.json）**加上它的两个纯 JS 依赖 `yaml`/`fflate`**，离线可用（已在本机验证该布局下 `yaml`/`fflate` 可被解析）
- `dist/windows-trial/nexusai.patch.yml`：`ui-settings-account: disabled` + `nexusai` 插入行（baseUrl = 生产地址、AES key/iv 取当前 dev home 值）；已用 yaml 解析器校验（0 error，2 行，baseUrl 正确），且与 ps1 里「去注释行」的处理一致
- `dist/windows-trial/toby-dsh-plugin-nexusai-0.1.0.tgz`：另一条路线用（安装打包好的 dsh 后，从「插件」页安装本地 tgz —— dsh 插件管理器接受 registry/本地路径/tgz/git 四种来源）
- `dist/windows-trial/README-WINDOWS.md`：两条路线的逐步说明 + 排错表 + 限制（窗口脚本是 macOS 专属、插件在 Windows 的行为未实测、未签名安装会被 SmartScreen 拦、AES key 随包分发说明）

**未验证项（如实标注）**：PowerShell 脚本本机无 pwsh，未做语法校验（逻辑与 macOS 的 `install-into-dsh.mjs` 同构、幂等、报错即停）；插件在 Windows 的实际运行未测（路径拼接用 `node:path`，SKILL.md→SKILL.md.disabled 的启用/关闭在 NTFS 同样成立）。

## 红线与坑（务必遵守）
1. **不改 dsh 源码**；配置只进 dev home 的 `cordis.patch.yml`。**应用运行时会改写该文件**——要手工改先停应用，否则会被覆盖
2. **宿主 `deepseek-account` 行永远不禁用**（欢迎窗 RPC 硬依赖，禁用=启动 fatal）
3. 改 client/src/patch 后必须重启桌面；**不要 Page.reload**（会搞挂宿主）
4. **esbuild 会重命名宿主 Remote 方法的参数**（与外层标识符冲突时）→ Typert 按编译后签名校验，报 `args fields do not match the descriptor`；改参数后核对 `lib/index.js`
5. **React 列表 key 必须唯一**：上游「天然主键」不可想当然（SkillHub 的 `publicSlug` 一页里就有重复，导致替换列表时旧节点残留 → 表现为「筛选失效」）
6. **外部接口空值不能只判 undefined/''**：JSON `null` 与字面量 `"null"` 都出现过（图标裂图）
7. **yaml 库解析结果是节点类型**（`YAMLSeq`/`YAMLMap`），判断集合要用 `isSeq/isMap`，`Array.isArray` 永远 false（曾导致 MCP 行重复堆积 77 份）
8. **注册表对文件变更的响应**：改名（SKILL.md ↔ .disabled）会刷新目录；**删除整个目录不会**——列表另用 `missingLocalSkills(paths)` 按磁盘核对，别指望目录接口
9. **dsh mcp-client 只支持 stdio / streamable-http**：legacy SSE（`event: endpoint` 握手）无法接入
10. 验证码 60s 有效；换 base url 后旧 token 对新服务器无效（401 自动登出）
11. 本机环境：**WorkBuddy 常驻占用 9222** → dsh 用 `DSH_DESKTOP_RENDERER_DEBUG_PORT=9223` 启动，验证脚本读 `DSH_CDP_PORT`；被强杀的实例会留下 `electron-user-data/Singleton*` 导致新实例秒退（删掉即可）；`pkill -9 -f "Harness Dev.app"` + `pkill -9 -f dsh-desktop-host` 清干净再起
12. 截屏看用户的 WorkBuddy 需要 macOS 屏幕录制权限（已开）：`screencapture -x /tmp/x.png` + `osascript -e 'tell application "WorkBuddy" to activate'`
13. typecheck 依赖 `node_modules/@deepseek-ai` symlink → dsh 的 project node_modules（`npm install` 后需重建）；升级 dsh 后跑 `npm run check:dsh` + tsc + CDP 回归并更新 `dshBaseline`

## 桌面窗口位置（启动即居中）
dsh 的窗口在**自己的源码里**创建（`apps/desktop/src/main.ts` `createWindow`：`width:1280, height:820`，**没有 x/y**），dev 启动脚本也不传位置；它既不保存窗口 frame，也没有几何配置（只有 Windows 签名的环境变量）。所以位置由 macOS/Electron 的默认规则决定，实测这台机器（屏幕 1512×982、菜单栏占 34px、工作区 34→908 共 874 高、Dock 顶 ≈908）：
- **原生启动 = (116, 34)**：水平方向**正好居中**（(1512-1280)/2 = 116），垂直方向**贴住工作区顶部**（菜单栏下沿 34）——这就是"居上对齐"的来源
- 原因：窗口高 820 已占工作区 874 的 94%，顶部对齐后底部只剩 ~54px 余量，视觉上非常明显
- （早先另一次测量读到过 (144, 87)，说明 macOS 对无位置窗口偶尔会带一点级联偏移，但"贴顶"是常态）

**不动 dsh 源码的解法**（本仓库内，两个新脚本，启动时自动摆位）：
- 摆位模式（`DSH_WINDOW_PLACEMENT`）：

  | 模式 | 效果 | 实测落点 |
  |---|---|---|
  | `center`（默认） | 工作区内垂直+水平居中 | (116, 61) —— 上下各 27px 留白 |
  | `bottom` | 贴住 Dock | (116, 88) |
  | `keep` | 保持 macOS 默认（贴工作区顶部） | (116, 34) |
- 工作区几何**从应用渲染进程读**（CDP `screen.availTop/availBottom` 等，实测 (0,34) 1512×874），所以菜单栏与 Dock 的占位都被算进去，落点是像素级准确；CDP 不可用时退回 Finder 的全屏 bounds
- 用法：`DSH_WINDOW_PLACEMENT=bottom scripts/dev/start-desktop.sh`；对运行中的窗口也可直接 `node scripts/dev/center-window.mjs --mode center|bottom|keep`，另有 `--top N` 精确指定、`--window "<标题>"` 换目标、`--probe` 只读位置
- **包装脚本支持换启动命令**：`DSH_START_SCRIPT=dev:desktop scripts/dev/start-desktop.sh`（默认 `start:desktop`，`dev:desktop` 会先 build）——用户若习惯 `pnpm run dev:desktop`，用这个就不会漏掉摆位
- **不想改启动习惯**：`scripts/dev/watch-window.sh [center|bottom]` 守候进程——由它盯窗口：每次应用启动、窗口首次出现时摆一次位，之后不再干预（手动拖动不会被抢回；窗口关闭后再次启动会再摆一次）。实测：用 **plain `pnpm run start:desktop`**（不经包装脚本）启动，守候进程日志 `window placed (center)`，窗口落在 (116,61) 工作区正中
- 端口自动发现：脚本会依次尝试 9222/9223/9224/9225/9231 找 `dsh-app` 页面（dsh 的 inspector 端口会变，且 9222 常被 WorkBuddy 占用），因此守候进程无需端口环境变量
- `scripts/dev/center-window.mjs`：用 AppleScript（System Events）摆位（默认工作区居中）；**按窗口标题匹配**而不是进程名——本机同时有 WorkBuddy（process `Electron`，窗口 `WorkDSH`）在跑，按进程名会动错窗口；每次 osascript 调用带 15s 超时（System Events 在应用启动期会挂住）；`--top N` 可改为贴某一行，`--window "<标题>"` 可换目标
- `scripts/dev/start-desktop.sh`：启动桌面端（`DSH_REPO`、`DSH_DESKTOP_RENDERER_DEBUG_PORT` 可覆盖），窗口出现后循环调用上面的单发模式居中（最多 60 次/每次间隔 3s），日志打印 `window centered`
- 迁移要求：移动别的应用的窗口需要**辅助功能（Accessibility）权限**——已确认当前终端可用（早先报 `-1719 not allowed assistive access`，后来可用了）。若权限被关，脚本会打印提示而不会静默失败
- 真机验证：窗口从 (600,200) 被脚本移到 (116,81)（正中）；把窗口故意放到 (500,300) 后跑包装脚本的循环 → 输出 `window centered`、终位 (116,81)；截图确认四周留白均匀
- ⚠️ 探测期间误把 WorkBuddy 的窗口移动过一次（按进程名匹配到了它），已按原位置 (36,34) 还原
- 若要在应用内部彻底解决（持久、免权限），只能改 dsh 源码加 `center: true`（1 行）——违反本项目"不改 dsh 源码"的红线，等用户拍板

## 验证操作手册
```bash
# 起桌面端（注意调试端口，9222 可能被 WorkBuddy 占用）
cd /Users/toby/IdeaProjects/deepseek-harness && DSH_DESKTOP_RENDERER_DEBUG_PORT=9223 pnpm run start:desktop
# 驱动/检查运行中的页面（自动找 dsh-app 目标）
cd /Users/toby/GoLandProjects/nexusai-harness && DSH_CDP_PORT=9223 node scripts/verify/cdp-eval.mjs "<js表达式>"
# 构建与静态检查
node scripts/build.mjs && npx tsc --noEmit && npm run check:dsh
```
查看 patch 行：`~/.desktop-build/development/home/profiles/desktop/cordis.patch.yml`（实际路径 `apps/desktop/.desktop-build/development/home/...`）；凭据：同目录 `.credentials.yaml`（`nexusai/session` = token，`nexusai/endpoint` = base url）。

## 待办（2026-10-08 用户指示：**全部暂缓**，等通知再继续）
> 用户明确"先开发功能，发行版本暂缓"，随后"这几个任务也暂缓" —— 下面每一项都保持现状、不动手；恢复时按本表顺序即可。

| 优先级 | 任务 | 状态 |
|--------|------|------|
| 暂缓 | **SSE 桥接的凭据跟进**：智能问数的工具需要有效 `token` 参数（实测远端返回 `403 Could not validate credentials`）；可选做法：② 看服务端能否用 `mcp_start`（用户名/密码换 token）；② 插件侧允许配置默认 token；③ 或依赖用户在会话里显式给 token | ⏸ 已暂缓 |
| 暂缓 | **agent 实调 NexusAI 自定义工具**（custom tools 侧的同类联调；MCP 侧已在 2026-10-08 用真实 agent 调用验证过链路） | ⏸ 已暂缓 |
| 暂缓 | 远程技能下载（NexusAI 目录）实测端到端 | ⏸ 已暂缓 |
| 暂缓 | **发行版/产品化**：薄载体（自有 Electron 壳 250 行 + 构建期组装 profile + electron-builder；macOS 本机出、Windows 走 CI windows runner）+ 插件自带 `dsh.bundle.patch` 与配置表单；产物目标 ~500MB；品牌 NexusAgent Builder、占位图标、不签名、窗口默认居中。方案与 workdsh 借鉴点见本文件「决策记录」与「Windows 试用包」两节 | ⏸ 已暂缓 |
| 暂缓 | Windows 试用包实测（`dist/windows-trial/` 里的一键脚本 + 离线包 + 说明；PowerShell 未做语法校验） | ⏸ 已暂缓 |
| 杂 | 「删除技能」是否改为移入废纸篓（当前二次确认后直接删目录） | ⏸ 已暂缓 |
| 杂 | package.json `types` 指向不存在的 d.ts（补产出或删字段） | ⏸ 已暂缓 |
| 可选 | 需要强登录门槛时：shell.overlay 全屏拦截层（未实施） | ⏸ 已暂缓 |

### 本轮调试留下的清洁项
- 测试用的临时技能（`zz-scratch-skill`、`mm-scratch-skill`、`aa-delete-target`、`zz-bystander`）均已删除；被误删的 `indiv-ebandao-dev-expert` 已从 SkillHub 重新安装
- 代码内无遗留 `TEMP-DEBUG` 日志（已 grep 确认）；`src/sync/mcp-rows.ts` 的重复行已收敛