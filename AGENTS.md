# AGENTS.md — Pilot 工程操作规范

面向 AI 编码代理的强制约束。目的：**不重复犯已犯过的错**。每次开工前通读一遍。

## 环境与进程（Windows / Git Bash）⚠️ 最高优先级

1. **任何 `pnpm install / ci / add / remove` 之前，必须先杀 electron**：
   ```bash
   taskkill //IM electron.exe //F
   ```
   运行中的 dev 应用锁住 node_modules 文件，pnpm 重链接会与之死锁（已发生过 3 次）。
2. pnpm 重装依赖会**清掉 electron 二进制**且不重跑其 postinstall。恢复钩子已挂在
   `package.json` 的 `postinstall`（`scripts/restore-electron.mjs`，默认走 npmmirror 镜像）。
   手动恢复：`node scripts/restore-electron.mjs`。判断标志：`node_modules/electron/path.txt` 是否存在。
3. dev 实例统一后台启动；**先杀旧实例再起新的**，不要叠加。验证完若不再需要，杀掉收尾。
   自动化测试使用可自动清理的临时目录。手动验收使用本次独立目录，结束时关闭测试进程，
   清理本次生成的临时配置、日志、安装和更新副本，并确认清理结果。测试失败也要收尾。
4. electron 二进制下载只走 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`（GitHub 直连不可用）。
5. **应用图标**：源文件 `resources/icon.svg`；改动后必须跑 `node scripts/make-icons.mjs` 重新生成
   `icon.png`（dev 窗口/任务栏）与 `icon.ico`（Phase 4 打包嵌入 exe，electron-builder 直接引用）。

## 验证流水线（代码改动后按序全绿，缺一不可，才能宣布"完成"）

```bash
pnpm exec oxfmt --write src tests   # 1. 格式化（必须先跑，后续检查基于格式化后的代码）
pnpm typecheck                      # 2. TS 双工程
pnpm exec oxlint src tests          # 3. lint（0 警告 0 错误）
pnpm exec vitest --run              # 4. 全部测试
pnpm exec knip                      # 5. 死代码/未用导出（有输出即修）
pnpm build                          # 6. 三段构建
pnpm exec electron . --smoke        # 7. 冒烟（期望 SMOKE_RESULT ok:true）
# 8. dev 挂载验证：启动后日志必须出现 `[renderer] [app] mounted` 且无 Uncaught
```

**宣布完成前必须真的跑完 1–8**，不许跳步、不许"应该没问题"。

## 模块交付与提交

- 把任务拆成可独立验收的模块。每个代码模块通过上述验证并复核对应场景后，立即提交并主动推送到当前分支的上游。
  新分支按仓库约定建立远程跟踪。独立文档模块核对内容和链接后也提交并推送。
- 只暂存该模块的文件和测试，保留其他改动的工作区和暂存状态。使用清楚的 Conventional Commits 标题，让每个提交可以独立审阅和回退。
- 推送后核对远端是否包含该提交，并在交付时报告提交号和目标分支。推送失败时保留本地提交，排查并重试。仍有阻塞时报告提交号和具体原因。用户要求暂缓提交或推送时，以本次要求为准。

## 契约与测试必须同步

- `src/shared/contract.ts` 任何变更（通道名/类型/事件语义）→ 立即同步检查：
  - `tests/contract.test.ts` 的**通道前缀正则**（当前：`^(app|agent|session|settings|skills|tool):`）
  - `tests/agent-events.test.ts` 的事件语义断言
- **usage 事件语义（已定，勿改错）**：主进程累计后发送**总量快照**，渲染层 reducer 只替换、不累加。
- 权限门（PermissionManager）测试：`await Promise.resolve()` 只推进一个微任务，**统一用
  `await flush()`（`new Promise(r => setTimeout(r, 0))`）**，避免 promise 链未结算导致超时。
- 权限门测试的 **mock 必须模拟持久化回路**：`addGlobalRule` 要把规则写进 `getGlobalRules`
  的来源数组，否则第二次 gate 看不到新规则、再次弹窗、无人应答 → 假超时（真实主进程里是
  settings 落盘回路）。测试失败先怀疑自己的 mock，不是产品代码。
- knip 报告的未用导出**一律删除**（不是加 ignore），ignore 白名单只给 vendored 代码。

## UI 适配备忘（本项目是 Base UI / base-rhea 世代，不是 Radix）

- **AI 界面优先参考 shadcn/ui AI Elements。** 新增或修改对话、输入框、模型选择、工具步骤、终端输出、引用等界面时，
  先核对官方 Base UI 示例，复用 `src/renderer/src/components/ui/` 中已有的组件，例如 `MessageScroller`、`Trace` 和
  `CodeBlock`，并按 Pilot 的实际事件和交互需求适配。[AI Elements 文档](https://ui.shadcn.com/docs/ai-elements)
- **没有 `asChild`**：自定义触发器用 `render={<button .../>}`，children 写在组件内。
- `DropdownMenuLabel`（Menu.GroupLabel）**必须包在 `DropdownMenuGroup` 内**，否则运行时抛
  `MenuGroupContext is missing`。
- 渲染层**禁止 import pi 类型/模块**——一切走 `src/shared/contract.ts` 的 `UiAgentEvent` 契约。
- 渲染层报错看主进程日志 `[renderer]` 前缀转发（console-message 已接入）；
  dev 挂载成功的正面证据是 `[app] mounted`。

## 代码规范

- oxlint + oxfmt（**不用** ESLint/Prettier）；vendored 目录（`components/`、`lib/`）不跑 oxlint 但必须过 oxfmt。
- 类型进 `types.ts`、常量进 `constants.ts`；显式返回类型；显式 import（禁 auto-import）。
- 工具失败**抛异常**（pi 转为 isError 给模型），不返回错误文本。
- 环境相关文件头部标注 `// @env node` / `// @env browser` / `// @env all`。
- 注释只写"为什么"；临时调试代码不留过夜。

## UI 设计规范（牢记，写代码前过一遍）

页面结构、状态模型、视觉与键盘规则的完整定义在 [`docs/DESIGN.md`](./docs/DESIGN.md)。**动界面前先读对应章节，
提交前过一遍文末的自检清单；界面结构或交互规则有变化，同一个提交里更新 DESIGN.md。** 下面是最容易犯错的硬约束：

- **新界面先定位置**：持续查看、与对话并行的内容进右侧审查面板的页签；需要确认范围或不可撤销的操作用对话框；
  阻塞任务的请求进输入坞。**禁止**在主列顶栏新增并列按钮，**禁止**新增与现有面板互斥的右侧面板。
- **状态表达只有一套**：待审批=橙、运行中=emerald、失败=红、已中断=灰、未读=强调色（`brand`）；侧栏状态位、主列和通知
  用同一组颜色与文案（DESIGN.md §3）。
- **强调色 `brand` 只用在五处**：未读圆点、链接与引用、焦点环、开关开启态、复选框选中态。主按钮仍是 `primary`，
  选中标记 ✓ 仍是文字色（DESIGN.md §4.1）。
- **默认收敛**：成功的工具步骤与命令输出折叠，失败与待处理自动展开；失败处必须带原因和下一步动作。
- **菜单/列表条目的次级信息一律上下结构**：主标题一行（正常字号/颜色），说明文字独立成行，
  `text-xs text-muted-foreground`（更小字号 + 灰阶）体现主次。**禁止**把说明塞进主标题同一行
  用「·」或小字挤在一起。
- **选中态**：条目右侧打 `CheckIcon` ✓（如当前权限模式），不要用加粗/变色标题表示选中。
- 菜单需要说明行时，条目用 `items-start`（图标与首行对齐，`mt-0.5` 微调），内容块
  `flex-col gap-0.5`。
- **下拉弹层宽度随内容自适应**（`min-w-40`），禁止 `w-(--anchor-width)` 之类的锚宽锁定——
  会把中文菜单压成一字一行竖排。
- **浮层类 UI 放排版留白（gutter）内**：minimap/刻度轨等覆盖物用 ResizeObserver 测量主区宽度，
  计算内容列左侧留白并钉在留白里；留白不足（窄窗口）时**整体隐藏**——禁止硬悬浮遮挡内容。
- **窗框 + 工作卡片骨架（勿回退）**：外层 `bg-window-frame` 承载 38px 标题栏（应用菜单、←→、侧栏开关、
  拖拽区）与 52px 导航栏，两者同色相连；内层一张圆角卡片承载侧栏、主列和审查面板。标题栏只放窗口级控件，
  会话标题与项目操作在主列顶栏。**卡片内**每列的背景从顶连续到底，禁止在卡片内引入横跨多列的横条。
- 语义色四级分级（牢记）：
  - 红 `destructive` = 破坏性动作与真实危险（拒绝/删除/错误/rm -rf 级命令）；
  - 橙 `text-amber-600 dark:text-amber-400` = **风险提示**（用户需警觉但非破坏，如「完全访问」模式）——不要用红吓退用户；
  - emerald = 运行态/成功/光标；
  - 灰阶 = 次级文字与常态。
- **带语义色的图标，其标题文字跟随同色**（图标+标题是一个整体），说明行保持灰阶；
  标题不要用加粗/变色表示选中（选中用右侧 ✓）。

## 架构铁律

- Agent（pi）只跑在主进程；渲染层永远拿不到 API key 明文（safeStorage 加密）。
- 权限门在 `beforeToolCall`：读类（read_file/glob/grep）默认放行，写类/命令按规则与
  approvalMode（standard / read-only / full-access）判定。
- pi 升级只允许动 `adapters/` 与 `agent-host/`，渲染层契约不变。
