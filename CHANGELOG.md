# 中文更新记录

发布前，在 `## v版本号` 二级标题下记录当版的新增功能、改进与修复。Windows CI 准备发布草稿时，会把对应版本的中文正文写入 GitHub Release。

## v0.1.1

Pilot 的首个公开正式版，提供 Windows x64 安装包。

### 对话与工作目录

- 支持流式对话、Markdown 和历史会话。长对话左侧的刻度会随滚动高亮可见消息，也可以点击刻度跳转。
- Agent 可更新任务步骤，重新打开原会话后可继续查看计划。
- 可以选择工作目录和 PowerShell 或 Git Bash 环境。Agent 可在工作目录中搜索、读取和编辑文件，写入和命令执行按所选模式审批。

### 模型与扩展

- 首次启动可直接选择内置演示模型，也可配置 Anthropic 或 OpenAI 兼容服务。支持切换简体中文和 English，并记住语言选择。
- 在「设置 → 导入」预览来自 Codex 或 Claude Code 的技能、MCP 服务及插件中可用的组件。勾选并确认后，只导入选中的项目。
- 可分别启停技能和 MCP 服务。支持 stdio 与 Streamable HTTP MCP 服务，其工具调用遵循 Pilot 的审批设置。

### 安装与更新

- 可在「帮助 → 关于 Pilot」检查更新，由用户确认后退出并安装。
- Windows CI 已验证全新安装和卸载，并通过正式 HTTPS 更新源完成兼容旧版升级。重启后验证了会话、权限模式、语言和已启用技能的恢复。[Windows 升级验收](https://github.com/Murmureeee/Pilot/actions/runs/44561428215)

[查看本版本的提交记录](https://github.com/Murmureeee/Pilot/commits/v0.1.1)
