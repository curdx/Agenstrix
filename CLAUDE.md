<!-- GSD:project-start source:PROJECT.md -->
## Project

**Agenstrix**

Agenstrix 是一个**多智能体 CLI 编排应用**（Web 端优先，桌面端 v2 通过 Tauri 加）：在你的电脑上启动一个真交互 `claude` 命令作为"大脑"（Master），由它自主决策、动态招募更多 `claude` / `codex` 命令作为"工人"（Workers），各自在合适的工作环境（独立 git worktree / 共享 worktree / 纯调用 MCP 等）里并行干活。你拖几个项目文件夹进 Agenstrix，它自动识别项目类型 / 启动命令 / 端口 / 角色，**全程不要你写任何配置**。面向小团队和独立开发者，开源（MIT），零额外 API key（用现有 Claude Code / Codex 订阅）。

**Core Value:** **一个人坐在 Agenstrix 前对话，背后是一个自主调度多个真实 `claude` / `codex` 终端并行干活的 AI 团队 —— 用户的 CLI 订阅天然就能用，配置全部自动推断，零额外计费门槛、零 yaml。** 这一条立不住，其他都没意义。

### Constraints

- **License**: MIT —— 最大化生态接纳；不需要 BSL 1.1 那种保护（不打算商业 SaaS 化抗克隆）
- **Tech stack — Backend**: TypeScript on **Bun 1.3.14+** + Hono（HTTP）+ Drizzle ORM `^0.45.2`（不要 1.0.0-rc）+ `drizzle-kit@^0.31.10` + `bun:sqlite` + **`Bun.Terminal`**（PTY，Bun 1.3.5 起 POSIX、1.3.14 起 Windows ConPTY）+ **`bun-pty`** 作为 FFI 兜底 + Biome 2.x（`@biomejs/biome@^2.4.15`）—— **不用** `node-pty`（在 Bun 下 NAPI 加载崩溃，维护者明确说不支持 Bun）；Bun `--compile` 出单 binary 适配 Tauri sidecar；内置 SQLite/HTTP/WebSocket；AI 生态 TS-first
- **Tech stack — Frontend**: **React 19** + Vite + **Tailwind v4**（CSS-first，`@theme` 块 + `@tailwindcss/vite`，不用 `tailwind.config.js`）+ shadcn/ui（v4 模板需 `tw-animate-css`，不是 `tailwindcss-animate`）+ **`@xyflow/react`**（拓扑，react-flow 新包名）+ **`@xterm/xterm@^6`**（真终端，**不用**旧的 unscoped `xterm` 包）+ 9 个 @xterm 插件（fit / web-links / search / webgl / canvas / serialize / unicode11 / clipboard / attach）+ assistant-ui（聊天）+ react-i18next + react-dropzone（拖拽热区）
- **Tech stack — Desktop (v2)**: **Tauri 2** —— Rust 壳子 < 1000 行只做系统集成（托盘 / 通知 / 深链接），Bun 进程作为 sidecar binary。打包配方：每平台跑 `bun build --compile --target=bun-<os>-<arch>`，产物按 `agenstrix-server-<rust-target-triple>(.exe)` 命名放到 `src-tauri/binaries/`，`tauri.conf.json` 声明 `externalBin`，调用用 `Command.sidecar(...).spawn()`（**不是** `.execute()`），capabilities JSON 显式允许 `shell:allow-spawn` + `sidecar: true`
- **Tech stack — MCP**: `@modelcontextprotocol/sdk` 官方包 —— Agenstrix 自身既作为 MCP Server（给 Master 注入动作）也作为 MCP Client（连第三方 server 如 chrome-devtools-mcp）
- **Tech stack — Lint/Test**: **Biome**（替代 ESLint + Prettier） + `bun:test` —— 速度与简洁
- **包管理**: **Bun**（不用 pnpm / npm / yarn）—— 与 Runtime 统一
- **跨平台**: macOS / Linux 主力，Windows v1 必须能跑（**最低 Windows 10 1809+**，ConPTY 必要；路径短名兼容抄 golutra 验证过的方案）。Phase 2 起 CI matrix 跑 Windows，因为 Bun.Terminal 的 Windows 通路 2026-05-13 才发布
- **依赖原则**: 不依赖任何"如果上游公司挂了我就死"的第三方框架 —— 比如 Composio ao 虽好，不内嵌；只用 Anthropic 官方 `@modelcontextprotocol/sdk` 和 VS Code 同款 `node-pty` 这种基础设施级依赖
- **零额外 API key**: Master 用用户现有 Claude 订阅（通过启动真 `claude` 命令实现），Worker 同理；无任何额外 API 注册门槛
- **零配置文件原则**: workspace / service / 启动命令 / 端口 / 学到的知识 —— 全部存 SQLite，用户从不打开 yaml / JSON 编辑配置
- **优先级**: Web 端优先；Tauri 桌面 v2 加
- **MVP CLI 范围**: Claude Code + Codex（Gemini / OpenCode v2 加）
- **不做自主反思圈 v1**: 推到 v3 远景；v1 只做手动 Skill / 模板，不强行做研究级问题
- **智能优先**: 任何能自动推断的事情都不应该问用户；只有自动失败才一次性求救（WS-06）
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Executive Summary
## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Bun** | `1.3.14` (May 13 2026) | Backend runtime + bundler + package manager + test runner | `--compile` single binary is the Tauri sidecar story; built-in `bun:sqlite`, native HTTP/WebSocket server, `Bun.Terminal` PTY, `Bun.spawn`, native `cross-spawn`-free child management. Replaces Node + npm + esbuild + jest in one. |
| **TypeScript** | `^5.9` (latest `5.9.x`; avoid 6.x beta) | Type system across BE + FE | Universal default; Bun ships its own TS loader so no `ts-node` / `tsx` needed. |
| **Hono** | `^4.12.19` | HTTP + SSE + WebSocket server on Bun | Web Standards (`fetch`/`Response`), first-class Bun adapter (`hono/bun` exports `upgradeWebSocket` + `websocket`), built-in `streamSSE` helper with backpressure, RPC types for end-to-end safety. Tiny (no Express bloat). |
| **Drizzle ORM** | `^0.45.2` (stable, not `1.0.0-rc.x`) | Type-safe SQL over `bun:sqlite` | Headless, zero-deps, sync-or-async, first-class `drizzle-orm/bun-sqlite` driver + `drizzle-orm/bun-sqlite/migrator`. SQL-first feels natural for `pty_chunks`/`events` event-sourcing schema. |
| **drizzle-kit** | `^0.31.10` (matches `drizzle-orm@0.45.2`) | Schema diff + migration generation | Use `bunx drizzle-kit generate` (write SQL) + programmatic `migrate()` at boot. **Do not** use `push` in production — generate + apply only. |
| **`bun:sqlite`** | bundled with Bun | SQLite driver | 3–6× faster than `better-sqlite3`, no native build, ships inside `bun --compile` binary, fully sync. Strict mode + WAL recommended. |
| **`Bun.Terminal`** (PTY) | bundled with Bun 1.3.14+ | Spawn real interactive `claude` / `codex` CLIs in a PTY (the entire "real CLI in a PTY" premise) | First-party. POSIX + Windows ConPTY. No native build / no `node-gyp` / no prebuilds to wrangle. Bundles cleanly into `bun --compile`. **This is the v1 path.** See "Windows caveats" below. |
| **React** | `^19.2.6` | UI framework | Locked. New compiler + Actions + `use` hook are useful for streaming Master messages. |
| **react-dom** | `^19.2.6` | DOM renderer | Must match React major. |
| **Vite** | `^8.0.13` | FE dev server + build | Hot-reload, ESM-native, plays well with Tailwind v4 via the dedicated Vite plugin. Vite 8 supports React 19 + Tailwind v4 out of the box. |
| **Tailwind CSS** | `^4.3.0` | Styling | v4 dropped `tailwind.config.js` in favor of CSS-first `@theme` + `@tailwindcss/vite`. shadcn/ui CLI has v4 support GA. |
| **`@tailwindcss/vite`** | `^4.3.0` | Vite plugin for Tailwind v4 | Required for v4; replaces the old `postcss` integration. |
| **shadcn/ui** | CLI `^3.4.x` (`npx shadcn@latest`) | Copy-paste accessible primitives | Tailwind-v4-native + React-19-native since early 2026. All primitives shipped with `data-slot` attributes (new style API). Removed `forwardRef` (React 19 transition). HSL → OKLCH colors. |
| **react-flow** (`@xyflow/react`) | `^12.10.2` | Topology canvas (Master + Workers + dep edges) | Standard. v12 renamed from `reactflow`; supports SSR, dark mode, computed flows. React 19 compatible (peer dep `>=17`). |
| **xterm.js** (`@xterm/xterm`) | `^6.0.0` | Real PTY terminal renderer in browser | v6 = current stable (Apr 2026); scoped `@xterm/*` packages only (legacy unscoped `xterm` is 5.x dead-end). Avoid the v6.1 betas. |
| **assistant-ui** (`@assistant-ui/react`) | `^0.14.5` | Chat composer + thread primitives | Locked. Open-source TS/React. Note: pre-1.0, still moving — pin exact version and bump deliberately. React 18/19 peer. |
| **node-pty** | **DO NOT INSTALL** | — | Will not load under Bun: NAN-based stable version crashes (`napi_define_properties`), NAPI beta crashes with `this._socket.write is not a function` in `unixTerminal.js`. Maintainer marked Bun support "out-of-scope" and explicitly recommends skipping Bun. |
| **`@modelcontextprotocol/sdk`** | `^1.29.0` | MCP server (Agenstrix → Master) + client (Agenstrix → chrome-devtools-mcp etc.) | Official Anthropic SDK. Runs on Bun. Ships stdio + Streamable HTTP transports + OAuth helpers. |
| **react-i18next** | `^17.0.8` + `i18next ^26.2.0` | UI i18n (`zh-CN` default, `en` fallback) | Standard. SSR-friendly. Use namespace splitting per panel for code-split. |
| **Biome** (`@biomejs/biome`) | `^2.4.15` | Lint + format (replaces ESLint + Prettier) | Locked. Rust-based, ~20× faster, single config file. v2 line is the 2026 line. |
| **Tauri (v2 only)** | `@tauri-apps/cli ^2.11.2`, `@tauri-apps/api ^2.11.0` | Desktop shell + sidecar binary host (v2 milestone) | Locked. v2 has stabilized sidecar API (`@tauri-apps/plugin-shell` `Command.sidecar`). Capabilities system replaces v1 allowlist. |
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@xterm/addon-fit` | `^0.11.0` | Resize terminal to container dimensions | Always — wire to ResizeObserver + Worker's `term.resize(cols, rows)` → server → PTY. |
| `@xterm/addon-web-links` | `^0.12.0` | Click URLs in terminal | Worker log usability. |
| `@xterm/addon-search` | `^0.16.0` | In-terminal search | UI-08 Cmd+K can scope to terminal pane. |
| `@xterm/addon-webgl` | `^0.19.0` | WebGL renderer (perf) | Default to WebGL renderer; fallback to canvas. Critical for heavy `claude` ASCII output. |
| `@xterm/addon-canvas` | `^0.7.0` | Canvas renderer fallback | When WebGL context creation fails (some Linux/WSL configs). |
| `@xterm/addon-serialize` | `^0.14.0` | Snapshot terminal state → VT sequences | UI-03 "replay from history": serialize state when closing drawer, hydrate when reopening. |
| `@xterm/addon-unicode11` | `^0.9.0` | CJK + emoji wide-char width | Required for CJK users (zh-CN default). Activate explicitly: `term.unicode.activeVersion = '11'`. |
| `@xterm/addon-clipboard` | `^0.2.0` | OSC 52 clipboard | Worker can paste via terminal. |
| `@xterm/addon-attach` | `^0.12.0` | Auto-bridge xterm ↔ WebSocket | Optional helper if you don't want to write the bridge yourself. We recommend writing the bridge manually for backpressure control. |
| `@hono/zod-validator` | `^0.8.0` | Request body validation on Hono | Pair with Zod for typed route handlers. |
| `zod` | `^4.4.3` | Schemas (validation, MCP tool inputs, IPC payloads) | Universal. MCP SDK accepts `^3.25 || ^4.0`, so v4 is fine. |
| `zustand` | `^5.0.13` | Lightweight client state (Master/Workers list, selection, UI mode) | Pair with React 19. Avoids Redux ceremony. |
| `@tanstack/react-query` | `^5.100.10` | Server-state cache + retry for REST queries | Use for workspace/settings/repo fetches; **don't** use it for streaming (use SSE/WebSocket directly). |
| `react-dropzone` | `^14.3.x` | Drag-folder hot-zone (WS-01) | Locked. Pair with Tauri 2 file drop event in v2. |
| `pino` | `^10.3.1` | Structured logging (INFRA-05) | Locked. Use `pino/file` transport with daily rotation; emit JSON. Worker chunks go via separate writer. |
| `simple-git` | `^3.36.0` | git worktree add/remove + commit (CORE-04) | Bun-compatible (pure JS, shells out to `git`). Avoid `isomorphic-git` for write paths (slower + has quirks with worktrees). |
| `chokidar` | `^5.0.0` | Watch `~/.agenstrix/skills/` + `.agenstrix/templates/` for hot reload (ASSET-02) | Standard. v5 fixed Bun fs event quirks. |
| `get-port` | `^7.2.0` | Find next free port for SVC-05 | Pure JS, Bun-compatible. |
| `nanoid` | `^5.1.11` | Worker/Conversation/Event IDs | Use 21-char URL-safe IDs; cryptographically secure. |
| `class-variance-authority` (cva) | `^0.7.1` | Variant-based className builder for shadcn primitives | Installed by `shadcn` CLI. |
| `tailwind-merge` | `^3.6.0` | Resolve conflicting Tailwind classes | Installed by `shadcn` CLI. |
| `clsx` | `^2.1.1` | Conditional className builder | Installed by `shadcn` CLI. |
| `lucide-react` | `^0.500.x` (latest) | Icon set used by shadcn | Default icon set; tree-shakeable. |
| `tw-animate-css` | `^1.4.0` | Animation utilities replacing `tailwindcss-animate` for v4 | shadcn v4 templates use this; `tailwindcss-animate` is v3-only and incompatible with Tailwind v4. |
| `@tauri-apps/plugin-shell` | `^2.3.5` | v2-only: `Command.sidecar(...)` to spawn the Bun binary from JS | Add when starting v2 Tauri milestone. |
| `@tauri-apps/plugin-fs` | `^2.5.1` | v2 file system access (drop folders, read workspace dir) | Pair with `react-dropzone` for native drop-detect. |
| `@tauri-apps/plugin-dialog` | `^2.7.1` | v2 native folder picker | Fallback when drag-drop isn't ergonomic. |
| `@tauri-apps/plugin-notification` | `^2.2.6` | v2 system notifications (Worker done) | Replaces web Notification API on desktop. |
| **`bun-pty`** (FFI) | `^0.4.8` | **Fallback PTY library** if `Bun.Terminal` Windows path bites | Cross-platform via Rust `portable-pty`. Same API as `node-pty`. Keep in your back pocket — wire behind a thin internal `Pty` interface so swap is a one-line change. |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| **Bun** (`bunx`, `bun add`, `bun test`, `bun build`) | Package install + script runner + test runner + bundler | Lockfile is `bun.lock` (binary, do commit). Use `bun add -d` for dev deps. |
| **Biome** | Lint + format | `biome.json` at repo root. Run `bunx @biomejs/biome check --apply`. |
| **drizzle-kit** | Migration codegen | `bunx drizzle-kit generate` → review SQL → commit `drizzle/<n>_*.sql` files. |
| **vite** | FE dev server | `bunx vite` on port 5173; proxy `/api` + `/ws` + `/sse` to Bun backend on 3000. |
| **Tauri CLI** (v2 only) | Desktop bundling | `bunx @tauri-apps/cli@2 init` then `bunx @tauri-apps/cli@2 build`. |
| `concurrently` (or Bun script with `&`) | Run BE + FE dev in parallel | A two-line Bun script (`bun --filter`) avoids the extra dep. |
## Installation
# --- Bootstrap (Bun is the package manager; do NOT use npm/pnpm) ---
# Frontend
# Dev tooling
# Initialize shadcn (after Tailwind v4 + Vite are set up)
# v2 (defer to Tauri milestone — do not install during v1)
## Critical Integration Patterns
### 1. Bun + PTY (the v1 path) — use `Bun.Terminal`, not `node-pty`
### 2. Bun + Drizzle migration pattern (production)
### 3. Bun `--compile` + Tauri 2 sidecar (the non-obvious recipe)
# Build the sidecar binary on each host platform you target.
# Inside src-bun/ (where main.ts is the Hono entrypoint):
# macOS Apple Silicon
# macOS Intel
# Linux x64 (glibc)
# Linux ARM64
# Windows x64 (must add .exe!)
### 4. SQLite embedding in compiled binary
### 5. Hono SSE with backpressure (Master → UI streaming)
### 6. Bun + Hono WebSocket (worker terminal stream)
### 7. xterm.js ↔ WebSocket bridging (manual, for backpressure)
- `convertEol: false` — never let xterm transform bytes; PTY is authoritative.
- `binaryType = "arraybuffer"` — avoid string-encoding overhead.
- `WebglAddon` in try/catch — context creation can throw on some Linux setups.
- `Unicode11Addon` mandatory for CJK users (default UI language is `zh-CN`).
### 8. shadcn/ui + Tailwind v4 + React 19 setup
### 9. react-flow state management (don't fight the library)
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `Bun.Terminal` | `bun-pty` (FFI / portable-pty) | If Bun.Terminal Windows ConPTY misbehaves on a specific user's machine (e.g., legacy Windows 10 < 1809). Identical API surface; keep behind an interface. |
| `Bun.Terminal` | `@lydell/node-pty` (1.2.0-beta with prebuilt platform-split packages) | **Only** if you regress to running on Node.js. Still unverified under Bun runtime. |
| `bun:sqlite` | `better-sqlite3` | Never for this project — it's a native module that won't bundle into `bun --compile` cleanly and would lose the Tauri sidecar story. |
| `drizzle-orm` | `kysely` | If you want pure query-builder with no schema management. Drizzle gives you migrations + types in one. |
| `react-flow` | `react-arborist` / `tldraw` | If the topology was a strict tree (it's a DAG) or a free-form canvas. react-flow is the right fit for "DAG of workers with edges." |
| `assistant-ui` | Build chat from scratch with shadcn primitives | If you outgrow assistant-ui's opinions. Worth budgeting for — it's pre-1.0 (`0.14.x`), so version it tightly. |
| `Hono` | `Elysia` | Elysia is Bun-only and equally fast, but Hono's adapter ecosystem (Cloudflare/Deno/Node) is a strategic hedge if you ever want to deploy a hosted version. Hono also has the more mature SSE/WS story right now. |
| `react-i18next` | `lingui` | If you want compile-time message extraction. react-i18next is more battle-tested with namespaces — better for multi-panel apps. |
| `pino` | `winston` | Pino is 5–10× faster and ships JSON natively. Winston only if you need a specific transport pino lacks (unlikely). |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **`node-pty`** (any version) | NAN crashes under Bun (`napi_define_properties` failure on spawn); NAPI beta crashes with `this._socket.write is not a function`; maintainer marked Bun support out-of-scope and *explicitly recommends skipping*. **Will not load in `bun build --compile` output.** | `Bun.Terminal` (default) or `bun-pty` (fallback). |
| **`xterm`** (unscoped, 5.x) | Legacy package; v6 lives only under `@xterm/*` scoped names. Old docs everywhere will mislead you. | `@xterm/xterm@^6.0.0` + scoped `@xterm/addon-*`. |
| **`drizzle-orm@1.0.0-rc.x`** | RC line; still ships patches every few days (last 5 versions in past 12 days); breaking schema-language tweaks possible before GA. | `drizzle-orm@^0.45.2` + `drizzle-kit@^0.31.10` (npm `latest` tag). |
| **`tailwindcss-animate`** | v3-only; will not work with Tailwind v4's CSS-first config. | `tw-animate-css@^1.4.0`. |
| **`better-sqlite3`** | Native module, requires `node-gyp`, won't embed cleanly in `bun --compile`; redundant given Bun's first-class `bun:sqlite`. | `bun:sqlite`. |
| **`tailwind.config.js`** (any) | Tailwind v4 is CSS-first; the JS config is legacy migration path only. | `@theme` block in `src/index.css`. |
| **`xterm.js@6.1.x-beta`** | Beta line; 200+ canary releases over 2 weeks. | `@xterm/xterm@6.0.0`. |
| **`bun build --compile --target=bun-…-baseline`** unless you've measured | Baseline variants exist for pre-Haswell CPUs; modern dev/CI is fine without. Pick baseline only if a user reports illegal instruction crashes. | Default `bun-<os>-<arch>`. |
| **`drizzle-kit push`** in production | Schema-diff push has destructive edge cases; SQLite migrations should be SQL-file + tracked. | `bunx drizzle-kit generate` → review → `migrate()` at boot. |
| **`assistant-ui` (unscoped CLI)** as a runtime dep | That's the **CLI** (`0.0.91`), not the React library. | `@assistant-ui/react@^0.14.5`. |
| **`Bun.spawn` with `stdio: ["pipe", "pipe", "pipe"]` for the claude CLI** | Without `terminal:`, claude won't render its TUI (no `isTTY`, no colors, no permission prompts). | `Bun.spawn(argv, { terminal })` — always. |
| **`tauri-plugin-shell` v1 syntax** in v2 | v1's allowlist is gone; v2 uses per-capability JSON files. Wrong syntax silently denies sidecar spawn at runtime. | Capabilities file with `shell:allow-spawn` + sidecar entry. |
## Known Production Gotchas
### Bun
- **`bun --compile` cannot embed dynamically `require()`-d `.node` files** outside the static graph. If you ever add a native module, import it statically.
- **`Bun.spawn` `kill(15)` does not propagate to PTY child group on Linux** — set up a `pgid` (use a wrapper script or `Bun.spawn`'s `detached: true`) so SIGTERM hits the whole `claude` tree. Mirror golutra's approach.
- **Bun's WebSocket pong is per-message** — for long PTY streams, the client must reply to pings; default `idleTimeout` of 120s will close idle sockets. Set `idleTimeout: 0` or send keep-alive nulls.
### Bun.Terminal (Windows ConPTY)
- **No termios** on Windows: `inputFlags` / `outputFlags` / `localFlags` / `controlFlags` always return 0 and setters are no-ops.
- **No kernel echo before child attaches**: on POSIX you can `write()` before spawn and the line discipline echoes; on Windows the bytes sit in the buffer.
- **ConPTY re-encodes output**: escape sequences in the `data` callback are semantically equivalent but **not byte-identical** to what the child emitted. This matters if you're doing byte-level diffing on PTY streams for the event log — store the re-encoded bytes, don't try to round-trip.
- **Older Windows 10** (< 1809) lacks ConPTY entirely; minimum supported Windows is 10 1809 (Oct 2018) — document this.
### node-pty (if you ever try it anyway — don't)
- Has historical "5th PTY bug" on Linux (fixed in NAPI port, but irrelevant to us).
- Requires Visual Studio Build Tools + Windows 10 SDK on Windows builds.
### Drizzle
- **`bun:sqlite` driver is sync by default** but the migrator API is async — `await migrate(...)` even though queries are sync.
- **Snake_case columns**: set `{ casing: "snake_case" }` in the drizzle config to keep your TS interface in camelCase but SQL in snake.
- **Foreign keys are off by default in SQLite** — enable per-connection: `sqlite.exec("PRAGMA foreign_keys = ON;")`.
### Hono
- **Hono on Bun requires the `hono/bun` adapter** for WS; the generic `hono` import doesn't ship a WS server. Don't try to wire `ws` library separately.
- **`streamSSE` aborts when client disconnects** — wire `stream.onAbort()` to clean up your subscriptions or you'll leak EventBus listeners.
### xterm.js
- **WebGL renderer requires a `canvas` element parent with a measurable size before `term.open()`** — if you mount in a `display: none` parent first, you get a 0×0 terminal that never recovers. Mount visible, then `fit.fit()`.
- **`allowProposedApi: true`** is mandatory for Unicode11 addon (it's still "proposed" in xterm's stability matrix).
- **Don't `term.write()` strings byte-by-byte** for high-volume PTY output — batch in `requestAnimationFrame` if rendering becomes the bottleneck. (xterm 6 dramatically improved this, but it's still a tax.)
### react-flow
- **Always wrap your canvas in `<ReactFlowProvider>`** even for a single canvas; many hooks silently no-op without it.
- **`nodeTypes` / `edgeTypes` must be memoized** (`useMemo(() => ({...}), [])`) or react-flow logs a warning every render and re-creates internal handlers, killing perf.
### Tauri 2 + Bun sidecar
- **`Command.execute()` blocks the whole call** — for a long-running server, use `cmd.spawn()` and listen to events.
- **Capability JSON for sidecar must list the binary explicitly** under `shell:allow-spawn` with `"sidecar": true` — otherwise you get an opaque "not allowed" runtime error. Easy to miss.
- **`externalBin` paths are relative to `src-tauri/`**, not to the Tauri config file's dir if you have a non-default layout.
- **`bun --compile` Linux binaries are dynamically linked against glibc** by default. If you need to ship to Alpine/Bullseye-old, use `--target=bun-linux-x64-musl`.
### `@modelcontextprotocol/sdk`
- **SDK ships its own `eventsource` + `express` deps** — they're not used in stdio mode, but they get bundled. Use Bun's tree-shaking or `external` config to drop them from the compiled sidecar.
- **The SDK exposes a `Server` class that requires you to provide a transport** — for the Master MCP plugin (CORE-02), use the **stdio** transport (Claude Code spawns it as a subprocess). For external HTTP MCP servers, use Streamable HTTP.
### chrome-devtools-mcp
- **It is an MCP server**, distributed via `npx chrome-devtools-mcp` — you spawn it as a child process and connect via stdio. Don't try to import it as a library.
- Current latest: `chrome-devtools-mcp@^0.26.0` (verified npm).
## Stack Patterns by Variant
- Bun process listens on `localhost:3000`; Vite dev server on `5173` proxies `/api` + `/sse` + `/ws`.
- No Tauri deps installed.
- PTY uses `Bun.Terminal` directly.
- Bun is compiled to `agenstrix-server-<target-triple>(.exe)` and placed in `src-tauri/binaries/`.
- Tauri Rust shell spawns it via `tauri_plugin_shell::ShellExt::shell().sidecar(...)` on startup.
- Frontend connects to `http://localhost:<auto-port>` (port handshake via Tauri event).
- Capabilities allow `shell:allow-spawn` for the sidecar only — no general shell access.
- Use Bun 1.3.14+ for ConPTY Terminal support.
- Document Windows 10 1809+ requirement.
- Path-short-name conversion: golutra's approach is `kernel32.dll` `GetShortPathNameW` for `cwd` with non-ASCII chars before passing to `Bun.spawn`. Wrap in a small `winShortPath()` helper.
- If `Bun.Terminal` exhibits any issue, swap to `bun-pty` via your interface (5-line change).
## Version Compatibility
| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `bun@1.3.14` | `Bun.Terminal` on POSIX + Windows | First Bun release with cross-platform ConPTY. |
| `drizzle-orm@0.45.2` | `drizzle-kit@0.31.10` | Pin both. Mixing `drizzle-orm@1.0.0-rc` with `drizzle-kit@0.31.x` causes migration codegen errors. |
| `@tailwindcss/vite@4.3.0` | `vite@>=5.2 || >=6 || >=7 || >=8`, `tailwindcss@^4.3.0` | All match. |
| `@assistant-ui/react@0.14.5` | `react@^18 || ^19` | OK with React 19. |
| `@xyflow/react@12.10.2` | `react>=17` | Works with React 19. |
| `@xterm/xterm@6.0.0` | `@xterm/addon-*` versions listed above | All v6-line addons are mutually compatible. |
| `hono@4.12.19` | `@hono/zod-validator@0.8.0`, `zod@^4` | All match. MCP SDK `^3.25 || ^4.0` for zod is also fine. |
| `@tauri-apps/cli@2.11.2` | `@tauri-apps/api@2.11.0`, plugins `2.x` | v1 plugins are incompatible — pure v2. |
| `react-i18next@17.0.8` | `i18next@^26` | v17 added React 19 compat. |
| `@biomejs/biome@2.4.15` | Bun & Node both | Project ships with a JSON-only config (`biome.json`). |
| `bun-pty@0.4.8` | `bun@>=1.0` | Cross-platform via prebuilt FFI bins, no node-gyp. |
## Confidence Levels per Recommendation
| Item | Confidence | Source |
|------|------------|--------|
| Versions (every row in tables above) | **HIGH** | `npm view <pkg> version` on 2026-05-17 |
| `node-pty` incompatible with Bun | **HIGH** | Maintainer-merged NAPI PR #644 explicitly states "skip bun"; Bun blog v1.3.5 ships `Bun.Terminal` as the Bun-native answer; multiple post-1.0 issues confirm |
| `Bun.Terminal` Windows ConPTY production-ready | **MEDIUM** | Shipped 2026-05-13 in 1.3.14 (4 days before research). Functionally complete but very new — flag for Phase 1 smoke test on Windows. Backup plan: `bun-pty`. |
| Drizzle 0.45.x recommended over 1.0.0-rc | **HIGH** | npm `latest` dist-tag is `0.45.2`; `rc` tag still shipping `-c5a84d1` / `-67a3509` patches within last week |
| shadcn/ui Tailwind v4 + React 19 native | **HIGH** | shadcn official docs (Tailwind v4 page) + GH discussion #6714 confirm GA |
| Bun `--compile` cross-target build per platform | **HIGH** | Bun official `executables.mdx` docs |
| Tauri 2 sidecar target-triple naming convention | **HIGH** | Tauri v2 official `develop/sidecar` page |
| Hono `streamSSE` + `hono/bun` WS pattern | **HIGH** | Hono official docs (`/helpers/streaming`, `/getting-started/bun`) |
| `bun-pty@0.4.8` as fallback | **MEDIUM** | Active project, 20 releases, but smaller user base than node-pty |
| `chrome-devtools-mcp@0.26.0` ready for built-in | **MEDIUM** | Verified on npm; integration pattern (stdio spawn from Agenstrix MCP client) is standard but should be validated in Phase containing MCP-02 |
| Windows path short-name workaround | **MEDIUM** | Pattern referenced from golutra; verify exact `kernel32` FFI signature when implementing |
## Sources
### Context7 (HIGH confidence)
- `/oven-sh/bun` — `bun build --compile`, native module loading, `Bun.Terminal`, Node-API
- `/websites/v2_tauri_app` — sidecar bundling, `externalBin`, target-triple naming, Rust-side spawn, JS-side `Command.sidecar`
- `/llmstxt/hono_dev_llms-full_txt` — `streamSSE`, `hono/bun` WebSocket, backpressure
- `/drizzle-team/drizzle-orm-docs` — `bun-sqlite` driver, migrator, drizzle-kit workflow
- `/microsoft/node-pty` — Windows ConPTY options, build requirements, **known Bun incompatibility**
- `/xtermjs/xterm.js` — addon usage (serialize, attach, unicode11, fit)
### Official docs (HIGH confidence)
- Bun blog v1.3.5 (2025-12-17) — `Bun.Terminal` POSIX launch — <https://bun.com/blog/bun-v1.3.5>
- Bun blog v1.3.14 (2026-05-13) — `Bun.Terminal` Windows ConPTY — <https://bun.com/blog/bun-v1.3.14>
- Bun `Terminal` API reference — <https://bun.com/reference/bun/Terminal>
- Bun `executables.mdx` — <https://bun.com/docs/bundler/executables>
- Tauri 2 sidecar guide — <https://v2.tauri.app/develop/sidecar>
- Tauri 2 Node sidecar tutorial (target-triple naming) — <https://v2.tauri.app/learn/sidecar-nodejs>
- shadcn/ui Tailwind v4 — <https://ui.shadcn.com/docs/tailwind-v4>
- shadcn/ui React 19 — <https://ui.shadcn.com/docs/react-19>
### GitHub (MEDIUM/HIGH confidence)
- `microsoft/node-pty#632` — Bun incompatibility (closed out-of-scope)
- `microsoft/node-pty#748` — node-pty beta crashes under `bun build`
- `microsoft/node-pty#644` (PR) — NAPI port merged Jan 2024; author concludes "skip bun support"
- `oven-sh/bun#25565` — Windows Terminal request (closed by `bun@1.3.14`)
- `garrytan/gstack#1221` — production Bun.Terminal Windows issue (fixed in 1.3.14)
- `xyflow/xyflow` releases — `@xyflow/react@12.10.2` confirmed
### npm registry (HIGH confidence)
- All version numbers verified via `npm view <pkg> version` on 2026-05-17
- Drizzle `latest` vs `rc` dist-tags verified via `npm view drizzle-orm dist-tags`
- node-pty release timeline verified — current stable `1.1.0` (2025-12-22), `1.2.0-beta.13` (2026-05-13)
### Sub-projects / FFI alternatives (MEDIUM confidence)
- `sursaone/bun-pty@0.4.8` — FFI wrapper over Rust portable-pty, no node-gyp — recommended fallback
- `@lydell/node-pty@1.2.0-beta.12` — only useful if you regress to Node.js
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
