# AGENTS — 执行规范

## 禁止改动范围（红线）
1. 不改 nexusai-server 任何代码（只通过其 REST API 调用）。
2. deepseek-harness 源码尽量不改；确需时只在 dev home 的 cordis.patch.yml 加配置，
   改 pnpm-workspace.yaml 等源码会与上游 git 冲突。
3. dsh 是 developer preview，API 会 breaking，插件要锁定 dsh 版本并记录。

## 编码约定
- 插件用 Cordis 范式：export function apply(ctx: Context)，注册用 ctx.effect（可撤销，登出即卸载）。
- 插件包名 @xxx/dsh-plugin-nexusai，遵循 dsh 的 package.json `dsh` 字段/profile 约定。
- 不在插件里写死密钥；凭据走 dsh credentials 机制。

## 测试/验证
- 每步改动后必须能在 desktop 跑通（pnpm run start:desktop）。
- NexusAI 接口先 curl 验证再接入。
- 国内网络：Electron/Chromium/Cua 二进制用镜像（ELECTRON_MIRROR / npmmirror / PLAYWRIGHT_DOWNLOAD_HOST）。

## 交接要求
- 每次切换工具前更新 HANDOFF.md（改了哪些文件、卡在哪、下一步）。
