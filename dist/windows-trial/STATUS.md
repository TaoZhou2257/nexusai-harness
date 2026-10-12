# 状态：Windows 试用包

## 完成✅

- 交付物 `dist/windows-trial/` 组装完成：
  - `setup-windows-dev.ps1` - 一键脚本，用于在 Windows 上快速设置开发环境
  - `plugin-offline.zip` - 插件本体 + 依赖 (yaml、fflate) 的离线包
  - `nexusai.patch.yml` - 配置片段 (NexusAI 服务地址 + 登录解密密钥 + 隐藏官方账号 UI)
  - `toby-dsh-plugin-nexusai-0.1.0.tgz` - 插件包 (可用于插件页安装)
  - `README-WINDOWS.md` - 完整操作手册，包括路线 A（开发环境）和路线 B（正式包安装），并包含排错指南

- HANDOFF.md 已经包含 Windows 试用包的部分
- 脚本和配置已过检查

## 不可完成 ❌

- **Windows 安装包** (`.exe` 文件) 无法构建，因为：
  1. dsh 的 Windows 打包脚本要求 `win-x64` 只能在 Windows 构建机上构建，运行时会抛出错误：`desktop package: win-x64 requires a Windows x64 build host`
  2. 构建 Windows 安装包还需要 Visual Studio Build Tools
  3. 交叉构建已在插件的 HANDOFF.md 中明确记录为无法实现

## 可以替代✅

### 路线 A（推荐，可直接在开发机运行）：
1. 在 Windows 上安装 Node.js 22 LTS、Git
2. 运行 `setup-windows-dev.ps1` 脚本，自动完成 dsh dev 环境的配置
3. 运行 `pnpm run dev:desktop` 启动应用
4. 登录 NexusAI，即可体验完整功能

### 路线 B（需最终用户打包）：
1. 可能最终用户已经拥有 dsh 桌面安装包（可能通过其他方式获取）
2. 使用现有的插件包和配置，直接安装
3. 所有配置和插件都已准备完毕

## 限制与注意事项

- 插件 Windows 行为未经实测（基于 node:path 路径处理、JavaScript 标准化保证，理论上跨平台适用）
- 窗口位置和摆放脚本 (center-window.mjs) 是 macOS 专属，Windows 上不适用
- `setup-windows-dev.ps1` 需要 Node.js 22 LTS + Git + corepack，这已经是现代 Windows 开发的标准环境

## 下一步（可选）

如果用户希望实现完整的 Windows 安装包：
1. 运行该脚本在 Windows 上构建 Windows 安装包 (需要 Visual Studio Build Tools)
2. 在 Visual Studio Build Tools 上使用 `pnpm run package:desktop:win:x64:unsigned` 构建 dsh 桌面应用
3. 使用提供的插件包和配置，完成 NexusAI 功能的完整部署

但如果用户只需要体验当前功能，路线 A 已经足够。推荐用户直接使用 `setup-windows-dev.ps1` 进行开发和测试。