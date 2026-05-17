# Requirements: Agenstrix

**Defined:** 2026-05-17
**Core Value:** 一个人坐在 Agenstrix 前对话，背后是一个自主调度多个真实 `claude` / `codex` 终端并行干活的 AI 团队 —— 用户的 CLI 订阅天然就能用，配置全部自动推断，零额外计费门槛、零 yaml。

---

## v1 Requirements

v1 版本所有可勾选需求。每条都有验收标准 + 来源引用。来源缩写：**PJ** = PROJECT.md / **F** = research/FEATURES.md (HR-_) / **P** = research/PITFALLS.md / **A** = research/ARCHITECTURE.md / **S** = research/SUMMARY.md §3。

### Core Engine（核心引擎，差异化）

- [ ] **CORE-01**: Master 是真交互 `claude` 命令，跑在 Agenstrix 后端控制的 PTY 中
  - **验收**：启动 Agenstrix → 后端自动 spawn 真 `claude` 进程；前端能在调试面板看到该进程 PID 和 PTY 字节流；杀掉再起，新的 PID 出现，旧的不残留
  - **来源**：PJ CORE-01 / S §1

- [ ] **CORE-02**: Master 通过 Claude Code 官方插件机制（MCP）接 Agenstrix 动作工具集
  - **验收**：Master 启动后 `claude` 内调 `/mcp` 命令能看到 Agenstrix server；Master LLM 能成功调用 `spawn_worker` / `kill_worker` / `start_service` / `stop_service` / `list_workers` / `list_services` / `wait_for_workers` / `read_worker_log` / `list_skills` / `inject_skill` / `update_learned_command` / `add_dep` / `send_to_worker` 等动作，每个动作有 schema 验证、错误处理
  - **来源**：PJ CORE-02 / A §7

- [ ] **CORE-03**: Worker 启动支持 4 种环境模式（用户隐藏，Master 内部决策）
  - **验收**：MCP `spawn_worker` 工具支持 `mode: isolated | inherit:<id> | merged:[ids] | no-worktree`；isolated 起独立 git worktree；inherit 接前置 Worker 完成的分支；merged 新 worktree 并 merge 多个上游分支；no-worktree 不建 worktree
  - **来源**：PJ CORE-03

- [ ] **CORE-04**: Worker 是真交互 `claude` 或 `codex` 命令，PTY 模式跑；结束后按环境模式自动处理
  - **验收**：Worker 完成时 worktree 模式自动 `git commit -am ...` + `git worktree remove`；no-worktree 模式直接退出；用户在主仓库能看到 worker 分支
  - **来源**：PJ CORE-04

- [ ] **CORE-05**: 杀 Worker：`SIGTERM` → 等 5s → `SIGKILL` → 清环境
  - **验收**：Kill 一个跑了 30 秒的 Worker，5s 后该 Worker PID 不再存在；worktree 被清；事件流有 `worker.killed` 事件
  - **来源**：PJ CORE-05

- [ ] **CORE-06**: MVP CLI 支持 Claude Code + Codex CLI 作为 Worker
  - **验收**：MCP `spawn_worker` 工具 `cli` 参数可选 `claude` 或 `codex`，两者都能在独立 worktree 干活并完成提交
  - **来源**：PJ CORE-06

- [ ] **CORE-07**: Worker 依赖图 —— Master 声明依赖关系，Agenstrix 负责等待 + 必要 merge / service 启停
  - **验收**：Master 调 `spawn_worker(..., wait_for: [W1, W2])` → Worker-3 状态显示 `waiting`，直到 W1 + W2 完成；service 依赖（`with_services`）相同逻辑；拓扑视图能看到 waiting 边
  - **来源**：PJ CORE-07 / A DF-09

### Cost & Safety（成本与安全，来自 research 新增）

- [ ] **COST-01**: 每 Worker token 预算上限
  - **验收**：默认 50k tokens/Worker；spawn 时可覆盖；Worker 系统提示注入 `"You have N tokens budget; pause at 85% (~42.5k) and ask permission"`；后端轮询 `/cost` 端点，超 100% 自动 kill（事件 `worker.budget_exceeded`）；UI 节点显示进度条
  - **来源**：F HR-01 / P Pitfall 5 / S §3 row 1

- [ ] **COST-02**: 会话级预算 kill-switch
  - **验收**：默认 $5/session（设置可改）；触线后 MCP `spawn_worker` 直接返回 budget_exceeded 错误；现有 Worker 优雅停止；UI 弹出无法取消的模态框，3 个按钮：Stop / 加预算继续 / Kill all
  - **来源**：F HR-02 / P Pitfall 5 / S §3 row 2

- [ ] **KILL-01**: 级联杀 —— PTY 子进程组 + chrome-devtools-mcp 浏览器子进程 + 启动时孤儿扫描
  - **验收**：`Bun.spawn(..., { detached: true })` 不变式；kill 用 `process.kill(-pgid, sig)`；杀 Worker 时同步关闭它的 MCP client 连接和 Chromium 子进程；启动 self-test 跑 `agenstrix doctor --reap`，发现孤儿进程能识别并提示清理
  - **来源**：F HR-05 / P Pitfall 1 / S §3 row 3

- [ ] **GIT-01**: 每 repo `git worktree add` 序列化队列 + 启动时清 stale lock
  - **验收**：Master 同时 spawn 3 个 Worker 到同一 repo，3 个 `git worktree add` 严格串行（不会出现 `.git/index.lock` 冲突）；启动时扫描每个 repo 的 `.git/index.lock` 并询问是否清除
  - **来源**：P Pitfall 3 / S §3 row 4

- [ ] **SEC-01**: Worker spawn env 最小化 + 密钥扫描
  - **验收**：Worker spawn 时 env 默认只含 `PATH / HOME / USER / LANG / SHELL`；用户在设置里可加 allowlist；MCP 有 `request_env_var(name)` 工具让 Master 主动申请；PTY 字节流写入 `pty_chunks` 前过 redactor，匹配 `sk-ant-` / `ghp_` / `sk-` / `AKIA[0-9A-Z]{16}` 等模式替换为 `[REDACTED]`；启动时不复制 `.env` / `.envrc` / `secrets.*` 到 worktree
  - **来源**：F HR-07 / P Pitfall 4 / S §3 row 5

- [ ] **MCP-PURITY-01**: MCP stdio bridge 纯净
  - **验收**：`mcp/bridge/**` 目录下 Biome lint 规则禁止 `console.log` / `console.error` 直写 stdout（必须 `process.stderr.write`）；启动时跑单元测试，断言 5 秒内 bridge stdout 输出全部可解析为 JSON-RPC；CI 跑这个测试
  - **来源**：P Pitfall 2 / S §3 row 6

### Smart Workspace（智能 workspace，差异化）

- [ ] **WS-01**: 拖拽 / 按钮加 repo / 目录
  - **验收**：UI 顶部有拖拽热区（react-dropzone）+ "添加" 按钮；命令行 `agenstrix workspace add <path>` 等价；零 yaml / JSON 配置文件
  - **来源**：PJ WS-01

- [ ] **WS-02**: 智能项目识别
  - **验收**：扫描签名文件识别语言（package.json / pyproject.toml / requirements.txt / go.mod / Cargo.toml / Gemfile / pom.xml / composer.json）；从 deps 识别框架（next / vite / react / vue / fastapi / django / express 等）；从 lockfile 识别包管理器（pnpm-lock → pnpm 等）；从 deps + 目录名 hint 推断角色（frontend / backend / test / lib）；判断是否 git 仓库；扫描完成后 UI 显示识别结果（可手动修正）
  - **来源**：PJ WS-02

- [ ] **WS-03**: 启动命令自动推断（三层兜底）
  - **验收**：层 1 读 `package.json` scripts.dev / start / serve；层 2 grep README 找 `uvicorn` / `python -m` / `go run` / `cargo run`；层 3 用框架默认值；如果都没有则 WS-06 进入兜底对话
  - **来源**：PJ WS-03

- [ ] **WS-04**: 端口自动推断
  - **验收**：读 `vite.config.*` / `next.config.*` / `.env` / `.env.local` 的端口；读 script 里 `--port` 参数；都没有用框架默认值（Next.js → 3000 / Vite → 5173 / FastAPI → 8000）
  - **来源**：PJ WS-04

- [ ] **WS-05**: 试启动 + 自动学习
  - **验收**：加 repo 后 Agenstrix 试启动一次；成功 → 把 repo / 启动命令 / 端口 / 健康 URL / pre-run 命令存进 SQLite `learned_commands` 表；失败 → 进入 WS-06；下次同 repo 直接用学到的命令
  - **来源**：PJ WS-05

- [ ] **WS-06**: 失败兜底对话
  - **验收**：启动失败时 UI 显示错误 + 智能建议（"看起来要先装依赖，要我跑 `pnpm install` 吗？"）；用户回答后 Agenstrix 重试；成功后把"pre-run hook"和最终命令一起记到 `learned_commands`；只问一次，下次自动用
  - **来源**：PJ WS-06

- [ ] **WS-07**: Workspace 配置全部存 SQLite
  - **验收**：repos / services / learned_commands / 用户调整 全部在 SQLite，无任何 yaml / JSON 配置文件；下次启动 Agenstrix 自动恢复 workspace
  - **来源**：PJ WS-07

- [ ] **WS-08**: 多 repo + 非 git 目录混合 workspace
  - **验收**：同一 workspace 能同时包含 2 个 git repo（如 frontend + backend）和 1 个非 git 目录（如 e2e-tests）；UI 区别显示（"📁 git repo" vs "📂 目录"）；Master 招 Worker 时能选哪个 repo / dir 工作
  - **来源**：PJ WS-08

- [ ] **WS-09**: 用户可在 UI / 聊天调整任意推断结果
  - **验收**：UI 有"workspace 编辑"面板能改启动命令 / 端口 / 角色；聊天里说"frontend 启动用 `bun dev` 不是 npm" → Master 调 `update_learned_command` MCP 工具 → SQLite 更新
  - **来源**：PJ WS-09

- [ ] **WS-DETECT-01**: Workspace-aware 根目录扫描
  - **验收**：识别 monorepo 工具（`package.json#workspaces` / `pnpm-workspace.yaml` / `turbo.json` / `nx.json` / `pyproject.toml` workspaces）；扫描时排除 `node_modules` / `.venv` / `dist` / `build` / `.next` / `target` / `.turbo` / `.git`；声明 service 前要求同时满足"签名文件存在 + 有 dev script"；检测到 > 2 个 service 时先弹选择器再 trial-start
  - **来源**：P Pitfall 9 / S §3 row 8

### Service Supervisor（服务一等，差异化）

- [ ] **SVC-01**: Service = 可启动的长期进程，由 WS 系列自动识别 + 学习
  - **验收**：Workspace 加 repo 后，识别到的 dev server 自动生成对应 service 条目（含 name / repo / cmd / port / health_url）
  - **来源**：PJ SVC-01

- [ ] **SVC-02**: Master 可调动作工具启动 / 停止 service
  - **验收**：MCP 工具 `start_service(name)` / `stop_service(name)` 工作；招人时 `with_services: [...]` 参数自动触发；spawn Worker 前对应 service 必须 ready
  - **来源**：PJ SVC-02

- [ ] **SVC-03**: Service 健康检查
  - **验收**：进程存活检测（PID 还在）+ HTTP ping 健康 URL；状态变化推 UI 事件
  - **来源**：PJ SVC-03

- [ ] **SVC-04**: UI 顶部显示当前 workspace 所有 service 状态
  - **验收**：UI 顶部条显示每个 service 一个 dot：绿（HTTP 2xx）/ 黄（启动中）/ 灰（未启）/ 红（异常）；点击可手动启停
  - **来源**：PJ SVC-04

- [ ] **SVC-05**: 端口冲突自动处理
  - **验收**：启动 service 前先试探端口；占用且是已知 Agenstrix 启动过的进程 → 直接复用；占用且是别的进程 → 弹"kill 它 / 用另一个端口 / 取消"；用户许可后处理
  - **来源**：PJ SVC-05

- [ ] **SVC-READY-01**: Service "ready" 必须是 HTTP 2xx，不是 port-open
  - **验收**：service 启动后等待逻辑 = HTTP GET health_url 返回 2xx + 额外 1 秒 warmup hold；每框架健康 URL 映射（Vite `/@vite/client` / Next `/` / Express `/` / FastAPI `/` / Django `/`）；60 秒超时 → 触发 `service.start_timeout` 事件 + 抓 stderr 最后 50 行展示
  - **来源**：F HR-17 / P Pitfall 10 / S §3 row 7

- [ ] **PORT-ALLOC-01**: 序列化端口分配 + reserve/release
  - **验收**：dep graph reconciler 并行 spawn 2 个 service 时端口分配走单一队列，避免 TOCTOU；分配中的端口立刻进 `reserved` 集合直到 bind 成功
  - **来源**：P Pitfall 15 / S §3 honorable mention

### UI

- [ ] **UI-01**: 双视图切换 —— 聊天侧 + 拓扑侧
  - **验收**：顶部切换按钮（聊天 / 拓扑），状态持久化；聊天侧流式 markdown / code block / diff 渲染（react-markdown + remark-gfm + rehype-highlight）；拓扑侧 `@xyflow/react` 渲染节点
  - **来源**：PJ UI-01

- [ ] **UI-02**: 拓扑视图节点状态色 + 信息显示
  - **验收**：状态色 idle 灰 / running 蓝 / waiting 黄 / done 绿 / error 红；节点显示 CLI 类型徽章（claude 蓝、codex 绿）+ 任务摘要 + 累计 token + 累计花费 + budget 进度条；waiting 节点显示在等谁
  - **来源**：PJ UI-02

- [ ] **UI-03**: 点 Worker 节点 → 弹层显示真终端
  - **验收**：点节点弹半屏抽屉或全屏；xterm.js 完整渲染该 Worker 的 PTY 流（彩色 / ASCII logo / tool 卡片 / permission 弹窗都原样）；从 SQLite 历史恢复 + SSE 增量
  - **来源**：PJ UI-03

- [ ] **UI-04**: Worker 终端弹层支持键盘字符注入
  - **验收**：弹层内输入框 + 直接键盘输入，字符通过 WebSocket 注入到 Worker PTY stdin；关闭弹层 Worker 不死
  - **来源**：PJ UI-04

- [ ] **UI-05**: Master Thinking 抽屉
  - **验收**：右上"Master Thinking"抽屉按钮；打开后实时滚动显示 Master 每一步：LLM 输入 / 思考 / 工具调用 + 参数 / 工具返回 / 最终回复；可按事件类型筛选；可导出 JSON
  - **来源**：PJ UI-05

- [ ] **UI-06**: 高风险动作弹确认
  - **验收**：杀 Worker / 删 Skill / 删 workspace / 删 repo 操作弹确认对话框；用户可在设置里关闭"轻级动作"的确认
  - **来源**：PJ UI-06

- [ ] **UI-07**: 全局成本仪表盘
  - **验收**：顶部显示本会话累计 token + 累计花费 + 距离 budget 剩余百分比；点开看明细（按 Worker / 按会话）
  - **来源**：PJ UI-07

- [ ] **UI-08**: 全局搜索 `Cmd+K`
  - **验收**：快捷键唤起命令面板；跨对话 / Skill / 事件 / Worker 日志全文搜索；结果点击跳转
  - **来源**：PJ UI-08

- [ ] **UI-09**: 暗 / 亮主题
  - **验收**：shadcn/ui 主题切换；默认跟随系统；手动切换持久化
  - **来源**：PJ UI-09

- [ ] **UI-10**: 聊天框 `@worker-N` 语法糖
  - **验收**：用户输入 `@worker-3 暂停一下` → 后端识别为对 Worker-3 的 `send_to_worker` 动作；自动补全建议
  - **来源**：PJ UI-10

- [ ] **UI-11**: Workspace 顶部条
  - **验收**：显示当前 workspace 名 + 已加 repo / dir 列表 + service 状态 dots（SVC-04）+ 添加按钮 + 拖拽热区（react-dropzone）
  - **来源**：PJ UI-11

### Templates & Skills（手动资产，v1 不做自动沉淀）

- [ ] **ASSET-01**: 4 个内置 spells 模板
  - **验收**：tree-executor / router-experts / map-reduce / critic-loop 模板各一份 .md 文件预装；Master 系统提示有索引；Master 调 `load_template(name)` 工具能加载全文
  - **来源**：PJ ASSET-01

- [ ] **ASSET-02**: Skill 文件夹自动注入
  - **验收**：用户在 `.agenstrix/skills/` 放 .md 文件（含 frontmatter `name / description / auto-load / trigger`）；`auto-load: true` 时启动 Worker 自动塞进 system prompt（按 trigger 关键词匹配任务描述）；`false` 时 Master 通过 `list_skills` 看到，主动决定要不要 `inject_skill`；文件改动 chokidar 监听 + debounce 自动重载
  - **来源**：PJ ASSET-02

- [ ] **ASSET-03**: 用户自定义 spells 模板
  - **验收**：用户放 .md 到 `.agenstrix/templates/`，Master 启动自动发现；命名冲突时内置模板优先
  - **来源**：PJ ASSET-03

- [ ] **ASSET-04**: `.agenstrix-pack` 包格式
  - **验收**：UI 有"导入包"按钮和"导出 workspace 为包"按钮；包格式 = zip（manifest.json + templates/ + skills/）；导出时跑额外 redactor 扫密钥；命名冲突弹 覆盖 / 重命名 / 跳过
  - **来源**：PJ ASSET-04

### MCP

- [ ] **MCP-01**: Agenstrix 作为 MCP server 向 Master 暴露动作工具集
  - **验收**：包括 spawn_worker / send_to_worker / kill_worker / start_service / stop_service / list_workers / list_services / wait_for_workers / read_worker_log / list_skills / inject_skill / load_template / update_learned_command / add_dep / request_env_var 等；每个工具有 JSON Schema + 错误处理
  - **来源**：PJ MCP-01 / A §7

- [ ] **MCP-02**: 内置 chrome-devtools-mcp
  - **验收**：`chrome-devtools-mcp@^0.26.0` 内置；默认对环境模式 `no-worktree` 的 Worker（测试 Worker）可用；用户不需要任何配置
  - **来源**：PJ MCP-02

- [ ] **MCP-03**: 用户可在设置加自定义 MCP server
  - **验收**：UI 设置里有"MCP server 列表"，可加 stdio / http / sse 三种 transport 的 server；启动时连接，工具自动暴露给 Master（也可指定只给某些 Worker）
  - **来源**：PJ MCP-03

- [ ] **MCP-04**: 测试 Worker 走浏览器端到端
  - **验收**：Master 调 `spawn_worker(cli=codex, mode=no-worktree, with_services=[backend, frontend])` → Agenstrix 启动两个 service 并等 ready → Worker 启动时 system prompt 注入"服务已就绪：backend 在 :8000、frontend 在 :3000，你有 chrome-devtools-mcp 工具"
  - **来源**：PJ MCP-04

### Infrastructure

- [ ] **INFRA-01**: i18n 框架（zh-CN + en）
  - **验收**：react-i18next；所有 UI 字符串走 `t()`；翻译文件 `locales/zh-CN/common.json` + `locales/en/common.json`；默认 zh-CN，可在设置切换
  - **来源**：PJ INFRA-01

- [ ] **INFRA-02**: SQLite 持久化
  - **验收**：`~/.agenstrix/store.db`；Drizzle ORM + bun:sqlite；表至少 11 张：workspaces / conversations / messages / workers / pty_chunks / events / skills / templates / repos / services / learned_commands；启动跑 migrations
  - **来源**：PJ INFRA-02

- [ ] **INFRA-03**: PTY 字节流完整持久化 + 回放
  - **验收**：每 ~100KB 一行存到 `pty_chunks`（带 seq 号）；ANSI 不切断（escape sequence 跨边界时延后写）；重新打开 Worker 弹层时从历史完整回放
  - **来源**：PJ INFRA-03

- [ ] **INFRA-04**: 事件溯源
  - **验收**：所有 Master 决策 / Worker spawn-kill / 用户输入 / service 启停 / Skill inject 都写 `events` 表；event payload 是 JSON；可按 workspace / time / type 查询；将来可重放
  - **来源**：PJ INFRA-04

- [ ] **INFRA-05**: 系统日志 + 内部诊断日志分流
  - **验收**：pino 写 `~/.agenstrix/logs/agenstrix-YYYY-MM-DD.log`（按天滚动）；诊断日志走独立 `diagnostics-*.log`；UI 有"打开日志目录"按钮
  - **来源**：PJ INFRA-05

- [ ] **INFRA-06**: 启动健康检查 self-test
  - **验收**：检查 `which claude` / `which codex` / `which git` / SQLite 读写 / 默认端口可用 / `agenstrix doctor --reap` 扫孤儿进程；失败给具体修复指引（含命令）
  - **来源**：PJ INFRA-06

- [ ] **INFRA-07**: 跨平台兼容（macOS / Linux 主力，Windows 必须能跑）
  - **验收**：macOS / Linux / Windows 10 1809+ 三平台 CI 跑 Phase 2 起的烟雾测试；Windows ConPTY 通路确认；路径短名转换（`GetShortPathNameW`）兼容旧 CMD MAX_PATH 限制
  - **来源**：PJ INFRA-07 / P Pitfall 7 / S §2

- [ ] **DB-DURABILITY-01**: SQLite 不变式 + 迁移备份
  - **验收**：启动设 `PRAGMA journal_size_limit=67108864`（64MB）；每 5 分钟跑 `wal_checkpoint(TRUNCATE)`；每次 Drizzle migration 前自动备份 `store.db` 到 `~/.agenstrix/backups/`（保留 10 份）；migrations 必须人工 review FK cascade-on-DROP；生产**不用** `drizzle-kit push`，只用 generate + migrate
  - **来源**：P Pitfall 6 + 11 / S §3 row 9

- [ ] **MASTER-RESUME-01**: Master 崩溃恢复
  - **验收**：Bun 后台监控 Master `claude` 进程；崩溃后自动重启新 `claude`，注入恢复提示（含活动 Worker 列表 W-1..N、运行中 service 列表、最近 20 轮聊天）；Master 系统提示约定"恢复后先调 `list_workers` / `list_services`"；30 秒内没 send_to_worker 到孤儿 Worker → 弹"是否 kill 孤儿"模态
  - **来源**：F HR-13 / P Pitfall 14 / S §3 row 10

- [ ] **WS-1011-01**: WebSocket PTY 流不掉链
  - **验收**：所有 PTY WebSocket 设 `idleTimeout: 0`；后端每 30 秒推 heartbeat；前端断线后用 `Last-Event-ID` 风格 chunk seq 重放，浏览器看到的字节流不丢
  - **来源**：P Pitfall 13 / S §3 honorable mention

- [ ] **ANSI-SPLITTER-01**: PTY chunk batcher 不切 ANSI
  - **验收**：chunk 批处理边界检测 ESC `[` 等 ANSI 序列起始字符，未结束就推迟切分；跨 chunk 的 tail 缓存到下一 chunk；单元测试覆盖常见序列（颜色 / 光标 / OSC）
  - **来源**：P Pitfall 7 / S §3 honorable mention

- [ ] **WORKTREE-CWD-01**: Worker cwd 与 git env 隔离
  - **验收**：spawn Worker 时 env 显式删 `GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE`；cwd 解析 symlink 后写死；Worker 完成后 commit 前 `git rev-parse --show-toplevel` 必须匹配 worktree 路径，不匹配则报错不 commit（避免误提交到 main）
  - **来源**：P Pitfall 17 / S §3 honorable mention

### Setup & Onboarding

- [ ] **SETUP-01**: CLI 检测向导
  - **验收**：启动时 `which claude` / `which codex` 检测；缺了显示安装指引（含 brew / npm 命令）+ "重新检测"按钮
  - **来源**：PJ SETUP-01

- [ ] **SETUP-02**: Workspace 添加（零配置文件）
  - **验收**：拖拽文件夹或点按钮添加；无需任何 yaml / JSON / 注册步骤；首次启动有引导提示
  - **来源**：PJ SETUP-02

- [ ] **SETUP-03**: 设置面板
  - **验收**：CLI 路径 / 默认模型（sonnet / opus）/ 主题 / 语言 / worktree 根目录 / 自定义 MCP server 列表 / budget 默认值 / env allowlist；所有改动持久化
  - **来源**：PJ SETUP-03

- [ ] **SETUP-04**: 优雅退出（11 步关停协议）
  - **验收**：关闭 / Ctrl+C 时严格按序：①停接新请求 → ②Workers SIGTERM → ③5s 等 → ④强杀 + worktree cleanup 兜底 → ⑤Master SIGTERM → ⑥services SIGTERM → ⑦MCP clients close → ⑧SQLite WAL checkpoint → ⑨pino flush → ⑩sockets close → ⑪exit
  - **来源**：PJ SETUP-04 / A §11-step shutdown / P Pitfall 1

---

## v2 Requirements

下个里程碑做。**目前不在 v1 roadmap**。

### Desktop & Distribution

- **DESKTOP-01**: Tauri 2 桌面打包（macOS / Linux / Windows）
- **DESKTOP-02**: 系统托盘 + 桌面通知 + 深链接
- **DESKTOP-03**: Tauri Updater 自动升级
- **DESKTOP-04**: 代码签名（macOS notarization + Windows EV cert）

### CLI Expansion

- **CLI-V2-01**: Gemini CLI 作为 Worker 支持
- **CLI-V2-02**: OpenCode 作为 Worker 支持

### Workspace Power Features

- **WS-V2-01**: 多 workspace 切换（多项目同时打开）
- **WS-V2-02**: Workspace 模板（一键创建"Next.js + FastAPI"workspace 含预配置 service）

### Worker Reliability

- **REL-V2-01**: Worker hang 自动检测 + 重启（参考 golutra Stability worker）
- **REL-V2-02**: Worker snapshot 周期保存（参考 golutra Snapshot service）
- **REL-V2-03**: Dry-run 模式（Worker 不真改文件，只输出 diff）
- **REL-V2-04**: 时间穿越调试（按历史 event log 重放 Master / Worker 决策）

### Tool & Permission

- **PERM-V2-01**: 工具权限策略（per-tool / per-worker / per-cwd allowlist，参考 Claude Code settings.json）

### Cost Polish

- **COST-V2-01**: Reasoning loop detection（hash workerId / toolName / args，5 次重复警告）

### Workspace UX

- **WS-V2-03**: Skill / Workflow marketplace
- **WS-V2-04**: 多 LLM provider 抽象层（让 Master 也能跑 OpenRouter / GLM / DeepSeek）

---

## v3 Requirements (远景)

实验性、需更多研究、或"自己长出来"那条线的功能。

### Self-Growing（核心远景）

- **GROW-V3-01**: 自动反思圈 —— 任务完成后 Master 自动评估并写 Skill
- **GROW-V3-02**: Workflow 模板自动蒸馏 —— 多次相似任务自动抽出可复用流程
- **GROW-V3-03**: 拓扑自适应 —— Agent 分工根据历史成功率自动重排
- **GROW-V3-04**: 长期运行模式（"AI 公司" / CEO Agent，跑数天到一个月）

### Collaboration

- **COLLAB-V3-01**: 群聊模式（多 Worker + 人在一个群里互发，swarm-ide 风）
- **COLLAB-V3-02**: 移动端 PWA 远程监控 / 介入

### Security & Isolation

- **ISO-V3-01**: 容器化 Worker（Docker / OrbStack 隔离）

### Ecosystem

- **ECO-V3-01**: MCP plugin marketplace（社区分享 server）

---

## Out of Scope

明确不做。包括 anti-features 和已被否决的选项。

| Feature | Reason |
|---|---|
| **用户认证 / 多用户管理** | 用户明确要求永不内置；self-host 假设单人或受信团队；引入 Auth 会让"零配置"承诺破裂 |
| **云托管 SaaS** | 与开源定位冲突；用户希望本地优先 |
| **Telemetry / 数据上报** | 开源 + 隐私优先；不收集任何使用数据 |
| **自有模型训练 / 微调** | 不是 Agenstrix 的赛道 |
| **商业账号绑定 / 计费集成** | 用户自带 Claude / Codex 订阅 |
| **"Friend Invite"（golutra 有）** | 没有 Auth 系统支撑就没意义 |
| **任何 yaml / JSON 用户配置文件** | "零配置文件原则"核心；workspace / service / 启动命令 全存 SQLite |
| **自动 merge Worker 分支到 main** | 风险过高；用户必须自己决定何时 merge |
| **LLM provider 抽象层（v1）** | 会模糊 "用真 `claude` 命令" 这个核心承诺；v2+ 再考虑 |
| **内置代码编辑器** | 这是 IDE 范畴的 scope creep；用户用自己的编辑器 |
| **Agent self-modification / 自我代码改写** | 研究有趣但破坏可解释性；用户拒绝 |
| **node-pty 作为 PTY 库** | research/STACK.md 发现 Bun 下 NAPI 加载崩溃；改用 Bun.Terminal + bun-pty 兜底 |
| **Drizzle 1.0.0-rc** | research/STACK.md 发现 rc 仍每周破坏式更新；钉 0.45.x 稳定线 |
| **unscoped `xterm` 包** | 5.x 死路；只用 `@xterm/xterm@^6` scoped 包 |
| **Composio agent-orchestrator 作为依赖** | 用户明确不希望核心绑定第三方公司 |
| **Claude Agent SDK 作为 Master 引擎** | 需 API key；与"用 Claude 订阅零额外费用"冲突 |

---

## Traceability

阶段映射在 roadmap 创建时填充。这里是空表，等 ROADMAP.md 出来后回填。

| Requirement | Phase | Status |
|---|---|---|
| CORE-01 | TBD | Pending |
| CORE-02 | TBD | Pending |
| CORE-03 | TBD | Pending |
| CORE-04 | TBD | Pending |
| CORE-05 | TBD | Pending |
| CORE-06 | TBD | Pending |
| CORE-07 | TBD | Pending |
| COST-01 | TBD | Pending |
| COST-02 | TBD | Pending |
| KILL-01 | TBD | Pending |
| GIT-01 | TBD | Pending |
| SEC-01 | TBD | Pending |
| MCP-PURITY-01 | TBD | Pending |
| WS-01 | TBD | Pending |
| WS-02 | TBD | Pending |
| WS-03 | TBD | Pending |
| WS-04 | TBD | Pending |
| WS-05 | TBD | Pending |
| WS-06 | TBD | Pending |
| WS-07 | TBD | Pending |
| WS-08 | TBD | Pending |
| WS-09 | TBD | Pending |
| WS-DETECT-01 | TBD | Pending |
| SVC-01 | TBD | Pending |
| SVC-02 | TBD | Pending |
| SVC-03 | TBD | Pending |
| SVC-04 | TBD | Pending |
| SVC-05 | TBD | Pending |
| SVC-READY-01 | TBD | Pending |
| PORT-ALLOC-01 | TBD | Pending |
| UI-01 | TBD | Pending |
| UI-02 | TBD | Pending |
| UI-03 | TBD | Pending |
| UI-04 | TBD | Pending |
| UI-05 | TBD | Pending |
| UI-06 | TBD | Pending |
| UI-07 | TBD | Pending |
| UI-08 | TBD | Pending |
| UI-09 | TBD | Pending |
| UI-10 | TBD | Pending |
| UI-11 | TBD | Pending |
| ASSET-01 | TBD | Pending |
| ASSET-02 | TBD | Pending |
| ASSET-03 | TBD | Pending |
| ASSET-04 | TBD | Pending |
| MCP-01 | TBD | Pending |
| MCP-02 | TBD | Pending |
| MCP-03 | TBD | Pending |
| MCP-04 | TBD | Pending |
| INFRA-01 | TBD | Pending |
| INFRA-02 | TBD | Pending |
| INFRA-03 | TBD | Pending |
| INFRA-04 | TBD | Pending |
| INFRA-05 | TBD | Pending |
| INFRA-06 | TBD | Pending |
| INFRA-07 | TBD | Pending |
| DB-DURABILITY-01 | TBD | Pending |
| MASTER-RESUME-01 | TBD | Pending |
| WS-1011-01 | TBD | Pending |
| ANSI-SPLITTER-01 | TBD | Pending |
| WORKTREE-CWD-01 | TBD | Pending |
| SETUP-01 | TBD | Pending |
| SETUP-02 | TBD | Pending |
| SETUP-03 | TBD | Pending |
| SETUP-04 | TBD | Pending |

**Coverage:**

- v1 requirements: **64 total**
- Mapped to phases: 0 (待 ROADMAP.md 出来后回填)
- Unmapped: 64 ⚠️ (正常 —— ROADMAP 还没生成)

---

*Requirements defined: 2026-05-17*
*Last updated: 2026-05-17 after merging PROJECT.md (34 reqs) + research SUMMARY (10 new reqs) + 6 honorable-mention hidden requirements*
