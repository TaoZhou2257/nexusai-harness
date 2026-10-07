# 真机验证脚本

对**运行中的 dsh 桌面端**做 CDP 驱动/检查（不需要模拟环境）。启动桌面端后使用：

```bash
# 1. 启动（dsh 仓库根；日志会打印 CDP 端口 renderer=9222 和带 token 的 web URL）
cd /Users/toby/IdeaProjects/deepseek-harness && pnpm run start:desktop

# 2. 取 dsh-app 页面的 CDP target id
curl -s http://127.0.0.1:9222/json/list

# 3. 驱动/检查（默认自动找 dsh-app 页面）
node scripts/verify/cdp-eval.mjs "(() => document.title)()"
```

## 常用片段

```js
// 侧栏是否有 NexusAI 入口
document.body.innerText.includes('NexusAI')

// 打开 NexusAI 面板（未登录=直接弹登录界面；已登录=菜单）
document.querySelector('[data-slot="settings.launcher"] button').click()

// 当前弹窗内容
[...document.querySelectorAll('[role=dialog]')].map(d => d.textContent.slice(0, 200))
```

## 注意

- 改 client.js / src/ / cordis.patch.yml 后必须**重启桌面进程**（整页 Page.reload 会搞挂宿主）
- 杀进程用 `pkill -f "Harness Dev.app"`（只杀 tsx 会留孤儿 Electron 占端口）
- 更多一次性验证脚本历史上在 `/tmp/nexusai-*.mjs`（弹窗流程、失败重试、布局测量等），可按需回填
