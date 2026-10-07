# HANDOFF — 交接摘要（2026-10-07 · 全量重写）

## 一句话现状
NexusAI 桌面插件（`@toby/dsh-plugin-nexusai`）已把登录、能力同步与「专家 · 技能 · 连接器」工作台全部跑通并逐一真机验证：NexusAI 登录替换了 dsh 内置账号 UI（左下角同一位置）、品牌名与来源计数全部接口驱动、技能页含 本地/SkillHub/远程 三来源（本地可启用关闭、SkillHub 可搜索/翻页/看详情/真安装）、连接器已补齐「创建 + 导入」两套 MCP。tsc 0 错误，dsh 基线 0.2.0-rc.2。剩余：agent 实调联调（P2）、导入 MCP 的 SSE 接入方式待拍板。

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
- **侧栏一级「专家 · 技能 · 连接器」**：`sidebar.panellist` 图标行 + `main` 键控面板（`NexusaiWorkbench.tsx`）。能力标签行：`专家 (11)` / `技能 (N)` / `连接器 (5)`，技能页右端常驻搜索框 + `已安装(21)` + `＋添加技能`
  - **专家** = NexusAI 自定义工具卡片（首字母头像 + 名称 + 描述）
  - **技能** 三来源：
    - **本地** = 对话「/」菜单同源目录（`remote.skills.list`，与斜杠菜单同一 Remote/过滤）＋ 已关闭项；每卡片：开关（启用/关闭）+「…」（查看技能内容 / 复制路径 / 删除技能-二次确认）；内置技能（无文件）无开关与菜单
    - **SkillHub** = 腾讯市场：搜索 / 14 个分类芯片（左右箭头翻页）/ 无限滚动 / 卡片（图标·名称·单行描述·⚡下载·☆收藏·＋安装或绿色「已安装」）；点卡片进详情（预览|源码）
    - **远程获取 · <品牌>** = NexusAI 目录（下载 SKILL.md 到本地技能根）
  - **连接器** = 创建 MCP + 导入 MCP 卡片（来源 + 工具数；legacy SSE 的带「SSE 未接入」标记）
- **左下角 NexusAI 账号按钮**（`settings.launcher`，priority -1 遮蔽内置，内置行保留作崩溃兜底）：未登录=单击直接开登录弹窗；已登录=头像+用户名 → 菜单（打开设置 / 同步能力 / 登出）
- **登录弹窗**：打开即自动取验证码；动态品牌（`{tab.title}`）；服务器地址（裸 origin + 「应用」按钮：脏值才可点 → 连通性测试转圈 → 通过才持久化）；空字段抖动校验；错误提示在表单下方（不遮输入框）；失败自动重发且**保留密码**；取消=一步关闭
- **设置 → NexusAI 分区**：组织选择器 / 同步 / 登出；未登录显示登录入口
- **内置 DeepSeek 账号 UI 已隐藏**：`cordis.patch.yml` 禁 `ui-settings-account`（客户端行安全；**宿主 `deepseek-account` 行绝不可禁**）

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

## 待办
| 优先级 | 任务 | 状态 |
|--------|------|------|
| P1 | **导入 MCP 接入方式待拍板**：① 服务端提供 streamable 端点（我们已支持自动写行）② 插件内实现 SSE MCP 客户端（握手→initialize→tools/list→tools/call）把远端工具注册成 dsh 工具 | ⬜ 等用户决定 |
| P2 | agent 实际调用联调：会话里让 agent 调一个同步来的 custom tool / MCP 工具，验证 schema 与执行链路 | ⬜ |
| P2 | 远程技能下载（NexusAI 目录）实测端到端 | ⬜ |
| 杂 | 「删除技能」是否改为移入废纸篓（当前二次确认后直接删目录） | ⬜ 等用户偏好 |
| 杂 | package.json `types` 指向不存在的 d.ts（补产出或删字段） | ⬜ |
| 可选 | 需要强登录门槛时：shell.overlay 全屏拦截层（未实施） | ⬜ |
| 产品化 | 分发时引入 workdsh 式载体（自有 Electron 壳 + profile 组装 + 打包管线；插件代码零重写，估算 3-5 天）；触发条件 = 要打包 NexusAI 品牌安装包 / 原生层定制 / 脱离官方 dsh 交付 | ⬜ 触发条件未到 |

### 本轮调试留下的清洁项
- 测试用的临时技能（`zz-scratch-skill`、`mm-scratch-skill`、`aa-delete-target`、`zz-bystander`）均已删除；被误删的 `indiv-ebandao-dev-expert` 已从 SkillHub 重新安装
- 代码内无遗留 `TEMP-DEBUG` 日志（已 grep 确认）；`src/sync/mcp-rows.ts` 的重复行已收敛