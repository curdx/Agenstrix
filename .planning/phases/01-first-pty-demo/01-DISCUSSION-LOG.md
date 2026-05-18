# Phase 1: First PTY Demo - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-17
**Phase:** 1-First PTY Demo
**Areas discussed:** Master 启动契约, 主区 UI 形态, 历史回放 UX, Self-test 失败 UX, claude cwd 范围, Tauri 是否提前到 v1

---

## Master 启动契约（含 cwd 范围）

| Option | Description | Selected |
|--------|-------------|----------|
| 启动目录就是 cwd | `bunx agenstrix` 启动时所在目录 = claude cwd；零 UI、零推断 | ✓ |
| Phase 1 加最小 Open Folder | 加一个极简 "Open Folder" 按钮，选了存 SQLite 下次恢复；不识别不试启动 | |
| 其他自定义 | 用户描述自己的方案 | |

**User's choice:** 启动目录就是 cwd（推荐）
**Notes:** 用户最初提到"我记得还要选择文件夹吧？" —— Claude 指出拖拽 UI 是 Phase 2 (WS-01..09) 的 scope，Phase 1 必须给 claude 一个 cwd，最小可行 = `process.cwd()`。用户接受。

---

## Tauri vs Web Phase 1 范围

| Option | Description | Selected |
|--------|-------------|----------|
| 不改，Phase 1 走 Web，Tauri 留 v2 | 原 PROJECT.md 计划。Web 模式 Bun 后端跑完整核心功能（PTY/DB/杀进程），只是前端壳子是 Chrome 不是原生窗口 | ✓ |
| Phase 1 同时出 Web + Tauri | Phase 1 范围扩大至同时打 Tauri 桌面包；Bun --compile + sidecar + capabilities + 三平台 CI；工作量翻倍 | |
| 我误会了，再说一遍 web 怎么测核心功能 | 用户怀疑 web 模式下 PTY/SQLite/杀进程没法验证 | |

**User's choice:** 不改，Phase 1 走 Web，Tauri 留 v2
**Notes:** 用户原话"我想 mvp 就要做 Tauri 和 web，web 主要是测试 UI 行不行，那核心功能怎么测试啊？" —— Claude 澄清核心功能 100% 在 Bun 后端，跟前端壳子是 Chrome 还是 Tauri 无关；Web 模式跑通 = 核心功能 100% 跑通。用户理解后选择保留原计划。

---

## 主区 UI 形态（关键决策，分两轮）

### 第一轮（B 被选但用户随后质疑）

| Option | Description | Selected |
|--------|-------------|----------|
| A 全填 xterm | 主区就是一个 xterm 完整填满；不写 ChatInput；最简最快 | |
| B xterm + ChatInput 上下分 | 上 70% xterm 下 30% ChatInput；类 VS Code 集成终端模式 | ✓（暂选） |
| C 纯聊天气泡 + 点头像看终端 | Phase 1 解析 PTY 切气泡，终端通过点头像看；最复杂 | |

**User's choice:** B（暂选），随后追问"主区不应该类似 golutra 是一个聊天的窗口吗？"

### 第二轮（重新对齐到真正 golutra）

Claude 重读 golutra `ChatInterface.vue`，指出 golutra 主区其实是 `ChatHeader + MessagesList + ChatInput`（消息气泡流），xterm 在**另一个独立 Tauri 子窗口**通过点成员头像打开。方案 B 实际上不像 golutra。

| Option | Description | Selected |
|--------|-------------|----------|
| D 聊天气泡外壳 + xterm 嵌入卡片 | 主区是消息流，Master 是一张大卡片，卡片内嵌 xterm 渲染真 PTY TUI，可一键全屏 ⤢ | ✓ |
| B xterm + ChatInput 上下分（第一轮的）| 保留第一轮选择 | |
| A 全填 xterm | 完全不像聊天软件 | |

**User's choice:** D - 聊天气泡外壳 + xterm 嵌入卡片（仿真正 golutra）
**Notes:** D 方案同时满足两个矛盾约束 ——（1）用户要的"聊天窗口"形态；（2）ROADMAP success criteria #1 要的"真 claude TUI 原样渲染（ASCII logo / permission 弹窗 / tool 卡片）"。在 web 模式下"卡片内嵌 + 一键全屏 ⤢" 是 golutra "点头像开 Tauri 子窗口" 的等价物。后续 Phase 3+ Worker 加入时直接复用同一个 MessageCard 容器组件。

---

## 历史回放 UX

| Option | Description | Selected |
|--------|-------------|----------|
| 字节流原样 dump | 把所有字节一次性塞回 xterm，最忠实但可能瞬间滚 10MB | |
| 加速重播 | 像快进视频一样把过程重新放一遍，能看见 ASCII logo 动起来 | |
| serialize-addon snapshot | 只恢复"最后一帧"，最快但丢中间过程 | |
| 微信式（用户自由表述） | 类似微信/聊天软件：打开就在最新状态，往上翻能看完整历史 | ✓ |

**User's choice:** 类似微信啊，或者聊天工具啥的
**Notes:** Claude 将用户描述映射到技术实现 = 直接把全部历史字节灌进 xterm 自带 scrollback，xterm 默认滚到底（最新一帧在视野），用户用鼠标滚轮往上翻能看到完整历史。不做"重播动画"，不做"截图模式"。

---

## Self-test 失败 UX

| Option | Description | Selected |
|--------|-------------|----------|
| A 严格门禁 | 终端打印修复指令然后退出，浏览器根本不开 | |
| B Degraded boot 到安装向导页 | 后端起来但浏览器进入"安装向导"页（一项项 ✓/✗ + 命令 + 重新检测按钮） | |
| C 警告 banner 但全功能启动 | 浏览器顶部红条提示，其他正常用 | ✓ |

**User's choice:** C
**Notes:** Claude 补充了一个例外（D-12）：SQLite 路径不可写比 missing claude 更致命（连 `pty_chunks` 都写不进去），仍走严格模式退出。其他失败项（claude 缺失 / git 缺失 / 端口被占等）走 C banner。

---

## Claude's Discretion

用户已明确"以上这些默认你有要推翻的吗？"回答"可以，写吧"，将以下细节交由 planner / researcher：

- 历史 chunks 加载用 HTTP REST 一次性拉 vs SSE 流式拉
- xterm scrollback 具体大小、超大历史时是否分页 lazy load
- ChatInput 多行支持（Shift+Enter 换行 vs Enter 直接发） — 建议按 golutra `ChatInput.vue` 照抄
- 卡片"全屏放大 ⤢"用 modal 还是 portal full-bleed
- ANSI redactor 正则的具体放置点（写入 chunk 前 vs 转发 WS 前）
- 进程组 `pgid` 抓取的具体时机
- WebSocket idleTimeout=0 + heartbeat 频率
- Banner 内具体文案 / 配色（红 vs 橙）
- Drizzle schema 是 Phase 1 一次性建 11 张表还是只建 ~4 张
- CLI 入口子命令的详细 flag 设计

---

## Deferred Ideas

讨论中涉及但属于其他 phase 的，全部记入 CONTEXT.md `<deferred>` 段：

- 拖拽文件夹 / Smart 识别 / 试启动 → Phase 2
- 多 Worker / Master Thinking drawer / chat 解析成气泡 → Phase 3
- 拓扑视图 / 双视图切换 → Phase 4
- token 预算 + 全局成本仪表盘 → Phase 5
- i18n / 主题 / Cmd+K / 高风险确认 → Phase 5
- Skill / Template / .agenstrix-pack → Phase 5
- 完整 11 步 shutdown → Phase 5
- Tauri 桌面打包 → v2
- Gemini / OpenCode CLI → v2
- 自动反思 / 进化 → v3

讨论始终保持在 Phase 1 boundary 内，未触发 scope creep redirect。
