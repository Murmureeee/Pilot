# Pilot · 开发计划

> 基于 pi（earendil-works/pi）v1.5.x SDK 构建的桌面 AI Agent 应用。
> 本文档记录当前实现、开发顺序和验收标准。依赖以 `pnpm-lock.yaml` 为准。

## 0. 当前进度

Pilot 已具备日常文本对话、会话恢复、工具审批、Provider 设置、技能管理和按项导入 Codex / Claude Code 的能力。Windows x64 v0.1.1 已在 GitHub Releases 发布，云端新装和公开 HTTPS 更新验收均已通过。下一项是实测 Ollama 和 LM Studio 的连接与流式对话。

开发顺序为 [Windows 预发布](#第一步-windows-预发布)、[界面多语言](#第二步-界面多语言)、[本地定时任务](#第三步-本地定时任务)和[其余待办](#后续工作)。

---

## 1. 技术栈定稿

### 1.1 核心栈

| 层 | 选型 | 版本 | 说明 |
|----|------|------|------|
| 语言 | TypeScript | 7.0.2 | 通过 `src/shared/` 的类型共享 IPC 契约，pi 类型留在主进程 |
| 构建工具 | Node.js / pnpm | 26.13.0 / 11.21.0 | Windows CI 固定版本，按锁文件安装 |
| 桌面壳 | Electron | 45.3.3 | 使用内置 Node 运行 Agent，渲染层使用 `contextIsolation` 和 sandbox |
| 工程脚手架 | electron-vite | 6.0.0 | main/preload/renderer 三段构建一体化，锁 Vite 版本（当前 Vite 8.3.8） |
| 前端框架 | React | 19.3.1 | AI Elements 要求 React 19 |
| 样式 | Tailwind CSS | 4.3.5 | shadcn/ui 的硬依赖（CSS Variables 模式） |
| 组件库 | shadcn/ui + AI Elements | registry | **vendor 进项目**（代码归仓库，非 npm 依赖）；AI Elements 用 shadcn/ui 官方版 |
| 状态管理 | zustand | 5.1.0 | pi 事件流 → store 单向同步 |
| Agent 核心 | `@earendil-works/pi-agent-core` | 1.5.2 | Agent 类、事件流、工具执行、steer/followUp |
| LLM API | `@earendil-works/pi-ai` | 1.5.2 | 30+ provider（含 ZAI/MiniMax/Moonshot/Qwen 国内线 + Ollama 本地）、usage/cost 统计 |
| 工具 Schema | `@earendil-works/pi-schema` | 1.5.2 | `obj()/str()` 构建 AgentTool 参数并类型化 |
| MCP | `@earendil-works/pi-mcp` | 1.5.2 | stdio / Streamable HTTP 外部工具 |
| 会话存储 | JSONL 文件 | — | 每会话一文件，与 pi 官方风格一致；不引入 SQLite（需要查询再说） |
| 密钥存储 | Electron safeStorage | — | 系统钥匙串加密，密钥永不进渲染层 |

### 1.2 工程质量工具

| 用途 | 选型 | 版本 | 说明 |
|------|------|------|------|
| Lint | oxlint | 1.94.0 | TS/React hooks/imports/无障碍规则 |
| 格式化 | oxfmt | 0.79.0 | pre-1.0，接受格式 churn；不使用 ESLint + Prettier |
| 单测 | vitest | 5.1.0 | 适配层、会话存储、权限逻辑必须有测试 |
| 死代码检查 | knip | 6.45.1 | 未用文件/导出/依赖 |
| 打包 | electron-builder | 26.18.0 | win / mac / linux 三平台 |
| 自动更新 | electron-updater | 6.8.11 | Windows NSIS |
| CI 门禁 | `pnpm run ci` / GitHub Actions | — | 本地快速检查与 Windows 八步门禁见 `AGENTS.md` |

### 1.3 代码规范（执行约定）

- 类型一律放 `types.ts` / `types/*.ts`；常量放 `constants.ts`
- 显式 return type；避免复杂内联类型
- 显式 import，关闭一切 auto-import
- 环境相关文件头部标注 `// @env node` / `// @env browser`
- 注释只写"为什么"，不写"怎么做"
- 提交前按 `AGENTS.md` 的顺序格式化并验证，记录测试运行与安装包来自哪次提交。

### 1.4 明确不使用 / 按需引入

| 项 | 决策 |
|----|------|
| react-markdown + shiki | ❌ 不用，`Response`（内置 Streamdown）完全替代 |
| ESLint / Prettier | ❌ 不用（oxlint + oxfmt 替代） |
| virtua 虚拟列表 | ⏸ 按需：仅当需要数千条消息无限滚动时引入（Phase 4 评估） |
| SQLite / better-sqlite3 | ⏸ 按需 |
| Next.js / Vercel AI SDK | ❌ 不用（组件只吃 props，不搬模板） |
| Tauri | ❌ 不用（pi 需 Node 运行时，Electron 零胶水） |

---

## 2. 系统架构

```
┌─────────────────────────────────────────────────────────┐
│ 渲染进程 React UI（sandbox，无 Node 能力，无密钥）           │
│  views: Chat / Settings / Onboarding                     │
│  stores: agentStore / sessionStore / settingsStore        │
│  adapters: pi 事件 → AI Elements parts  ★唯一胶水          │
└────────────────────┬────────────────────────────────────┘
   preload（contextBridge，类型化 API，唯一通道）
┌────────────────────┴────────────────────────────────────┐
│ 主进程 Node                                              │
│  agent-host:                                             │
│    · models.ts     createModels() + provider 注册          │
│    · host.ts       new Agent({streamFn}) 生命周期管理       │
│    · tools/        AgentTool 定义（read/write/edit/bash…） │
│    · permissions.ts beforeToolCall 权限门 → 弹窗            │
│    · session-store.ts JSONL 读写                          │
│  security: safeStorage 密钥 / CSP / IPC 输入校验            │
└─────────────────────────────────────────────────────────┘
```

**数据流（两条单向通道）**

- UI → 主进程：`prompt / abort / steer / followUp / 切换模型 / 权限应答 / 会话管理 / 设置读写`
- 主进程 → UI：`agent.subscribe()` 事件透传（`message_update`、`tool_execution_*` 等）+ 权限请求 + 状态推送

**pi 事件 → AI Elements 组件映射（适配层职责）**

| pi 侧 | AI Elements 组件 |
|--------|------------------|
| `message_update(text_delta)` → 流式正文 | `Response` |
| thinking 块 | `Reasoning` |
| `tool_execution_start/update/end` | `Tool` / `Terminal`（bash）/ `Stack Trace`（失败） |
| `beforeToolCall` 拦截 | `Confirmation` |
| `steer()` / `followUp()` 队列 | `Queue` |
| `state.model` + `thinkingLevel` | `Model Selector` |
| usage / cost / 上下文占用 | `Context` |
| 任务步骤 | `Plan` / `Task` / `ChainOfThought` |
| 文件变更 | `File Tree` |
| 滚动跟随 | `Conversation`（不含虚拟化） |
| 输入框、附件、发送/停止 | `Prompt Input` |
| 引用来源 | `Sources` / `Inline Citation` |

---

## 3. 项目结构

```
pi-desktop/
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ package.json
├─ resources/                    # 图标等静态资源
├─ src/
│  ├─ main/                      # 主进程（@env node）
│  │  ├─ index.ts                # app 生命周期、窗口管理
│  │  ├─ agent-host/
│  │  │  ├─ host.ts              # Agent 创建/销毁/事件桥接
│  │  │  ├─ models.ts            # provider 注册、模型目录、密钥解析
│  │  │  ├─ permissions.ts       # beforeToolCall 门禁 + 规则持久化
│  │  │  ├─ tools/
│  │  │  │  ├─ read-file.ts  write-file.ts  edit-file.ts
│  │  │  │  ├─ bash.ts           # Windows 适配（PowerShell/Git Bash）
│  │  │  │  └─ glob.ts  grep.ts
│  │  │  ├─ skills.ts             # 技能发现/解析/注入（system sections）
│  │  │  └─ session-store.ts     # JSONL 读写、索引
│  │  ├─ ipc/                    # 通道注册 + 入参校验（zod）
│  │  ├─ security/
│  │  │  └─ keys.ts              # safeStorage 加解密
│  │  └─ logging.ts
│  ├─ preload/
│  │  └─ index.ts                # contextBridge 暴露类型化 API
│  ├─ shared/                    # ★ 双进程共用契约（无运行时代码）
│  │  ├─ contract.ts             # 通道名 + 请求/响应/事件类型
│  │  └─ types.ts
│  └─ renderer/                  # 渲染进程（@env browser）
│     ├─ stores/                 # agent / session / settings (zustand)
│     ├─ adapters/               # pi 事件 → parts 结构  ★
│     ├─ views/                  # ChatView / SettingsView / OnboardingView
│     ├─ components/
│     │  ├─ ai/                  # AI Elements（shadcn CLI 安装）
│     │  └─ ui/                  # shadcn/ui 基础组件
│     └─ lib/
│        ├─ i18n.ts
│        └─ markdown-links.ts    # 链接拦截 → shell.openExternal
└─ tests/                        # adapters / permissions / session-store
```

---

## 4. 开发路线图

### Phase 0 · 工程地基（约 0.5–1 周）

**目标**：空壳可运行，工具链全绿，pi 兼容性验证完成。

- [x] electron-vite 脚手架（React + TS），Electron 45 初始化
- [x] Tailwind v4 + shadcn/ui 基础积木安装 —— 实际落在 **base-rhea 世代（Base UI 原语 `@base-ui/react`）**，AI Elements 模式文档全部基于此世代；AI Elements 上层组件（chat/tool/confirmation 等）为按 Phase 取用的复制式模式，非一次性安装
- [x] oxlint + oxfmt + vitest + knip 接入，`ci` 脚本就位
- [x] `shared/contract.ts` 建立，preload 空通道 ping-pong 打通
- [x] **验证 pi 在 Electron 主进程 Node 上可运行**：Electron 45 内置 **Node 24.22.3** ≥ 22.19，faux provider 完整跑通一轮（agent_start → … → agent_end，流式文本正确）→ **sidecar 方案取消**
- [x] 渲染进程 CSP、contextIsolation、sandbox 配置到位

> 运维注记：Electron 二进制下载在国内网络需 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 重跑 `node node_modules/electron/install.js`；重装依赖后若 `node_modules/electron/path.txt` 丢失按此恢复。zustand 与 pi-schema 暂未进 package.json（Phase 1/2 用到时再加回，保持 knip 诚实）。

**验收**：`pnpm ci` 全绿；窗口可开；IPC 往返正常；`new Agent()` 在主进程实例化成功并完成一次 `prompt("hi")` 冒烟测试（结果打到日志即可，UI 未接）。

### Phase 1 · 核心链路 MVP（约 1 周）

**目标**：最短路径跑通「输入 → 流式渲染 → 会话恢复」。

- [x] agent-host：`createModels()` + 单 provider（Anthropic + 任一 OpenAI 兼容端）+ API key 从 safeStorage 读 —— 实现走「直连 API 实现模块」路线（pi-ai `api/anthropic-messages` / `api/openai-completions`），绕过 provider 凭据体系；faux 作为开箱默认 provider（60 tok/s 限速流式 + 回显）
- [x] IPC：prompt / abort / 事件推送（`AGENT_EVENT_CHANNEL` 单向推送 + invoke 请求通道）
- [x] 渲染层：ChatView + `Response`（Streamdown 流式 Markdown）+ 发送/停止状态切换 + MessageScroller 吸底
- [x] adapters：`message_update(text_delta)` → zustand store 增量渲染（纯函数 reducer，有单测）+ 光标
- [x] `agent_end` 时 JSONL 落盘；启动时可载入最近会话（原子写 tmp+rename；agent_end 时以转录为准全量校准 UI）

**验收**：✅ 2026-11-19 人工验收通过——流式渲染、停止中断、重启恢复全部符合预期。附带修复：MessageScroller 需要显式 Provider 包裹（空白屏根因）；渲染层 console 已转发主进程日志（FR-9.1 种子）。

### Phase 2 · 工具系统与权限（约 1 周）

**目标**：Agent 能真正干活，且每一步都在用户掌控下。

- [x] 6 个内置工具：read_file / write_file / edit_file / bash / glob / grep（pi-schema 定义，含 Windows 路径与 shell 适配）—— bash 走 PowerShell（UTF-8 输出）+ 超时/中止 + 流式 stdout；grep/glob 自实现递归扫描（跳过 node_modules/.git）；工具 cwd = 用户主目录（Phase 3 设置项化）
- [x] `beforeToolCall` 权限门：弹窗 [本次允许 / 本会话总是 / 总是允许 / 拒绝]，规则持久化 —— 读类（read_file/glob/grep）默认放行；规则 = {toolName, pathPrefix?}（会话内存 + settings.toolRules 全局持久化）
- [x] 工具卡片 UI：Trace 线状态机（排队/运行/完成/失败）+ 可折叠参数/输出详情 + 失败默认展开
- [x] steer（插话）：运行中输入自动转 `agent.steer()` + 队列计数展示；abort 时权限 pending 全部按拒绝结算（防卡死）
- [x] 状态栏：token（input+output+cache）/ 费用（usage.cost.total 累计）/ 等待审批状态

**验收**：让 Agent "读取某目录并重写一个文件"——全程工具卡片可见、可审批、可中断；工具抛错时卡片显示失败详情且模型收到 isError。（faux 触发词「演示」→ 脚本化 write_file 工具调用，覆盖弹窗→卡片→收尾全链路；机制层已由 smoke + tools/permissions/adapter 单测验证，交互待人工验收）

### Phase 3 · 完整产品 UI（约 1–2 周）

**设计基准（2026-11-19）**采用 pi 的蓝灰色。历史导航、侧栏开关和菜单集中在顶部左侧，右边留出拖拽区域。原生窗控和左侧图标栏沿用窗口底色。侧栏面板和主区共用一个圆角外框，分隔线从内容区开始。会话标题放在窗口工具栏下方的主区首行，与左栏应用名称同排。空白会话的欢迎标题和输入框居中排列。有消息时输入框固定在底部，和消息共用对话列。设置导航按应用和集成分组，当前条目右侧显示勾选。

**目标**：从"能用的 demo"到"能日常用的应用"。

- [x] 会话侧栏：列表 / 重命名 / 删除 / 新建；自动标题（首条用户消息）—— 重命名走行内输入（titleCustom 保护，自动标题不再覆盖）；删除当前会话回草稿态；搜索由 FR-4.13 命令面板承担
- [x] 设置页支持 Provider、API Key、模型目录、工具授权、主题和数据目录。Composer 可切换模型和七档思考强度。
- [x] `Reasoning` 思考块流式折叠 —— thinking_start/delta 事件 + 独立 part；流式自动展开、结束自动折叠，转录恢复同样保留思考块
- [x] 首次启动引导支持选择提供方、输入连接信息和确认模型。内置演示模型无需密钥即可完成。
- [x] Skills 管理（本地导入 + 启停注入）与个性化（人设 / 自定义指令 / 每会话覆盖）—— ✅ 设置页「个性化」「技能」两分区 + 右键「会话指令」覆盖；注入顺序 = 应用提示词 → 人设（会话覆盖优先）→ 技能 sections
- [x] 设置「常规」中的外观与语言支持中文和 English 即时切换并在重启后恢复。
- [x] 模型可用 `update_plan` 维护任务步骤。同一轮更新当前计划，会话重开后恢复。内置演示模型可发送「计划演示」体验。
- [x] 设置「常规」中的工作环境支持选择工作目录并切换 Windows 的 PowerShell / Git Bash。设置在下一次运行时生效。
- [x] Markdown 链接拦截 → 默认浏览器打开 —— Phase 0 已实现（setWindowOpenHandler 拒绝新窗 + http(s) 走 shell.openExternal）
- [x] 空状态、错误态、断网重试提示 —— 空态居中大标题 + 引导卡；错误条回显（含模型请求失败），重发即重试

**验收**：全新机器上安装后，不看任何文档即可完成引导并开始日常使用；切换模型/思考等级对下一轮对话即时生效；启用一个技能后，新会话可观察到行为变化；自定义人设在全局与单会话两种粒度均生效。

**Windows 开发验证（2026-11-19）**：完成八步验证，84 项测试通过。隔离配置中复核了侧栏折叠、窄窗布局、双语切换、首次配置、任务计划恢复和工作目录下的审批写入。

### Phase 4 · 产品化

- [x] Windows x64 NSIS 已通过临时目录安装和卸载。
- [x] Windows NSIS 自动更新。更新检查和下载状态显示在「帮助 → 关于 Pilot」，用户确认后退出并安装。已用本地更新源完成 0.1.0 → 0.1.1 实际升级。
- [x] 本地模型接入。Ollama 和 LM Studio 预设支持免密钥配置。已用本地协议桩验证模型目录、连通性测试、端点切换和流式对话，实际模型推理待验收。
- [x] MCP 接入（`pi-mcp` → AgentTool 桥）和服务配置。Windows 安装版已验证 stdio / Streamable HTTP 工具发现、独立启停、审批拒绝与允许、环境变量加密以及工具卡片恢复。
- [x] 设置「导入」集中提供技能、MCP 服务和插件组件的导入弹窗。先预览 Codex 和 Claude Code 的用户与项目配置，勾选并确认后导入所选项目。插件预览列出可导入的技能和 MCP 配置。

**Windows 安装版验收（2026-11-19）**通过首次引导、工作目录内的拒绝与允许写入、技能启停持久化和重启后会话恢复。独立配置首次启动到可交互约 1.27 秒。500 条消息滚动的帧间隔 P95 为 18.2 毫秒（175 帧），刻度联动与跳转正常。长回复的 120 段文字增量全部渲染，增量到渲染帧的 P95 为 31.8 毫秒，最大 32.3 毫秒。八步验证通过，104 项自动化测试全绿。

#### 第一步 Windows 预发布

| 状态 | 工作 | 验收标准 |
| --- | --- | --- |
| 已验收 | GitHub Actions 与测试安装包（FR-8.5） | Windows runner 从锁文件安装。推送代码到 `main` 或提交 PR 后执行八步验证。`ad9600e` 通过全部检查并生成 NSIS 测试包，Actions 产物保留 7 天。[Windows CI 构建记录](https://github.com/Murmureeee/Pilot/actions/runs/44525138926) |
| 已验收 | Pilot 新装与从旧版升级（FR-8.2 / FR-8.3） | Windows runner 验证 Pilot 0.1.1 新装、演示对话、配置向导和卸载。从 `ad9600e` 重建采用 `pi Desktop` 发行标识的 0.1.0 兼容包。0.1.1 自动识别原安装路径，保留会话、审批模式、自定义指令、界面语言和启用的技能，原会话可继续。测试目录已清理。[安装验收记录](https://github.com/Murmureeee/Pilot/actions/runs/44536855149) |
| 已验收 | 正式 HTTPS 更新源（FR-8.6） | Windows runner 从公开地址下载 v0.1.1 的清单、安装包和 blockmap，SHA-256 与发布资产一致，安装包的 SHA-512 与清单一致。配置公开更新源的 0.1.0 兼容包下载后普通退出仍保留旧版，经确认安装并重启后进入 0.1.1，原会话、设置、语言和技能均已恢复。测试下载和目录已清理。[正式发布](https://github.com/Murmureeee/Pilot/releases/tag/v0.1.1) · [公开更新验收](https://github.com/Murmureeee/Pilot/actions/runs/44561428215) |
| 待验收 | 真实 Ollama 与 LM Studio | 两个本地服务分别发现模型、通过连接检查、完成一轮流式对话。记录服务版本和模型 ID，连接失败和无模型有明确反馈。 |
| 待实施 | 本地滚动日志（FR-9.1） | 能从主进程、渲染进程和更新状态定位错误，日志按大小轮转。验证磁盘占用上限与敏感字段脱敏。 |

Windows CI 的 `verify_installation` 使用隔离源复验新装和 HTTPS 升级，`prepare_release` 在验收通过后准备使用 GitHub Releases 的发布草稿。`verify_published_update` 下载公开安装包并验收从兼容包到最新发布版的升级。

#### 第二步 界面多语言

- [ ] 统一语言列表、翻译键和回退规则。先加繁体中文，验证流程后再加日语和韩语。旧的 `zh` / `en` 偏好在打开应用时正确映射。
- [ ] “设置 → 常规 → 语言”能即时切换并记住选择。翻译涵盖菜单、首次引导、文件选择框、错误和无障碍标签。日期、计数和数字使用所选语言的格式。
- [ ] 对照翻译键检查缺项和插值，并验证 IPC 接受全部已注册语言。首次启动、重启、窄窗口和长文案均是验收场景（FR-5.13）。

#### 第三步 本地定时任务

- [ ] 在任务页创建、修改、暂停、删除和立即运行任务。任务包含提示词、模型、工作目录、时区及执行时间，一次性、每天和每周三种频率都能预览下次运行时间（FR-10.1）。
- [ ] Pilot 运行期间由主进程触发。每次运行使用独立的 Agent 会话和任务目录，首版使用只读模式，通过现有权限门限制工具。任务结果归档到运行记录，可打开相应会话查看（FR-10.2）。
- [ ] 重启和唤醒时标记错过的执行时间，按下一时段调度，也可手动重跑。重启时在途任务标记为中断。验收时覆盖重复时段、夏令时、暂停、模型不可用和执行失败，确保每个计划时段只触发一次。
- [ ] 退出后触发作为后续能力评估。Windows 可以接入系统任务计划程序，关机期间执行需要能访问所需数据的持续在线环境。

#### 后续工作

| 优先级 | 工作 | 验收重点 |
| --- | --- | --- |
| P1 | 输入框快捷调用与文件引用（FR-4.16–FR-4.18） | `/` 可快速打开已有操作。`@` 和 `+` 均可给当前消息添加工作目录中的文件或文件夹引用，支持移除和会话恢复。 |
| P1 | macOS DMG、Linux AppImage/deb、三平台关键路径（FR-8.2、NFR-7） | 分平台完成构建、安装、一次对话及升级或更新流程验证。 |
| P1 | 图片附件（FR-1.10） | 在支持图像的模型中发送与恢复图文会话。切换模型时明确显示附件能力。 |
| P2 | Pi Packages、Prompt 模板和可选数据目录（FR-5.6、FR-5.11、FR-5.12） | 扩展包先预览内容再安装，模板能在输入框复用，数据迁移时保全会话及设置。 |
| P2 | 长会话压缩、工具结果处理和会话导出（FR-1.8、FR-2.6、FR-6.5、FR-6.6） | 保留原始转录，超长会话仍能继续，导出的 Markdown 可读。 |
| P2 | 文件变更视图、来源引用和会话检查点（FR-4.11、FR-4.12） | 引用可追踪，回退范围明确，回退前可预览。 |
| P2 | 代码签名、事件查看器、崩溃日志和诊断导出（FR-8.4、FR-9.2、FR-9.3） | 签名由平台验证，用户可查看并导出脱敏的诊断内容。 |
| P2 | 长列表与多会话内存（NFR-8） | 先测长会话和反复切换会话表现，发现瓶颈再决定虚拟化或内存优化。 |

---

## 5. 完整开发需求列表

优先级：P0 核心（无此不能发布）· P1 重要 · P2 增强。
`[ ]` 表示待实现或待验收，`[x]` 表示已完成当前条目定义的范围。正式版本的 P0 需求优先验收。

### FR-1 · Agent 运行时（主进程）

- [x] FR-1.1 (P0/Ph1) 创建/销毁 Agent 实例；切换会话 = 按持久化 messages 重建
- [x] FR-1.2 (P0/Ph1) 文本消息从输入框经 IPC 接入 `Agent.prompt`。
- [x] FR-1.3 (P0/Ph1) `abort()` 立即中断当前流，UI 同步回发送态（stopReason 区分 aborted）
- [x] FR-1.4 (P1/Ph2) `steer()` 工具运行中插话；`followUp()` 停止前排队；队列可清空（`clearAllQueues`）—— ✅ 收尾补全：composer「清空排队」按钮（agent:clear-queue）整表撤回 steer+followUp
- [x] FR-1.5 (P1/Ph2) `steeringMode / followUpMode` = one-at-a-time（默认）
- [x] FR-1.6 (P1/Ph2) 运行时切换 `state.model` 与 `thinkingLevel`，下一轮生效 —— ✅ thinkingLevel 运行时同步；provider/模型变更 → ensureAgent 检测变更重建 Agent（转录从落盘恢复，下一轮请求生效）
- [x] FR-1.7 (P1/Ph2) 系统提示词可配置（应用人设 + 个性化指令）；技能说明经 systemPrompt sections 注入 —— ✅ buildSystemPrompt 组装 + systemPrompt 指纹变更即重建 Agent（下一轮生效）
- [ ] FR-1.8 (P2/Ph4) `prepareRequest` 接入上下文压缩；`finishTurn` 自定义续跑策略
- [x] FR-1.9 (P0/Ph1) 全事件订阅桥接 IPC；`waitForIdle` 支撑批量落盘时机
- [ ] FR-1.10 (P1/Ph4) 为支持图像输入的模型接入图片附件，支持发送和会话恢复。

### FR-2 · 工具系统（主进程）

- [x] FR-2.1 (P0/Ph2) 6 个内置工具，pi-schema 类型化参数；工具失败**抛异常**（转 isError 给模型）
- [x] FR-2.2 (P0/Ph2) `beforeToolCall` 权限门：拒绝时 `block: true` + reason
- [x] FR-2.3 (P1/Ph2) 权限规则持久化（per 工具 per 路径前缀），会话级与全局级
- [x] FR-2.4 (P1/Ph2) 工具级 `executionMode`：bash = sequential，其余 parallel
- [x] FR-2.9 (P1/Ph2) 权限模式三档（composer 徽章切换）：standard（读放行写确认）/ read-only（写类直接拒绝）/ full-access（全放行）；存储于 settings.approvalMode
- [x] FR-2.5 (P1/Ph2→Ph3) bash 工具支持超时和流式输出。Windows 默认 PowerShell，可在设置切换 Git Bash。命令从工作目录启动，选择自定义目录后文件和搜索工具限定在该目录。
- [ ] FR-2.6 (P2/Ph4) `afterToolCall` 结果后处理钩子
- [x] FR-2.7 (P1/Ph4) MCP 服务工具经 AgentTool 桥进入现有权限门。每个服务可独立启停，并选择继承全局权限或要求确认。
- [x] FR-2.8 (P1/Ph4→Ph3 提前) 技能加载器：发现/解析技能（SKILL.md frontmatter + 正文），按启用状态注入 systemPrompt sections

### FR-3 · IPC 契约（shared/）

- [x] FR-3.1 (P0/Ph0) `shared/contract.ts` 定义全部通道与类型，主/预加载/渲染三处共用
- [x] FR-3.2 (P0/Ph0) preload contextBridge 暴露 `window.pi.*` 类型化 API；渲染层禁止其他 IPC 访问
- [x] FR-3.3 (P0/Ph1) 事件推送通道：pi 事件归并为 `UiAgentEvent` 联合类型推送（渲染层不 import pi 类型）
- [x] FR-3.4 (P0/Ph2) 所有主进程 invoke 通道通过同一入口做 Zod 校验，覆盖参数个数、枚举、标识符和嵌套设置。回归测试覆盖合法调用和无效入参。

### FR-4 · 主界面 UI（渲染层）

- [x] FR-4.1 (P0/Ph1) ChatView：消息流 + `Response` 流式 Markdown + 流式光标
- [x] FR-4.2 (P0/Ph1) 输入区：多行、发送/停止状态互斥、Enter 发送 Shift+Enter 换行
- [x] FR-4.3 (P0/Ph2) 工具卡片（`Tool`/`Terminal`/`Stack Trace`）：状态、参数、结果摘要、可展开 —— 基于 Trace 积木自建 ToolCard；bash 流式输出 + 失败详情（Stack Trace 场景合并进失败详情）
- [x] FR-4.4 (P1/Ph2) `Confirmation` 权限弹窗（与 FR-2.2 联动）+ 危险命令红标
- [x] FR-4.5 (P1/Ph2) `Reasoning` 思考块（thinkingLevel > off 时可见，流式折叠）—— ✅ 收尾补全：thinking_start/delta 事件 → 独立 thinking part，ThinkingBlock 流式自动展开 / 结束自动折叠（摘要单行截断），落盘转录恢复同样保留思考块
- [x] FR-4.6 (P1/Ph2) `Queue` 展示 steer/followUp 队列；运行中输入自动转为 steer
- [x] FR-4.7 (P1/Ph2) 状态栏：token / 费用 / 上下文占用 / 运行状态 —— ✅ 收尾补全：contextTokens（最近一轮 input+cache+output 快照）/ contextWindow（模型目录），进度条 + 百分比，>80% amber 风险提示
- [x] FR-4.8 (P1/Ph3) `Model Selector` 支持在 Composer 切换提供方和七档思考强度，并在设置中浏览模型目录。
- [x] FR-4.9 (P1/Ph3) 会话侧栏：列表 / 新建 / 重命名 / 置顶 / 归档 / 标记未读 / 分叉 / 复制全文 / 永久删除（带确认）—— ✅ 右键上下文菜单对齐 ChatGPT 语义 + 悬停浮现「置顶/归档」双按钮 + 侧栏三分区（置顶 / 最近 / 已归档）+ 未读圆点加粗（打开即清）+ 分叉复制转录 + 删除当前会话回草稿态；搜索由 FR-4.13 命令面板承担。取舍不变：项目（分组系统）不做；在新窗口打开（多窗口状态模型）暂缓
- [x] FR-4.13 (P1/Ph3) 全局命令面板：Ctrl+K 唤起（侧栏搜索按钮入口），搜快捷操作（新聊天/设置/权限模式切换）+ 会话（标题过滤 + 相对时间），底部「全部/操作/聊天」过滤标签，键盘上下选择 + Enter 执行；Ctrl+N 新聊天
- [x] FR-4.14 (P1/Ph3) 顶部 38px 留给窗口操作，左侧集中放置历史导航、侧栏展开/收起、文件/编辑/视图/帮助菜单，右侧是拖拽区域和原生窗控。主区的会话标题位于工具栏下方。窗口动作通过 IPC 白名单调用原生功能。
- [x] FR-4.15 (P2/Ph3) 用户发送至少五条消息后，对话列左侧在留白内显示等距的轮次刻度。刻度栏跟随正文滚动，画面中的轮次同步高亮。点击可跳转。悬停时邻近刻度展开，并显示随窗口宽度调整的问答预览和复制入口。
- [x] FR-4.10 (P2/Ph3) `Plan`/`Task` 通过结构化工具调用展示待处理、进行中和已完成的步骤，用转录恢复计划。
- [ ] FR-4.11 (P2/Ph4) `File Tree` 展示本轮文件变更；`Sources`/`Inline Citation`（RAG 场景）
- [ ] FR-4.12 (P2/Ph4) `Checkpoint` 会话回退点
- [ ] FR-4.16 (P1/Ph4) 输入 `/` 打开命令菜单，可搜索新聊天、模型、权限和 MCP 服务等已有操作。支持方向键选择、Enter 确认和 Esc 关闭，兼容输入法组词、普通文本及路径输入。
- [ ] FR-4.17 (P1/Ph4) 输入 `@` 按名称或相对路径查找当前工作目录中的文件和文件夹。选中后将可移除的引用随当前消息发送和保存。Agent 通过现有文件工具和权限规则读取。
- [ ] FR-4.18 (P1/Ph4) 输入框左侧 `+` 提供鼠标选择文件和文件夹的入口，与 `@` 共用引用和移除逻辑。图片附件随 FR-1.10 接入。

### FR-5 · 设置（渲染层 + 主进程）

- [x] FR-5.1 (P0/Ph3) Provider + API Key 管理：增删改、掩码显示、连通性测试（最小流式探测，emerald 成功/红 失败行内回显）、自定义 OpenAI 兼容端点（base URL，覆盖 Ollama / LM Studio / 中转站）
- [x] FR-5.2 (P0/Ph3) 模型目录浏览：anthropic 走 pi-ai catalog（含上下文窗口展示）；openai-compatible 探测 GET /models；目录弹窗点选回填模型 ID（当前模型右侧 ✓），端点无目录时仍可手填
- [x] FR-5.3 (P1/Ph3) thinkingLevel 全局默认 + 会话内临时切换 —— ✅ 已落地：composer 模型菜单内置思考强度滑块（7 档渐变轨道，Codex 截图同款交互），持久化 settings.thinkingLevel + 运行时同步当前 Agent（下一轮请求生效）
- [x] FR-5.4 (P1/Ph3) 已授权规则管理（撤销入口）—— ✅ 收尾补全：设置页列出 settings.toolRules（工具名 + 路径前缀上下结构）+ 单条撤销（整表提交，下一轮权限门生效）；per-工具总开关随 MCP 一并做
- [x] FR-5.5 (P1/Ph3) 外观设置支持亮色、暗色和跟随系统，同步原生标题栏配色。中英界面可即时切换并本地保存。
- [x] FR-5.6 (P2/Ph3) 数据目录展示 + 打开（shell.openPath 白名单目标）—— 自定义目录与导出诊断随 Phase 4
- [x] FR-5.7 (P0/Ph3) 无可用 Provider 时可从对话空态打开三步配置向导。演示模型可以直接启用，真实提供方可在选择模型后测试连接。
- [x] FR-5.8 (P1/Ph3) Skills 管理支持从本地选择含 `SKILL.md` 的目录并复制导入，可识别链接目录，重名自动加后缀。启停会保存并在下一轮请求时生效。
- [x] FR-5.9 (P1/Ph3) 个性化：全局人设与自定义指令（设置页文本域）+ 每会话覆盖（右键「会话指令」，空白清除回落全局）；顺序 = 应用提示词 → 自定义指令 → 技能 sections
- [x] FR-5.10 (P1/Ph4) 设置「MCP 服务」支持 stdio / Streamable HTTP、command / args / env 编辑、启停、重连、工具清单和连接状态。stdio 环境变量使用系统密钥服务加密。
- [ ] FR-5.11 (P2/Ph4) Pi Packages：从 npm / git 安装扩展包（skills + prompt templates + 主题），安装前展示包内容清单
- [ ] FR-5.12 (P2/Ph4) 自定义 Prompt 模板可通过 `/` 命令菜单搜索并填入当前草稿。
- [ ] FR-5.13 (P1/Ph4) 扩展界面语言，覆盖应用文案、原生对话框及区域格式，兼容已有偏好。

### FR-6 · 会话持久化（主进程）

- [x] FR-6.1 (P0/Ph1) JSONL：每会话一文件（userData/sessions/），`agent_end` 与 abort 时增量落盘
- [x] FR-6.2 (P0/Ph1) 启动恢复：读 JSONL → `initialState.messages`
- [x] FR-6.3 (P1/Ph3) 会话索引（列表/updatedAt 排序/搜索走命令面板）、重命名、删除（含转录文件）
- [x] FR-6.4 (P1/Ph3) 自动标题：取首条用户消息（titleCustom 手动命名保护）；P2 小模型生成随 Phase 4
- [ ] FR-6.5 (P2/Ph4) 导出 Markdown；会话回滚（Checkpoint）
- [ ] FR-6.6 (P2/Ph4) 超长会话压缩（transformContext 摘要旧消息）

### FR-7 · 安全（主进程 + preload）

- [x] FR-7.1 (P0/Ph0) `contextIsolation: true`、`nodeIntegration: false`、sandbox、渲染层 CSP（生产注入）
- [x] FR-7.2 (P0/Ph1) API Key 仅存主进程 safeStorage 加密文件；渲染层只见 hasKey 标志
- [x] FR-7.3 (P0/Ph3) Markdown 内链接拦截 → `shell.openExternal`（setWindowOpenHandler 拒新窗 + http/https 白名单）
- [x] FR-7.4 (P0/Ph2) 工具作用域约束：权限门 pathPrefix 规则 + cwd=用户主目录；bash 超时（≤300s）杀进程
- [x] FR-7.5 (P1/Ph2) 权限门对 bash 命令做危险模式提示（rm -rf 等，硬编码列表 + 展示原文）

### FR-8 · 打包与分发（Phase 4）

- [x] FR-8.1 (P0/Ph0) **Node 兼容验证**：✅ Electron 45 内置 Node 24.22.3 ≥ 22.19，pi 冒烟通过，sidecar 方案取消
- [ ] FR-8.2 (P1/Ph4) Windows x64 NSIS 已通过自动化新装、旧版升级和卸载验收。macOS DMG 与 Linux AppImage/deb 待构建验收。
- [x] FR-8.3 (P1/Ph4) Windows 安装版支持自动检查、下载和退出安装。设置 `PI_UPDATE_URL` 后运行 `pnpm package:win` 会在 `dist/release` 生成安装包、blockmap 和 `latest.yml`。
- [ ] FR-8.4 (P2/Ph4) 代码签名（mac notarize / win Authenticode）
- [x] FR-8.5 (P1/Ph4) 云端 Windows 验证流水线与可按提交下载的 NSIS 测试安装包。
- [x] FR-8.6 (P1/Ph4) GitHub Releases 公开更新源已上线，Windows 0.1.0 → 0.1.1 升级通过验收。

### FR-9 · 可观测性

- [ ] FR-9.1 (P1/Ph1) 主进程 + 渲染层日志（滚动文件，级别可配）
- [ ] FR-9.2 (P1/Ph2) 调试模式：原始事件流查看器（排障利器）
- [ ] FR-9.3 (P2/Ph4) 崩溃收集 + 脱敏诊断导出

### FR-10 · 定时任务

- [ ] FR-10.1 (P1/Ph4) 创建和管理本地任务，支持一次性、每日和每周执行、选择时区及查看运行记录。
- [ ] FR-10.2 (P1/Ph4) 主进程执行任务，隔离 Agent 会话与权限，并处理重启、唤醒、失败及重复触发。

### NFR · 非功能需求

- [x] NFR-1 (P0) Windows 安装版长回复测试中，120 个文字增量到 `requestAnimationFrame` 回调的最大延迟为 32.3 毫秒，低于 100 毫秒目标。采样的 111 个帧间隔 P95 为 16.8 毫秒。
- [x] NFR-2 (P1) Windows 安装版首次启动到可交互约 1.27 秒，低于 3 秒目标。
- [x] NFR-3 (P1) Windows 安装版的 500 条消息滚动通过，帧间隔 p95 为 18.2 毫秒。
- [x] NFR-4 (P1) 会话落盘为原子写（临时文件 + rename），崩溃不丢已确认消息
- [x] NFR-5 (P0) 8 步门禁全绿才可宣布完成：oxfmt / typecheck / oxlint / vitest / knip / build / smoke / dev 挂载
- [x] NFR-6 (P1) Windows 云端通过 115 项自动化测试，覆盖适配层、权限门、会话存储、工具、技能、设置、模型目录、IPC 校验和外部导入。
- [ ] NFR-7 (P1) 三平台关键路径冒烟（Phase 4 出包前）
- [ ] NFR-8 (P2) 内存：空闲会话 < 300MB；多会话切换不泄漏（Agent 实例随会话销毁）

---

## 6. 风险登记

| 风险 | 影响 | 对策 |
|------|------|------|
| Electron 内置 Node < 22.19，pi 不兼容 | 高（架构级） | Phase 0 第一件事验证；备选 sidecar 方案已留架构位 |
| pi 1.x API 迭代快（仓库刚迁移改名） | 中 | 锁定 1.5.2 版本；适配层集中在 `adapters/` 与 `agent-host/`，升级只动这两处 |
| oxfmt pre-1.0 格式 churn | 低 | 锁版本，升级单独提交 |
| Streamdown/CSP 在 Electron 的兼容 | 中 | Phase 0 冒烟；必要时放宽 CSP 限定指令 |
| Windows 下 bash 工具语义差异 | 中 | FR-2.5 明确默认 shell 与适配；测试覆盖 |
| AI Elements 官方仍在迁移期（Vercel 版 2026-11 弃用） | 低 | 只用 shadcn/ui 官方 registry；vendor 后代码自主可控 |

---

## 7. 附录 · pi API 速查（实施时对照）

**Agent 配置**：`initialState{systemPrompt, model, thinkingLevel, tools, messages}`、`streamFn: models.streamSimple.bind(models)`、`convertToLlm`、`transformContext`、`beforeToolCall/afterToolCall`、`prepareRequest`、`finishTurn`、`sessionId`、`identity`、`getApiKey`

**方法**：`prompt()` / `continue()` / `steer()` / `followUp()` / `abort()` / `waitForIdle()` / `reset()` / `subscribe()`；状态：`agent.state.{model, thinkingLevel, tools, messages, isStreaming, streamingMessage}`；队列：`peekQueuedMessages()` / `clearAllQueues()`

**事件**：`agent_start` → `turn_start` → `message_start/update/end` → (`tool_execution_start/update/end` × N) → `turn_end` → … → `agent_end`

**pi-ai**：`createModels()` / `setProvider(anthropicProvider())` / `getModel(provider, id)`；usage 与 cost 随消息返回；Ollama 等走 OpenAI 兼容 provider

**工具**：`AgentTool<typeof schema>` = `{ name, label, description, parameters, execute(toolCallId, params, signal, onUpdate) }`；错误抛异常；`terminate: true` 提示跳过后续 LLM 调用
