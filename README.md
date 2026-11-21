# Pilot

Pilot 是基于 pi 的桌面 AI 工作台。你可以从一次对话开始，让 Agent 与你一起处理工作目录中的文件和命令，并随时回到保存的会话继续工作。

[English](./docs/README.en.md) · [下载最新版](https://github.com/Murmureeee/Pilot/releases/latest) · [中文更新记录](./CHANGELOG.md) · [开发路线图](./docs/PLAN.md) · [开发完成记录](./docs/DEVELOPMENT_HISTORY.md)

## 下载与更新

在最新正式版的 **Assets** 中按平台下载安装包。每个发布页都附有当版的中文更新说明。[最新正式版](https://github.com/Murmureeee/Pilot/releases/latest)

| 平台 | 发行文件 |
| --- | --- |
| Windows x64 | `pilot-<版本号>-x64-setup.exe` |
| Linux x64 | `pilot-<版本号>-linux-x86_64.AppImage` 或 `pilot-<版本号>-linux-amd64.deb` |

Linux 文件随启用该构建流程的正式版提供。AppImage 添加执行权限后运行。Debian、Ubuntu 及其衍生发行版可使用 `sudo apt install ./pilot-<版本号>-linux-amd64.deb` 安装。

Windows 安装版在启动后自动检查并下载更新，也可以从 **帮助 → 检查更新…** 手动检查。下载完成后，点击侧栏设置上方的更新图标即可安装并重新打开 Pilot。Linux 用户通过 Releases 下载新版。

## 开始使用

1. 首次打开时，选择内置演示模型体验对话，或配置 Anthropic / OpenAI 兼容服务与所用模型。
2. 在 **设置 → 常规** 中选择工作目录。需要 Agent 读写文件或运行命令时，可在对话中选择权限模式，并按提示审批。
3. 在 **设置 → 导入** 中预览 Codex 或 Claude Code 的技能、MCP 服务和插件组件，勾选所需项目后确认导入。

## 当前功能

- **会话与任务**。流式对话、Markdown、会话历史和可恢复的任务步骤。
- **文件与命令**。在选定目录内读取、搜索和编辑文件。Windows 支持 PowerShell 和 Git Bash，Linux 使用 Bash。工具调用按权限模式处理。
- **技能与 MCP**。管理包含 `SKILL.md` 的本地技能，配置 stdio 或 Streamable HTTP MCP 服务，并导入外部插件中可用的技能和 MCP 配置。
- **个性化**。切换简体中文和 English、调整主题，设置全局自定义指令或单独修改某个会话的指令。

## 从源码运行

开发环境使用 Node.js 26 和 pnpm 11。关闭正在运行的 Electron 开发实例，再在仓库根目录运行以下命令。[构建工作流](./.github/workflows/windows.yml)

```sh
pnpm install --frozen-lockfile
pnpm dev
```

运行 `pnpm build` 可构建应用。Windows 使用 `pnpm package:win` 制作安装包，Linux x64 使用 `pnpm package:linux` 生成 AppImage 和 `.deb`。[开发路线图](./docs/PLAN.md)
