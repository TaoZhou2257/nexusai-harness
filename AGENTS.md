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

## 推送与构建（用户明确要求，务必遵守）
- **功能开发完不要自动 `git push`，也不要自动触发 CI 构建**：`git push github` 会跑两个平台的构建
  + 验收闸（每次约 20 分钟额度）。**每次推送/构建前先问用户**，得到同意再推。
- 本地提交、本地验证（`tsc` / `build.mjs` / 两个 verify 套件 / 本机 `scripts/ci/*`）可以直接做，
  不受此限 —— 需要问的只有"推到远端触发 CI"这一步。
- 用户说"可以推"时按当时的分支与 tag 意图推；一次授权只对应一次推送。

## 交接要求
- 每次切换工具前更新 HANDOFF.md（改了哪些文件、卡在哪、下一步）。
