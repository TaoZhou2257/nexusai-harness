# HANDOFF — 交接摘要（2026-09-30 · 全量重写）

## 一句话现状
NexusAI 登录已完整替换 dsh 内置登录，登录弹窗交互已打磨成熟（直连弹窗、服务器地址可配置+连通测试、空字段校验、失败自动重试、错误提示不遮挡），全部真机验证通过；构建通过、tsc 0 错误。剩余：agent 实际调用同步工具的联调（P2）、skills 下载实测、SSE 适配（P3）。

## 功能形态（用户视角，全部已真机验证）
- **左下角 NexusAI 账号按钮**（`settings.launcher`，priority -1 遮蔽内置，内置行保留作崩溃兜底）：
  - 未登录：显示「登录」，**单击直接弹出验证码登录界面**（无菜单、无中间按钮）
  - 已登录：头像+用户名，菜单 = 打开设置 / 同步能力 / 登出
- **登录弹窗**（Modal，官方规格样式 + 注入 CSS）：
  - 打开即自动发起登录、验证码直接出现；登录成功自动关闭；「取消登录」= 撤销+关闭一步
  - **服务器地址**（用户名上方一行）：只填裸 origin（如 `http://agent.nexusai.net.cn:8081`），nginx 前缀 `/service/api` 由插件内部拼接（`api-client` 的 `API_PREFIX`）；右侧「应用」按钮悬浮在输入框内右端（与用户名框右缘对齐），**值与已生效值不同才可点**；点击先**连通性测试**（`testBaseUrl` Remote 探测 captcha 端点，6s 超时、不动当前生效地址；按钮转圈特效）→ 通过才应用并持久化（绿框「已连通，验证码已更新」）→ 失败红字且不应用不保存（短文案：HTTP 状态/连接超时/无法连接/格式非法）
  - **空字段校验**：点登录时用户名/密码/验证码任一为空 → 该字段红框 + 左右抖动特效（交替类名可重触发，尊重 prefers-reduced-motion），**请求不发出**；输入即清除
  - **验证码行**：盾牌图标（`IconShieldOutlineRegular`）输入框（占位符「验证码」）+ 右侧 100x48 验证码图片（object-fit fill、圆角），**点击图片刷新**
  - **错误凭据反馈**：`decode()` 对任何状态码都先解析 bff envelope，业务消息优先显示（如「验证码错误，请重新输入」；gin 对参数/解密失败返回 400+envelope，此前丢 body 导致误导性「HTTP 400 请检查服务器地址」）；完整请求 URL 记宿主日志排障
  - **错误提示位置**：统一在**表单下方、操作按钮上方**，输入框永远在顶部不被遮挡；内容区 `min-height:0;flex:1` 可滚动
  - **失败自动重发**：attempt failed → 自动重新发起（同一 attempt 只重试一次 + 5s 节流防死循环），新验证码自动出现、表单原地恢复；**密码保留**（只清验证码框）；失败消息本地保留显示直到登录成功
  - 弹窗内含「打开设置」链接——未登录时唯一设置入口
- **设置 → NexusAI 分区**：能力控制台（自定义工具 11 / MCP 服务 3 / 技能 1、组织选择器、同步、登出）；未登录显示提示+登录按钮
- **内置 DeepSeek 账号 UI 已隐藏**：cordis.patch.yml 禁用 `ui-settings-account`（纯 UI 行）；侧栏原「NexusAI 登录」入口与主面板已移除

## 已验证的关键事实
- 登录成功（用户实测 admin）：`nexusai/session` GrantRecord 落盘官方凭据库、11 工具注册、MCP 行写入 profile patch、重启自动恢复会话
- base url 覆盖值持久化 `nexusai/endpoint`（重启保留，优先于 patch 配置默认值；旧带前缀值自动归一）
- 首次启动路径：原生欢迎窗未受影响（无 DeepSeek 登录且无任何 API key 才出现）；NexusAI 登录当前**不是**工作区门槛（如需强拦可做 shell.overlay 拦截层，未实施）
- NexusAI 服务端约束：captcha 强制无绕过；OIDC 不可用；错误走 200 或 400 envelope，msg 带真实原因

## 架构（官方范式，仿内置 PlatformAccount）
| 环节 | 实现 |
|---|---|
| 授权 flow | `NexusaiAuthService` 注册 `ctx.authorization.registerFlow`（key `nexusai/session`），flow：captcha→等提交→bff login→`session.commit(grant)` |
| 尝试状态机 | initializing/waiting-input/verifying/committing/succeeded/cancelled/failed，经 `@Remote({mode:'stream'}) watch` 下发 |
| 凭据 | flow 是唯一提交者（nexusai/session）；nexusai/endpoint 存 base url 覆盖值 |
| 客户端 | mount/consumer 双 fiber（顶层只 inject 基础服务并 $mount，`ctx.plugin({inject:['remote.nexusaiAuth',...]})` 起消费者注册 UI——否则自锁）|
| 状态共享 | 一条 watch 流 → 共享快照 store → `useNexusai(selector)` 合成 hook，三个表面共用 |
| 槽位 | `settings.launcher`（priority -1）+ `settings.section`（id nexusai, order 10）|

## 文件地图
```
src/                       宿主半
  index.ts                 apply：装配 + inject ['credentials','tools','authorization']
  service/auth.ts          登录服务：flow + 状态机 + watch + getBaseUrl/setBaseUrl/testBaseUrl
  service/capabilities.ts  能力 Remote（list/sync/downloadSkill）
  sync/endpoint-store.ts   base url 覆盖值持久化（nexusai/endpoint）
  sync/session-store.ts    会话读写（nexusai/session）
  sync/{custom-tools,mcp-rows,skills}.ts   能力同步
  nexus/api-client.ts      bff 客户端：可变 base、/service/api 内嵌拼接（API_PREFIX）、
                           normalizeBaseUrl（校验+剥旧前缀）、decode()（envelope 优先+日志）、
                           testBaseUrl（连通探测）
client/                    浏览器半
  index.ts                 双 fiber + 共享快照 store + 槽位注册
  face.ts                  共享 DTO/inject face/unwrap
  NexusaiLauncher.tsx      左下角按钮+菜单（未登录=直接开弹窗）
  NexusaiSignInDialog.tsx  登录弹窗（服务器字段+应用按钮+连通测试；空字段校验+抖动；
                           错误提示在表单下方；失败自动重发；密码保留）
  NexusaiSection.tsx       设置分区控制台
  remote.ts / locales.ts   Typert 描述符（15 条）/ zh-en 字典
scripts/build.mjs          esbuild 双产物（host ESM external @deepseek-ai/*；client CJS 包 ModuleLoader）
```

## 红线与坑（务必遵守）
1. **不改 dsh 源码**；配置只进 dev home 的 cordis.patch.yml（应用运行时会重写该文件格式，改前先停应用）
2. **宿主 `deepseek-account` 行永远不禁用**——原生欢迎窗 RPC 硬依赖，禁用=启动 fatal（禁 `ui-settings-account` 客户端行是安全的）
3. 改 client.js / src/ / cordis.patch.yml 后必须**重启桌面进程**；整页 Page.reload 会搞挂宿主
4. 杀进程用 `pkill -f "Harness Dev.app"`（只杀 tsx 会留孤儿 Electron 占端口）
5. typecheck 依赖 `node_modules/@deepseek-ai` symlink → dsh 的 project node_modules（npm install 后需重建；构建不需要）
6. dsh 基线 **0.1.7-rc.1**（developer preview）：升级时槽位/原语变化 → tsc 报错（当前 0 错误基线）；禁用行 id 失配 → 内置 UI 自动恢复（可见、非致命）
7. 验证码 60s 有效；换服务器地址后自动从新地址拉取；旧服务器 token 对新服务器无效（401 自动登出）

## 验证操作手册
```bash
cd /Users/toby/IdeaProjects/deepseek-harness && pnpm run start:desktop
# 日志给出：CDP 端口 renderer=9222 / host=9230、带 token 的 web URL
curl -s http://127.0.0.1:9222/json/list     # 取 dsh-app 页面 target id
node /tmp/nexusai-cdp.mjs <targetId> "<js>"  # CDP 驱动/检查（/tmp/nexusai-*.mjs 一组现成脚本）
# 构建与检查（项目根）
node scripts/build.mjs && npx tsc -p tsconfig.json --noEmit
```

## 待办
| 优先级 | 任务 | 状态 |
|--------|------|------|
| P2 | **agent 实际调用联调**：会话里让 agent 调一个同步来的 custom tool / MCP 工具，验证参数 schema 与执行链路 | ⬜ |
| P2 | skills 下载实测 | ⬜ |
| P3 | SSE 协议适配 | ⬜ |
| 杂 | package.json `types` 指向不存在的 d.ts（补产出或删字段） | ⬜ |
| 可选 | 需要强登录门槛时的方案：shell.overlay 全屏拦截层（未实施） | ⬜ |
