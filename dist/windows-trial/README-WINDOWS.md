# NexusAI 插件 —— Windows 试用包

目标：在一台 Windows 机器上把「当前功能」跑起来（侧栏一级工作台：专家 · 技能 · 连接器；NexusAI 登录替换官方账号 UI）。
**不需要**修改 dsh 源码；**不需要** Visual Studio C++ 工具链（那条是"打安装包"才需要的，见文末）。

---

## 包里有什么

| 文件 | 用途 |
|---|---|
| `setup-windows-dev.ps1` | 一键脚本：检查环境 → 拉取 dsh（锁定版本）→ 安装依赖 → 拷入插件 → 写好配置 |
| `plugin-offline.zip` | 插件本体 + 它的两个纯 JS 依赖（yaml、fflate），离线可用 |
| `nexusai.patch.yml` | 配置片段（服务器地址 + 登录解密密钥 + 隐藏官方账号 UI），脚本会自动写入；也可手工粘贴 |
| `toby-dsh-plugin-nexusai-0.1.0.tgz` | 插件包（另一条路线用：安装打包好的 dsh 应用后，从「插件」页安装） |
| `README-WINDOWS.md` | 本文件 |

---

## 路线 A（推荐，本次体验）：Windows 上跑 dev 环境

### 一次性准备（约 10 分钟 + 依赖下载时间）
1. 装 **Node.js 22 LTS**：`winget install OpenJS.NodeJS.LTS`（或官网 msi）
2. 装 **Git**：`winget install Git.Git`
3. 开 PowerShell，确认：`node -v`（应为 v22.x）、`git --version`
4. 启用 pnpm：`corepack enable`（Node 22 自带 corepack，pnpm 版本由 dsh 的 `packageManager: pnpm@11.7.0` 决定）

### 跑脚本（自动完成接线）
把本目录整个拷到 Windows 后：
```powershell
powershell -ExecutionPolicy Bypass -File .\setup-windows-dev.ps1
```
脚本做这些事（幂等，可重复跑）：
- 克隆 `deepseek-ai/deepseek-harness` 到 `%USERPROFILE%\dev\deepseek-harness`（默认路径，可用 `-DshRepo` 改），并 `git checkout dsh-v0.2.0-rc.2`
- `pnpm install`
- 首次启动一次桌面端以生成 `.desktop-build\development`（随后自动关掉）
- 把 `plugin-offline.zip` 解到该 dev 工程的 `node_modules\`（插件本体 + yaml + fflate）
- 把 `nexusai.patch.yml` 的两段配置追加到 dev home 的 `profiles\desktop\cordis.patch.yml` 末尾

### 启动并登录
```powershell
cd $env:USERPROFILE\dev\deepseek-harness
pnpm run dev:desktop
```
窗口起来后：**左下角点「登录」** → 填 NexusAI 账号 + 密码 + 验证码 → 侧栏出现「专家 · 技能 · 连接器」。

---

## 路线 B：用打包好的 dsh 应用（若是给同事的机器，更接近正式形态）
1. 在 **Windows** 上构建安装包（需 Visual Studio Build Tools，见文末"限制"）：
   ```powershell
   cd <dsh 检出>; pnpm run package:desktop:win:x64:unsigned
   ```
   产物在 `apps\desktop\.desktop-build\targets\...\*-unsigned.exe`
2. 安装并**启动一次**（会生成 `%USERPROFILE%\.dsh`），然后退出
3. 打开 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`，把 `nexusai.patch.yml` 的内容粘到末尾
4. 重启应用 → 侧栏「插件」页 → 安装 → 填 `toby-dsh-plugin-nexusai-0.1.0.tgz` 的**绝对路径** → 启用
5. 重启 → 左下角登录

---

## 排错

| 现象 | 处理 |
|---|---|
| 安装/运行被 SmartScreen 拦（未签名） | 「更多信息 → 仍要运行」 |
| 找不到 `.dsh` 目录 | 先启动一次应用；目录是 `%USERPROFILE%\.dsh`，若不存在看应用设置里的 data 目录 |
| 侧栏没有「专家 · 技能 · 连接器」 | 确认 patch 片段已写入且 YAML 解析没问题（缩进别弄坏）；重启应用 |
| 登录报「验证码错误」/ 无法连接 | 服务器地址默认 `http://agent.nexusai.net.cn:8081`；如换了部署，在登录界面顶部的「服务器地址」里改，点「应用」会先做连通性测试 |
| 「插件」页安装 tgz 失败（路线 B） | 回退：把 `plugin-offline.zip` 解到 `%USERPROFILE%\.dsh\profiles\desktop\`（覆盖同名目录），并在该 profile 的 `package.json` 里把 `@toby/dsh-plugin-nexusai` 加进 `dependencies`，然后重启 |
| 想换插件版本 | 重新 `npm pack` 出新 tgz，重复路线 B 第 4 步 |

## 限制与已知差异
- **macOS 专属**：窗口自动居中脚本（`scripts/dev/center-window.mjs` / `watch-window.sh`）用 AppleScript 实现，Windows 上不可用；Windows 窗口位置走系统默认。
- 插件在 Windows 上的行为**未经实测**（内部路径拼接用 `node:path`，理论上跨平台；`SKILL.md`→`SKILL.md.disabled` 的启用/关闭在 NTFS 上同样成立）。
- **打 Windows 安装包**需要：Node 22 + Git + **Visual Studio Build Tools（含 "使用 C++ 的桌面开发"，`Microsoft.VisualStudio.Component.VC.Tools.x86.x64`）** —— dsh 的打包预检会校验这个（编译安装器助手用），另外**只能在 Windows 机器上构建 Windows 包**（macOS 交叉构建会被 dsh 明确拒绝：`desktop package: win-x64 requires a Windows x64 build host`）。
- 密钥说明：`nexusai.patch.yml` 里带的是登录请求体的解密密钥（与服务端配置一致），随包分发；它**不是**你的账号凭据——登录 token 只存在本机。
- 正式产品化（自带运行时、装上即用、品牌 NexusAgent Builder、未签名安装包）是后续步骤，见 `HANDOFF.md` 的「产品化」一节。