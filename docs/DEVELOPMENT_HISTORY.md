# Pilot 开发完成记录

完成一个模块后，在近期交付里追加日期、交付范围、提交和验收结果。发布时面向用户的版本说明见中文更新记录。[开发路线图](./PLAN.md) · [中文更新记录](../CHANGELOG.md)

## 近期交付

### 2026-11-27

- **MCP 登录。** 「设置 → MCP 服务」可为已保存和受信任项目的远程 Streamable HTTP 服务打开系统浏览器。支持自动发现和动态客户端注册，本机服务也可填写公共客户端 ID。主进程加密保存令牌，按服务隔离，过期或收到授权错误时尝试刷新。用户可取消、重新登录或退出。Windows 隔离场景用本地 OAuth 和 MCP 服务实测了浏览器交接、PKCE、无效回调拒绝、取消和焦点恢复、加密落盘、重启后令牌轮换、刷新授权撤销、重新登录，以及项目工具调用和撤销信任。对话框通过中英文、亮暗主题、1100 × 750、720 × 480 和窄窗 150% 缩放检查，最低文字对比度为 5.67:1。八步验证、599 项 Vitest 测试和 40 个 Windows 桌面场景通过，Electron 冒烟返回 `ok: true`，开发版挂载且无未捕获异常。测试进程和临时目录已清理。里程碑 6 的 18 项已交付，并更新「开发顺序」总表。[MCP 登录设计](./DESIGN.md#212-设置视图) · [场景脚本](../scripts/verify-windows-ui.mjs) · [提交 8172be7](https://github.com/Murmureeee/Pilot/commit/8172be72ebad271e002068d3918b36d048a7c2e1)

- **项目级配置。** 项目可通过 `.pilot/config.json` 声明 MCP 服务、授权规则和验证命令，并读取 Claude Code 的 `.mcp.json`。输入坞在首次执行或配置改变时展示范围，按 `Esc` 可跳过本次加载。配置详情和相关设置列出文件来源，可在详情中撤销信任。已保存的本机回合后验证命令或停用设置优先。Windows 隔离场景用本地模型和 stdio 服务实测了跳过、审批后的 MCP 调用、任务结束时关闭服务、手动和回合后验证，以及重启恢复、跨项目隔离和撤销。回归测试覆盖确认期间文件变化、过期回复、停止和授权路径边界。项目配置详情通过中英文、亮暗主题、1100 × 750、720 × 480 和窄窗 150% 缩放检查，最低文字对比度为 5.03:1。复核了信任卡按钮可见性和键盘焦点。八步验证、38 个 Windows 桌面场景和 594 项 Vitest 测试通过。Electron 冒烟返回 `ok: true`，开发版挂载且无未捕获异常。测试进程和临时目录已清理。[项目配置设计](./DESIGN.md#25-主列顶栏) · [场景脚本](../scripts/verify-windows-ui.mjs) · [提交 11c440e](https://github.com/Murmureeee/Pilot/commit/11c440e735de22d9506e7d8e04b0d4e024c0e5cc)

### 2026-11-26

- **发现页。** 「技能 → 发现插件」可浏览 Claude Code 官方市场、添加 Git 市场、筛选条目并预览安装。「MCP 服务 → 发现 MCP 服务」可按名称搜索官方 MCP Registry 的最新版本并分页查看。从条目核对来源、发布者、版本、HTTP 地址或启动命令，预填配置并补齐必填项后保存。预填支持 Streamable HTTP 与使用固定版本 npm、PyPI 包的 stdio 配置，保存后默认停用。Windows 隔离桌面复核了来源恢复与移除、仓库子目录安装、Registry 搜索和分页、占位符校验、MCP 配置保存与重启。应用实读 Claude Code 官方市场 317 个条目和 MCP Registry 的 `filesystem` 搜索结果。中英文、亮暗主题、1100 × 750、720 × 480 和窄窗 150% 缩放的键盘与焦点检查通过，配置对话框最低文字对比度为 5.67:1。八步验证、36 个 Windows 桌面场景和 575 项 Vitest 测试通过。Electron 冒烟返回 `ok: true`，开发版挂载且无未捕获异常，测试进程和临时目录已清理。[发现页设计](./DESIGN.md#212-设置视图) · [场景脚本](../scripts/verify-windows-ui.mjs) · [提交 478e578](https://github.com/Murmureeee/Pilot/commit/478e5788e9b593da3dd68381e126748efa4999a3)

- **技能与插件安装。** 在「设置 → 插件」从 Git、本地文件夹或 ZIP 预览技能、提示词模板、脚本路径和 MCP 启动命令。确认时复核来源，安装和更新后默认停用。支持独立技能及 Claude Code、Codex 和 Pi Packages 的可移植组件，钩子、原生扩展和 npm 依赖等在预览中标为暂不支持。Windows 隔离桌面验证了三种来源的预览、Git 安装、启用后用 `/` 展开模板、技能进入模型请求、MCP 工具经审批运行、过期预览恢复、版本差异、重启与卸载。单元测试覆盖了 ZIP 和本地目录安装、重复确认以及保存失败后的回滚。界面覆盖中英文、亮暗主题、1100 × 750、720 × 480 和窄窗 150% 缩放，核对了键盘焦点，预览最低文字对比度为 5.67:1。八步验证、34 个 Windows 桌面场景和 568 项 Vitest 测试通过。Electron 冒烟返回 `ok: true`，开发版挂载且无未捕获异常。已核对测试进程和临时目录清理结果。[插件设置](./DESIGN.md#212-设置视图) · [场景脚本](../scripts/verify-windows-ui.mjs) · [提交 782d6d4](https://github.com/Murmureeee/Pilot/commit/782d6d4efacbb062ecad86cdbba5abcbc2636d8e)

- **辅助模型。** 在「设置 → 模型与提供方」选择已配置的模型，默认跟随当前会话模型。首轮成功回复后在后台生成会话标题，手动名称优先保留。压缩仍按当前会话模型的容量触发，辅助模型生成摘要失败时由当前模型接手。Windows 隔离桌面用本地 OpenAI 兼容接口夹具核对了对话、标题和摘要的模型选择、延迟返回时的手动标题保护，以及重启后恢复设置和标题。单元测试覆盖辅助摘要失败后的回退。菜单在 1100 × 750、720 × 480 和窄窗 150% 缩放下复核了中英文、亮暗主题、选中状态和键盘焦点返回。八步验证、32 个 Windows 桌面场景和 562 项 Vitest 测试通过。Electron 冒烟返回 `ok: true`，开发版挂载且无未捕获异常。测试进程和临时目录已清理。[辅助模型设置](./DESIGN.md#212-设置视图) · [标题生成](../src/main/agent-host/session-title.ts) · [场景脚本](../scripts/verify-windows-ui.mjs) · [提交 0ad8c3f](https://github.com/Murmureeee/Pilot/commit/0ad8c3f2f8d03d51dbe94eec17d7ec832afcf55b)

- **外部编辑器。** 在「设置 → 常规」选择 VS Code、Cursor、JetBrains 或自定义命令，文件预览的「在编辑器中打开」和 Git 差异行号共用已保存的设置。JetBrains 配置启动程序，自定义模式可逐行填写带 `{file}` 和 `{line}` 的参数。Windows 隔离桌面用可执行测试夹具核对了两个入口传出的绝对路径和行号、找不到启动程序时的提示、缺少文件参数的校验，以及重启后恢复设置。预设启动参数由单元测试核对。设置与文件预览通过中英文、亮暗主题、1100 × 750、720 × 480 和窄窗 150% 缩放检查，并复验了键盘选择、焦点返回和常规页横向溢出。八步验证、30 个 Windows 桌面场景和 558 项 Vitest 测试通过。Electron 冒烟返回 `ok: true`，开发版挂载且无未捕获异常。测试进程和临时目录已清理。[编辑器设置](./DESIGN.md#212-设置视图) · [审查面板](./DESIGN.md#210-审查面板) · [场景脚本](../scripts/verify-windows-ui.mjs) · [提交 9f0dcfb](https://github.com/Murmureeee/Pilot/commit/9f0dcfb56ac4e7787a45ce301eca579cc32631e0)

- **从系统进入。** Windows 安装版可从资源管理器的文件夹或文件夹背景菜单选择「用 Pilot 打开」，新终端可运行 `pilot <目录>`，也可以把文件夹拖到工作卡片。同一数据目录的后续启动由原窗口接手，切换项目时恢复对应草稿。Windows x64 隔离安装包实测了命令行 PATH、资源管理器入口和单窗口接管，原位重装后 PATH 只保留一条 Pilot 项，卸载后菜单清除且 PATH 恢复原值。桌面回归核对了输入坞附件与 `@` 引用、无效目录反馈、焦点和草稿恢复，拖放提示覆盖 1100 × 750、720 × 480、窄窗 150% 缩放及各自的中英文和亮暗主题。八步验证、28 个 Windows 桌面场景及 546 项 Vitest 测试通过。Electron 冒烟返回 `ok: true`，开发版挂载且无未捕获异常。测试进程与临时目录已清理。[项目入口](./DESIGN.md#26-首页空会话) · [场景脚本](../scripts/verify-windows-ui.mjs) · [提交 b4d50c4](https://github.com/Murmureeee/Pilot/commit/b4d50c4225c007e5b53ac0a066534006c87058b4)

- **差异批注。** 在「变更」页签的文本差异中批注单行或同一区块内的连续行，支持鼠标和键盘选区。汇总时可编辑或移除批注，加入草稿后保留原有内容，随正常发送把批注、工作目录相对路径、旧版和新版位置及差异节选交给 Agent。删除行保留旧版引用，与工作树对应的新版引用可定位文件。Windows 隔离场景实测了子目录中的修改和删除、批注编辑与移除、原草稿保留、重载恢复以及首次发送前的会话状态。本地模型夹具确认只收到一条用户消息，并核对了行号、节选和文件定位。中英文、亮暗主题、1100 × 750、720 × 480 和窄窗 150% 缩放下复核了布局与焦点，批注对话框最低文字对比度为 5.67:1。八步验证、27 个桌面场景及 540 项 Vitest 测试通过。Electron 冒烟返回 `ok: true`，开发版挂载且无未捕获异常。测试进程和临时目录已清理。[差异批注](./DESIGN.md#210-审查面板) · [场景脚本](../scripts/verify-windows-ui.mjs) · [提交 b1fcae3](https://github.com/Murmureeee/Pilot/commit/b1fcae3447aee27f7a73f181426d9de45465f9c2)

- **分支与推送。** 从「变更」页签新建或切换本地分支。推送确认显示有效远端、目标分支和提交，执行前复核本地与远端状态。通过已登录的 `gh` 为已发布到 GitHub.com 的分支创建 PR，可修改基准分支以及根据任务与提交预填的标题和说明。Windows 裸仓库实测了新建与切换、取消推送、确认推送和首次推送后的上游跟踪。PR 用隔离的 `gh` 可执行夹具验证任务预填、编辑后的多行说明、结果链接和临时文件清理。推送和 PR 对话框覆盖中英文、亮暗主题、1100 × 750、720 × 480 和窄窗 150% 缩放，并核对键盘操作与焦点恢复。推送预览最低文字对比度为 5.67:1。八步验证和 26 个桌面场景通过，Vitest 52 个文件共 536 项通过。Electron 冒烟返回 `ok: true`，开发版挂载且无未捕获异常。测试进程和临时目录已清理。[变更页签](./DESIGN.md#210-审查面板) · [场景脚本](../scripts/verify-windows-ui.mjs) · [提交 db2283d](https://github.com/Murmureeee/Pilot/commit/db2283d19646a351304b891686e48b7508a58ee8)

- **回合后验证。** 从「验证」页签为项目保存一条命令及其 Shell，Agent 成功完成执行回合后自动运行。结果随任务保存在原会话。已有验证在运行时按会话排队，启动前复核配置。失败结果可一键把命令、退出码和日志交给原会话的 Agent，输入框保留草稿。Windows 隔离场景用本地模型接口夹具验证了工具调用期间等待、切换项目后的结果归属、失败回传、审批修复文件、自动通过、重启恢复和停用。配置对话框通过中英文、亮暗主题、1100 × 750、720 × 480 和窄窗 150% 缩放检查，最低文字对比度为 5.67:1。八步验证和 25 个桌面场景通过，Vitest 51 个文件共 525 项通过。Electron 冒烟返回 `ok: true`，开发版挂载且无未捕获异常。测试进程和临时目录已清理。[验证页签](./DESIGN.md#210-审查面板) · [场景脚本](../scripts/verify-windows-ui.mjs) · [提交 70d89ef](https://github.com/Murmureeee/Pilot/commit/70d89ef0cd129eb038e9e2e39d6c5c9923f31e4b)

- **记忆。** 用户可从输入框用 `#` 快速记录约定，也可在回复下方审阅 Agent 的记忆建议。审阅框支持编辑内容、选择项目指令或全局个性化、预览差异、确认保存和撤销。项目范围追加到生效的根目录指令，两种文件均缺少时建立 `AGENTS.md`。保存与撤销核对目标内容，发现后续改动时显示处理方式。Windows 隔离场景验证了草稿取消和保留、直接保存与撤销、新建文件撤销、Agent 建议、带 `#` 原文发送，以及重启后两种范围的记忆进入模型请求。界面通过中英文、亮暗主题、1100 × 750、720 × 480 和窄窗 150% 缩放检查，最低文字对比度为 5.67:1。八步验证与 23 个桌面场景通过，Vitest 51 个文件共 522 项通过。Electron 冒烟返回 `ok: true`，开发版挂载且无未捕获异常。测试进程和临时目录已清理。[输入坞](./DESIGN.md#28-输入坞) · [场景脚本](../scripts/verify-windows-ui.mjs) · [提交 fc1567f](https://github.com/Murmureeee/Pilot/commit/fc1567ffa0549407c8c8dc30cdbfbd91644f77e9)

### 2026-11-25

- **指令兼容。** 项目根目录和适用的子目录优先读取 `AGENTS.md`，缺少时读取 `CLAUDE.md`。`@` 引用和内置文件、搜索工具的目标路径会加载对应子目录的规则。首次写入或编辑发现新指令时，Agent 会先收到对应规则，再重试并按原会话权限处理。「指令来源」显示每份文件的适用目录、路径、读取状态和优先级。Windows 本地模型接口夹具实测了草稿中的 `@` 引用、模型收到规则的顺序、写入前提示、重试审批和重启后来源恢复。对话框覆盖中英文、亮暗主题、1100 × 750 和 720 × 480，窄窗 150% 缩放下验证了键盘滚动及关闭后的焦点恢复。最低文字对比度为 5.67:1。八步验证和 20 个桌面场景通过，Vitest 50 个文件共 515 项通过。Electron 冒烟返回 `ok: true`，开发版挂载且无未捕获异常。测试进程已退出，独立测试目录已从临时路径清理。[指令来源](./DESIGN.md#25-主列顶栏) · [场景脚本](../scripts/verify-windows-ui.mjs) · [提交 9ffd218](https://github.com/Murmureeee/Pilot/commit/9ffd2189f0ed7d74863ef392893715ebea87484d)

- **联网工具。** Agent 可读取公开网页和通过 DuckDuckGo 搜索。输入坞显示目标域名、网址或搜索词。会话与已保存授权按工具和完整域名匹配，权限设置可撤销，跨域跳转需对新网址发起请求。读取公开 HTML 和纯文本，正文最多 12,000 个字符，搜索结果最多五条。来源随会话保存并可在系统浏览器打开。Windows 桌面夹具验证了审批前无联网、同域授权复用、跨域拒绝、正文裁剪、重载后来源和撤销。实网验证了搜索返回 Electron 官方文档及读取 example.com。审批与来源覆盖中英文、亮暗主题、1100 × 750 和 720 × 480，窄窗复验 150% 缩放和键盘操作。八步验证与 18 个桌面场景通过，Vitest 50 个文件共 513 项通过。Electron 冒烟返回 `ok: true`，开发版挂载且无未捕获异常。测试进程和临时目录已清理。[审批卡](./DESIGN.md#29-审批卡) · [工具轨迹](./DESIGN.md#27-对话流) · [提交 1ec44a1](https://github.com/Murmureeee/Pilot/commit/1ec44a14580bd29733b5aaed4ae5a5bd146fddd0)

- **交互式终端。** 审查面板可从任务工作目录打开设置中选定的 Shell，支持输入、停止和复制选区或输出。打开终端保留原草稿，首条消息发送后沿用同一终端。Agent 通过命令审批启动后台命令，可读取和停止本次任务的进程。运行中的后台进程随任务结束清理，手动 Shell 在应用退出时清理。Windows 实测 PowerShell、Git Bash、`Ctrl+C` 中断、系统剪贴板、后台命令审批和子进程清理，以及取消退出后继续使用终端。设计验收覆盖两种语言、亮暗主题、1100 × 750 和 720 × 480，并在窄窗检查 150% 缩放和键盘焦点。八步验证和 17 个桌面场景通过，Vitest 49 个文件共 502 项通过。Electron 冒烟返回 `ok: true`，开发版挂载且无未捕获异常。Windows x64 打包目录实测终端输入与停止。测试进程和临时目录已清理。[审查面板](./DESIGN.md#210-审查面板) · [场景脚本](../scripts/verify-windows-ui.mjs) · [提交 d46a223](https://github.com/Murmureeee/Pilot/commit/d46a22323e0faf75b61928ebab6b66402ee7eca6)

- **附件与拖放。** 输入坞支持选择、粘贴和拖放图片，可查看大图或逐张移除。图片随草稿和消息恢复，工作目录内的其他文件或文件夹拖入后生成 `@` 引用。模型选择器显示图像能力。切到文本模型时保留草稿图片并提示换模型或移除图片，历史图片仍可预览。Windows 隔离验收用本地 OpenAI 兼容接口夹具核对图文请求、纯图片请求，以及移除草稿图片后继续原会话的文本请求。实测草稿重启恢复、原消息预览、项目范围内外文件拖放和键盘焦点恢复。输入坞在 1100 × 750 和 720 × 480 下通过中英文与亮暗主题八种组合，图片预览通过窄窗 150% 缩放检查。八步验证和 14 个桌面场景通过，Vitest 48 个文件共 492 项通过。Electron 冒烟返回 `ok: true`，开发版挂载且无未捕获异常，测试进程和临时数据已清理。[输入坞](./DESIGN.md#28-输入坞) · [场景脚本](../scripts/verify-windows-ui.mjs) · [提交 acba84e](https://github.com/Murmureeee/Pilot/commit/acba84e4654cfa8e04725c5834f82647d417b69b)

- **命令面板与斜杠命令。** `Ctrl+K` 搜索操作、项目、会话和设置分区，可直接切换主题、语言与会话权限，打开模型、审查页签，或运行项目默认验证。`/` 菜单共用这些动作定义，提供 `/compact`、`/clear`、`/init`、`/review` 和 `/diff`。全局提示词模板在「设置 → 个性化」管理，用 `{{参数名}}` 定义参数，从 `/prompt-名称` 或面板填入草稿。Windows 隔离验收用本地模型接口夹具实际生成并审批写入 `AGENTS.md`，核对审查请求、压缩保留重点、测试输出和退出码、空白聊天及模板取消、恢复、编辑和删除。命令面板和斜杠菜单通过 1100 × 750、720 × 480 的中英文与亮暗主题八种组合，并在窄窗复验 150% 缩放。八步验证和 12 个桌面场景通过，Vitest 47 个文件共 487 项通过。Electron 冒烟返回 `ok: true`，开发版挂载且无未捕获异常，测试进程与临时数据已清理。[命令面板](./DESIGN.md#211-命令面板) · [场景脚本](../scripts/verify-windows-ui.mjs) · [提交 008e40a](https://github.com/Murmureeee/Pilot/commit/008e40a6955aaba414120e899050684f887b2352)

- **搜索与导出。** 用 `Ctrl+K` 按项目搜索消息、文件名和命令，选择片段后打开原会话并定位到命中处。`Ctrl+F` 在会话内查找，从 `⋯` 菜单可导出 Markdown。Windows 隔离验收的十个场景通过，实测项目范围切换、跨会话跳转、展开折叠步骤、键盘前后跳转和焦点恢复。保存场景替换了系统对话框的返回值，核对取消后无文件、确认后写入的 Markdown 包含消息、文件和命令。搜索控件在 1100 × 750 和 720 × 480 下通过中英文与亮暗主题八种组合，并在窄窗复验 150% 缩放。八步验证通过，Vitest 46 个文件共 480 项通过，Electron 冒烟返回 `ok: true`，开发版挂载且无未捕获异常。测试进程和临时数据已清理。[命令面板](./DESIGN.md#211-命令面板) · [场景脚本](../scripts/verify-windows-ui.mjs) · [提交 d1c2676](https://github.com/Murmureeee/Pilot/commit/d1c2676d83f4ab6e39ccf6311fbe3aafa9153faa)

- **首条消息发送时创建会话。** 空白新聊天独立保存内容、项目、模型、权限和计划模式。发送前的草稿可在重启或重新打开项目时恢复，首条消息被接受后才加入会话列表。Windows 隔离验收覆盖输入、切换权限、切换 `/plan`、重启恢复草稿和首条消息创建会话。八步验证和九个桌面场景通过，Vitest 474 项通过。测试进程和临时数据已清理。[首页与草稿](./DESIGN.md#26-首页空会话) · [提交 851fca9](https://github.com/Murmureeee/Pilot/commit/851fca9eab5ce6f215a5c250807947f21ff664c9)

- **计划模式入口调整。** 在输入框的 `/` 菜单用 `/plan` 启用或退出规划。输入框单独显示规划状态，`Shift+Tab` 循环切换确认模式、只读和完全访问。明确更改会话权限后，审阅卡显示计划将使用的权限。Windows 隔离验收覆盖键盘与鼠标选择、草稿保留、规划期间切换权限、重启恢复计划，以及确认后的文件审批与写入。八步验证和八个桌面场景通过，Vitest 474 项通过。测试进程和临时数据已清理。[输入坞](./DESIGN.md#28-输入坞) · [提交 1a6a768](https://github.com/Murmureeee/Pilot/commit/1a6a768c4d9ba64632d9e3f03cd3ec67d1d9ad16)

- **计划模式。** 在会话权限菜单、命令面板或用 `Shift+Tab` 进入。Agent 在规划期间可读取和搜索，并提交 Markdown 计划。输入坞支持编辑、保存、放弃和确认执行，待确认计划随会话恢复。确认后用进入计划模式时的权限执行已审阅的版本。Windows 隔离桌面使用本地 OpenAI 兼容接口夹具，实测读取、编辑、重启恢复和确认后的文件审批及写入。审阅卡在 1100 × 750、720 × 480 下通过中英文、亮暗主题八种组合，状态标题最低对比度为 5.03:1。窄窗 150% 缩放时复验编辑、取消及焦点返回。八步验证和八个桌面场景通过，Vitest 46 个文件共 473 项通过。Electron 冒烟返回 `ok: true`，开发版挂载且无未捕获异常。测试进程和临时数据已清理。[输入坞](./DESIGN.md#28-输入坞) · [场景脚本](../scripts/verify-windows-ui.mjs) · [提交 7c62fdd](https://github.com/Murmureeee/Pilot/commit/7c62fdd4320ff505ec146452d2e2c2fea552392f)

- **Linux 更新入口。** 从应用菜单或设置「关于」检查更新。AppImage 与 Debian 安装包用 Linux 更新清单选择并校验各自的下载文件。AppImage 确认后保留原路径替换并重启，Debian 包提供下载位置，由系统包管理器安装。Linux 隔离验收从 `0.0.1` 测试包更新到 `0.5.0` 候选包，确认 AppImage 替换失败时保留原文件，重试后保留原数据目录和草稿。Debian 包通过版本检查和下载校验，文件管理器收到安装包所在目录，候选包也在隔离容器中通过 apt 安装、启动和卸载。软件更新对话框在 1100 × 750 和 720 × 480 下通过中英文、亮暗主题八种组合，并核对了键盘打开、操作和焦点返回。Windows 八步验证与六个桌面场景通过，Vitest 465 项通过。[提交 124915d](https://github.com/Murmureeee/Pilot/commit/124915da55ecb85480f58ab753469b16cff82414) · [提交 022d04a](https://github.com/Murmureeee/Pilot/commit/022d04a45cb28ca9ff99e626de646189755f7791) · [Windows 安装回归](https://github.com/Murmureeee/Pilot/actions/runs/45576659838) · [Linux 更新回归](https://github.com/Murmureeee/Pilot/actions/runs/45577825926)

- **Pilot v0.5.0 发布。** 交付里程碑 5「工作台结构与反馈」。GitHub Releases 提供 Windows x64 安装包、更新清单和 blockmap，以及 Linux x64 AppImage 和 Debian `.deb`。本地八步验证、465 项 Vitest 测试和六个桌面场景均通过。CI 验证了 Windows 新装、卸载、旧版 HTTPS 升级、数据保留和自定义安装目录，并在隔离环境启动了两种 Linux 包。公开更新验收从 `0.1.0` 升级到 `0.5.0`，安装包 SHA-512 与 `latest.yml` 一致。另用 `v0.4.0` 直接从公开更新源下载 `v0.5.0`，校验下载包与正式资产一致。用两个正式安装包内的应用依次打开同一隔离数据目录，确认会话转录逐字节一致，原会话可继续对话，草稿、设置、语言、主题和已启用的技能均保留。Windows 发行包冷启动到输入框可用用时约 0.52 秒，120 个流式增量最大渲染延迟 19 毫秒，500 条消息滚动帧间隔 P95 为 16.7 毫秒。切换会话 20 次，强制垃圾回收后的渲染进程工作集约从 189 MiB 升至 190 MiB。本地测试进程和临时数据已清理。[正式发布](https://github.com/Murmureeee/Pilot/releases/tag/v0.5.0) · [打包与安装验收](https://github.com/Murmureeee/Pilot/actions/runs/45562057076) · [公开更新验收](https://github.com/Murmureeee/Pilot/actions/runs/45564355087) · [发版提交 ad599ca](https://github.com/Murmureeee/Pilot/commit/ad599ca12d575bfd9a9b738cf5842819edf1911f)

- **界面场景脚本。** 新增 `pnpm verify:windows:ui`，Windows 本地和 CI 的六个场景均通过。测试使用隔离数据目录和本地模型接口夹具，打开项目时替换一次原生目录选择器的返回结果。场景覆盖首次配置、流式回复、键盘允许和拒绝写入并恢复草稿、设置导航与保存，以及重启恢复设置和会话。审查面板在 1100 × 750、720 × 480 下通过中英文和亮暗主题的八种组合，窄窗缩放至 150% 时复核了审查面板、侧栏和焦点恢复。修复了 Windows 8.3 短路径下的普通文件夹消息回退，并用同一短路径场景确认预览、重启恢复和实际回退。按序通过八步验证，Vitest 465 项通过，Electron 冒烟返回 `ok: true`，开发版已挂载且无未捕获异常。退出后确认测试进程和临时目录已清理。[场景脚本](../scripts/verify-windows-ui.mjs) · [提交 e00b2be](https://github.com/Murmureeee/Pilot/commit/e00b2be4b7beb623d3fd1cef424805b918573d5c) · [提交 96a128b](https://github.com/Murmureeee/Pilot/commit/96a128b2cc0a4355b5a5d296e4636a273838dcf7) · [Windows CI](https://github.com/Murmureeee/Pilot/actions/runs/45560391685)

- **键盘与主题。** 新增 `Ctrl+L` 聚焦输入框、`Shift+Tab` 切换会话权限、`↑` 取回带引用的上一条消息，以及在提示后 2 秒内再按 `Esc` 停止任务。应用菜单、命令面板和设置均显示快捷键。Windows 隔离实例用本地模型和系统目录选择器测试替身走通打开项目、文件与技能引用、审批、查看差异、撤销、验证输出滚动和暂存提交，核对了焦点恢复及浮层优先处理 `Esc`。中英文、亮暗主题在 1100 × 750 和 720 × 480 下通过八种组合检查。窄窗 150% 缩放下复验审查面板和命令面板，另验证键盘切换主题及模拟系统配色变化。「完全访问」标记在八种组合里测得最低对比度 5.25:1。八步验证通过，Vitest 465 项通过，冒烟返回 `ok: true`，开发版挂载且无未捕获异常。测试进程与临时数据已清理。[键盘规范](./DESIGN.md#6-键盘) · [提交 51a59e5](https://github.com/Murmureeee/Pilot/commit/51a59e536e87a4724cd4e500e88540d997a6a0b6)

- **消息操作。** 用户可复制消息、从所选消息分叉，或在新聊天编辑原文和文件、技能引用后重发。助手回合支持复制、以原始提问在新聊天重试，以及预览后续消息和任务改动后回退。Git 回退核对工作树与暂存区，普通文件夹使用内置文件工具快照。Windows 隔离开发版用本地模型接口和剪贴板测试替身核对了六个操作，实测取消、文件及暂存内容变化后重新预览、保留用户改动、重启和旧版纯文本聊天回退。中英文、亮暗主题在 1100 × 750 与 720 × 480 下通过八种组合检查，150% 缩放下验证了键盘操作和焦点恢复。八步验证通过，Vitest 462 项通过，冒烟返回 `ok: true`，开发版挂载且无未捕获异常。测试进程与临时数据已清理。[对话流](./DESIGN.md#27-对话流) · [提交 04dee38](https://github.com/Murmureeee/Pilot/commit/04dee3818d3552901659b7fa9524f5b1f409801d)

- **审批细节。** 审批卡显示实际工作目录、目标文件、命令环境与授权范围。新建、覆盖和编辑支持逐行差异，MCP 请求显示服务名、工具名和格式化 JSON。需要确认的同批调用依次编号，审批决定及保存的范围随工具步骤留存。Windows 隔离开发版用本地模型与 MCP 接口复核四项连续审批、自动放行的读操作、一次允许、拒绝、会话授权和 PowerShell 持久授权。确认预览后更改的文件保留原有改动，重启后可回看已保存决定。中英文和亮暗主题在 1100 × 750、720 × 480 下通过八种组合检查。150% 缩放下复测差异区滚动、审批按钮可见和键盘焦点返回。八步验证通过，Vitest 458 项通过，冒烟返回 `ok: true`，开发版挂载且无未捕获异常。测试进程及临时数据已清理。[审批卡](./DESIGN.md#29-审批卡) · [提交 a1e271a](https://github.com/Murmureeee/Pilot/commit/a1e271aa1ce9d621ab61033def0ce0c9dd252541)

- **对话流收敛。** 活动摘要显示从本次回合开始处理到最终回复的耗时、步数和失败步数。起止时间随 JSONL 转录保存，旧回合继续显示步数。上下文用量弹层持续显示本会话累计 token 与费用，模型上限未知时仍可查看。Windows 隔离开发版用本地 OpenAI 兼容接口夹具复核工具执行与审批等待计入耗时、失败详情展开、计划回到轨迹、重试单独计时和重启恢复。弹层打开时累计值从 1,200 token、$0.0028 更新到 4,200 token、$0.0098，切换会话及重启后核对了各自用量。中英文和亮暗主题在 1100 × 750 与 720 × 480 下通过八种组合检查，另以 150% 缩放复核键盘开合与焦点。八步验证通过，Vitest 457 项通过，冒烟返回 `ok: true`，开发版挂载且无未捕获异常。测试进程和临时数据已清理。[对话流](./DESIGN.md#27-对话流) · [输入坞](./DESIGN.md#28-输入坞) · [提交 558c0e0](https://github.com/Murmureeee/Pilot/commit/558c0e054ea2e6e51fc5def1ae8e99666992adcf)

- **通知与提醒。** 窗口失焦或对应会话不可见时，待审批、完成和失败发送桌面通知，Windows 同时请求任务栏闪烁。「常规 → 通知」的开关即时生效，重启后保留，后台完成仍标为未读。归档、恢复、复制聊天全文和移除最近项目显示可关闭的提示条。Windows 隔离开发版用本地模型接口夹具核对三种通知的原生显示事件与任务栏调用，捕获待审批通知的原生点击，窗口恢复后焦点落到审批卡。完成与失败的跳转用 Electron 点击事件夹具核对。实测了前台抑制、后台未读及返回清除、关闭提醒后重启、提示条自动消失、键盘关闭和复制失败反馈。通知设置在 1100 × 750 和 720 × 480 下覆盖中英文及亮暗主题，另以 150% 缩放验证键盘切换。八步验证通过，Vitest 457 项通过，冒烟返回 `ok: true`，开发版挂载且无未捕获异常。测试进程与临时数据已清理。[状态模型](./DESIGN.md#3-状态模型) · [提交 8353c95](https://github.com/Murmureeee/Pilot/commit/8353c954aed083dc2e4593ebe431a80b3de0f7f7)

- **侧栏状态。** 主进程按会话保存最近的运行结果，后台失败时对应会话显示红点，重启后恢复，重试成功后清除。项目菜单可在文件管理器中打开目录或将其移出最近项目，关联聊天保留在「其他项目」。Windows 隔离实例用本地 OpenAI 兼容接口夹具核对后台失败、未读优先级、重启与重试，用 Electron Shell 调用夹具核对传入的项目路径，并实测目录失效时的反馈、移除后焦点返回及重新打开项目。中英文与亮暗主题在 1100 × 750 和 720 × 480 下共通过八种组合检查，另外复测 150% 缩放。八步验证通过，Vitest 450 项通过，测试进程和临时数据已清理。[侧栏设计](./DESIGN.md#24-侧栏) · [提交 68a19e2](https://github.com/Murmureeee/Pilot/commit/68a19e2a75831dcdcea071332ed4ca45e5429006)

- **统一审查面板。** 变更、文件预览与验证共用右侧面板。顶栏显示去重后的变更文件数和验证状态，并排时可拖拽或用方向键调宽。Windows 隔离实例实测三档布局、页签和文件选择、滚动与焦点恢复，重启后恢复面板宽度和四条会话验证记录。Git 场景覆盖暂存、选择性提交和检查点撤销，普通文件夹覆盖工具差异与确认撤销。验证场景覆盖实时输出、退出码、失败重跑、成功折叠和停止。中英文、亮暗主题在 1100 × 750 与 720 × 480 下共复核八种组合，并在 150% 缩放下验证键盘切换。八步流水线通过，Vitest 通过 443 项，Electron 冒烟返回 `ok: true`，开发版成功挂载且无未捕获异常。测试进程与临时数据已清理。[设计规范](./DESIGN.md#210-审查面板) · [提交 3081c53](https://github.com/Murmureeee/Pilot/commit/3081c53b2769de8abc1ab7ae086b4700ce81db77)
- **Pilot v0.4.0 发布。** 交付里程碑 4「安全与可靠性」。GitHub Releases 提供 Windows x64 安装包、更新清单和 blockmap，以及 Linux x64 AppImage 和 Debian `.deb`。本地八步验证和 440 项测试通过。CI 验证了 Windows 新装、卸载、HTTPS 更新和自定义安装目录保留，并在隔离环境启动了两种 Linux 包。Windows 从公开 HTTPS 更新源由 `0.1.0` 升级到 `0.4.0`，安装包 SHA-512 与 `latest.yml` 一致，重启后保留了会话、设置、语言、主题和已启用的技能。另在 Windows 使用同一路径分别启动 `v0.3.1` 和 `v0.4.0` 正式安装包内的应用，确认原会话、设置、语言和主题得到保留，旧的无范围命令规则显示为停用且下次运行会重新询问。测试进程已退出，隔离目录已移入回收站。[正式发布](https://github.com/Murmureeee/Pilot/releases/tag/v0.4.0) · [打包与安装验收](https://github.com/Murmureeee/Pilot/actions/runs/45429790005) · [公开更新验收](https://github.com/Murmureeee/Pilot/actions/runs/45433991131) · [发版提交 599934d](https://github.com/Murmureeee/Pilot/commit/599934ddff3ad2593b700d4c94c3a71c6078cb12)

### 2026-11-24

- **代理验证。** 模型流式请求和压缩摘要、模型目录、连通性测试、Streamable HTTP MCP 和 Windows 更新使用 Electron 的代理配置，支持系统代理及 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY`。Windows 隔离打包对照中，原版在 Chromium 代理夹具下通过 1/5 项，仅设置 `HTTPS_PROXY` 时通过 0/5 项。修复后两种模式均通过 5/5 项，覆盖模型流式回复、模型目录、连通性测试、MCP 工具发现及更新清单与下载。更新下载的 SHA-512 均匹配，环回和 `NO_PROXY` 直连也通过。另用本机 Windows 系统代理访问公开仓库，响应为 HTTP 200。八步验证和 440 项测试通过，测试进程已退出，隔离目录已移入回收站。[开发路线图](./PLAN.md#4-安全与可靠性) · [提交 4aaf304](https://github.com/Murmureeee/Pilot/commit/4aaf3049f3380082571ac10088de29fd2ce2ba60)
- **会话追加写。** 运行期间把新增消息、已完成的工具结果和检查点写入同一条 JSONL 追加记录，结算与压缩时原子整理为完整转录。Windows 对照测量以 720 条消息、180 段长工具输出和约 18.07 MB 的转录为起点。36 次在途保存的 P95 从 22.58 ms 降到 0.23 ms，累计写入从约 676.54 MB 降到 1.21 MB。隔离实例用本地模型桩复测旧转录、强制退出、损坏行和缺少换行的尾记录，核对工具原文、插话、草稿和检查点恢复。在中断状态压缩后续跑，确认已完成写入被拦截、用户后续修改得到保留，结算重启后转录完整。八步验证和 436 项测试通过，夹具、进程和临时数据已清理。[开发路线图](./PLAN.md#4-安全与可靠性) · [提交 ec8632b](https://github.com/Murmureeee/Pilot/commit/ec8632b2f3a78388b3ecc8b97978262a77b7252e)
- **技能按需加载。** 请求仅带技能清单，模型用到时通过 `read_skill` 读取技能目录里的正文和附带文件。Windows 隔离实例通过本地 OpenAI 兼容端点桩验收了十个已启用本机技能、两种项目来源、切换项目、按任务选择停用技能、跨目录及 junction 读取拦截，以及 PowerShell 脚本经审批后运行。实测设置页导入、启用、预览和确认删除，重启后核对项目发现及本机启用和删除状态。列表、详情与删除对话框覆盖中英文、亮暗主题、1100 × 750 和 720 × 480，150% 缩放下复核键盘滚动、Esc 取消及焦点恢复。八步验证和 432 项测试通过，测试进程和临时数据已清理。[开发路线图](./PLAN.md#4-安全与可靠性) · [设计规范](./DESIGN.md#212-设置视图) · [提交 19fa968](https://github.com/Murmureeee/Pilot/commit/19fa96833a284b75b4058a4d04aa96537eebe722)
- **上下文压缩。** 按模型生效上限的 80% 触发自动压缩，优先缩短较早的工具输出，需要时用当前模型生成摘要。用量弹层和 `/compact [保留重点]` 支持手动压缩，对话标记可展开查看摘要。Windows 隔离实例使用本地 OpenAI 兼容端点桩，实测降低模型上限后自动压缩、计划和文件引用保留、手动保留重点、取消摘要请求，以及超限后沿用工具结果继续且夹具文件只写入一次。重启后核对压缩标记、会话累计用量和原始转录。用量弹层、压缩标记和超限错误卡覆盖中英文、亮暗主题、1100 × 750 和 720 × 480，150% 缩放下验证 Tab、Enter、Esc、焦点返回和草稿保留。八步验证和 428 项测试通过，测试进程与临时数据已清理。[开发路线图](./PLAN.md#4-安全与可靠性) · [设计规范](./DESIGN.md#27-对话流) · [提交 e6d3aec](https://github.com/Murmureeee/Pilot/commit/e6d3aec8c82932069581eeed73ed16879a5d3300)
- **模型能力配置。** 读取和刷新模型目录时解析上下文、输出、图像输入、思考支持和已知费率，逐模型覆盖与目录数据分别保存。Windows 隔离实例通过本地协议桩从旧模型记录导入能力，实测刷新保留覆盖、上下文占用即时更新、请求采用输出上限与思考设置、目录费率计费。重启后复核覆盖，清除后恢复新目录值。模型能力对话框通过中英文、亮暗主题、1100 × 750 和 720 × 480 的组合检查，150% 缩放下复核 Tab、Esc 和焦点返回。八步验证和 421 项测试通过，测试进程和临时数据已清理。[开发路线图](./PLAN.md#4-安全与可靠性) · [设计规范](./DESIGN.md#212-设置视图) · [提交 569fe95](https://github.com/Murmureeee/Pilot/commit/569fe95d8d61d0840ac003d8834caa547bfde2aa)
- **失败重试。** 单次模型请求支持三次可取消的自动退避，输入坞显示序号和倒计时。错误卡区分连接中断、限流、服务端错误、凭据、额度和模型能力问题，提供可展开的脱敏详情及对应操作。Windows 隔离实例用本地模型协议桩实测了流式断连、429、`Retry-After`、502 恢复、键盘取消、重试用尽和重启后沿原任务继续。核对了工具结果与运行标识，夹具文件只写入一次，草稿保留且焦点回到输入框。凭据、额度与模型能力错误各发送一次请求，设置按钮进入模型提供方页。错误卡通过中英文、亮暗主题、1100 × 750、720 × 480 和 150% 缩放复核。八步验证和 417 项测试通过，测试进程和临时数据已清理。[开发路线图](./PLAN.md#4-安全与可靠性) · [设计规范](./DESIGN.md#27-对话流) · [提交 a875669](https://github.com/Murmureeee/Pilot/commit/a8756697a6ee1989b7be5ba61584fc0db0ccd300)
- **命令执行。** 停止和超时与验证命令共用进程树终止逻辑。成功和失败的输出共用 100,000 字符上限，保留首尾并报告省略长度。模型可指定 1–300 秒的超时，默认 60 秒，超时结果包含已运行时长。Windows 隔离实例经 PowerShell 和 Git Bash 实测点击停止与 2 秒超时均结束夹具父子进程，核对了模型收到的成功、失败和超时结果，并复验了 1 秒下限。工具轨迹通过中英文、亮暗主题、1100 × 750 和 720 × 480 的组合复核，Tab 可达，Enter 可开合并保留焦点。八步验证和 408 项测试通过，测试进程与临时目录已清理。[开发路线图](./PLAN.md#4-安全与可靠性) · [设计规范](./DESIGN.md#27-对话流) · [提交 0b64d87](https://github.com/Murmureeee/Pilot/commit/0b64d87d16a5d84946a5b1c1c5a50efc9ddd525a)
- **运行对象拆分。** `AgentRun` 管理一次运行的状态、工具审批、插话队列、检查点、中止和 Git 任务快照，按运行安装并清理 Pi SDK 钩子。`AgentHost` 负责会话选择、Agent 缓存和工作区审查。八步验证和 403 项测试通过，新增回归覆盖启动通知期间请求退出和续跑时阻止重复执行已记录操作。Windows 隔离实例验证了切换会话时审批与队列归属、清空队列、停止期间处理旧运行请求、结算后的 Git 审查，以及进程中断后恢复检查点和草稿、用新运行 ID 续跑。测试进程和临时数据已清理。[开发路线图](./PLAN.md#4-安全与可靠性) · [运行对象](../src/main/agent-host/run.ts) · [提交 db9c3f6](https://github.com/Murmureeee/Pilot/commit/db9c3f662476fdee05ba0bbf810f35cff168276d)
- **格式化与静态检查配置。** 新增 Oxfmt 配置，启用导入、Tailwind CSS 类名和 `package.json` 排序。本地 `pnpm format`、`pnpm format:check` 和 Windows CI 使用相同的文件范围。Oxlint 补齐基础插件，警告会使检查失败。对原地排序和反转、局部辅助函数、负索引 `Array.with()` 配置了 Unicorn 例外。首轮整理 195 个源码和测试文件，复核了副作用导入、类名合并结果和 CSS 编译输出。本地八步验证和 401 项测试通过，Oxlint 零诊断。Windows CI 通过。[Oxfmt 配置](../.oxfmtrc.json) · [Oxlint 配置](../.oxlintrc.json) · [排序文档](https://oxc.rs/docs/guide/usage/formatter/sorting.html) · [提交 5a0f39a](https://github.com/Murmureeee/Pilot/commit/5a0f39aa35104c2c355926c6aac4d2eaa518bd59) · [Windows CI](https://github.com/Murmureeee/Pilot/actions/runs/45375470237)
- **危险命令。** 主进程先判定危险规则，再考虑会话授权、已保存授权和完全访问模式。命中规则时用红色审批卡说明风险，只能本次允许或拒绝。命令识别覆盖破坏性 Git 操作、下载后直接执行的管道、磁盘与分区工具和项目外递归删除。八步验证和 401 项测试通过。Windows 隔离实例在 PowerShell 和 Git Bash 验证了组合命令触发审批、完全访问下仍询问、拒绝长期授权应答、`git clean -n` 单次放行及下次再次询问。审批卡与权限设置覆盖中英文、亮暗主题和两种验收尺寸。实测键盘操作、草稿与焦点恢复，以及应用缩放至 158% 后的审批。测试进程和临时数据已清理。[开发路线图](./PLAN.md#4-安全与可靠性) · [设计规范](./DESIGN.md#29-审批卡) · [提交 c7807ff](https://github.com/Murmureeee/Pilot/commit/c7807fff607602f9295622cee136d95b38d14619)
- **命令授权范围。** PowerShell 和 Git Bash 的命令按 Shell 与参数前缀授权。审批卡显示完整命令、实际工作目录和长期授权范围，权限设置显示规则并提供撤销。旧的无范围命令授权已停用。八步验证和 330 项测试通过。Windows 隔离实例使用本地模型桩和临时 Git 项目，验证了 `pnpm test`、`git status` 的参数边界、组合命令逐段核对、重定向重新询问，以及两种 Shell 的保存、重启和撤销。审批与设置覆盖中英文、亮暗主题和 1100 × 750、720 × 480 两种尺寸。实测 Tab 导航、Enter 本次允许、Esc 关闭菜单或拒绝，以及草稿与焦点恢复。应用缩放至 158% 时仍可用键盘滚动长命令。验收后已退出测试进程并删除临时数据。[开发路线图](./PLAN.md#4-安全与可靠性) · [设计规范](./DESIGN.md#29-审批卡) · [提交 068a2c3](https://github.com/Murmureeee/Pilot/commit/068a2c394d4ef5bde51bf5b69b92d939deaf283f)
- **Pilot v0.3.1 发布。** 交付里程碑 3「基础稳健性」六项，以及设置导航与对话界面改进。GitHub Releases 提供 Windows x64 安装包、更新清单和 blockmap，以及 Linux x64 AppImage 和 Debian `.deb`。本地八步验证和 258 项测试通过。CI 验证了 Windows 新装、配置向导、升级保留自定义安装目录及卸载，并在隔离环境启动了两种 Linux 包。Windows 从公开 HTTPS 更新源将 `0.1.0` 升级到 `0.3.1`，安装包 SHA-512 与 `latest.yml` 一致，升级后保留了会话转录、设置、语言、主题和已启用的技能。[正式发布](https://github.com/Murmureeee/Pilot/releases/tag/v0.3.1) · [发版提交 7ea9d4d](https://github.com/Murmureeee/Pilot/commit/7ea9d4d87091d54bb459aac3fac67b8976de3079) · [打包与安装验收](https://github.com/Murmureeee/Pilot/actions/runs/45345620520) · [公开更新验收](https://github.com/Murmureeee/Pilot/actions/runs/45346813398)
- **运行期间不休眠。** Agent 任务和验证命令共用一个系统睡眠阻止，屏幕仍可按系统设置熄灭。等待审批和停止收尾期间继续持有，最后一项工作结束后释放。八步验证和 258 项测试通过。Windows 隔离实例核对了 Electron 原生阻止状态，覆盖最小化、任务和验证重叠运行、验证命令失败或停止、模型端点返回失败和从检查点续跑。退出确认采用受控应答，验证了取消后继续持有、确认后停止工作并释放。[开发路线图](./PLAN.md#3-基础稳健性) · [提交 4910551](https://github.com/Murmureeee/Pilot/commit/4910551dfdee8b6533345794bbe8ca80632f434c)
- **窗口与布局记忆。** 按数据目录恢复窗口位置、大小和最大化状态，以及侧栏宽度和收起状态。窄窗打开审查面板时临时收起侧栏，保留用户选择。八步验证和 255 项测试通过。Windows 隔离实例验证了最大化后最小化退出再重启、还原原窗口尺寸和位置、拖拽调整侧栏与快捷键展开、窄窗自动收起、屏外窗口回到主屏以及损坏记录回退。侧栏控件覆盖中英文、亮暗主题和 1100 × 750、720 × 480 两种窗口尺寸。运行中移除副屏由单元测试模拟。[开发路线图](./PLAN.md#3-基础稳健性) · [设计规范](./DESIGN.md#24-侧栏) · [提交 e3c79ed](https://github.com/Murmureeee/Pilot/commit/e3c79eda1648396c7e10c954f2778d11053acc5e)
- **退出确认。** 关窗、`Ctrl+Q` 和更新重启共用主进程的确认流程。取消后任务与验证命令继续运行。确认后保存 Agent 的可续跑检查点，结束验证进程树并保存已中断记录，再退出或启动安装。八步验证和 247 项测试通过。Windows 隔离实例验证了取消 `Ctrl+Q`、确认关窗、恢复草稿及续跑原任务。更新入口用隔离安装桩验证了取消后保留下载状态，以及确认后先清理和保存再交给安装器。更新按钮覆盖中英文、亮暗主题和 1100 × 750、720 × 480 两种窗口尺寸。[开发路线图](./PLAN.md#3-基础稳健性) · [设计规范](./DESIGN.md#23-标题栏与应用菜单) · [提交 2e317df](https://github.com/Murmureeee/Pilot/commit/2e317df)
- **界面崩溃恢复。** React 组件异常时显示原因和「重新加载」「查看日志」。渲染进程退出或失去响应时，由主进程显示原生恢复提示。终止无响应进程后等待它退出，再重载同一个窗口。八步验证和 242 项测试通过。Windows 隔离实例验收了真实进程崩溃、界面卡死后重载、原会话和草稿恢复、原审批继续处理，以及组件报错时的键盘重载和日志入口。恢复页覆盖中文、英文、亮色、暗色和 1100 × 750、720 × 480 两种窗口尺寸。[开发路线图](./PLAN.md#3-基础稳健性) · [设计规范](./DESIGN.md) · [提交 4e9440b](https://github.com/Murmureeee/Pilot/commit/4e9440b)
- **设置损坏保护。** 设置文件损坏时保存原样备份，再恢复默认设置。备份或写入受阻时保留原文件，界面提示恢复访问后重试。会话索引损坏时保留还能读取的条目，从转录和草稿文件找回其他会话。八步验证和 236 项测试通过。Windows 隔离实例验证了受阻时拒绝写入、键盘重试、备份内容、确认提示后重启、从侧栏打开找回的聊天及读取草稿。恢复提示覆盖中文、英文、亮色、暗色和 1100 × 750、720 × 480 两种窗口尺寸。[开发路线图](./PLAN.md#3-基础稳健性) · [设计规范](./DESIGN.md#212-设置视图) · [提交 027a103](https://github.com/Murmureeee/Pilot/commit/027a103)
- **单实例。** 按实际数据目录加锁。重复启动会唤醒已有主窗口，最小化时先还原，后启动的进程在加载设置和会话前退出。八步验证和 230 项测试通过。Windows 实测同一目录与目录联接都能还原并聚焦原窗口，两个独立目录的实例可以并行运行。Windows 验证脚本加入目录联接回归检查。[开发路线图](./PLAN.md#3-基础稳健性) · [Windows 验证](../scripts/verify-windows.mjs) · [提交 841d3f4](https://github.com/Murmureeee/Pilot/commit/841d3f4)
- **界面按设计规范对齐。** 新增强调色 `brand`，只用于未读圆点、链接与引用、焦点环、开关和复选框，侧栏焦点环与它同值。标题栏的菜单合并为一个应用菜单，主列顶栏改为 40 px 单行，放会话标题、项目、分支、审查开关和一个更多菜单。首页在未选择项目时提示并列出最近项目，选定项目后给出三个起步任务。侧栏项目行改为单行可折叠，同名项目带上一级目录，会话行用一个状态位表示待审批、运行中、停止中、已中断和未读，时间在悬停或键盘聚焦时换成操作按钮。回合给出回答后活动轨迹折成一行摘要，运行期间计划固定在输入坞上方，全部完成的计划在轨迹里收起。验收中修掉两个问题：发送后焦点还在输入框时审批卡拿不到焦点，`Enter` 和 `Esc` 无效；新一轮开始的间隙里上一回合会重新展开。八步验证通过，228 项测试通过。Windows 隔离实例里用调试端口走过首页、发送、审批（鼠标与键盘）、拒绝、计划、顶栏菜单与重命名、审查开关、侧栏悬停与右键菜单、未读、折叠后重载、`Tab` 焦点环和 12 个设置分区，覆盖中文亮色 1100 × 750、英文暗色 1100 × 750 与 720 × 480。没有验到的：需要先配置模型的首页状态和已中断状态位没有在运行中的应用里触发，中文暗色与英文亮色没有单独截图。侧栏失败状态、项目行更多菜单、摘要里的回合耗时留在路线图。[设计规范](./DESIGN.md) · [提交 e94771f](https://github.com/Murmureeee/Pilot/commit/e94771f)

### 2026-11-23

- **路线图补充实用功能。** 里程碑 4 加入技能按需加载：只注入技能的名称、说明和目录，模型用到时再读正文和附带文件。里程碑 6 加入记忆、分支与推送、差异批注、从系统进入、外部编辑器、辅助模型、技能与插件安装、发现页、项目级配置和 MCP 登录，其中引入第三方内容的三项排在命令授权范围和技能按需加载之后。里程碑 9 用用量统计、托盘与全局快捷键、页面预览、远程与容器项目替换原来的扩展包与模板。本次只改文档，已核对里程碑表与正文条目一致、本地链接有效。[开发路线图](./PLAN.md) · [提交 741fda0](https://github.com/Murmureeee/Pilot/commit/741fda0)
- **路线图补充基础稳健性。** 对照主进程、渲染层、打包和测试代码，整理出路线图没有覆盖的桌面应用基础项。新增里程碑 3「基础稳健性」，包含单实例、设置损坏保护、界面崩溃恢复、退出确认、窗口与布局记忆和运行期间不休眠，原里程碑 3 至 8 顺延为 4 至 9。安全与可靠性并入运行对象拆分、模型能力配置、会话追加写和代理验证，工作台结构与反馈并入界面场景脚本，发行里程碑并入更新策略、持久化格式版本和数据备份与恢复。本次只改文档，已核对里程碑编号、文内锚点和本地链接。[开发路线图](./PLAN.md) · [提交 75d3516](https://github.com/Murmureeee/Pilot/commit/75d3516)
- **设置页按实际行为重组。** 设置导航分为应用、集成、数据和 Pilot 四组，新增外观、权限、快捷键、技能、已归档的聊天和关于分区，导航顶部可搜索设置项。设置行改为平铺，只用细线分隔。技能和 MCP 服务的导入入口放到各自分区，失败原因就地显示。提供方保存后留在当前分区并显示「已保存」。发送方式可改为 `Ctrl+Enter`。窗口级快捷键由渲染层识别后走菜单动作白名单。设计规范同步更新设置视图和键盘表。八步验证通过，222 项测试通过。Windows 隔离实例的 16 项场景检查通过 15 项，未通过的一项是验收脚本对初始提供方的断言有误，落盘的设置正确。技能分区打开目录失败的提示没有在运行中的应用里复现，只经过类型检查和构建。[设计规范](./DESIGN.md) · [提交 0727f15](https://github.com/Murmureeee/Pilot/commit/0727f15)

### 2026-11-22

- **设计规范与路线图调整。** 新增设计规范，定义窗口骨架、各区域职责、统一审查面板、状态模型、视觉与键盘规则，并列出从 `v0.3.0` 界面到目标结构的迁移清单。路线图把命令授权范围、危险命令、命令执行、失败重试和上下文压缩提前为里程碑 3，原桌面交互里程碑改写为按迁移清单拆分的工作台结构与反馈，新增并行任务里程碑。工程规范中的骨架描述改为与现有实现一致的窗框加工作卡片结构。本次只改文档，已核对内容与本地链接。[设计规范](./DESIGN.md) · [提交 5e141fb](https://github.com/Murmureeee/Pilot/commit/5e141fb)

### 2026-11-21

- **Pilot v0.3.0 发布。** 交付里程碑 2 的 Git 审查、撤销、验证、暂存与提交，以及 Windows 应用内更新入口。GitHub Releases 提供 Windows x64 安装包、更新清单、blockmap 和 Linux x64 AppImage、Debian `.deb`。Windows 从公开 HTTPS 更新源将 `0.1.0` 升级到 `0.3.0`，安装包 SHA-512 与 `latest.yml` 一致，升级后核对了会话转录、设置、语言、主题和启用的技能。八步验证通过，219 项测试通过。[正式发布](https://github.com/Murmureeee/Pilot/releases/tag/v0.3.0) · [发版提交 573244e](https://github.com/Murmureeee/Pilot/commit/573244e18c03adf895557161a47249f1e10ac7db) · [打包验收](https://github.com/Murmureeee/Pilot/actions/runs/44891669880) · [公开更新验收](https://github.com/Murmureeee/Pilot/actions/runs/44892640787)
- **Windows 短路径兼容。** Git 审查用同一目录的长路径判断项目范围，并将工具改动归入对应的 Git 文件。用 NTFS 短路径复现 GitHub Windows CI 的 7 项失败，修复后差异、撤销、暂存、提交与验证重跑的 19 项测试通过。使用默认路径复跑八步验证，219 项测试通过。[提交 57060a6](https://github.com/Murmureeee/Pilot/commit/57060a61e7efb40ea55d3abf359c5869f52dffb6)
- **应用内更新入口。** 「帮助 → 检查更新…」显示检查结果，侧栏设置上方显示下载进度，下载完成后点击「更新并重启」即可安装。Agent 执行期间可查看状态，任务结束后可安装。Windows 用本地更新源和两个隔离 NSIS 测试包，从 0.2.1 更新到 0.2.2 并自动打开新版。复核了检查失败后的重试、中英文、浅色与 720 px 深色折叠侧栏。会话转录逐字节一致，语言和主题保留。八步验证通过，219 项测试通过。[提交 e8250c4](https://github.com/Murmureeee/Pilot/commit/e8250c49af1cf2930daa9bed4c0d22dd3e6c0f84)
- **暂存与提交。** Git 变更面板支持按文件或文本区块暂存。用户在暂存区选择提交范围、查看完整差异并填写提交信息，提交后可查看提交号、分支和更新后的清单。Windows 隔离 Electron 验收在同一文件中混合用户已暂存、未暂存和任务改动，只提交了选中的任务区块。`git show` 与预览逐字一致，索引和 CRLF 工作树文件在提交前后逐字节一致。复核了整文件暂存、720 px 窄窗、暂存区变化后拒绝旧预览，以及从面板打开任务记录和检查点。八步验证通过，219 项测试通过。[提交 2817f80](https://github.com/Murmureeee/Pilot/commit/2817f80bd7ec1ced8e1f4e1901f86ae0afd7181c)
- **验证入口。** 在会话的项目目录运行测试、类型检查和构建，支持填写项目脚本以外的命令。每次执行保存工作目录、命令、输出、状态、退出码与耗时，并关联到会话与任务。Windows 隔离验收通过项目脚本确认了实时输出、测试退出码 `0`、类型检查退出码 `7`、切换会话时构建继续执行，以及手动停止结束子进程。重启后从原会话找回三种结果，重跑沿用原目录、命令和任务。720 px 窄窗与八步验证通过，212 项测试通过。[提交 7c2ecf5](https://github.com/Murmureeee/Pilot/commit/7c2ecf55f02c95e627458163774ca9b743ef5ef5)
- **差异与撤销。** Git 面板支持逐行差异和 VS Code 行号跳转。任务检查点显示选中的反向差异，并在确认时复核当前文件和暂存条目。Windows 隔离验收在同一个文件中保留了暂存和未暂存的用户改动，先撤销所选区块，再按文件撤销其余任务改动。Git 索引逐字节一致，CRLF 原样保留。归属冲突和预览后的编辑会保留文件。复核了带空格和 `#` 的文件名跳转、720 px 窄窗和重启后恢复检查点。八步验证通过，207 项测试通过。[提交 0749a83](https://github.com/Murmureeee/Pilot/commit/0749a83c86b5c10614e37468603412e9e44391a0)
- **Git 变更。** 任务启动前记录暂存区、工作树和未跟踪文件的基线，并在会话标题旁显示变更清单。Windows 隔离实例通过本地模型接口桩运行了内置编辑、写入和 PowerShell 命令，核对了新增、修改、删除、暂存与未暂存的重命名，以及已有和新增内容重叠时的混合标记。验收逐字节核对 Git 索引，原有暂存和用户内容均得到保留。复核了 720 px 窄窗和重启后恢复本轮清单。八步验证通过，204 项测试通过。[提交 0566317](https://github.com/Murmureeee/Pilot/commit/0566317825091f51526c941f525dbffe2159b19b)
- **Pilot v0.2.1 发布。** 发布 Windows x64 安装包、更新清单与 blockmap，以及 Linux x64 AppImage 和 `.deb`。Windows 新装默认启动 `%LOCALAPPDATA%\Programs\pilot\pilot.exe`。公开 HTTPS 更新验收从 `0.1.0` 升到 `0.2.1`，校验了安装包摘要，并在重启后核对了原会话、设置、语言、主题和技能。发版验收脚本会等 NSIS 卸载进程退出后再继续安装。八步验证和 200 项测试通过。[正式发布](https://github.com/Murmureeee/Pilot/releases/tag/v0.2.1) · [发版提交 4f920e8](https://github.com/Murmureeee/Pilot/commit/4f920e8) · [打包验收](https://github.com/Murmureeee/Pilot/actions/runs/44856566335) · [公开更新验收](https://github.com/Murmureeee/Pilot/actions/runs/44857460780)
- **内部包名迁移。** Windows 新装默认使用 `%LOCALAPPDATA%\Programs\pilot\pilot.exe`，应用配置迁移到 `Pilot` 目录，Linux `.deb` 包名为 `pilot`。Windows 隔离验收通过了新装、卸载、旧版 HTTPS 升级和自定义目录内的静默覆盖安装。原会话转录、设置、语言、主题和已启用的技能都能恢复。Linux AppImage 和 `.deb` 均通过启动与 Agent 冒烟，且 `.deb` 声明替换旧包。八步验证通过，200 项测试通过。[提交 14b4710](https://github.com/Murmureeee/Pilot/commit/14b4710) · [安装与打包验收](https://github.com/Murmureeee/Pilot/actions/runs/44853929278)
- **项目指令。** 会话标题旁的「指令」显示项目根目录实际加载的 `AGENTS.md` 路径和指令优先级。Windows 隔离 Electron 验收使用两个指令不同的项目，通过本地模型接口桩核对请求内容和顺序。A 使用会话指令，B 使用全局个性化，两者都在项目指令之后加载技能。运行时切换会话仍显示各自的来源，修改 A 的文件后下一次请求发送新内容。八步验证通过，197 项测试通过。[提交 0455dd5](https://github.com/Murmureeee/Pilot/commit/0455dd5)
- **在途保存与恢复。** Windows 隔离 Electron 实例通过强制结束进程，分别验证了首段回复、两个工具步骤完成后及命令执行中退出。重启可从原工作目录打开「已中断」任务。模型接口桩在续跑请求中收到已保存的消息和工具结果，并尝试重复调用。文件修改时间和命令追加日志确认原写入和命令各执行一次，结果未落盘的步骤也保留了未知结果提示。完成后再次重启仍显示完整转录。八步验证通过，196 项测试通过。[提交 ca2cc71](https://github.com/Murmureeee/Pilot/commit/ca2cc71)
- **运行归属。** 同一时间只运行一项任务。切换会话时，原任务继续使用发起时的目录、模型和权限。其他会话保留自己的草稿，发送受阻时显示任务所在会话，并可直接返回。Windows 隔离 Electron 实例通过本地模型接口桩和真实 PowerShell 工具验证了流式回复、工具执行和待审批时切换 A、B 会话，回到 A 允许或停止任务，以及后台结束时消息与工具结果写回 A。重启后复查 A 历史和 B 草稿，并从 B 用自己的模型成功发送。八步验证通过，193 项测试通过。[提交 ce94a7b](https://github.com/Murmureeee/Pilot/commit/ce94a7b)
- **会话设置。** 输入区按会话保存模型、权限模式和未发送草稿。Windows 隔离 Electron 验收覆盖同一项目内两个会话的来回切换与重启、多行草稿及文件引用恢复，以及旧会话和手动清除覆盖后的全局默认值。通过本地模型接口桩核对两个会话的请求模型，复核只读模式拦截写入和完全访问模式允许写入。八步验证通过，190 项测试通过。[提交 64b0424](https://github.com/Murmureeee/Pilot/commit/64b0424)

### 2026-11-20

- **最近项目与会话分组。** 侧栏保留最近打开的目录，按项目组织会话，Git 项目在标题旁显示分支。Windows 隔离 Electron 实例验证了重启后从侧栏打开无会话目录和 Git 项目、窗口聚焦时刷新分支，以及从「未关联项目」打开旧会话并关联到最近项目。再次重启后会话归组恢复，原转录逐字节一致。首次打开新目录使用选择结果夹具。八步验证通过，185 项测试通过。[提交 dcf8a6f](https://github.com/Murmureeee/Pilot/commit/dcf8a6f)
- **项目入口与会话目录绑定。** 可从侧栏或文件菜单打开本地文件夹，新聊天沿用项目目录并在标题下显示。Windows 隔离 Electron 实例验证了两个项目的文件搜索、同名文件预览、切换后工具写入和重启恢复。旧会话关联前沿用默认工作目录，手动关联后按项目查找文件，原转录逐字节一致。原生文件夹选择结果由测试夹具提供。八步验证通过，181 项测试通过。[提交 ee63460](https://github.com/Murmureeee/Pilot/commit/ee63460)
- **输入区审批卡。** 等待审批时在输入区显示操作与详情，允许用键盘处理，多个请求按顺序展示。处理后恢复草稿。Windows 隔离实例验证了命令展开、键盘允许与拒绝、草稿和焦点恢复、浅色与 720 px 深色布局。八步验证通过，175 项测试通过。[提交 d6720fa](https://github.com/Murmureeee/Pilot/commit/d6720fa)
- **文件变更审查。** 将文本文件的逐行差异按目录组织，提供变更面板与独立的文件导航。可从聊天定位差异，并在校验当前文件后逐文件撤销内置编辑或写入产生的变更。[目录分组](https://github.com/Murmureeee/Pilot/commit/11dfea2) · [差异与导航](https://github.com/Murmureeee/Pilot/commit/08573f5)
- **对话与工具轨迹。** 加入结构化文件引用和工具轨迹，支持回到最新消息、手动折叠思考块，以及从输入区查看最近一次请求的上下文占用。[引用与轨迹](https://github.com/Murmureeee/Pilot/commit/1941e68) · [对话跳转](https://github.com/Murmureeee/Pilot/commit/5b17c4a) · [上下文用量](https://github.com/Murmureeee/Pilot/commit/895a188)
- **模型目录、界面语言与本地诊断。** 设置可浏览模型目录并测试连接，渲染层接入 i18next 和 react-i18next，主进程与渲染层等诊断信息写入本地滚动日志。[设置与诊断](https://github.com/Murmureeee/Pilot/commit/3290754) · [语言接入](https://github.com/Murmureeee/Pilot/commit/10a949f)
- **开发路线图。** 整理首个日用版的六个里程碑和验收条件，明确独立模块通过验证后提交并推送。已核对文档内容和本地链接。[提交 b6829ab](https://github.com/Murmureeee/Pilot/commit/b6829ab)

## 历史验收

| 范围 | 已验证的场景 | 证据 |
| --- | --- | --- |
| Windows 开发版（2026-11-19） | 流式渲染、停止与重启恢复。隔离配置复核侧栏折叠、窄窗、双语切换、首次配置、计划恢复及审批写入。八步验证通过，84 项测试通过。 | [旧版计划的阶段验收](https://github.com/Murmureeee/Pilot/blob/d6720faa619b970ead1874fc2276047536ed2d96/PLAN.md#4-开发路线图) |
| Windows 安装版（2026-11-19） | 首次引导、拒绝与允许写入、技能启停持久化和重启恢复。八步验证通过，104 项自动化测试通过。冷启动到可交互约 1.27 秒，500 条消息滚动的帧间隔 P95 为 18.2 毫秒。120 个文字增量到渲染帧的延迟 P95 为 31.8 毫秒，最大 32.3 毫秒。 | [旧版计划的阶段验收](https://github.com/Murmureeee/Pilot/blob/d6720faa619b970ead1874fc2276047536ed2d96/PLAN.md#4-开发路线图) |
| Windows x64 新装与升级 | 用 0.1.0 兼容安装包覆盖到 0.1.1，复核首次运行、卸载、会话和偏好保留。公开 HTTPS 更新验收核对更新清单、安装包和 blockmap，用户确认安装并重启后保留原会话、设置、语言和技能。 | [新装及升级](https://github.com/Murmureeee/Pilot/actions/runs/44536855149) · [公开更新](https://github.com/Murmureeee/Pilot/actions/runs/44561428215) · [v0.1.1](https://github.com/Murmureeee/Pilot/releases/tag/v0.1.1) |
| Windows 默认 CI | 旧版清单记录云端 115 项自动化测试通过，覆盖适配层、权限、会话、工具、技能、设置、模型目录、IPC 和外部导入。 | [默认检查记录](https://github.com/Murmureeee/Pilot/actions/runs/44671592973) |
| Linux x64 | 在 Ubuntu 24.04 runner 构建 AppImage 和 .deb。两种产物通过启动和 Agent 冒烟，.deb 从解包后的程序启动。桌面安装和升级验收见路线图。 | [Linux 打包验证](https://github.com/Murmureeee/Pilot/actions/runs/44669912414) |
| 模型与集成 | 本地协议桩覆盖了 Ollama 和 LM Studio 的模型目录、连通性、端点切换和流式对话。Windows 安装版验证了 stdio 和 Streamable HTTP MCP 工具发现、独立启停、审批、凭据存储和工具卡片恢复。 | [旧版计划的阶段验收](https://github.com/Murmureeee/Pilot/blob/d6720faa619b970ead1874fc2276047536ed2d96/PLAN.md#4-开发路线图) |
| 本地滚动日志 | 主进程、渲染层和更新状态写入诊断日志，最多保留 3 个 1 MiB 文件。隔离环境验收了轮转、错误内容过滤、日志级别重启恢复和写入失败时继续运行。 | [诊断功能提交](https://github.com/Murmureeee/Pilot/commit/3290754) · [旧版验收记录](https://github.com/Murmureeee/Pilot/blob/d6720faa619b970ead1874fc2276047536ed2d96/PLAN.md#第一步-windows-预发布) |

## 旧版完成清单

以下保留重整路线图前的 99 条已勾选原文。条目记录了各阶段当时的交付状态，后续界面与验收变化见上方记录。[旧版计划原文](https://github.com/Murmureeee/Pilot/blob/d6720faa619b970ead1874fc2276047536ed2d96/PLAN.md)

<details>
<summary>阶段交付记录</summary>

#### Phase 0 · 工程地基（约 0.5–1 周）

- [x] electron-vite 脚手架（React + TS），Electron 45 初始化
- [x] Tailwind v4 + shadcn/ui 基础积木安装 —— 实际落在 **base-rhea 世代（Base UI 原语 `@base-ui/react`）**，AI Elements 模式文档全部基于此世代；AI Elements 上层组件（chat/tool/confirmation 等）为按 Phase 取用的复制式模式，非一次性安装
- [x] oxlint + oxfmt + vitest + knip 接入，`ci` 脚本就位
- [x] `shared/contract.ts` 建立，preload 空通道 ping-pong 打通
- [x] **验证 pi 在 Electron 主进程 Node 上可运行**：Electron 45 内置 **Node 24.22.3** ≥ 22.19，faux provider 完整跑通一轮（agent_start → … → agent_end，流式文本正确）→ **sidecar 方案取消**
- [x] 渲染进程 CSP、contextIsolation、sandbox 配置到位

#### Phase 1 · 核心链路 MVP（约 1 周）

- [x] agent-host：`createModels()` + 单 provider（Anthropic + 任一 OpenAI 兼容端）+ API key 从 safeStorage 读 —— 实现走「直连 API 实现模块」路线（pi-ai `api/anthropic-messages` / `api/openai-completions`），绕过 provider 凭据体系；faux 作为开箱默认 provider（60 tok/s 限速流式 + 回显）
- [x] IPC：prompt / abort / 事件推送（`AGENT_EVENT_CHANNEL` 单向推送 + invoke 请求通道）
- [x] 渲染层：ChatView + `Response`（Streamdown 流式 Markdown）+ 发送/停止状态切换 + MessageScroller 吸底
- [x] adapters：`message_update(text_delta)` → zustand store 增量渲染（纯函数 reducer，有单测）+ 光标
- [x] `agent_end` 时 JSONL 落盘；启动时可载入最近会话（原子写 tmp+rename；agent_end 时以转录为准全量校准 UI）

#### Phase 2 · 工具系统与权限（约 1 周）

- [x] 6 个内置工具：read_file / write_file / edit_file / bash / glob / grep（pi-schema 定义，含 Windows 路径与 shell 适配）—— bash 走 PowerShell（UTF-8 输出）+ 超时/中止 + 流式 stdout；grep/glob 自实现递归扫描（跳过 node_modules/.git）；工具 cwd = 用户主目录（Phase 3 设置项化）
- [x] `beforeToolCall` 权限门：弹窗 [本次允许 / 本会话总是 / 总是允许 / 拒绝]，规则持久化 —— 读类（read_file/glob/grep）默认放行；规则 = {toolName, pathPrefix?}（会话内存 + settings.toolRules 全局持久化）
- [x] 工具卡片 UI：Trace 线状态机（排队/运行/完成/失败）+ 可折叠参数/输出详情 + 失败默认展开
- [x] steer（插话）：运行中输入自动转 `agent.steer()` + 队列计数展示；abort 时权限 pending 全部按拒绝结算（防卡死）
- [x] 状态栏：token（input+output+cache）/ 费用（usage.cost.total 累计）/ 等待审批状态

#### Phase 3 · 完整产品 UI（约 1–2 周）

- [x] 会话侧栏：列表 / 重命名 / 删除 / 新建；自动标题（首条用户消息）—— 重命名走行内输入（titleCustom 保护，自动标题不再覆盖）；删除当前会话回草稿态；搜索由 FR-4.13 命令面板承担
- [x] 设置页支持多个提供方、API Key、各自的模型列表和可见思考档位。聊天输入框可切换当前提供方的模型和启用的档位。
- [x] `Reasoning` 思考块流式折叠 —— thinking_start/delta 事件 + 独立 part；流式自动展开、结束自动折叠，转录恢复同样保留思考块
- [x] 首次启动引导支持选择提供方、输入连接信息和确认模型。内置演示模型无需密钥即可完成。
- [x] Skills 管理（本地导入 + 启停注入）与个性化（人设 / 自定义指令 / 每会话覆盖）—— ✅ 设置页「个性化」「技能」两分区 + 右键「会话指令」覆盖；注入顺序 = 应用提示词 → 人设（会话覆盖优先）→ 技能 sections
- [x] 设置「常规」中的外观与语言支持中文和 English 即时切换并在重启后恢复。
- [x] 模型可用 `update_plan` 维护任务步骤。同一轮更新当前计划，会话重开后恢复。内置演示模型可发送「计划演示」体验。
- [x] 设置「常规」中的工作环境支持选择工作目录并切换 Windows 的 PowerShell / Git Bash。设置在下一次运行时生效。
- [x] Markdown 链接拦截 → 默认浏览器打开 —— Phase 0 已实现（setWindowOpenHandler 拒绝新窗 + http(s) 走 shell.openExternal）
- [x] 空状态、错误态、断网重试提示 —— 空态居中大标题 + 引导卡；错误条回显（含模型请求失败），重发即重试

#### Phase 4 · 产品化

- [x] Windows x64 NSIS 已通过临时目录安装和卸载。
- [x] Windows NSIS 自动更新。更新检查和下载状态显示在「帮助 → 关于 Pilot」，用户确认后退出并安装。已用本地更新源完成 0.1.0 → 0.1.1 实际升级。
- [x] 本地模型接入。Ollama 和 LM Studio 预设支持免密钥配置。已用本地协议桩验证模型目录、连通性测试、端点切换和流式对话，实际模型推理待验收。
- [x] MCP 接入（`pi-mcp` → AgentTool 桥）和服务配置。Windows 安装版已验证 stdio / Streamable HTTP 工具发现、独立启停、审批拒绝与允许、环境变量加密以及工具卡片恢复。
- [x] 设置「导入」集中提供技能、MCP 服务和插件组件的导入弹窗。先预览 Codex 和 Claude Code 的用户与项目配置，勾选并确认后导入所选项目。插件预览列出可导入的技能和 MCP 配置。
- [x] 输入框支持 / 快捷操作和 @ 文件引用。左侧 + 可点选同一工作目录的文件和文件夹。Windows 窄窗口验收覆盖键盘选择、中文搜索、移除引用和会话恢复（FR-4.16–FR-4.18）。
- [x] 渲染层接入 i18next 和 react-i18next。词条随应用加载，缺失时回退到中文原文。语言列表与 IPC 复用同一份定义，继续读取旧的 `zh` / `en` 偏好。

</details>

<details>
<summary>功能需求与质量记录（FR、NFR）</summary>

#### FR-1 · Agent 运行时（主进程）

- [x] FR-1.1 (P0/Ph1) 创建/销毁 Agent 实例；切换会话 = 按持久化 messages 重建
- [x] FR-1.2 (P0/Ph1) 文本消息从输入框经 IPC 接入 `Agent.prompt`。
- [x] FR-1.3 (P0/Ph1) `abort()` 立即中断当前流，UI 同步回发送态（stopReason 区分 aborted）
- [x] FR-1.4 (P1/Ph2) `steer()` 工具运行中插话；`followUp()` 停止前排队；队列可清空（`clearAllQueues`）—— ✅ 收尾补全：composer「清空排队」按钮（agent:clear-queue）整表撤回 steer+followUp
- [x] FR-1.5 (P1/Ph2) `steeringMode / followUpMode` = one-at-a-time（默认）
- [x] FR-1.6 (P1/Ph2) 运行时切换 `state.model` 与 `thinkingLevel`，下一轮生效 —— ✅ thinkingLevel 运行时同步；provider/模型变更 → ensureAgent 检测变更重建 Agent（转录从落盘恢复，下一轮请求生效）
- [x] FR-1.7 (P1/Ph2) 系统提示词可配置（应用人设 + 个性化指令）；技能说明经 systemPrompt sections 注入 —— ✅ buildSystemPrompt 组装 + systemPrompt 指纹变更即重建 Agent（下一轮生效）
- [x] FR-1.9 (P0/Ph1) 全事件订阅桥接 IPC；`waitForIdle` 支撑批量落盘时机

#### FR-2 · 工具系统（主进程）

- [x] FR-2.1 (P0/Ph2) 6 个内置工具，pi-schema 类型化参数；工具失败**抛异常**（转 isError 给模型）
- [x] FR-2.2 (P0/Ph2) `beforeToolCall` 权限门：拒绝时 `block: true` + reason
- [x] FR-2.3 (P1/Ph2) 权限规则持久化（per 工具 per 路径前缀），会话级与全局级
- [x] FR-2.4 (P1/Ph2) 工具级 `executionMode`：bash = sequential，其余 parallel
- [x] FR-2.9 (P1/Ph2) 权限模式三档（composer 徽章切换）：standard（读放行写确认）/ read-only（写类直接拒绝）/ full-access（全放行）；存储于 settings.approvalMode
- [x] FR-2.5 (P1/Ph2→Ph3) bash 工具支持超时和流式输出。Windows 默认 PowerShell，可在设置切换 Git Bash。命令从工作目录启动，选择自定义目录后文件和搜索工具限定在该目录。
- [x] FR-2.7 (P1/Ph4) MCP 服务工具经 AgentTool 桥进入现有权限门。每个服务可独立启停，并选择继承全局权限或要求确认。
- [x] FR-2.8 (P1/Ph4→Ph3 提前) 技能加载器：发现/解析技能（SKILL.md frontmatter + 正文），按启用状态注入 systemPrompt sections

#### FR-3 · IPC 契约（shared/）

- [x] FR-3.1 (P0/Ph0) `shared/contract.ts` 定义全部通道与类型，主/预加载/渲染三处共用
- [x] FR-3.2 (P0/Ph0) preload contextBridge 暴露 `window.pi.*` 类型化 API；渲染层禁止其他 IPC 访问
- [x] FR-3.3 (P0/Ph1) 事件推送通道：pi 事件归并为 `UiAgentEvent` 联合类型推送（渲染层不 import pi 类型）
- [x] FR-3.4 (P0/Ph2) 所有主进程 invoke 通道通过同一入口做 Zod 校验，覆盖参数个数、枚举、标识符和嵌套设置。回归测试覆盖合法调用和无效入参。

#### FR-4 · 主界面 UI（渲染层）

- [x] FR-4.1 (P0/Ph1) ChatView：消息流 + `Response` 流式 Markdown + 流式光标
- [x] FR-4.2 (P0/Ph1) 输入区：多行、发送/停止状态互斥、Enter 发送 Shift+Enter 换行
- [x] FR-4.3 (P0/Ph2) 工具事件按顺序显示为 `Trace`，可展开查看参数、流式输出和错误。JavaScript 栈帧可打开工作区源码并定位行号。
- [x] FR-4.4 (P1/Ph2) 权限弹窗显示申请的操作。点击关闭或按 Esc 会拒绝本次请求。危险命令使用红色提示。
- [x] FR-4.5 (P1/Ph2) 思考块使用 `Trace` 展示流式内容与实测耗时。默认在生成时展开、结束后收起，用户可手动展开或收起。重开会话仍可查看。
- [x] FR-4.6 (P1/Ph2) `Queue` 展示 steer/followUp 队列；运行中输入自动转为 steer
- [x] FR-4.7 (P1/Ph2) 运行状态栏显示 token、费用和进度。模型上下文上限随用量快照同步到界面，输入框可查看最近一次请求的占用和百分比，超过 80% 用橙色提示。
- [x] FR-4.8 (P1/Ph3) 在设置选择当前提供方。Composer 用同一个按钮显示模型和强度，弹窗先显示强度，点模型名进入当前提供方的模型列表，选完返回强度。强度控制显示已启用的档位。
- [x] FR-4.9 (P1/Ph3) 会话侧栏：列表 / 新建 / 重命名 / 置顶 / 归档 / 标记未读 / 分叉 / 复制全文 / 永久删除（带确认）—— ✅ 右键上下文菜单对齐 ChatGPT 语义 + 悬停浮现「置顶/归档」双按钮 + 侧栏三分区（置顶 / 最近 / 已归档）+ 未读圆点加粗（打开即清）+ 分叉复制转录 + 删除当前会话回草稿态；搜索由 FR-4.13 命令面板承担。取舍不变：项目（分组系统）不做；在新窗口打开（多窗口状态模型）暂缓
- [x] FR-4.13 (P1/Ph3) 全局命令面板：Ctrl+K 唤起（侧栏搜索按钮入口），搜快捷操作（新聊天/设置/权限模式切换）+ 会话（标题过滤 + 相对时间），底部「全部/操作/聊天」过滤标签，键盘上下选择 + Enter 执行；Ctrl+N 新聊天
- [x] FR-4.14 (P1/Ph3) 顶部 38px 留给窗口操作，左侧集中放置历史导航、侧栏展开/收起、文件/编辑/视图/帮助菜单，右侧是拖拽区域和原生窗控。主区的会话标题位于工具栏下方。窗口动作通过 IPC 白名单调用原生功能。
- [x] FR-4.15 (P2/Ph3) 用户发送至少五条消息后，对话列左侧在留白内显示轮次刻度。滚动正文会高亮可见轮次，悬停可预览，点击可跳转。阅读较早的内容时可一键回到最新消息。
- [x] FR-4.10 (P2/Ph3) `Plan`/`Task` 通过结构化工具调用展示待处理、进行中和已完成的步骤，用转录恢复计划。
- [x] FR-4.16 (P1/Ph4) 输入 `/` 在光标旁打开紧凑单行菜单，可模糊搜索快捷命令和已安装技能。选择快捷命令立即执行。选择技能插入芯片，发送后为当次运行加载技能指令。菜单支持方向键、Enter、Esc 和失焦关闭。
- [x] FR-4.17 (P1/Ph4) 输入 `@` 按名称或相对路径查找工作目录中的文件、文件夹与已启用技能。选中后在光标处插入可整体删除的行内芯片。发送时主进程校验结构化提及，Agent 通过现有文件工具和技能配置使用资源。
- [x] FR-4.18 (P1/Ph4) 输入框左侧 `+` 打开文件和文件夹选择器，选中后在草稿中插入同一种提及芯片。图片附件随 FR-1.10 接入。

#### FR-5 · 设置（渲染层 + 主进程）

- [x] FR-5.1 (P0/Ph3) Provider + API Key 管理：增删改、掩码显示、连通性测试（最小流式探测，emerald 成功/红 失败行内回显）、自定义 OpenAI 兼容端点（base URL，覆盖 Ollama / LM Studio / 中转站）
- [x] FR-5.2 (P0/Ph3) 每个提供方可保存多个模型，旧配置的单个模型 ID 自动成为列表首项。Anthropic 使用 Pi 模型目录，OpenAI Responses 和兼容接口通过 GET /models 获取列表。可多选添加、手动添加或移除模型。
- [x] FR-5.3 (P1/Ph3) thinkingLevel 全局默认 + 会话内临时切换 —— ✅ 已落地：composer 模型菜单内置思考强度滑块（7 档渐变轨道，Codex 截图同款交互），持久化 settings.thinkingLevel + 运行时同步当前 Agent（下一轮请求生效）
- [x] FR-5.4 (P1/Ph3) 已授权规则管理（撤销入口）—— ✅ 收尾补全：设置页列出 settings.toolRules（工具名 + 路径前缀上下结构）+ 单条撤销（整表提交，下一轮权限门生效）；per-工具总开关随 MCP 一并做
- [x] FR-5.5 (P1/Ph3) 外观设置支持亮色、暗色和跟随系统，同步原生标题栏配色。中英界面可即时切换并本地保存。
- [x] FR-5.6 (P2/Ph3) 数据目录展示 + 打开（shell.openPath 白名单目标）—— 自定义目录与导出诊断随 Phase 4
- [x] FR-5.7 (P0/Ph3) 无可用 Provider 时可从对话空态打开三步配置向导。演示模型可以直接启用，真实提供方可在选择模型后测试连接。
- [x] FR-5.8 (P1/Ph3) Skills 管理支持从本地选择含 `SKILL.md` 的目录并复制导入，可识别链接目录，重名自动加后缀。启停会保存并在下一轮请求时生效。
- [x] FR-5.9 (P1/Ph3) 个性化：全局人设与自定义指令（设置页文本域）+ 每会话覆盖（右键「会话指令」，空白清除回落全局）；顺序 = 应用提示词 → 自定义指令 → 技能 sections
- [x] FR-5.10 (P1/Ph4) 设置「MCP 服务」支持 stdio / Streamable HTTP、command / args / env 编辑、启停、重连、工具清单和连接状态。stdio 环境变量使用系统密钥服务加密。

#### FR-6 · 会话持久化（主进程）

- [x] FR-6.1 (P0/Ph1) JSONL：每会话一文件（userData/sessions/），`agent_end` 与 abort 时增量落盘
- [x] FR-6.2 (P0/Ph1) 启动恢复：读 JSONL → `initialState.messages`
- [x] FR-6.3 (P1/Ph3) 会话索引（列表/updatedAt 排序/搜索走命令面板）、重命名、删除（含转录文件）
- [x] FR-6.4 (P1/Ph3) 自动标题：取首条用户消息（titleCustom 手动命名保护）；P2 小模型生成随 Phase 4

#### FR-7 · 安全（主进程 + preload）

- [x] FR-7.1 (P0/Ph0) `contextIsolation: true`、`nodeIntegration: false`、sandbox、渲染层 CSP（生产注入）
- [x] FR-7.2 (P0/Ph1) API Key 仅存主进程 safeStorage 加密文件；渲染层只见 hasKey 标志
- [x] FR-7.3 (P0/Ph3) Markdown 内链接拦截 → `shell.openExternal`（setWindowOpenHandler 拒新窗 + http/https 白名单）
- [x] FR-7.4 (P0/Ph2) 工具作用域约束：权限门 pathPrefix 规则 + cwd=用户主目录；bash 超时（≤300s）杀进程
- [x] FR-7.5 (P1/Ph2) 权限门对 bash 命令做危险模式提示（rm -rf 等，硬编码列表 + 展示原文）

#### FR-8 · 打包与分发（Phase 4）

- [x] FR-8.1 (P0/Ph0) **Node 兼容验证**：✅ Electron 45 内置 Node 24.22.3 ≥ 22.19，pi 冒烟通过，sidecar 方案取消
- [x] FR-8.3 (P1/Ph4) Windows 安装版支持自动检查、下载和退出安装。设置 `PILOT_UPDATE_URL` 后运行 `pnpm package:win` 会在 `dist/release` 生成安装包、blockmap 和 `latest.yml`。
- [x] FR-8.5 (P1/Ph4) 云端 Windows 验证流水线与手动生成的 Windows 和 Linux 测试安装包。
- [x] FR-8.6 (P1/Ph4) GitHub Releases 公开更新源已上线，Windows 0.1.0 → 0.1.1 升级通过验收。

#### FR-9 · 可观测性

- [x] FR-9.1 (P1/Ph1) 主进程、渲染层和更新状态的本地滚动日志，级别可配置。

#### NFR · 非功能需求

- [x] NFR-1 (P0) Windows 安装版长回复测试中，120 个文字增量到 `requestAnimationFrame` 回调的最大延迟为 32.3 毫秒，低于 100 毫秒目标。采样的 111 个帧间隔 P95 为 16.8 毫秒。
- [x] NFR-2 (P1) Windows 安装版首次启动到可交互约 1.27 秒，低于 3 秒目标。
- [x] NFR-3 (P1) Windows 安装版的 500 条消息滚动通过，帧间隔 p95 为 18.2 毫秒。
- [x] NFR-4 (P1) 会话落盘为原子写（临时文件 + rename），崩溃不丢已确认消息
- [x] NFR-5 (P0) 8 步门禁全绿才可宣布完成：oxfmt / typecheck / oxlint / vitest / knip / build / smoke / dev 挂载
- [x] NFR-6 (P1) Windows 云端通过 115 项自动化测试，覆盖适配层、权限门、会话存储、工具、技能、设置、模型目录、IPC 校验和外部导入。

</details>
