# DECISIONS — 已确认决策

## 已拍板
| 项 | 决策 |
|---|---|
| 底座 | 直接押注 dsh（不加隔离层） |
| 客户端 | dsh Electron 桌面端 |
| 模型 | 双轨：本地/自定义 OpenAI 兼容 + NexusAI 纳管(/callback/...) |
| NexusAI 接入 | 同用户登录，用内部 /v1 JWT API 动态同步能力，登出卸载 |

## 2026-09-29 拍板（三项待定）
| 项 | 决策 |
|---|---|
| Skill 处理 | 列表呈现 NexusAI skills，用户自选下载 SKILL.md 到本地（方案 A 的用户主动版） |
| 登录方式 | ~~复用提供给 web 端的登录接口~~ → 演进为下条（登录架构重定） |
| MVP 范围 | 先打通「调用 nexusai-server 的工具和 MCP」；skills 下载为其次，agent/workflow 延后 |

## 2026-09-29 晚拍板（登录架构重定）
| 项 | 决策 |
|---|---|
| 登录架构 | 按 dsh 官方范式：`ctx.authorization.registerFlow`（key `nexusai/session`）+ `session.commit` 写 grant 记录 + 自有 watch 流下发尝试状态（仿内置 PlatformAccount；不再自造登录面板协议） |
| 登录协议 | 保持 bff captcha+账号密码（服务端 captcha 强制无开关；OIDC 不可行：oauth.switch 默认关、authorize 需已有 web 会话 JWT、confidential client + 精确 redirect_uri） |
| dsh 原有登录 | 不需要保持兼容；本轮不动内置 deepseek-account 行（禁用会打断 accountController 与欢迎窗，收益低），后续可 shadow 其 UI 槽位 |
| 基线版本 | 插件针对 dsh **0.1.7-rc.1** 开发（developer preview，升级需重核签名） |

## 架构
Electron → dsh 插件树（本地能力 + 模型双轨 + @xxx/dsh-plugin-nexusai）→ NexusAI(可选)

## 能力缺口（dsh 缺、NexusAI 补）
- 可视化工作流（dsh 的 workflow 是模型脚本编排，非画布）
- 企业级知识库/RAG
- Skills 对外暴露（NexusAI skill 带 markdown，可 /v1 拉取）

## 待定
（无 — 2026-09-29 已全部拍板，见上）
