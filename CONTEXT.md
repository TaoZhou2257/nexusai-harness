# CONTEXT — 项目地图

## 一句话
基于 DeepSeek Harness(dsh) 做一个 WorkBuddy 式本地桌面客户端，本地独立 agent + 可选接入 NexusAI 远程能力。

## 相关仓库
- 本项目：/Users/toby/GoLandProjects/nexusai-harness（客户端/插件代码）
- dsh 上游源码：/Users/toby/IdeaProjects/deepseek-harness（第三方，慎改）
- NexusAI 服务端：/Users/toby/GoLandProjects/nexusai-server（Go 微服务，只调其 API，不改）

## 技术栈
- 客户端：Node.js 22.19+/24+，pnpm 11.7，TypeScript，Cordis 插件框架，Electron 44
- dsh 核心：agent loop / tools / session / skill / mcp / workflow / computer-use / browser-use
- 服务端(NexusAI)：Go 微服务（bff/agent/mcp/assistant/knowledge/iam 等）

## 关键启动命令（dsh 仓库内）
- desktop: pnpm run start:desktop（dev home 在 apps/desktop/.desktop-build/development/home）
- web:     pnpm run start:web（普通 home ~/.dsh，与 desktop 隔离）

## dsh 扩展点（插件要用的）
- ctx.llm / ctx.tools / ctx.skills / ctx.agents / ctx.subagents
- sidebar.panellist（左侧导航）、sidebar.settings（设置区）、ConversationNodeDefinition（聊天节点）
- mcp-client（连外部 MCP）、skill-filesystem（扫描 <name>/SKILL.md）

## NexusAI 对外端点
- /v1/*（JWT 用户态）：agents/skills/mcp/workflow/knowledge/model
- /openapi/v1/mcp/server/{sse,message,streamable}（AppKey）
- /callback/v1/model/:modelId/chat/completions（OpenAI 兼容）
- /openapi/v1/oauth/*（OIDC 登录）
