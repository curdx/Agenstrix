# Agenstrix

## What This Is

Agenstrix 是一个**多智能体 CLI 编排应用**（Web 端优先，桌面端 v2 通过 Tauri 加）：在你的电脑上启动一个真交互 `claude` 命令作为"大脑"（Master），由它自主决策、动态招募更多 `claude` / `codex` 命令作为"工人"（Workers），各自在合适的工作环境（独立 git worktree / 共享 worktree / 纯调用 MCP 等）里并行干活。你拖几个项目文件夹进 Agenstrix，它自动识别项目类型 / 启动命令 / 端口 / 角色，**全程不要你写任何配置**。面向小团队和独立开发者，开源（MIT），零额外 API key（用现有 Claude Code / Codex 订阅）。

## Core Value

**一个人坐在 Agenstrix 前对话，背后是一个自主调度多个真实 `claude` / `codex` 终端并行干活的 AI 团队 —— 用户的 CLI 订阅天然就能用，配置全部自动推断，零额外计费门槛、零 yaml。** 这一条立不住，其他都没意义。

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- v1 范围：所有 v1 必交付的需求。每条都是假设，shipped 后才进 Validated。 -->

#### 核心引擎（差异化）

- [ ] **CORE-01**: Master 是真交互 `claude` 命令，跑在 Agenstrix 后端控制的 PTY 中（不是 `claude -p` 或 SDK，就是用户平时敲的那个 `claude`）
- [ ] **CORE-02**: Agenstrix 通过 Claude Code 官方插件机制给 Master 注入动作工具集（招人 / 发话 / 看状态 / 杀人 / 启停 service / 等等），实际数量按内部需要扩展
- [ ] **CORE-03**: Worker 启动支持多种环境模式（**全部对用户隐藏，Master 内部决策**）：
  - `isolated`: 在指定 repo 起独立 git worktree（默认 / 并行独立场景）
  - `inherit`: 接前置 Worker 完成的分支继续干（流水线串行场景）
  - `merged`: 在指定 repo 起新 worktree 并 merge 多个上游 Worker 分支进来（并行后集成场景）
  - `no-worktree`: 不建 worktree，在指定目录或纯 MCP 工具调用环境工作（测试 / 调研场景）
- [ ] **CORE-04**: Worker 是真交互 `claude` 或 `codex` 命令，跑在 PTY 中；结束后按环境模式自动处理（worktree 模式自动 `git commit` + `git worktree remove`；no-worktree 模式直接退出）
- [ ] **CORE-05**: 杀 Worker：`SIGTERM` → 等 5s → `SIGKILL` → 清环境
- [ ] **CORE-06**: MVP CLI 支持范围：Claude Code + Codex CLI（Gemini / OpenCode 推到 v2）
- [ ] **CORE-07**: Worker 依赖图 —— Master 内部声明 Worker 之间的依赖（"等 W1、W2 完成后再启动 W3"），Agenstrix 负责等待 + 必要的 merge / service 启停；**依赖关系在拓扑视图可视化展示给用户**

#### 智能 Workspace（用户拖文件夹，其他全自动）

- [ ] **WS-01**: 添加 repo / 目录：用户拖拽一个或多个文件夹到 Agenstrix UI（也支持按钮选择 + 命令行参数），无需写任何配置文件
- [ ] **WS-02**: **智能项目识别** —— 自动读签名文件判断：
  - 语言：`package.json` (JS/TS) / `pyproject.toml` / `requirements.txt` (Python) / `go.mod` / `Cargo.toml` / `Gemfile` / `pom.xml`
  - 框架：deps 关键词识别（next → Next.js、vite → Vite、vue → Vue、fastapi → FastAPI、django → Django、express → Express 等）
  - 包管理器：从 lockfile 推（`pnpm-lock.yaml` → pnpm、`bun.lock` → bun、`yarn.lock` → yarn、`package-lock.json` → npm）
  - 角色（frontend / backend / test / lib）：deps + 目录名 hint（fe/frontend/client → fe；be/backend/server/api → be；e2e/tests → test）+ entry file 暗示
  - 是 / 否 git 仓库
- [ ] **WS-03**: **启动命令自动推断** —— 三层兜底：
  - 1. `package.json` scripts.dev / start / serve（首选）
  - 2. README 里 grep `uvicorn` / `python -m` / `go run` / `cargo run` 等
  - 3. 常见模式默认值（FastAPI → `uvicorn main:app --reload`；Next.js → `<pm> dev`）
- [ ] **WS-04**: **端口自动推断** —— 读 `vite.config.*` / `next.config.*` / `.env` / `.env.local` / script 中的 `--port` 参数；找不到用框架默认值
- [ ] **WS-05**: **试启动 + 自动学习** —— 加 repo 后 Agenstrix 试着启动一次：
  - 成功 → 把"项目 → 启动命令 → 端口"记到 SQLite，下次直接用
  - 失败 → 进入兜底对话（WS-06）
- [ ] **WS-06**: **失败兜底对话** —— 启动失败时 Agenstrix 显示错误信息 + 智能建议（如 "看起来要先装依赖，要我跑 `pnpm install` 吗？"），用户一句话回答后 Agenstrix 重试，成功后把"启动前需要执行的预处理"也记到 SQLite
- [ ] **WS-07**: **Workspace 配置全部存 SQLite**（不是 yaml，不是 JSON 配置文件），下次启动自动恢复
- [ ] **WS-08**: **多 repo + 非 git 目录混合 workspace** —— 同一 workspace 可包含多个 git repo 和不是 git 的目录（如纯测试脚本目录），Agenstrix 区别处理
- [ ] **WS-09**: 用户可在 UI / 聊天里调整任意推断结果（"启动命令改成 X"），调整后自动记到 SQLite 覆盖

#### Service 一等（Master 内部用，用户可见状态）

- [ ] **SVC-01**: Service = 可启动的长期进程（如 dev server），由 WS-02 ~ WS-06 自动识别 + 学习
- [ ] **SVC-02**: Master 可调动作工具启动 / 停止 service（"招人"时可声明"启动前先拉起这些 service"）
- [ ] **SVC-03**: Service 健康检查 —— HTTP 端口 ping / 进程存活检测
- [ ] **SVC-04**: UI 顶部显示当前 workspace 所有 service 状态（绿点跑着 / 灰点未启动 / 红点异常）
- [ ] **SVC-05**: 端口冲突自动处理 —— 启动时端口被占，先试 kill 占用进程（用户许可），否则自动找下一个空闲端口

#### UI（双视图 + 真终端）

- [ ] **UI-01**: 双视图切换 —— 聊天侧（人 ↔ Master，流式 markdown / code / diff）/ 拓扑侧（react-flow 渲染 Master + 所有 Worker 节点 + 消息线 + 依赖等待线）
- [ ] **UI-02**: 拓扑视图节点状态：idle（灰）/ running（蓝）/ waiting（黄）/ done（绿）/ error（红）；节点上显示 CLI 类型徽章 + 当前任务摘要 + 累计 token + 累计花费
- [ ] **UI-03**: 点拓扑视图任意 Worker 节点 → 半屏抽屉或全屏弹层，xterm.js 真实渲染该 Worker 的完整 PTY 字节流（彩色 / ASCII logo / tool 卡片 / permission 弹窗都原样）
- [ ] **UI-04**: Worker 终端弹层支持键盘字符注入到 Worker stdin（学 golutra "直接注入"）；关闭弹层 Worker 不死
- [ ] **UI-05**: Master Thinking 抽屉 —— 实时滚动显示 Master 每一步：LLM 输入 / 思考 / 工具调用参数+返回 / 最终回复（swarm-ide "agent 不再是黑箱"思想）；可筛选事件类型、可导出 JSON
- [ ] **UI-06**: 高风险动作（杀 Worker / 删 Skill / 删 workspace）弹确认
- [ ] **UI-07**: 顶部全局成本仪表盘 —— 本会话累计 token + 累计花费，点开看明细
- [ ] **UI-08**: 全局搜索 `Cmd+K` —— 跨对话 / Skill / 事件 / Worker 日志搜索
- [ ] **UI-09**: 暗 / 亮主题（跟随系统或手动）
- [ ] **UI-10**: 聊天框 `@worker-N` 直接对某个 Worker 喊话（语法糖，底层走"发话"动作）
- [ ] **UI-11**: Workspace 顶部条 —— 显示已加的 repo / 目录 + service 状态 + 添加 repo 按钮 + 拖拽热区

#### 模板与 Skill（手动资产，v1 不做自动沉淀）

- [ ] **ASSET-01**: 4 个内置 spells 模板（抄自 swarm-ide）：tree-executor / router-experts / map-reduce / critic-loop
- [ ] **ASSET-02**: Skill 文件夹自动注入 —— 用户在 `.agenstrix/skills/` 放 .md 文件，含 frontmatter（`name` / `description` / `auto-load` / `trigger`）；`auto-load: true` 时启动 Worker 自动塞进 system prompt；`false` 时 Master 通过 `list_skills` 看到，自己决定要不要塞给某个 Worker
- [ ] **ASSET-03**: 用户可手动加自定义 spells 模板（`.md` 放进 `.agenstrix/templates/`），Master 启动时自动看到列表
- [ ] **ASSET-04**: `.agenstrix-pack` 包格式（zip：`manifest.json` + `templates/` + `skills/`），一键导入 / 导出；命名冲突弹覆盖 / 重命名 / 跳过

#### MCP 工具集成

- [ ] **MCP-01**: Agenstrix 自身作为 MCP server，向 Master 暴露动作工具集（招人 / 发话 / 看状态 / 杀人 / 启停 service / 等等）
- [ ] **MCP-02**: **内置 chrome-devtools-mcp**（浏览器自动化）—— 默认对测试 Worker 可用，无需用户配置
- [ ] **MCP-03**: 用户可在设置里加自定义 MCP server（GitHub / 数据库 / Slack 等），自动暴露给 Master 或指定 Worker
- [ ] **MCP-04**: 测试 / 浏览器场景：Master 可启动一个"测试 Worker"（环境模式 = no-worktree），自动启动相关 service，让该 Worker 用 chrome-devtools-mcp 跑端到端测试

#### 基础设施

- [ ] **INFRA-01**: i18n 框架（react-i18next）+ zh-CN（默认）+ en；所有 UI 字符串走 `t()`
- [ ] **INFRA-02**: SQLite 持久化（`~/.agenstrix/store.db`），Drizzle ORM；表：`workspaces` / `conversations` / `messages` / `workers` / `pty_chunks` / `events` / `skills` / `templates` / `repos` / `services` / `learned_commands`
- [ ] **INFRA-03**: PTY 字节流完整持久化（按 ~100KB 分块存 `pty_chunks`），重新打开 Worker 可从历史回放
- [ ] **INFRA-04**: 事件溯源（`events` 表）—— 所有 Master 决策 / Worker spawn / 用户输入 / service 启停都记 event，可重放调试
- [ ] **INFRA-05**: 系统日志（pino，按天滚动到 `~/.agenstrix/logs/agenstrix-YYYY-MM-DD.log`）+ 独立内部诊断日志流；UI 一键打开日志目录
- [ ] **INFRA-06**: 启动健康检查 self-test —— CLI 可用 / git 可用 / SQLite 读写 / 端口可用；失败给具体修复指引
- [ ] **INFRA-07**: 跨平台 —— macOS / Linux 主力，Windows v1 必须能跑（ConPTY + 路径短名转换，抄 golutra 验证过的方案）

#### 启动与设置

- [ ] **SETUP-01**: CLI 检测向导 —— 启动检测 `which claude` / `which codex`，缺了引导用户安装（含 brew / npm 命令）
- [ ] **SETUP-02**: Workspace 添加 —— 拖拽文件夹或按钮选择，**无需任何 yaml / JSON 配置**（取代旧版"仓库选择器"）
- [ ] **SETUP-03**: 设置面板 —— CLI 路径 / 默认模型（sonnet / opus）/ 主题 / 语言 / worktree 根目录 / 自定义 MCP server 列表
- [ ] **SETUP-04**: 优雅退出 —— 关闭 / Ctrl+C：杀所有 Worker → 停所有 service → 等 git commit → 清 worktree → 保存状态到 SQLite

### Out of Scope

<!-- 明确不做的，含理由防止后期反复 -->

**永不内置**

- 用户认证 / 多用户管理 —— 用户明确要求永不内置；self-host 假设单人或受信团队
- 云托管 SaaS —— 与开源定位冲突
- Telemetry / 数据上报 —— 开源 + 隐私优先
- 自有模型训练 / 微调 —— 不是 Agenstrix 的赛道
- 商业账号绑定 / 计费 —— 用户自带 Claude / Codex 订阅
- "Friend Invite"（golutra 有，邀请第二个人加入 workspace）—— 不内置 Auth → 没意义
- **任何 yaml / JSON 用户配置文件** —— workspace、service、启动命令全部存 SQLite，对用户表现为"拖一下就好"

**v1 范围之外（v2 / v3 再考虑）**

- Tauri 桌面打包 —— v2 加（v1 先 Web 端跑通，Tauri 只是最后一公里加壳）
- Gemini CLI / OpenCode 支持 —— v2 加
- **自动反思圈 / Skill 自动沉淀** —— 推到 v3 远景；参考项目（golutra / swarm-ide / CAO / Composio ao / ruflo）都没做，是研究问题；v1 先做扎实的"swarm-ide 智能 + golutra 真 CLI + 智能 workspace"合体
- 工作流模板自动蒸馏 —— v3 远景
- 拓扑自适应（Agent 分工根据成功率重排）—— v3 远景
- 群聊模式（多 Worker + 人在一个群里）—— v2 / v3；v1 简化为主从对话 + 点 Worker 介入
- 长期运行模式（"AI 公司"，类似 golutra 远景 CEO Agent）—— v3
- 移动端 PWA 远程监控 —— v3
- 容器化 Worker（Docker 隔离）—— v3
- Dry-run 模式（Worker 不真改文件）—— v2
- 时间穿越调试 —— v2
- 任意 LLM Provider 可插拔（OpenRouter / GLM / DeepSeek 等给 Master 用）—— v2 之后再考虑；v1 只走"真 `claude` / `codex`"
- MCP plugin marketplace —— v3
- Worker hang 自动重启 / Stability 监测 —— v2
- 多 workspace 切换（多项目同时打开）—— v2；v1 一次只开一个 workspace

## Context

**业界 2026 年 5 月生态**：

- [AWS Labs CAO](https://github.com/awslabs/cli-agent-orchestrator)（587★，Python，tmux + MCP 三原语）—— CLI 编排范式开拓者，但无 UI、无自主 Master、无反思
- [Composio agent-orchestrator](https://github.com/ComposioHQ/agent-orchestrator)（7.1k★，TS，MIT）—— 多 CLI + worktree + web dashboard，但无自主 Master、无反思
- [ruvnet/ruflo](https://github.com/ruvnet/ruflo)（52k★，TS，alpha，MIT）—— 多 CLI + 自称 "self-learning"，但实际仅 RAG 检索，未做真反思
- [winfunc/opcode](https://github.com/winfunc/opcode)（21.9k★，TS + Rust Tauri，AGPL-3.0）—— Claude Code GUI 头部产品，单会话为主，非编排器
- **参考项目 [golutra/golutra](https://github.com/golutra/golutra)**（3.5k★，Rust + TS + Vue Tauri，BSL 1.1）—— 真 PTY 包多 CLI + @mention 派发 + 工作流模板，但**无自主 Master**（用户即 orchestrator），无反思，**无智能项目识别**
- **参考项目 [chmod777john/swarm-ide](https://github.com/chmod777john/swarm-ide)**（1.5k★，TS Next.js，未指定 license）—— 自主 Master + `create/send/wakeup` 三原语 + IM 风 UI + Agent-Graph，但**不包真 CLI**（直调 GLM/OpenRouter LLM API），无反思

**Agenstrix 的市场缺口**：

> **"自主 Master + 真 PTY 多 CLI Worker + 智能 workspace 识别"** 这个组合 = swarm-ide 的智能 + golutra 的真 CLI 体验 + Agenstrix 独有的零配置 onboarding。**没有现有产品做这件事**。

**核心 demo 场景**（v1 必须能演示，多 repo 场景）：

> 用户的项目结构：
> - `~/projects/myapp-frontend/` （Next.js）
> - `~/projects/myapp-backend/` （FastAPI）
>
> 用户拖两个文件夹进 Agenstrix → Agenstrix 自动识别 + 试启动 + 记住启动命令 → 用户跟 Master 说："加用户注册功能 —— 前端表单 + 后端 API + 端到端测试"
>
> → Master 拆 3 个任务，**内部用 Worker 依赖图自己决定怎么干**：
>
> - Worker-1（后端，claude）：在 backend repo 起独立 worktree（isolated 模式），写注册 API
> - Worker-2（前端，claude）：等 Worker-1 完成 → Agenstrix 自动启动 backend dev server（用 Worker-1 完成代码）→ Worker-2 在 frontend repo 起独立 worktree，写注册表单
> - Worker-3（端到端测试，codex）：等 Worker-1 + Worker-2 完成 → Agenstrix 自动启动 frontend + backend dev server → Worker-3 启动（no-worktree 模式，内置 chrome-devtools-mcp），开浏览器跑测试
>
> → 用户在拓扑视图实时看到 3 个 Worker 并行+依赖关系；点 Worker-2 弹层看到前端 claude 实时干活；点 Worker-3 看到 codex 用 chrome-devtools-mcp 开浏览器
> → 全部完成后，用户在主仓库 review 各 worker 分支并自行 merge

**用户群画像**：

- 独立开发者 / 2-5 人小团队
- 已有 Claude Code 订阅（Pro / Max）和 / 或 Codex CLI 订阅
- 项目可能是 monorepo，也可能是多 repo（前后端分开）
- 习惯 CLI 工具，但希望并行加速
- 喜欢可观测、可介入、不黑箱
- **零容忍 yaml / 配置文件 / "请告诉我你的启动命令"**
- 开源认同 / 不想被 SaaS 绑架

**两个参考项目的具体抄 / 学清单**（已纳入 v1 设计）：

| 来源 | 抄的东西 | 对应 v1 需求 |
|---|---|---|
| golutra | 真 PTY 包 CLI | CORE-01, CORE-04 |
| golutra | 直接注入（在终端流中注入文字不打断 Worker）| UI-04 |
| golutra | Agent 头像 + 颜色 + 角色徽章 | UI-02 |
| golutra | Workflow 模板导入 / 导出 | ASSET-04 |
| golutra | 跨平台兼容（ConPTY + 路径短名）| INFRA-07 |
| swarm-ide | 自主 Master + 动态 spawn sub-agent | CORE-01, CORE-02 |
| swarm-ide | 4 个 spells 模板（tree-exec / router / map-reduce / critic-loop）| ASSET-01 |
| swarm-ide | Skill loader（手动放 .md，自动注入 system prompt）| ASSET-02 |
| swarm-ide | 拓扑可视化（Agent-Graph）| UI-01 拓扑侧 |
| swarm-ide | Agent 详情看 LLM 历史（"不再是黑箱"）| UI-05 |
| **Agenstrix 独创** | 智能 workspace 识别 + 试启动 + 失败兜底 + SQLite 学习 | WS-01 ~ WS-09 |
| **Agenstrix 独创** | 多 repo workspace + Worker 依赖图 + service 一等 | CORE-03, CORE-07, SVC-01 ~ SVC-05 |
| **Agenstrix 独创** | 内置 chrome-devtools-mcp + no-worktree 测试 Worker | MCP-02, MCP-04 |

## Constraints

- **License**: MIT —— 最大化生态接纳；不需要 BSL 1.1 那种保护（不打算商业 SaaS 化抗克隆）
- **Tech stack — Backend**: TypeScript on **Bun 1.x** + Hono（HTTP）+ Drizzle ORM + `bun:sqlite` + `node-pty` —— Bun `--compile` 出单 binary 适配 Tauri sidecar；内置 SQLite/HTTP/WebSocket；AI 生态 TS-first
- **Tech stack — Frontend**: **React 19** + Vite + Tailwind v4 + shadcn/ui + **react-flow**（拓扑）+ **xterm.js**（真终端）+ assistant-ui（聊天）+ react-i18next + react-dropzone（拖拽热区）
- **Tech stack — Desktop (v2)**: **Tauri 2** —— Rust 壳子 < 1000 行只做系统集成（托盘 / 通知 / 深链接），Bun 进程作为 sidecar binary
- **Tech stack — MCP**: `@modelcontextprotocol/sdk` 官方包 —— Agenstrix 自身既作为 MCP Server（给 Master 注入动作）也作为 MCP Client（连第三方 server 如 chrome-devtools-mcp）
- **Tech stack — Lint/Test**: **Biome**（替代 ESLint + Prettier） + `bun:test` —— 速度与简洁
- **包管理**: **Bun**（不用 pnpm / npm / yarn）—— 与 Runtime 统一
- **跨平台**: macOS / Linux 主力，Windows v1 必须能跑（ConPTY + 路径短名兼容，抄 golutra 验证过的方案）
- **依赖原则**: 不依赖任何"如果上游公司挂了我就死"的第三方框架 —— 比如 Composio ao 虽好，不内嵌；只用 Anthropic 官方 `@modelcontextprotocol/sdk` 和 VS Code 同款 `node-pty` 这种基础设施级依赖
- **零额外 API key**: Master 用用户现有 Claude 订阅（通过启动真 `claude` 命令实现），Worker 同理；无任何额外 API 注册门槛
- **零配置文件原则**: workspace / service / 启动命令 / 端口 / 学到的知识 —— 全部存 SQLite，用户从不打开 yaml / JSON 编辑配置
- **优先级**: Web 端优先；Tauri 桌面 v2 加
- **MVP CLI 范围**: Claude Code + Codex（Gemini / OpenCode v2 加）
- **不做自主反思圈 v1**: 推到 v3 远景；v1 只做手动 Skill / 模板，不强行做研究级问题
- **智能优先**: 任何能自动推断的事情都不应该问用户；只有自动失败才一次性求救（WS-06）

## Key Decisions

<!-- 关键决策日志。每项都标记 outcome：✓ Good / ⚠️ Revisit / — Pending -->

| Decision | Rationale | Outcome |
|---|---|---|
| Master 用真交互 `claude` 跑在 PTY 中，**不用** `claude -p` 也不用 SDK | 用户偏好简单直白；继承 Claude Code 完整 UX；用户现有订阅天然能用；与 Worker 形态完全统一（都是真 CLI 在 PTY） | — Pending |
| Master 通过 Claude Code 官方插件机制（MCP）接 Agenstrix 动作工具集 | 唯一干净的方式让真 `claude` 主动调用 Agenstrix 提供的动作；不用魔改 Claude Code | — Pending |
| **零 yaml / 零 JSON 配置文件** —— 所有 workspace / service / 启动命令 / 学到的知识全存 SQLite | 用户明确零容忍配置文件；现代 AI 产品的标杆 UX；调整命令通过聊天或 UI 编辑，背后落 SQLite | — Pending |
| **智能项目识别 + 试启动 + 学习** —— 用户拖文件夹，其他全自动 | 用户明确要"要智能"；让用户告诉每个项目类型 / 命令是 hostile UX；现代 IDE / 工具的标杆是自动推断 | — Pending |
| **失败才一次性兜底对话** —— 自动猜失败时显示错误 + 智能建议 + 一句话学到 | 不能因为追求"零交互"而把崩溃藏起来；用户介入要有明确边界，学到后不再问 | — Pending |
| **Worker 4 种环境模式**（isolated / inherit / merged / no-worktree） + **依赖图** | 覆盖单 repo 并行、跨 repo 协作、流水线串行、纯测试 4 大场景；对用户隐藏复杂度，全在 Master 思考链路里 | — Pending |
| **Service 一等抽象** | 多 repo 协作的依赖是"服务"不是"代码"；让 Master 自动启停 dev server 是核心能力；用户只通过 UI 顶部条看 service 状态 | — Pending |
| **内置 chrome-devtools-mcp 作为测试 Worker 默认工具** | 端到端测试是 demo 场景的核心一步；预装让用户开箱即用；用户也可加自己的 MCP server | — Pending |
| 不做自主反思圈 / 自动 Skill 沉淀（推到 v3 远景） | 参考项目都没做，这是研究级问题；v1 先做扎实的"swarm-ide 智能 + golutra 真 CLI + 智能 workspace"合体；用户明确同意此决策 | — Pending |
| Skill 和模板均为**手动资产**（用户放 .md 文件） | v1 先验证产品形态；可手动累积、可导入导出包；v3 再做自动沉淀 | — Pending |
| 后端用 **Bun** 而非 Node | 单 binary `--compile` 适配 Tauri sidecar；内置 SQLite / HTTP / WebSocket；启动 4x 快；2026 主流 | — Pending |
| 前端 **React + Vite**（不用 Vue / Svelte） | react-flow 拓扑图事实标准无对等替代；assistant-ui 等聊天组件 React 生态强；开源贡献者池大 3-5 倍 | — Pending |
| **暂不依赖** [Composio agent-orchestrator](https://github.com/ComposioHQ/agent-orchestrator) | 用户明确不希望核心依赖第三方公司；要完全可控的开源项目；可借鉴设计但不绑死 | — Pending |
| **Web 优先，Tauri 桌面 v2 加** | Web 迭代快、调试容易；Tauri 加壳是最后一公里 | — Pending |
| **永不内置 Auth** | 用户明确要求；self-host 假设单人或受信团队；保持简单 | — Pending |
| **License MIT** | 最大化生态接纳；不打算商业 SaaS 对抗克隆，无需 BSL 1.1 的限制条款 | — Pending |
| **4 个内置 spells 模板直接抄 swarm-ide**（tree-executor / router-experts / map-reduce / critic-loop）| 已验证可行；省自己设计的成本；用户在使用中可加自定义模板 | — Pending |
| Master 一次只支持一个 workspace（v1）；多 workspace 切换推到 v2 | YAGNI；先把单 workspace 做扎实 | — Pending |
| Worker 完成后自动 commit 到 worker 分支并 `git worktree remove`（不自动 merge）| 安全：用户自行决定何时 merge；避免误操作 | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):

1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):

1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-17 after smart-workspace pivot*
