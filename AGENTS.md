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
- **功能开发完不要自动 `git push`，也不要自动触发 CI 构建**：`git push github` 会跑双平台
  × 品牌的构建 + 验收闸（每次约 40 分钟额度）。**每次推送/构建前先问用户**，得到同意再推。
- **发版（打 tag 触发 Release）前，分两步问，两步都得到勾选后才能改 workflow、打 tag、推送。**
  先只问品牌。用户勾选之后，再单独问架构。不要把两题放进同一次提问。上次发了什么不算数。用户同一句话里已经写了品牌或架构，也不算确认。用 AskQuestion，不要改成口头列举。
  1. `brand`「这次发版打哪些品牌？」选项：`both` 全部都打（NexusAIHarness + `branding/` 下每一个客户目录，现在是审源润泽和赛孚唯）；`default` 只打 NexusAIHarness；再为每个客户目录各加一项（现在是 `syrz` 只打审源润泽，`isafeways` 只打赛孚唯）。以后 `branding/` 新增目录，选项跟着加。
  2. 品牌定了之后再问 `arch`「这次发版打哪些架构？」选项：`both` macOS arm64 和 Windows x64 都打；`win` 只打 Windows x64；`mac` 只打 macOS arm64。这一问对刚才选中的每个品牌都生效。
  按勾选改 `.github/workflows/build.yml` 的发版提交：没选的品牌从仍要跑的 job 的 `matrix.include` 删掉；没选的架构给那个 job 加 `if: false`，Release 的 `needs` 只留要跑的 job；没有 dmg 就只上传 exe，没有 exe 就只上传 dmg，发布说明只写这次真正有的安装包。全选则矩阵保持两品牌 × 两架构。tag 打在这份提交上。下一笔提交把 workflow 恢复成两品牌、两架构，提交说明含 `[skip ci]`。先推 tag，再推分支。一次确认只对应这一次 tag。
- 本地提交、本地验证（`tsc` / `build.mjs` / 两个 verify 套件 / 本机 `scripts/ci/*`）可以直接做，
  不受此限 —— 需要问的只有"推到远端触发 CI"这一步。
- 用户说"可以推"时按当时的分支与 tag 意图推；一次授权只对应一次推送。

## 交接要求
- 每次切换工具前更新 HANDOFF.md（改了哪些文件、卡在哪、下一步）。
