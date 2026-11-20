# Pilot

Pilot 是基于 pi 的桌面 AI 工作台。你可以从一次对话开始，让 Agent 与你一起处理工作目录中的文件和命令，并随时回到保存的会话继续工作。

[English](./README.en.md) · [下载最新版](https://github.com/Murmureeee/Pilot/releases/latest) · [中文更新记录](./CHANGELOG.md) · [开发计划](./PLAN.md)

## 下载与更新

当前提供 **Windows x64** 安装包。打开[最新正式版](https://github.com/Murmureeee/Pilot/releases/latest)，展开 **Assets** 并下载 `pi-desktop-<版本号>-x64-setup.exe`。每个发布页都附有当版的中文更新说明。

已安装 Pilot 时，可以从 **帮助 → 关于 Pilot** 检查更新。下载完成后，由你确认退出并安装。

## 开始使用

1. 首次打开时，选择内置演示模型体验对话，或配置 Anthropic / OpenAI 兼容服务与所用模型。
2. 在 **设置 → 常规** 中选择工作目录。需要 Agent 读写文件或运行命令时，可在对话中选择权限模式，并按提示审批。
3. 在 **设置 → 导入** 中预览 Codex 或 Claude Code 的技能、MCP 服务和插件组件，勾选所需项目后确认导入。

## 当前功能

- **会话与任务**。流式对话、Markdown、会话历史和可恢复的任务步骤。
- **文件与命令**。在选定目录内读取、搜索和编辑文件，使用 PowerShell 或 Git Bash 执行命令，并按权限模式处理审批。
- **技能与 MCP**。管理包含 `SKILL.md` 的本地技能，配置 stdio 或 Streamable HTTP MCP 服务，并导入外部插件中可用的技能和 MCP 配置。
- **个性化**。切换简体中文和 English、调整主题，设置全局自定义指令或单独修改某个会话的指令。

## 从源码运行

Windows 开发环境使用 Node.js 26 和 pnpm 11，具体版本见[构建工作流](./.github/workflows/windows.yml)。关闭正在运行的 Electron 开发实例，再在仓库根目录运行以下命令。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

构建可运行 `pnpm build`，生成 Windows 安装包可运行 `pnpm package:win`。本地模型验收、多语言和定时任务的进度见[开发计划](./PLAN.md)。
