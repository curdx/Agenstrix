# Agenstrix

## What This Is

Agenstrix 是一个**多智能体 CLI 编排应用**（Web 端优先，桌面端 v2 通过 Tauri 加）：在你的电脑上启动一个真交互 `claude` 命令作为"大脑"（Master），由它自主决策、动态招募更多 `claude` / `codex` 命令作为"工人"（Workers），每个 Worker 跑在独立的 git worktree 里并行干活。你能在网页 UI 上点任意 Worker 看它的真实终端、随时插话介入。面向小团队和独立开发者，开源（MIT），用户用现有 Claude Code / Codex 订阅即可，零额外 API key 门槛。

## Core Value

**一个人坐在 Agenstrix 前对话，背后是一个自主调度多个真实 `claude` / `codex` 终端并行干活的 AI 团队 —— 用户的 CLI 订阅天然就能用，零额外计费门槛。** 这一条立不住，其他都没意义。

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- v1 范围：所有 v1 必交付的需求。每条都是假设，shipped 后才进 Validated。 -->

**核心引擎（差异化）**

- [ ] **CORE-01**: Master 是真交互 `claude` 命令，跑在 Agenstrix 后端控制的 PTY 中（不是 `claude -p` 或 SDK，就是用户平时敲的那个 `claude`）
- [ ] **CORE-02**: Agenstrix 通过 Claude Code 官方插件机制给 Master 注入 4 个动作工具：**招人 / 发话 / 看状态 / 杀人**
- [ ] **CORE-03**: Worker 是真交互 `claude` 或 `codex` 命令，跑在独立 git worktree 中（`.agenstrix/worktrees/<worker-id>/`）
- [ ] **CORE-04**: Worker 结束自动 `git commit -am ...` 到 worker 分支并 `git worktree remove`，用户在主仓库可看分支自行决定合并
- [ ] **CORE-05**: 杀 Worker：`SIGTERM` → 等 5s → `SIGKILL` → 清 worktree
- [ ] **CORE-06**: MVP CLI 支持范围：Claude Code + Codex CLI（Gemini / OpenCode 推到 v2）

**UI（双视图 + 真终端）**

- [ ] **UI-01**: 双视图切换 —— 聊天侧（人 ↔ Master，流式 markdown / code / diff）/ 拓扑侧（react-flow 渲染 Master + 所有 Worker 节点 + 消息线）
- [ ] **UI-02**: 点拓扑视图任意 Worker 节点 → 半屏抽屉或全屏弹层，xterm.js 真实渲染该 Worker 的完整 PTY 字节流（彩色、ASCII logo、tool 卡片、permission 弹窗都原样）
- [ ] **UI-03**: Worker 终端弹层支持键盘字符注入到 Worker stdin（学 golutra "直接注入"）；关闭弹层 Worker 不死
- [ ] **UI-04**: Worker 节点显示：CLI 类型徽章（claude 蓝、codex 绿）+ 状态色（idle/running/blocked/done/error）+ 当前任务摘要 + 累计 token + 累计花费
- [ ] **UI-05**: Master Thinking 抽屉 —— 实时滚动显示 Master 每一步：LLM 输入 / 思考 / 工具调用参数+返回 / 最终回复（swarm-ide "agent 不再是黑箱"思想）；可筛选事件类型、可导出 JSON
- [ ] **UI-06**: 高风险动作（杀 Worker / 删 Skill / 删 workspace）弹确认
- [ ] **UI-07**: 顶部全局成本仪表盘 —— 本会话累计 token + 累计花费，点开看明细
- [ ] **UI-08**: 全局搜索 `Cmd+K` —— 跨对话 / Skill / 事件 / Worker 日志搜索
- [ ] **UI-09**: 暗 / 亮主题（跟随系统或手动）
- [ ] **UI-10**: 聊天框 `@worker-N` 直接对某个 Worker 喊话（语法糖，底层走"发话"动作）

**模板与 Skill（手动资产，v1 不做自动沉淀）**

- [ ] **ASSET-01**: 4 个内置 spells 模板（抄自 swarm-ide）：tree-executor / router-experts / map-reduce / critic-loop
- [ ] **ASSET-02**: Skill 文件夹自动注入 —— 用户在 `.agenstrix/skills/` 放 .md 文件，含 frontmatter（`name` / `description` / `auto-load` / `trigger`）；`auto-load: true` 时启动 Worker 自动塞进 system prompt；`false` 时 Master 通过 `list_skills` 看到，自己决定要不要塞给某个 Worker
- [ ] **ASSET-03**: 用户可手动加自定义 spells 模板（`.md` 放进 `.agenstrix/templates/`），Master 启动时自动看到列表
- [ ] **ASSET-04**: `.agenstrix-pack` 包格式（zip：`manifest.json` + `templates/` + `skills/`），一键导入/导出；命名冲突弹覆盖/重命名/跳过

**基础设施**

- [ ] **INFRA-01**: i18n 框架（react-i18next）+ zh-CN（默认）+ en；所有 UI 字符串走 `t()`
- [ ] **INFRA-02**: SQLite 持久化（`~/.agenstrix/store.db`），Drizzle ORM；表：`workspaces` / `conversations` / `messages` / `workers` / `pty_chunks` / `events` / `skills` / `templates`
- [ ] **INFRA-03**: PTY 字节流完整持久化（按 ~100KB 分块存 `pty_chunks`），重新打开 Worker 可从历史回放
- [ ] **INFRA-04**: 事件溯源（`events` 表）—— 所有 Master 决策 / Worker spawn / 用户输入都记 event，可重放调试
- [ ] **INFRA-05**: 系统日志（pino，按天滚动到 `~/.agenstrix/logs/agenstrix-YYYY-MM-DD.log`）+ 独立内部诊断日志流；UI 一键打开日志目录
- [ ] **INFRA-06**: 启动健康检查 self-test —— CLI 可用 / git 可用 / SQLite 读写 / 端口可用；失败给具体修复指引
- [ ] **INFRA-07**: 跨平台 —— macOS / Linux 主力，Windows v1 必须能跑（ConPTY + 路径短名转换，抄 golutra 验证过的方案）

**启动与设置**

- [ ] **SETUP-01**: CLI 检测向导 —— 启动检测 `which claude` / `which codex`，缺了引导用户安装（含 brew/npm 命令）
- [ ] **SETUP-02**: 仓库选择器 —— 第一次进入指定 workspace 根目录（必须是 git 仓库）
- [ ] **SETUP-03**: 设置面板 —— CLI 路径 / 默认模型（sonnet / opus）/ 主题 / 语言 / worktree 根目录
- [ ] **SETUP-04**: 优雅退出 —— 关闭/Ctrl+C：杀所有 Worker → 等 git commit → 清 worktree → 保存状态到 SQLite

### Out of Scope

<!-- 明确不做的，含理由防止后期反复 -->

**永不内置**

- 用户认证 / 多用户管理 —— 用户明确要求永不内置；self-host 假设单人或受信团队
- 云托管 SaaS —— 与开源定位冲突
- Telemetry / 数据上报 —— 开源 + 隐私优先
- 自有模型训练 / 微调 —— 不是 Agenstrix 的赛道
- 商业账号绑定 / 计费 —— 用户自带 Claude / Codex 订阅
- "Friend Invite"（golutra 有，邀请第二个人加入 workspace）—— 不内置 Auth → 没意义

**v1 范围之外（v2 / v3 再考虑）**

- Tauri 桌面打包 —— v2 加（v1 先 Web 端跑通，Tauri 只是最后一公里加壳）
- Gemini CLI / OpenCode 支持 —— v2 加
- **自动反思圈 / Skill 自动沉淀** —— 推到 v3 远景；参考项目（golutra / swarm-ide / CAO / Composio ao / ruflo）都没做，是研究问题；v1 先做扎实的"swarm-ide 智能 + golutra 真 CLI"合体
- 工作流模板自动蒸馏 —— v3 远景
- 拓扑自适应（Agent 分工根据成功率重排）—— v3 远景
- 群聊模式（多 Worker + 人在一个群里）—— v2 / v3；v1 简化为主从对话 + 点 Worker 介入
- 长期运行模式（"AI 公司"，类似 golutra 远景 CEO Agent）—— v3
- 移动端 PWA 远程监控 —— v3
- 容器化 Worker（Docker 隔离）—— v3
- Dry-run 模式（Worker 不真改文件）—— v2
- 时间穿越调试 —— v2
- 任意 LLM Provider 可插拔（OpenRouter / GLM / DeepSeek …）—— v2 之后再考虑；v1 只走"真 `claude` / `codex`"
- MCP plugin marketplace —— v3
- Worker hang 自动重启 / Stability 监测 —— v2

## Context

**业界 2026 年 5 月生态**：

- [AWS Labs CAO](https://github.com/awslabs/cli-agent-orchestrator)（587★，Python，tmux + MCP 三原语）—— CLI 编排范式开拓者，但无 UI、无自主 Master、无反思
- [Composio agent-orchestrator](https://github.com/ComposioHQ/agent-orchestrator)（7.1k★，TS，MIT）—— 多 CLI + worktree + web dashboard，但无自主 Master、无反思
- [ruvnet/ruflo](https://github.com/ruvnet/ruflo)（52k★，TS，alpha，MIT）—— 多 CLI + 自称 "self-learning"，但实际仅 RAG 检索，未做真反思
- [winfunc/opcode](https://github.com/winfunc/opcode)（21.9k★，TS + Rust Tauri，AGPL-3.0）—— Claude Code GUI 头部产品，单会话为主，非编排器
- **参考项目 [golutra/golutra](https://github.com/golutra/golutra)**（3.5k★，Rust + TS + Vue Tauri，BSL 1.1）—— 真 PTY 包多 CLI + @mention 派发 + 工作流模板，但**无自主 Master**（用户即 orchestrator），无反思
- **参考项目 [chmod777john/swarm-ide](https://github.com/chmod777john/swarm-ide)**（1.5k★，TS Next.js，未指定 license）—— 自主 Master + `create/send/wakeup` 三原语 + IM 风 UI + Agent-Graph，但**不包真 CLI**（直调 GLM/OpenRouter LLM API），无反思

**Agenstrix 的市场缺口**：

> **"自主 Master + 真 PTY 多 CLI Worker"** 这个组合 = swarm-ide 的智能 + golutra 的真 CLI 体验。**没有现有产品做这件事**。开源、面向独立开发者、零额外 API key（用现有 Claude / Codex 订阅）。

**核心 demo 场景**（v1 必须能演示）：

> 用户在 Agenstrix 网页 UI 跟 Master 说："给我加一个用户注册功能 —— 前端表单 + 后端 API + 数据库 schema + 测试"
>
> → Master 拆 3 个任务
> → 调"招人"工具，Agenstrix 在 3 个 worktree 起 3 个 Worker（2 个 claude，1 个 codex）
> → 拓扑视图实时显示 3 个并行 Worker
> → 用户点 Worker-2 弹层看 codex 实时跑测试
> → Worker 全部完成，Master 整合并 commit
> → 用户在主仓库切到 3 个 worker 分支 review 后 merge

**用户群画像**：

- 独立开发者 / 2-5 人小团队
- 已有 Claude Code 订阅（Pro / Max）和/或 Codex CLI 订阅
- 习惯 CLI 工具，但希望并行加速
- 喜欢可观测、可介入、不黑箱
- 开源认同 / 不想被 SaaS 绑架

**两个参考项目的具体抄/学清单**（已纳入 v1 设计）：

| 来源 | 抄的东西 | 对应 v1 需求 |
|---|---|---|
| golutra | 真 PTY 包 CLI | CORE-01, CORE-03 |
| golutra | 直接注入（在终端流中注入文字不打断 Worker）| UI-03 |
| golutra | Agent 头像 + 颜色 + 角色徽章 | UI-04 |
| golutra | Workflow 模板导入导出 | ASSET-04 |
| golutra | 跨平台兼容（ConPTY + 路径短名）| INFRA-07 |
| swarm-ide | 自主 Master + 动态 spawn sub-agent | CORE-01, CORE-02 |
| swarm-ide | 4 个 spells 模板（tree-exec / router / map-reduce / critic-loop）| ASSET-01 |
| swarm-ide | Skill loader（手动放 .md，自动注入 system prompt）| ASSET-02 |
| swarm-ide | 拓扑可视化（Agent-Graph）| UI-01 拓扑侧 |
| swarm-ide | Agent 详情看 LLM 历史（"不再是黑箱"）| UI-05 |

## Constraints

- **License**: MIT —— 最大化生态接纳；不需要 BSL 1.1 那种保护（不打算商业 SaaS 化抗克隆）
- **Tech stack — Backend**: TypeScript on **Bun 1.x** + Hono（HTTP）+ Drizzle ORM + `bun:sqlite` + `node-pty` —— Bun `--compile` 出单 binary 适配 Tauri sidecar；内置 SQLite/HTTP/WebSocket；AI 生态 TS-first
- **Tech stack — Frontend**: **React 19** + Vite + Tailwind v4 + shadcn/ui + **react-flow**（拓扑）+ **xterm.js**（真终端）+ assistant-ui（聊天）+ react-i18next —— react-flow 是拓扑图事实标准且无对等替代；shadcn/ui 提供完整暗/亮主题
- **Tech stack — Desktop (v2)**: **Tauri 2** —— Rust 壳子 < 1000 行只做系统集成（托盘/通知/深链接），Bun 进程作为 sidecar binary
- **Tech stack — MCP**: `@modelcontextprotocol/sdk` 官方包 —— 用作 Server 端，给 Master `claude` 注入 4 个动作工具
- **Tech stack — Lint/Test**: **Biome**（替代 ESLint + Prettier） + `bun:test` —— 速度与简洁
- **包管理**: **Bun**（不用 pnpm/npm/yarn）—— 与 Runtime 统一
- **跨平台**: macOS / Linux 主力，Windows v1 必须能跑（ConPTY + 路径短名兼容，抄 golutra 验证过的方案）
- **依赖原则**: 不依赖任何"如果上游公司挂了我就死"的第三方框架 —— 比如 [Composio ao](https://github.com/ComposioHQ/agent-orchestrator) 虽好，不内嵌；只用 Anthropic 官方 `@modelcontextprotocol/sdk` 和 VS Code 同款 `node-pty` 这种基础设施级依赖
- **零额外 API key**: Master 用用户现有 Claude 订阅（通过启动真 `claude` 命令实现），Worker 同理；无任何额外 API 注册门槛
- **优先级**: Web 端优先；Tauri 桌面 v2 加
- **MVP CLI 范围**: Claude Code + Codex（Gemini / OpenCode v2 加）
- **不做自主反思圈 v1**: 推到 v3 远景；v1 只做手动 Skill / 模板，不强行做研究级问题

## Key Decisions

<!-- 关键决策日志。每项都标记 outcome：✓ Good / ⚠️ Revisit / — Pending -->

| Decision | Rationale | Outcome |
|---|---|---|
| Master 用真交互 `claude` 跑在 PTY 中，**不用** `claude -p` 也不用 SDK | 用户偏好简单直白；继承 Claude Code 完整 UX；用户现有订阅天然能用；与 Worker 形态完全统一（都是真 CLI 在 PTY） | — Pending |
| Master 通过 Claude Code 官方插件机制（MCP）接 4 个 Agenstrix 动作（招人/发话/看状态/记笔记） | 唯一干净的方式让真 `claude` 主动调用 Agenstrix 提供的动作；不用魔改 Claude Code | — Pending |
| **不做自主反思圈 / 自动 Skill 沉淀（推到 v3 远景）** | 参考项目 golutra 和 swarm-ide 都没做，这是研究级问题；v1 先做扎实的"swarm-ide 智能 + golutra 真 CLI"合体；用户明确同意此决策 | — Pending |
| Skill 和模板均为**手动资产**（用户放 .md 文件） | v1 先验证产品形态；可手动累积、可导入导出包；v3 再做自动沉淀 | — Pending |
| 后端用 **Bun** 而非 Node | 单 binary `--compile` 适配 Tauri sidecar；内置 SQLite / HTTP / WebSocket；启动 4x 快；2026 主流 | — Pending |
| 前端 **React + Vite**（不用 Vue / Svelte） | react-flow 拓扑图事实标准无对等替代；assistant-ui 等聊天组件 React 生态强；开源贡献者池大 3-5 倍 | — Pending |
| **暂不依赖** [Composio agent-orchestrator](https://github.com/ComposioHQ/agent-orchestrator) | 用户明确不希望核心依赖第三方公司；要完全可控的开源项目；可借鉴设计但不绑死 | — Pending |
| **Web 优先，Tauri 桌面 v2 加** | Web 迭代快、调试容易；Tauri 加壳是最后一公里 | — Pending |
| **永不内置 Auth** | 用户明确要求；self-host 假设单人或受信团队；保持简单 | — Pending |
| **License MIT** | 最大化生态接纳；不打算商业 SaaS 对抗克隆，无需 BSL 1.1 的限制条款 | — Pending |
| **4 个内置 spells 模板直接抄 swarm-ide**（tree-executor / router-experts / map-reduce / critic-loop）| 已验证可行；省自己设计的成本；用户在使用中可加自定义模板 | — Pending |
| Master 一次只支持一个（v1）；多 workspace 切换推到 v2 | YAGNI；先把单 workspace 做扎实 | — Pending |
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
*Last updated: 2026-05-17 after initialization*
