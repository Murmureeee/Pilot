# Pilot 开发完成记录

完成一个模块后，在近期交付里追加日期、交付范围、提交和验收结果。发布时面向用户的版本说明见中文更新记录。[开发路线图](./PLAN.md) · [中文更新记录](../CHANGELOG.md)

## 近期交付

### 2026-11-24

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
