# Walking Skeleton — Agenstrix

**Phase:** 1 (First PTY Demo)
**Generated:** 2026-05-17

## Capability Proven End-to-End

A user who runs `bunx agenstrix` in any directory opens `http://localhost:3000`, sees a three-column chat shell with one MessageCard whose embedded xterm.js renders the live byte-stream of a real interactive `claude` CLI running in a `Bun.Terminal` PTY on the backend; keystrokes typed into the terminal travel through a WebSocket to the PTY stdin and the response renders back; on tab close+reopen the terminal replays from SQLite-persisted `pty_chunks`; on Ctrl+C the process group dies (5s SIGTERM → SIGKILL) and `agenstrix doctor --reap` identifies any historical orphans.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Runtime | Bun 1.3.14+ | `Bun.Terminal` is the only PTY library that loads under Bun (node-pty NAPI crashes); `bun --compile` is the eventual v2 Tauri sidecar story; built-in SQLite/HTTP/WS removes 4 deps. |
| HTTP / WS / SSE server | Hono `^4.12.19` on `hono/bun` adapter | First-class Bun WS support (`upgradeWebSocket`/`websocket` exports); `streamSSE` helper with backpressure; tiny; web-standards `fetch`/`Response`. |
| Database | SQLite via `bun:sqlite` + Drizzle ORM `^0.45.2` (NOT `1.0.0-rc`) | Sync driver, 3-6x faster than `better-sqlite3`, bundles cleanly into `bun --compile`; Drizzle gives type-safe migrations via `drizzle-kit@^0.31.10` (`generate` + `migrate()`, **never** `push`). |
| PTY library | `Bun.Terminal` (primary) behind a `PtyHandle` interface; `bun-pty@^0.4.8` (FFI fallback) statically imported but dormant | `Bun.Terminal` ships in Bun 1.3.14 with cross-platform ConPTY (2026-05-13). `bun-pty` is the 5-line-swap escape hatch if Windows ConPTY misbehaves. |
| Frontend framework | React 19 + Vite 8 + Tailwind v4 (CSS-first via `@theme` + `@tailwindcss/vite`, **no** `tailwind.config.js`) + shadcn/ui v4 + `tw-animate-css` (**not** `tailwindcss-animate`) | Locked by PROJECT.md. Dev server on `5173` proxies `/api` + `/ws` + `/sse` to Bun on `3000`. |
| Terminal renderer | `@xterm/xterm@^6.0.0` (scoped — **never** unscoped `xterm`) + WebGL/Canvas fallback + Unicode11 + Fit + WebLinks | Forwards raw PTY bytes; xterm's VT parser handles split escape sequences. `allowProposedApi: true` mandatory for Unicode11 (CJK default). |
| Auth | None (single-user local tool; PROJECT.md "永不内置 Auth") | Localhost only. |
| State store (frontend) | Zustand `^5.0.13` | React 19 compatible, less ceremony than Redux. |
| Server-state cache (frontend) | `@tanstack/react-query@^5` for REST queries; raw WS/SSE for streaming (no library) | History replay = one REST `GET /api/workers/:id/chunks` → react-query caches; live = raw `WebSocket` binary frames → `term.write()`. |
| Lint / format | Biome `^2.4.15` (single config file) | Replaces ESLint + Prettier; Rust-fast; PROJECT.md mandates. |
| Test runner | `bun:test` (built-in) | No install; auto-discovers `*.test.ts`. |
| Deployment target (Phase 1) | Local dev only via `bunx agenstrix` (web mode). Tauri sidecar binary recipe deferred to v2. | PROJECT.md: "Web 优先，Tauri 桌面 v2 加". |
| Directory layout | `src-bun/{db,bus,pty,worker,gateway,system}/` for backend; `src-react/{components,lib}/` for frontend; `drizzle/` for committed SQL migrations; `tests/{unit,smoke}/` for `bun:test` files | Mirrors ARCHITECTURE.md module decomposition; same shape that Phase 2-5 will extend (adding `master/`, `mcp/`, `service/`, `workspace/`). |
| CLI entry | `bunx agenstrix` (default subcommand = `start`); also `agenstrix doctor --reap`; `--port <N>` flag | D-13. No interactive prompts on first launch. |
| Database location | `~/.agenstrix/store.db` (auto-created on first boot) with WAL mode, `PRAGMA journal_size_limit=67108864`, periodic `wal_checkpoint(PASSIVE)`, pre-migrate backup to `~/.agenstrix/backups/` (keep 10) | DB-DURABILITY-01. |
| Process group invariant | `Bun.spawn(..., { terminal, detached: true })` → `pgid = proc.pid` → kill via `process.kill(-pgid, sig)` on POSIX; `process.kill(pid)` on Windows (ConPTY cascades) | KILL-01. PtyHandle.kill() branches on platform. |
| Secret-redaction placement | Inline in PTY data callback BEFORE writing to SQLite AND BEFORE forwarding to WebSocket (single pass) | SEC-01. Patterns: `sk-ant-…`, `ghp_…`, `sk-…`, `AKIA[0-9A-Z]{16}`. |
| Spawn env allowlist | `PATH / HOME / USER / LANG / SHELL / TERM` by default; explicit `delete GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE` (WORKTREE-CWD-01) | SEC-01 + WORKTREE-CWD-01. |
| ANSI chunk splitter | Pure-function VT500 state machine (`GROUND / ESC / CSI / OSC / DCS / PM / APC / SOS / STRING_ST`); flush only at sequence boundary or forced shutdown; ~100KB or 250ms batch; tail bytes carried to next chunk | ANSI-SPLITTER-01. Persistence only — xterm.js handles split sequences client-side. |
| WebSocket invariants | `idleTimeout: 0`, server heartbeat every 30s (empty binary frame), client-initiated normal close = 1000, server abnormal = 1011; PTY outlives browser disconnects | WS-1011-01. |

## Stack Touched in Phase 1

- [x] **Project scaffold** — `package.json`, `tsconfig.json`, `biome.json`, `drizzle.config.ts`, `vite.config.ts`, Tailwind v4 CSS (no JS config), shadcn CLI initialized; lockfile = `bun.lock` (committed)
- [x] **Routing** — `GET /api/workers/:id/chunks` (REST history), `WS /ws/worker/:id` (live PTY bytes), `SSE /sse/events` (system events), `POST /api/workers/:id/input` (stdin inject), `GET /healthz` (skeleton liveness)
- [x] **Database** — Drizzle schema (≥ 4 tables in Walking Skeleton, all 11 by end of phase: `workers / pty_chunks / events / messages / workspaces / conversations / repos / services / skills / templates / learned_commands`); read via `ptyChunksRepo.listByWorker(workerId)`, write via `ptyChunksRepo.append(...)` and `workersRepo.insert(...)` on PTY spawn
- [x] **UI** — Three-column shell with WorkspaceBar (top, cwd display), left/right sidebar placeholders, center MessageCard with embedded `WorkerTerminal` (xterm.js), ChatInput at bottom; `⤢` fullscreen toggle on card; SelfTestBanner appears on degraded start
- [x] **Deployment** — Local: `bun dev` (concurrent `src-bun/main.ts --watch` + `vite`); production-mode equivalent: `bunx agenstrix start` after `bun install` boots the integrated Bun server (Vite-built static assets served by Hono in single-binary v2 mode — deferred)
- [x] **CI** — GitHub Actions matrix on macOS / Ubuntu / Windows-latest with Bun pinned to 1.3.14, runs `bun test` + PTY smoke tests on each platform

## Out of Scope (Deferred to Later Slices)

- Drag-folder / Open Folder UI / Smart workspace recognition / try-start / learned commands → **Phase 2** (WS-01..09, SVC-*)
- Master ↔ Worker MCP wiring / `spawn_worker` MCP tool / Master Thinking drawer / multiple Worker cards / chat-bubble parsing of PTY output → **Phase 3** (CORE-02/06, MCP-01, UI-03/04/05, MASTER-RESUME-01)
- Topology / `@xyflow/react` canvas / dual-view switcher / `@worker-N` mention syntax → **Phase 4** (UI-01/02), **Phase 5** (UI-10)
- Token + dollar cost guard / global cost dashboard / Worker budget bar → **Phase 5** (COST-01/02, UI-07)
- i18n (zh-CN + en) / dark-light theme / Cmd+K command palette / high-risk confirmation dialogs → **Phase 5** (INFRA-01, UI-06/08/09)
- Skills / templates / `.agenstrix-pack` import-export → **Phase 5** (ASSET-01..04)
- Full 11-step graceful shutdown protocol → **Phase 5** (SETUP-04 complete version); Phase 1 implements minimal 5 steps: stop accept WS → kill PTY (SIGTERM→5s→SIGKILL) → WAL checkpoint → pino flush → exit
- Tauri 2 desktop packaging / sidecar binary / `Command.sidecar()` / capabilities JSON / macOS notarization / Windows EV cert → **v2** (DESKTOP-01..04)
- Codex CLI worker support / Gemini / OpenCode → **v2** (CLI-V2-01/02)
- Automatic reflection loops / Skill self-distillation / topology self-rearranging → **v3** (GROW-V3-*)
- Master crash recovery (`MASTER-RESUME-01`) is **NOT** in Phase 1 because there is no Master/Worker distinction yet — the single auto-spawned `claude` is the "Master-as-single-Worker" placeholder per D-04

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- **Phase 2 (Smart Workspace):** Drag a Next.js folder + a FastAPI folder → auto-detect language/framework/port/role → trial-start → green dots in top bar. Reuses: schema (extends `workspaces`, `repos`, `services`, `learned_commands`); bus; Hono REST/WS; SQLite durability; SetupBanner pattern.
- **Phase 3 (Master + Worker):** Auto-spawn `claude` becomes Master with `@modelcontextprotocol/sdk` stdio bridge injecting `spawn_worker / kill_worker / list_workers / send_to_worker / read_worker_log` tools. Each spawned Worker gets its own `MessageCard` (reused from Phase 1) and `WorkerTerminal` (reused from Phase 1) — N cards in the stream.
- **Phase 4 (Topology + Multi-Worker):** `@xyflow/react` topology view is a parallel projection of the same `workers` + `events` tables; dual-view toggle; `wait_for` dependency edges; built-in `chrome-devtools-mcp@^0.26.0`.
- **Phase 5 (Production Polish):** Token/cost guard, i18n, theme, Cmd+K, full 11-step shutdown, Skills/templates/`.agenstrix-pack`. No architectural change.
