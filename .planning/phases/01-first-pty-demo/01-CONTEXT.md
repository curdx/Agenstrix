# Phase 1: First PTY Demo - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Phase Boundary

让浏览器看到一个**真正的 `claude` 命令**跑在 Bun.Terminal PTY 里、字节流双向贯通、SQLite 持久化已开始、按 Ctrl+C 不留孤儿。整个栈最未验证的环节（Bun.Terminal POSIX + Windows ConPTY、xterm.js 实时渲染、`pty_chunks` 回放、进程组级杀）在这一 phase 全部跑通。Phase 1 提供端到端可演示的 vertical MVP，但**不做**：拖拽文件夹 / Smart Workspace 识别（Phase 2）、Master-Worker MCP 通路（Phase 3）、拓扑视图 + 多 Worker（Phase 4）、cost guard / i18n / 主题等 polish（Phase 5）、Tauri 桌面打包（v2）。

`bunx agenstrix` 启动后：
- 启动健康检查（`which claude` / `which git` / SQLite r/w / 端口）
- 自动 spawn 真 `claude`（cwd = `process.cwd()`，无初始 prompt）
- 自动开浏览器 → 看到三栏聊天 shell（仿 golutra），中间一张消息卡片，卡片里嵌 xterm 渲染 claude TUI
- 用户在底部 ChatInput 打字 Enter 注入 stdin，也可在 xterm 里直接按键（Ctrl+C 等）
- 关 tab 重开 → xterm 微信式回放，往上翻能看到完整历史
- Ctrl+C / 关进程 → 5s SIGTERM → SIGKILL，进程组级清理；`agenstrix doctor --reap` 扫历史孤儿

</domain>

<decisions>
## Implementation Decisions

### Master 启动契约
- **D-01:** Agenstrix 启动时**自动 spawn** 真 `claude`（不等用户点 Start），前提是 self-test 检测到 `claude` 命令存在；否则不 spawn，仅在 UI 顶部 banner 提示。
- **D-02:** `claude` cwd = **启动 `bunx agenstrix` 时所在目录**（`process.cwd()`）。Phase 1 **不做**拖拽文件夹 / Open Folder 按钮 / 文件夹选择 UI / cwd 持久化（这些全部留给 Phase 2 的 WS-01..09）。
- **D-03:** `claude` 启动参数 = **裸 `claude`，无任何 flag**。**不**带 `--print` / `--mcp-config` / 初始 prompt。用户拿到一个干净 TUI，自己跟它互动。MCP 注入 留给 Phase 3 (CORE-02)。
- **D-04:** Phase 1 内 Master 视为"单 Worker 雏形" —— `worker/` 模块最小实现仅支持 `no-worktree` 模式 + cwd 直传 + cli=`claude`，不实现 worktree create / merge / inherit（Phase 3+）。Master 在 events 表里以"`worker`"行存在，便于后续 phase 复用同一持久化路径。

### 浏览器主区形态（关键 UI 决策）
- **D-05:** 主区采用 **D 方案 — "聊天气泡外壳 + xterm 嵌入消息卡片"**（仿真正 golutra `ChatInterface.vue`）：
  - 三栏 shell：左 sidebar（会话列表，Phase 1 仅一条 "Master Claude"，占位）/ 中主区（聊天气泡流 + ChatInput） / 右 MembersSidebar（成员列表，Phase 1 仅 Master 一个成员，占位）
  - 顶部 workspace bar（占位，仅显示当前 cwd 字符串，不点击不交互；Phase 2 才填充识别结果）
  - **主区中间不是 xterm 全填，不是 xterm + ChatInput 上下分** —— 而是**消息气泡流**，Master = 一张**大消息卡片**，卡片**内部嵌**一个 xterm 渲染真 PTY TUI（ASCII logo / 彩色 / permission 弹窗 / tool 卡片 全部原样）
  - 卡片右上角有 `⤢` 按钮，点了把该 xterm **全屏放大**（占满主区，再点回退）；这是 web 模式下对 golutra "点头像开 Tauri 子窗口" 的等价物
  - 卡片头部显示：● + "Master Claude" + PID + 启动时长（毫秒级活跃指示）
  - 底部 ChatInput：打字 + Enter → 整句 `\n` 结尾注入 PTY stdin；xterm 仍可直接接键盘（Ctrl+C / Esc / 方向键等不经过 ChatInput）
- **D-06:** 整个 shell 用 **shadcn/ui + Tailwind v4 + React 19** 搭，**必须是后续 Phase 2-5 真用得到的最终长相**（不允许 throwaway 调试页）。后续 Phase 3 Worker 加入时**直接复用同一个 MessageCard 容器组件**——Master 一张卡 + 每个 Worker 一张卡。

### 历史回放 UX
- **D-07:** 回放采用 **"微信式" — 打开就在最新状态，往上翻能看完整历史**。技术路径：用户打开浏览器 → 主区卡片挂载 xterm → 先用 HTTP REST 拉该 worker 的全部 `pty_chunks`（按 `seq` 升序）→ 一次性 `term.write()` 灌进 xterm（xterm 自己的 scrollback buffer 承载历史 + 自动滚到底）→ 然后开 WebSocket 接 live 增量。
- **D-08:** 不做"加速重播动画"，不做 `serialize-addon` snapshot 模式，不做"从某 seq 开始回放"。`scrollback` 容量 ≥ 100,000 行；超过时优先丢最旧（xterm 默认行为）。
- **D-09:** 加载历史时主区可显示极简 "Loading…" indicator（蒙层 + spinner），毫秒级加载基本看不见；超过 500ms 才显示。

### Self-test 失败 UX
- **D-10:** Self-test 失败采用 **C 方案 — Degraded full-start with top banner**：后端正常启动 → 浏览器正常打开 → 顶部出现**红色 banner**列出缺失项（"⚠ claude 未安装"、"⚠ SQLite 路径不可写"、"⚠ 默认端口被占"...），其他 UI 全功能可用（用户至少能点 banner / 进设置）。
- **D-11:** 点 banner → 弹 **shadcn Dialog** 显示具体修复指引 + 跨平台命令（`brew install …` / `winget install …` / `apt install …` / `npm i -g @anthropic-ai/claude-code`）+ "复制命令"按钮 + "重新检测"按钮。
- **D-12:** 例外：**SQLite 路径不可写**（比 missing claude 更致命，没法存任何东西）触发**严格模式** —— 后端立刻退出，终端打印修复指令，不开浏览器（degraded 模式都没用，因为 `pty_chunks` 写不进去）。

### CLI 入口与首次启动
- **D-13:** CLI 入口 `bunx agenstrix`（默认子命令 = `start`）。子命令最小集：
  - `agenstrix` / `agenstrix start` — 启动后端 + 自动开浏览器
  - `agenstrix doctor --reap` — 独立子命令，扫历史孤儿进程（PID 仍存活但无 Agenstrix 后端 attach），询问是否清理
  - `--port <N>` — 覆盖默认 3000
- **D-14:** 端口策略 = **默认 3000，被占了报错退出**（不自动找下一个端口）。Phase 2 才做 PORT-ALLOC-01 序列化端口分配（那是 service 端口，不是后端自己的端口）。错误里给出 `--port` 用法。
- **D-15:** 首次启动 = `~/.agenstrix/` 不存在时，自动创建 + 终端打印一行 `Created ~/.agenstrix/ (database + logs)`；不弹任何交互式 prompt。
- **D-16:** 自动开浏览器：mac `open`、linux `xdg-open`、win `start`；失败（无 GUI 环境如 SSH）静默忽略，仅打印 URL 让用户手动复制。

### Claude's Discretion
- 历史 chunks 加载用 HTTP REST 一次性拉 vs SSE 流式拉 —— 由 planner 根据 PITFALLS.md（如 1MB 单 chunk 边界）决定
- xterm scrollback 具体大小、超大历史时是否分页 lazy load —— planner 决定
- ChatInput 多行支持（Shift+Enter 换行 vs Enter 直接发） —— planner 按 golutra `ChatInput.vue` 现成模式照抄
- 卡片"全屏放大 ⤢"用 modal 还是 portal full-bleed —— planner 按 shadcn 现成组件选
- ANSI redactor 正则的具体放置点（写入 chunk 前 vs 转发 WS 前） —— planner 按 SEC-01 决定
- 进程组 `pgid` 抓取的具体时机（spawn 后 vs spawn 时） —— planner 按 KILL-01 决定
- WebSocket idleTimeout=0 + heartbeat 频率（30s / 60s） —— planner 决定
- Banner 内具体文案 / 配色（红 vs 橙）—— planner 按设计系统决定，但**必须**有"复制命令"和"重新检测"按钮
- Drizzle schema 是 Phase 1 一次性建 11 张表，还是只建 Phase 1 用得到的 ~4 张 —— planner 决定，但**至少**要 `workers / pty_chunks / events / messages`，**migration 前必须备份**（DB-DURABILITY-01）

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 项目级合同（强制）
- `.planning/PROJECT.md` — 核心价值 + Tech stack 锁定（PTY = Bun.Terminal + bun-pty fallback；Drizzle 0.45.x；@xterm/xterm v6 scoped；Tailwind v4；Web 优先 v1 不打 Tauri）
- `.planning/REQUIREMENTS.md` — Phase 1 的 17 条 v1 requirements 与验收标准（CORE-01/04/05、KILL-01、GIT-01、SEC-01、INFRA-02/03/04/05/06/07、DB-DURABILITY-01、WS-1011-01、ANSI-SPLITTER-01、WORKTREE-CWD-01、SETUP-01）
- `.planning/ROADMAP.md` § Phase 1 — phase goal + success criteria 6 条 + risk defenses landing 表（KILL-01 / GIT-01 / SEC-01 / DB-DURABILITY-01）

### 研究底稿（强制）
- `.planning/research/SUMMARY.md` §1-5 — TL;DR + stack corrections（不要用 node-pty！）+ Top 10 必须需求 + Phase 1 风险列表（Bun.Terminal Windows 4 天大、cost runaway、orphan process）
- `.planning/research/STACK.md` — Bun.Terminal 用法 + Drizzle 0.45.x 写法 + Hono SSE/WS adapter + xterm.js 配置（WebGL + Unicode11 + serialize）+ Critical Integration Patterns
- `.planning/research/ARCHITECTURE.md` §1-3 + §10 — 10 模块组件边界（Phase 1 涉及 `db/` + `bus/` + `pty/` + `worker/` 最小态 + `gateway/` + `system/`）；event taxonomy；30000 尺寸图；11-step shutdown 协议
- `.planning/research/PITFALLS.md` Pitfall 1 / 2 / 3 / 4 / 5 / 6 / 7 / 11 / 13 / 17 — 进程组杀、stdout 污染、git lock、env 泄漏、cost runaway、SQLite WAL、ANSI 切分、migration cascade、WebSocket idleTimeout、worktree cwd
- `.planning/research/FEATURES.md` HR-05 / HR-07 / HR-13 / HR-20 — kill cascade、env minimization、master resume、xterm perf

### 外部参考实现（用户指定 — researcher 必须读源码取灵感和反面教材）
- `/Users/wdx/opc/golutra/src/features/chat/ChatInterface.vue` — **主区形态 D 方案直接参照**：三栏布局（ChatSidebar + ChatHeader+MessagesList+ChatInput + MembersSidebar）+ 工作区只读 banner 模式 + 成员头像点击打开终端的事件路径（`handleMessageAvatarOpen`）
- `/Users/wdx/opc/golutra/src/features/chat/components/MessagesList.vue` — **消息卡片渲染模式**直接参照（我们的 Master/Worker 卡片用同款气泡容器，区别是卡片内容是 xterm 不是文本）
- `/Users/wdx/opc/golutra/src/features/chat/components/ChatInput.vue` — **ChatInput 组件**直接参照（多行 / mention / quick prompts / 发送行为）
- `/Users/wdx/opc/golutra/src/features/terminal/TerminalWorkspace.vue` 和 `TerminalPane.vue` — **xterm.js 嵌入容器**参照（虽然 golutra 是 Tauri 子窗口里跑，xterm 的初始化 / addon 装载 / WS bridge / resize observer 模式可直接抄）
- `/Users/wdx/opc/golutra/src/features/terminal/terminalBridge.ts` / `terminalStore.ts` / `terminalEvents.ts` — PTY ↔ UI bridge 抽象、状态存储、事件路由
- `/Users/wdx/opc/golutra/src/app/App.vue` — 整体壳子（titlebar + window-body + 视图路由 + workspace selection）；我们 web 模式不要 titlebar，但视图路由 + workspace bootstrap 思路通用
- `/Users/wdx/opc/golutra/startup_processmd.md` — KILL-01 与进程组 / Windows GetShortPathNameW 等的真实代码出处（cross-platform PTY 杀逻辑参考）
- `/Users/wdx/opc/swarm-ide/backend/app/im/` — IM-style chat backend 形态参考（消息路由 / 会话模型）
- `/Users/wdx/opc/swarm-ide/backend/app/graph/` — 拓扑可视化参考（**Phase 1 不实现**，留给 Phase 4 UI-01/UI-02，但 researcher 可先记一笔）
- `/Users/wdx/opc/swarm-ide/README.md` + `README_EN.md` — 设计哲学：dynamic delegation / human-to-any-agent communication / WeChat-style 多层会话；与 Agenstrix 的 Master/Worker 模型同源
- `/Users/wdx/opc/swarm-ide/spells/` — spells 模板格式参考（**Phase 1 不实现**，留给 Phase 5 ASSET-01）

### 关键差异提示（researcher 必看）
- golutra 是 **Tauri + Vue + Pinia + Vue I18n**，Agenstrix 是 **Web + React 19 + Zustand + react-i18next** —— 形态可参照，**代码不能直接搬**；需要 React 化重写
- golutra 终端是**独立 Tauri 子窗口** (`view=terminal`)，我们 web 模式没法开子窗口 —— 等价物是 **D-05 描述的"卡片内嵌 xterm + 一键全屏 ⤢ 按钮"**
- swarm-ide 是 **Next.js + OpenRouter LLM API**，Agenstrix 是 **Bun + Hono + 真 claude 订阅** —— 业务模型类似但运行机制完全不同（swarm-ide 直连 API，我们 spawn 真 CLI）

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **空仓库** —— Phase 1 是项目第一段代码，没有现成模块可复用
- `.planning/research/STACK.md` 里的"Critical Integration Patterns" 8 段代码示例可直接作为 Phase 1 的起点（Bun + PTY / Drizzle migration / Hono SSE / Hono WS / xterm bridge / shadcn-Tailwind4 setup）

### Established Patterns
- **架构原则（ARCHITECTURE.md §1）**：单 Bun 进程拥有所有状态；in-memory 与 SQLite 二元状态；4 种 transport 各司其职（PTY / stdio MCP / WebSocket / SSE）
- **模块边界**：Phase 1 触及 `db/`、`bus/`、`pty/`、`worker/`（最小态）、`gateway/`、`system/`；**不**实现 `master/`（Phase 3）、`mcp/`（Phase 3）、`service/`（Phase 2）、`workspace/`（Phase 2）
- **数据流**：每个 PTY chunk → `pty_chunks` 表（INFRA-03）+ `events` 表（INFRA-04），分别写两次而非合一，便于 Phase 4 事件溯源
- **杀进程协议（KILL-01）**：`Bun.spawn(..., { detached: true })` → 抓 `pgid` → kill 用 `process.kill(-pgid, sig)`
- **chunk 批处理（ANSI-SPLITTER-01 + HR-04）**：~100KB 或 250ms flush，ESC 序列起始未结束时延后切分，跨边界 tail 缓存到下一 chunk
- **WebSocket 不变式（WS-1011-01）**：`idleTimeout: 0` + 后端 30s heartbeat + 前端用 `Last-Event-ID` 风格 seq 重放
- **SQLite 不变式（DB-DURABILITY-01）**：`PRAGMA journal_size_limit=67108864` + 每 5min `wal_checkpoint(TRUNCATE)` + migrate 前备份 `~/.agenstrix/backups/` 保留 10 份；生产**不用** `drizzle-kit push`
- **shutdown 11 步（SETUP-04 的 Phase 1 部分）**：Phase 1 不实现完整 11 步，但**至少**：①停接 WS → ②kill 当前唯一 PTY（SIGTERM → 5s → SIGKILL）→ ③SQLite WAL checkpoint → ④pino flush → ⑤exit。Phase 5 补完整 11 步。

### Integration Points
- **Hono 在 Bun 上的 WS** 必须用 `hono/bun` adapter（不是裸 `hono`）
- **Bun --compile 静态导入限制** —— 任何 native module（fs 之外的 .node）必须 static import，不要 dynamic `require()`；Phase 1 唯一可能踩雷的是 `bun-pty` FFI 兜底（藏在 `PtyHandle` 接口后）
- **xterm WebGL renderer** 必须在容器有可测量尺寸后才 `term.open()`，否则得到 0×0 永不恢复；Unicode11 addon 需 `allowProposedApi: true`
- **shadcn/ui CLI** 用 `npx shadcn@latest init`（不是 `shadcn-ui`），Tailwind v4 + React 19 GA；动画用 `tw-animate-css`（**不是** `tailwindcss-animate`）

</code_context>

<specifics>
## Specific Ideas

- **形态参照系**：用户明确说 "想看到 `/Users/wdx/opc/golutra` 和 `/Users/wdx/opc/swarm-ide` 这两个的结合体"
  - golutra 给的是**三栏聊天 shell + 消息卡片 + 终端窗口**这套**视觉与组件结构**
  - swarm-ide 给的是 **IM 式聊天 + workspace 概念 + 多 agent 拓扑**这套**心智模型**
  - 主区最终走 **D 方案**："聊天气泡流外壳 + Master/Worker 各为一张消息卡片 + 卡片内嵌 xterm 渲染真 TUI + 一键全屏 ⤢"
- **历史 = 微信式**：用户原话"类似微信啊，或者聊天工具啥的"。意思是：打开就是上次的状态（最新一帧在视野中），**往上滑能看到完整历史**。不要"重播动画"，不要"加速回放"，不要"截图模式只恢复最后一帧丢中间"。技术上 = xterm 自带 scrollback 装满所有历史字节。
- **Self-test 失败 = C 方案**：banner 警告但全功能启动；最贴 "bunx agenstrix → 浏览器能用" 的承诺。
- **claude cwd = 启动目录**：用户明确选 "启动目录就是 cwd（推荐）"；不做拖拽 UI（那是 Phase 2）。
- **顶部 workspace bar 必须占位**：Phase 1 里只显示一行 cwd 字符串，不交互；但 chrome 必须搭好让 Phase 2 直接往里塞 dropzone + 识别结果 + service status dots。
- **MessageCard 容器是 Phase 1 留给后续 phase 的关键组件**：Master 是第一张卡，Phase 3 起每个 Worker 是新一张卡，Phase 4 拓扑视图与气泡视图是同源数据的不同投影。MessageCard 必须从 Phase 1 就**对**。

</specifics>

<deferred>
## Deferred Ideas

- **拖拽文件夹 / Open Folder UI / Smart 识别 / 试启动 / 学到的命令** → Phase 2（WS-01..09 + SVC-*）
- **多 Worker 卡片 / Master 通过 MCP spawn Worker / Master Thinking drawer / chat 解析成气泡（不只是 xterm 嵌入）** → Phase 3（CORE-02/06 + MCP-01 + UI-03/04/05）
- **拓扑视图（react-flow）/ 双视图切换 / @worker-N 提及** → Phase 4 / Phase 5（UI-01 / UI-02 / UI-10）
- **token / 美元预算 + 全局成本仪表盘 + cost runaway 防御** → Phase 5（COST-01 / UI-07）
- **i18n（zh-CN + en）/ 暗亮主题 / Cmd+K 全局搜索 / 高风险确认对话框** → Phase 5（INFRA-01 / UI-06/08/09）
- **Skill / Template / .agenstrix-pack 导入导出** → Phase 5（ASSET-01..04）
- **完整 11 步 shutdown 协议** → Phase 5（SETUP-04 完整版）；Phase 1 只实现最小 5 步
- **Tauri 桌面打包 + sidecar binary + capabilities + macOS notarization + Windows EV cert** → v2（DESKTOP-01..04）
- **Gemini / OpenCode CLI 支持** → v2（CLI-V2-01/02）
- **自动反思圈 / Workflow 自动蒸馏 / 自我进化** → v3（GROW-V3-*）

None deferred from outside the phase scope — discussion stayed within Phase 1 boundaries.

</deferred>

---

*Phase: 1-First PTY Demo*
*Context gathered: 2026-05-17*
