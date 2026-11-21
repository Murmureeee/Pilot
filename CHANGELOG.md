# 中文更新记录

发布前，在 `## v版本号` 二级标题下记录当版的新增功能、改进与修复。Desktop CI 准备发布草稿时，会把对应版本的中文正文写入 GitHub Release。

## v0.2.1

- 修正 Windows 安装包的内部名称。新装默认使用 `%LOCALAPPDATA%\Programs\pilot`，程序文件名为 `pilot.exe`。
- 从旧版升级时，Pilot 会迁移旧的默认安装目录和用户配置，保留会话、设置、语言、主题和已启用的技能。通过应用内更新时，自定义安装位置会保留。
- Linux 的 Debian 包名统一为 `pilot`，可替换已安装的旧包。

已安装的 Windows 用户可在「帮助 → 关于 Pilot」检查更新。[下载 Windows x64 安装包](https://github.com/Murmureeee/Pilot/releases/download/v0.2.1/pilot-0.2.1-x64-setup.exe)

## v0.2.0

Pilot 现在可以在多个本地项目之间切换，并在重启后继续中断的任务。

### 项目与会话

- 从侧栏重新打开最近项目，按项目浏览会话。会话标题下显示工作目录，Git 项目还会显示当前分支。旧会话可从「未关联项目」打开并关联目录。
- 每个会话记住模型、权限模式和未发送的草稿。未单独设置的模型和权限沿用全局默认值。
- 文件引用和工具执行使用会话绑定的目录。会话标题旁的「指令」可查看加载的项目 `AGENTS.md`，以及它与会话指令和技能的优先顺序。

### 任务切换与恢复

- 切换会话时，原任务继续运行，进度、审批和结果留在发起任务的会话。可在其他会话编辑草稿，也可从输入区直接返回活动任务。
- 异常退出后，打开原会话并在「已中断」提示中选择「继续任务」。Pilot 会使用原工作目录、已保存的消息和工具结果接着处理。续跑会拦住已经开始执行的相同写入、编辑和命令。工具结果未保存时，会标为结果未知。

### 下载与更新

- 已安装的 Windows 用户可在「帮助 → 关于 Pilot」检查更新。[下载 Windows x64 安装包](https://github.com/Murmureeee/Pilot/releases/download/v0.2.0/pilot-0.2.0-x64-setup.exe)
- Linux x64 提供 AppImage 和 Debian `.deb` 安装包。

[查看 v0.1.1 到 v0.2.0 的提交记录](https://github.com/Murmureeee/Pilot/compare/v0.1.1...v0.2.0)

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
