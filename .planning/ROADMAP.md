# Roadmap: Agenstrix v1

**Created:** 2026-05-17
**Granularity:** Coarse (5 phases, vertical MVP)
**Project Mode:** Vertical MVP — every phase ships an end-to-end demoable user capability
**Core Value:** 一个人坐在 Agenstrix 前对话，背后是一个自主调度多个真实 `claude` / `codex` 终端并行干活的 AI 团队 —— 用户的 CLI 订阅天然就能用，配置全部自动推断，零额外计费门槛、零 yaml。

---

## Phases

- [ ] **Phase 1: First PTY Demo** — 浏览器看到一个真的 `claude` 命令在 PTY 中实时跑（字节流双向，事件溯源已开始）
- [ ] **Phase 2: Smart Workspace Demo** — 拖两个文件夹进 UI → 自动识别 + 试启动 + 顶部条绿点
- [ ] **Phase 3: Master + Worker Demo** — 用户跟真 `claude` Master 聊天，Master 通过 MCP 自己 spawn 一个 Worker 并在浏览器实时显示
- [ ] **Phase 4: Topology + Multi-Worker Demo** — PROJECT.md 多 repo demo 剧本完整跑通（3 Worker 并行+依赖+service 自动启停+chrome-devtools-mcp 测试）
- [ ] **Phase 5: Production Polish** — Cost guards / 安全 / 主题 / i18n / Skill / 包导入导出 / 11 步关停 / Tauri 准备 — v1 在 mac/linux/windows 都跑得稳

---

## Phase Details

### Phase 1: First PTY Demo
**Goal:** 用户访问 `http://localhost:5173` → 看到一个聊天/调试界面 → 后台有一个真的 `claude` 进程跑在 Bun.Terminal PTY 里 → 浏览器 xterm.js 实时渲染该 PTY 的字节流（ASCII logo / 彩色 / tool 卡片原样）；用户键盘输入能注入到 PTY stdin；事件已持久化到 SQLite（重启后从历史回放）
**Mode:** mvp
**Depends on:** Nothing (foundation)
**Requirements:** INFRA-02, INFRA-03, INFRA-04, INFRA-05, INFRA-06, INFRA-07, DB-DURABILITY-01, CORE-01, CORE-04, CORE-05, KILL-01, GIT-01, SEC-01, WS-1011-01, ANSI-SPLITTER-01, WORKTREE-CWD-01, SETUP-01
**Success Criteria** (what must be TRUE for users):
  1. 用户运行 `bunx agenstrix` 并打开浏览器，看到一个调试面板，里面有一个真 `claude` 命令的实时终端窗口（彩色 ASCII logo、permission 弹窗、tool 卡片全部原样渲染）
  2. 用户在浏览器输入字符 → 字符注入到 `claude` stdin；`claude` 回复 → 浏览器实时显示
  3. 用户关掉浏览器 tab 再打开，看到的不是空白 —— 而是从 SQLite `pty_chunks` 完整回放的历史字节流
  4. 用户按 Ctrl+C / 关闭进程 → 后端 `claude` 及其子进程组一起被杀（5s SIGTERM → SIGKILL），不留孤儿；下次启动 `agenstrix doctor --reap` 能识别历史孤儿
  5. 启动时跑 self-test：检测 `which claude`、`which git`、SQLite 读写、默认端口；缺了任何一项给具体修复指令（含 brew / npm 命令）
  6. 在 macOS、Linux、Windows 10 1809+ 三平台 CI 上都能跑通烟雾测试（Windows ConPTY 通路确认；路径短名转换工作）
**Plans:** 3/6 plans executed
  - [x] 01-01-PLAN.md — Walking Skeleton: scaffold + DB + bus + PTY + Hono + chat shell + echo placeholder (Wave 1)
  - [x] 01-02-PLAN.md — Real claude PTY bridge + ANSI splitter + WS hardening (Wave 2)
  - [x] 01-03-PLAN.md — DB durability + backups + WAL PASSIVE + replay correctness (Wave 2)
  - [ ] 01-04-PLAN.md — Kill-group + running.json + doctor --reap + git lock scanner + WORKTREE-CWD-01 (Wave 3)
  - [ ] 01-05-PLAN.md — Secret redactor + spawn-env hard denylist (Wave 3)
  - [ ] 01-06-PLAN.md — CI matrix (mac/linux/windows) + Windows short-path + README (Wave 4)
**UI hint:** yes
**Research-phase needed:** yes — Bun.Terminal Windows ConPTY 是 2026-05-13 才发的，需要早期验证；`bun-pty` FFI 兜底接线再次确认；ANSI 序列跨 chunk 切分边界 case 收集
**Risk defenses landing here:**
  - **KILL-01** — `detached: true` 不变式 + `process.kill(-pgid, sig)` 包装；`agenstrix doctor --reap` 启动孤儿扫描
  - **GIT-01** — 每 repo `git worktree add` 序列化队列雏形（即使 Phase 1 暂未用 worktree，也要把 `.git/index.lock` 启动扫描器先放好）
  - **SEC-01** — Worker spawn env 默认只含 `PATH/HOME/USER/LANG/SHELL`；PTY chunk 写入前过 redactor（`sk-ant-` / `ghp_` / `sk-` / `AKIA[0-9A-Z]{16}`）
  - **DB-DURABILITY-01** — `PRAGMA journal_size_limit=67108864` + 每 5 分钟 `wal_checkpoint(TRUNCATE)` + **migrate 前自动备份 `store.db` 到 `~/.agenstrix/backups/`（保留 10 份）**

### Phase 2: Smart Workspace Demo
**Goal:** 用户拖一个 Next.js 文件夹和一个 FastAPI 文件夹进 Agenstrix UI → Agenstrix 自动识别（语言 / 框架 / 包管理器 / 角色 / 端口 / 启动命令）→ 试启动 → 顶部条出现两个绿点（"Next.js :3000 ✓"、"FastAPI :8000 ✓"）；如果启动失败一次性兜底对话学到正确命令；下次启动自动恢复 workspace
**Mode:** mvp
**Depends on:** Phase 1 (SQLite + bus + 系统骨架已就位)
**Requirements:** WS-01, WS-02, WS-03, WS-04, WS-05, WS-06, WS-07, WS-08, WS-09, WS-DETECT-01, SVC-01, SVC-02, SVC-03, SVC-04, SVC-05, SVC-READY-01, PORT-ALLOC-01, UI-11, SETUP-02
**Success Criteria** (what must be TRUE for users):
  1. 用户拖 `~/projects/myapp-frontend/` 进 Agenstrix UI → 1-2 秒内看到识别结果："Next.js / pnpm / port 3000 / role: frontend"
  2. 用户再拖 `~/projects/myapp-backend/` → 识别为 "FastAPI / pip / port 8000 / role: backend"；UI 顶部条同时显示两个 repo + service 状态 dots
  3. 试启动一次：如果识别到的命令成功 → service dot 变绿（HTTP GET health URL 返回 2xx + 1s warmup hold，不是 port-open）；如果失败 → 弹错误 + 智能建议（"看起来要先装依赖，要我跑 `pnpm install` 吗？"），用户一句话回答后 Agenstrix 重试，成功后把 pre-run 命令一起记到 SQLite
  4. 端口冲突 → 弹"kill 占用进程 / 用另一个端口 / 取消"三选项（默认推荐"用下一个空闲端口"，串行化端口分配避免 TOCTOU）
  5. 用户关 Agenstrix 再打开 → workspace 自动恢复（repo 列表 / 学到的命令 / pre-run / 端口全部从 SQLite 读回），整个过程**零 yaml / 零 JSON 配置文件**
  6. 用户在聊天里说"frontend 启动用 `bun dev` 不是 npm" → Master 通过 `update_learned_command` 工具更新 SQLite（这条在 Phase 3 联调，Phase 2 先把 SQLite 写路径+UI 编辑面板备好）
**Plans:** TBD
**UI hint:** yes
**Research-phase needed:** yes — 各框架健康检查 URL 的 ground truth（Vite `/@vite/client` / Next `/` / Express `/` / FastAPI `/` / Django `/`）；monorepo 工具（turbo / nx / pnpm-workspace）扫描边界 case
**Risk defenses landing here:**
  - **SVC-READY-01** — service "ready" 必须是 HTTP 2xx，不是 port-open；60s 超时 → `service.start_timeout` 事件 + 抓 stderr 最后 50 行展示
  - **PORT-ALLOC-01** — 单一队列分配端口；分配中端口立刻进 `reserved` 集合直到 bind 成功

### Phase 3: Master + Worker Demo
**Goal:** 用户在 Agenstrix 聊天框里跟真 `claude` Master 对话（"帮我加一个文件读取功能"）→ Master 内部决策 → 通过 MCP 工具调用 `spawn_worker` → Agenstrix 在 worktree 中起一个真 `claude` Worker → 用户在 UI 上点 Worker 节点弹出 PTY 抽屉，看到 Worker 实时干活（彩色输出 / tool 卡片）；Worker 完成自动 commit + worktree remove；Master 重启能从崩溃中恢复（注入活动 Worker + 服务列表 + 最近 20 轮聊天）
**Mode:** mvp
**Depends on:** Phase 1 (PTY 基础设施), Phase 2 (workspace + service 已就位作为 Worker 的工作场所)
**Requirements:** CORE-02, CORE-06, MCP-01, MCP-PURITY-01, MASTER-RESUME-01, COST-02, UI-05, UI-03, UI-04
**Success Criteria** (what must be TRUE for users):
  1. Agenstrix 启动时自动以 Master 身份 spawn 真 `claude`，并通过 stdio bridge 把自己作为 MCP server 注入（在 `claude` 里输 `/mcp` 能看到 Agenstrix 的工具集）；MCP server 有至少 `spawn_worker / send_to_worker / kill_worker / list_workers / read_worker_log / list_skills` 等动作
  2. 用户在聊天里说"在 backend repo 起一个 worker 帮我写一个 hello 端点" → Master LLM 自己决策 → 调 `spawn_worker(repo=backend, cli=claude, mode=isolated)` → 1 个 Worker 出现，PID 可见，在独立 git worktree 中工作
  3. 用户点 Worker 节点 → 弹出半屏 xterm.js 抽屉，看到该 Worker 的完整 PTY 字节流（包括 ASCII logo / diff 卡片 / permission 弹窗，原样无损）；关掉弹层 Worker 不死；用户在弹层键盘输入字符能注入到 Worker stdin
  4. Worker 完成 → 自动 `git commit -am ...` + `git worktree remove`；用户在主仓库能看到一个新 worker 分支；事件 `worker.exited` 写入 `events` 表
  5. 打开右上"Master Thinking"抽屉 → 实时滚动显示 Master 每一步：LLM 输入 / 思考 / 工具调用参数+返回 / 最终回复；可按事件类型筛选；可导出 JSON
  6. 用户故意 `kill -9` Master → Bun 后端检测到 → 30s 内自动重启新 `claude`，注入恢复 prompt（活动 Worker W-1..N + 运行中 service + 最近 20 轮聊天）；新 Master 系统提示约定"先调 `list_workers / list_services`"；30s 内没 `send_to_worker` 到孤儿 Worker → 弹"是否 kill 孤儿"模态
  7. 会话累计花费超过 $5（设置可改）→ MCP `spawn_worker` 直接返回 budget_exceeded；现有 Worker 优雅停；UI 弹无法取消的模态：Stop / 加预算继续 / Kill all
**Plans:** TBD
**UI hint:** yes
**Research-phase needed:** yes — Claude Code MCP 插件 spawn 配置发现顺序（`CLAUDE_MCP_CONFIG` 环境变量 vs `.claude.json`，跨 claude 版本可能漂移）；Claude Code 自身 session 持久化位置（`~/.claude/`）对 MASTER-RESUME-01 缓解程度的影响；Claude Code 工具调用事件流是否给 UI-05 Thinking drawer 提供足够结构化数据
**Risk defenses landing here:**
  - **MCP-PURITY-01** — `mcp/bridge/**` Biome lint 禁 `console.log`；启动单测断言 5s 内 bridge stdout 全部可解析 JSON-RPC；CI 跑这个测试
  - **MASTER-RESUME-01** — Master 崩溃自动重启 + recap prompt 注入 + 孤儿 Worker 检测

### Phase 4: Topology + Multi-Worker Demo
**Goal:** 完整跑通 PROJECT.md 那个"多 repo + 3 Worker + 依赖 + service 自动启停 + chrome-devtools-mcp 端到端测试"剧本：用户跟 Master 说"加用户注册功能 —— 前端表单 + 后端 API + 端到端测试" → Master 拆 3 个任务声明依赖 → Worker-1 (backend, isolated) → Agenstrix 自动启 backend service → Worker-2 (frontend, isolated, waits W1) → 自动启 frontend service → Worker-3 (codex, no-worktree, chrome-devtools-mcp, waits W1+W2 + needs both services) 开浏览器跑测试 → 用户在拓扑视图实时看到 3 节点并行+依赖等待线；点任一节点看 PTY 真实情况
**Mode:** mvp
**Depends on:** Phase 3 (Master + MCP + 单 Worker 已工作)
**Requirements:** CORE-03, CORE-07, UI-01, UI-02, MCP-02, MCP-03, MCP-04
**Success Criteria** (what must be TRUE for users):
  1. 用户按顶部切换按钮在"聊天侧"和"拓扑侧"之间切换；状态持久化；聊天侧流式 markdown / code / diff 渲染；拓扑侧 `@xyflow/react` 渲染节点
  2. Master 调 `spawn_worker(..., wait_for: [W1, W2], with_services: [backend, frontend])` → 拓扑视图能看到 3 个节点 + 实线依赖边 + 虚线动画"waiting" 等待边；waiting 节点显示"在等 W1/W2"
  3. Worker 节点状态色实时变化：idle 灰 / running 蓝 / waiting 黄 / done 绿 / error 红；节点上显示 CLI 类型徽章（claude 蓝、codex 绿）+ 任务摘要 + 累计 token + 累计花费 + budget 进度条
  4. 4 种 Worker 环境模式全部可用：`isolated`（独立 worktree） / `inherit:<id>`（接前置分支） / `merged:[ids]`（多分支 merge） / `no-worktree`（纯 MCP 工具调用，比如测试 Worker）
  5. Worker-3（测试 Worker, codex, no-worktree）启动时自动获得内置 `chrome-devtools-mcp` 工具（无需用户配置）+ system prompt 注入"服务已就绪：backend 在 :8000、frontend 在 :3000，你有 chrome-devtools-mcp 工具"；Worker-3 开浏览器跑端到端测试，用户能在它的 PTY 抽屉里看到浏览器自动化过程
  6. 用户在设置里加一个自定义 MCP server（stdio / http / sse 三种 transport）→ 工具自动暴露给 Master（也可指定只给某些 Worker）
  7. 完整 demo 剧本一遍到底跑通；可以录视频；3 Worker 并行写代码 + 1 个跑测试 + 用户在拓扑视图看到全局
**Plans:** TBD
**UI hint:** yes
**Research-phase needed:** no — react-flow + bus projection 都是成熟模式
**Risk defenses landing here:**
  - **CORE-03/07** "demo 魔法"四件套必须同时工作（WS + Master + service auto-start + chrome-devtools-mcp）的端到端集成测试在这个 phase 收官
  - 8 Worker 并行 spawn 到同一 repo 的 CI 集成测试（验证 GIT-01 在 Phase 1 落地的序列化队列在高并发下也工作）

### Phase 5: Production Polish
**Goal:** v1 可发布质量 —— 没有 cost 黑天鹅、没有密钥泄漏、Skill / 包导入导出可用、UI 完善（i18n / 主题 / Cmd+K / `@worker-N` / 高风险确认）、11 步优雅关停在 Windows 也工作；Tauri 2 sidecar 打包配方落地（v1 不打 desktop，但 v2 不应该是 3 天的惊喜）
**Mode:** mvp
**Depends on:** Phase 4 (核心 demo 剧本已完整可跑)
**Requirements:** COST-01, UI-06, UI-07, UI-08, UI-09, UI-10, ASSET-01, ASSET-02, ASSET-03, ASSET-04, INFRA-01, SETUP-03, SETUP-04
**Success Criteria** (what must be TRUE for users):
  1. 每 Worker 默认有 50k tokens 预算，spawn 时可覆盖；Worker 系统提示注入"你有 N tokens，85% 时暂停求许可"；后端轮询 `/cost`，超 100% 自动 kill（事件 `worker.budget_exceeded`）；UI 节点显示进度条 — 用户跑一晚不会被烧 $200
  2. 顶部全局成本仪表盘显示本会话累计 token + 累计花费 + 距 budget 剩余 %；点开看按 Worker / 按会话明细
  3. 全局搜索 `Cmd+K` 唤起命令面板，跨对话 / Skill / 事件 / Worker 日志全文搜索；结果点击跳转
  4. 主题 暗 / 亮 跟随系统或手动切换；i18n 框架就位（zh-CN 默认 + en）所有 UI 字符串走 `t()`
  5. 聊天框 `@worker-3 暂停一下` 自动补全 + 后端识别为 `send_to_worker` 动作；高风险动作（杀 Worker / 删 Skill / 删 workspace / 删 repo）弹确认对话框
  6. 4 个内置 spells 模板（tree-executor / router-experts / map-reduce / critic-loop）预装；用户在 `.agenstrix/skills/` 放 .md 自动注入；UI 有"导入 `.agenstrix-pack`"和"导出 workspace 为包"按钮，导出时跑密钥扫描
  7. 用户按 Ctrl+C / 关窗 → 严格 11 步关停：停接新请求 → Workers SIGTERM → 5s 等 → 强杀 + worktree cleanup 兜底 → Master SIGTERM → services SIGTERM → MCP clients close → SQLite WAL checkpoint → pino flush → sockets close → exit；macOS / Linux / Windows 都验证
**Plans:** TBD
**UI hint:** yes
**Research-phase needed:** yes — 仅 Tauri 2 sidecar 代码签名（macOS notarization + Windows EV cert）路径需要再次验证（v1 不打 desktop，但 v2 不能临时学）
**Risk defenses landing here:**
  - **COST-01/02** — Worker 级 + Session 级双层 budget；MCP loop detection（hash workerId/toolName/args，5 次重复警告，HR-03）
  - **DB-DURABILITY-01 兜底** — backup 已在 Phase 1，这里加 migration cascade-drop 人工 review 流程；生产**不用** `drizzle-kit push`，只用 generate + migrate

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. First PTY Demo | 3/6 | In Progress|  |
| 2. Smart Workspace Demo | 0/? | Not started | - |
| 3. Master + Worker Demo | 0/? | Not started | - |
| 4. Topology + Multi-Worker Demo | 0/? | Not started | - |
| 5. Production Polish | 0/? | Not started | - |

---

## Coverage

- **v1 requirements total:** 65 (REQUIREMENTS.md traceability table count; the `64 total` summary line in REQUIREMENTS.md appears to be off-by-one — flag during requirements review)
- **Mapped:** 65 / 65 (100%)
- **Orphans:** 0
- **Duplicates:** 0

Detailed mapping lives in `REQUIREMENTS.md` § Traceability.

---

## Dependency Order (Why This Sequence Is Non-Negotiable)

1. **Phase 1 before Phase 2**: 每个 PTY spawn 都要写 chunks 和 emit 事件 — DB+bus 必须最早；事后改持久化代价巨大。
2. **Phase 1 before Phase 3**: PTY 是锁定 stack 里最未验证的一块（Bun.Terminal Windows ConPTY 4 天大）；早失败早换 `bun-pty`。
3. **Phase 2 before Phase 3**: Smart Workspace 是核心差异化承诺，**且**比 Master+MCP 简单 — 单独 debug 比同时 debug 两者容易。
4. **Phase 3 before Phase 4**: 单 Worker 通路必须先打通；拓扑视图是展示 MCP 驱动的动作结果。
5. **Phase 4 before Phase 5**: dep graph 通过 MCP 工具调用声明；reconciler 消费 MCP handler 发的 bus 事件。
6. **Phase 5 收尾**：除了 6 个 "必须 P1 不能延后"的风险防御（KILL-01 / GIT-01 / SEC-01 / DB-DURABILITY-01 → Phase 1，SVC-READY-01 → Phase 2，MCP-PURITY-01 / MASTER-RESUME-01 → Phase 3），其他 polish 都集中到 Phase 5。

---

*Roadmap created: 2026-05-17*
*Project mode: Vertical MVP — 每个 phase 都有端到端可演示的用户能力*
