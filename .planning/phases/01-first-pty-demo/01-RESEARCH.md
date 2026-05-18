# Phase 1: First PTY Demo — Research

**Researched:** 2026-05-17
**Domain:** Bun.Terminal PTY orchestration, xterm.js v6, Hono WebSocket, Drizzle/bun:sqlite, process-group kill, ANSI splitter, React 19 chat-shell UI
**Confidence:** HIGH for stack (npm-verified day-of); MEDIUM for Bun.Terminal Windows ConPTY (4 days since shipped)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Auto-spawn real `claude` on start if self-test passes; show top-banner if not.
- **D-02:** `claude` cwd = `process.cwd()` at `bunx agenstrix` invocation. No drag-folder UI in Phase 1 (Phase 2).
- **D-03:** Spawn `claude` bare — no `--print`, no `--mcp-config`, no initial prompt. Clean TUI.
- **D-04:** Phase 1 Master = single Worker in `no-worktree` mode; `worker/` module minimum: cli=`claude`, cwd direct-pass, no worktree create/merge/inherit.
- **D-05:** Main area = three-column shell: left sidebar (session list placeholder) / center (message bubble stream + ChatInput) / right MembersSidebar (placeholder). Master = one large MessageCard with embedded xterm. Card header: live status dot + "Master Claude" + PID + uptime. Card upper-right: `⤢` fullscreen toggle. Bottom ChatInput: Enter sends line + `\n` to PTY stdin; xterm also accepts raw keyboard (Ctrl+C, Esc, arrows) bypassing ChatInput.
- **D-06:** UI uses shadcn/ui + Tailwind v4 + React 19. Must be final production appearance — not throwaway debug page. MessageCard component is the reusable container for Phase 3+ Workers.
- **D-07:** History replay = "WeChat-style": on open, HTTP REST fetches all `pty_chunks` by `seq` ascending, one-shot `term.write()` loads all into scrollback, WebSocket attaches for live delta. Scrollback >= 100,000 lines.
- **D-08:** No replay animation, no serialize-addon snapshot, no "start from seq N" replay.
- **D-09:** Loading indicator (overlay + spinner) shows only after >500ms.
- **D-10:** Self-test failure = Degraded full-start with top red banner listing missing items.
- **D-11:** Banner → shadcn Dialog with fix instructions + platform commands + "Copy command" + "Re-check" buttons.
- **D-12:** SQLite path not writable = strict mode: backend exits immediately, prints fix instructions, does NOT open browser.
- **D-13:** CLI entry = `bunx agenstrix` (default = `start`). Subcommands: `start`, `doctor --reap`, `--port <N>`.
- **D-14:** Port strategy = default 3000; occupied = error + exit with `--port` hint. No auto-find.
- **D-15:** First launch creates `~/.agenstrix/` automatically; prints one line, no interactive prompt.
- **D-16:** Auto-open browser: `open` (mac), `xdg-open` (linux), `start` (win); silent on failure, print URL.

### Claude's Discretion

- History chunks: HTTP REST one-shot vs SSE streaming — planner decides based on pitfall research (1MB chunk boundary concerns favor one-shot REST with streaming fallback above threshold).
- xterm scrollback size and lazy-load above huge history threshold.
- ChatInput multi-line: Shift+Enter = newline vs Enter = send — mirror golutra `ChatInput.vue` behavior.
- Card `⤢` fullscreen: modal vs portal full-bleed — use shadcn Dialog or CSS portal.
- ANSI redactor placement: before SQLite write AND before WS forward (both, per SEC-01).
- pgid capture timing: after spawn (pid is available synchronously from `Bun.spawn` return).
- WebSocket `idleTimeout: 0` + heartbeat frequency (30s per WS-1011-01 requirement).
- Drizzle schema: Phase 1 builds all 11 tables now (simpler migration path than incremental) — at minimum: `workers / pty_chunks / events / messages`. Backup before migrate required.

### Deferred Ideas (OUT OF SCOPE)

- Drag-folder / Open Folder UI / Smart workspace recognition → Phase 2 (WS-01..09).
- Multi-Worker / MCP spawn / Master Thinking drawer → Phase 3.
- Topology view (react-flow) → Phase 4.
- Token/dollar cost guard / i18n / themes / Cmd+K → Phase 5.
- Tauri desktop packaging → v2.
- Codex worker support → v2.
- Automatic reflection loops → v3.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-02 | SQLite persistence at `~/.agenstrix/store.db`; Drizzle ORM + bun:sqlite; ≥11 tables; migrations on boot | §SQLite Schema section — Drizzle 0.45.2 + bun-sqlite migrator pattern |
| INFRA-03 | PTY byte-stream persistence + replay; ~100KB/chunk with `seq`; ANSI-safe splitting; replay on worker reopen | §ANSI Splitter section — chunk batcher state machine |
| INFRA-04 | Event sourcing: all decisions/spawn-kill/user-input written to `events` table; JSON payload | §SQLite Schema — events table design |
| INFRA-05 | pino logging to `~/.agenstrix/logs/agenstrix-YYYY-MM-DD.log` daily rotation | §Standard Stack — pino ^10.3.1 |
| INFRA-06 | Startup self-test: `which claude`, `which git`, SQLite r/w, port availability; give fix commands | §SETUP-01 / Doctor section |
| INFRA-07 | Cross-platform: macOS, Linux, Windows 10 1809+; ConPTY path confirmed; Windows path short-name shim | §Bun.Terminal Windows section |
| DB-DURABILITY-01 | `PRAGMA journal_size_limit=67108864`; 5-min `wal_checkpoint(TRUNCATE)`; pre-migrate backup to `~/.agenstrix/backups/` (keep 10); never `drizzle-kit push` | §SQLite Durability section |
| CORE-01 | Master = real `claude` in PTY; PID visible; browser sees live stream; kill leaves no orphan | §Bun.Terminal API section |
| CORE-04 | Worker (`no-worktree` mode) PTY spawned; on exit auto-cleans; events table gets `worker.exited` | §Worker Module Design |
| CORE-05 | Kill: SIGTERM → 5s → SIGKILL; process-group; events table gets `worker.killed` | §Kill-Group Invariant section |
| KILL-01 | `detached: true` invariant; `process.kill(-pgid, sig)`; `agenstrix doctor --reap` orphan scanner | §Kill-Group Invariant section |
| GIT-01 | Per-repo worktree-add serialization queue scaffold; boot-time stale `.git/index.lock` scanner | §Git Lock Scanner section |
| SEC-01 | Env minimization: only PATH/HOME/USER/LANG/SHELL; PTY redactor before SQLite + WS; regexes for sk-ant-/ghp-/sk-/AKIA | §Secret Redactor section |
| WS-1011-01 | PTY WebSocket `idleTimeout: 0`; 30s server heartbeat; client reconnects with last seq for replay | §WebSocket Bridge section |
| ANSI-SPLITTER-01 | Chunk batcher detects ESC sequence boundaries; partial sequences cached to next chunk; unit tests | §ANSI Splitter section |
| WORKTREE-CWD-01 | Spawn env scrubs GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE; cwd resolved via `fs.realpath` before spawn | §CWD Resolver section |
| SETUP-01 | CLI detection: `which claude`, `which codex`; missing = banner with install guide + "Re-check" | §Doctor / Self-Test section |
</phase_requirements>

---

## Summary

Phase 1 is a greenfield vertical slice: Bun backend + React frontend + SQLite + one real `claude` PTY rendered in-browser via xterm.js. The stack is locked and npm-verified. The primary research investment is in four areas where documented behavior matters more than guessing:

**First:** `Bun.Terminal` API surface — the constructor takes `{ cols, rows, data(term, chunk) }` and the spawn uses `Bun.spawn(argv, { ..., terminal })`. The data callback fires with `Uint8Array` chunks from the PTY child. On Windows, ConPTY re-encodes escape sequences (semantically equivalent, not byte-identical) and termios flags are inert. This shipped in Bun 1.3.14 on 2026-05-13 — 4 days before this research. The dev environment has Bun 1.3.12; the first executor step must be `bun upgrade --version 1.3.14` (or latest 1.3.x).

**Second:** The ANSI splitter for chunk boundaries. Raw bytes can be forwarded to xterm unchanged (xterm has its own VT parser and handles split sequences). But for SQLite persistence, we need atomic escape-sequence storage or replay will render garbled output for boundary-crossing sequences. The recommended approach: accumulate a tail buffer for incomplete CSI/OSC/DCS sequences (state machine: GROUND → ESC → CSI/OSC/DCS → terminal byte); flush to SQLite only on sequence boundaries. Forward to WebSocket immediately (no wait).

**Third:** Kill-group safety. `Bun.spawn` with `detached: true` calls `setsid()` on POSIX (new pgid = pid). Kill via `process.kill(-pgid, 'SIGTERM')` hits the entire group. After 5s, `process.kill(-pgid, 'SIGKILL')`. On Windows, ConPTY cascades kill to PTY children automatically via the pseudo-console handle — but Chromium children of `chrome-devtools-mcp` (Phase 3+) are not in the group. Phase 1 only deals with a single `claude` process; the cascade is straightforward.

**Fourth:** The UI is not a throwaway debug page — it's the production shell. The three-column layout with MessageCard + embedded xterm must be built to the final specification from day 1, as Phase 3+ Workers reuse the same MessageCard component directly.

**Primary recommendation:** Follow the exact architecture in this document. Do not deviate from the PTY abstraction interface — the `PtyHandle` wrapper is the insurance policy for the Windows ConPTY fallback to `bun-pty`. Build the ANSI splitter as a pure function with unit tests before wiring it into the chunk batcher.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| PTY spawn + byte streaming | Backend (Bun) | — | PTY is a kernel-level resource; only the server process can own the file descriptor |
| Chunk persistence (pty_chunks) | Backend (Bun) → SQLite | — | Persistence is server-side; browser only receives live deltas |
| Event sourcing (events table) | Backend (Bun) → SQLite | — | All state changes must be server-authoritative |
| WebSocket gateway (PTY ↔ browser) | Backend (Bun/Hono) | Browser (xterm.js) | Binary pipe: server reads PTY → WS send; browser receives → xterm.write |
| Terminal rendering | Browser (xterm.js) | — | Rendering is client-side; raw bytes → xterm |
| User keystroke injection | Browser → Backend | Backend → PTY | Forward: browser WS message → server → `terminal.write(data)` |
| History replay | Backend (REST) → Browser (xterm) | — | HTTP GET `pty_chunks` ordered by seq; one-shot write to xterm |
| Self-test / doctor | Backend (CLI entry) | — | Node process inspects OS, CLI tools, SQLite, ports before serving |
| Kill-group management | Backend (Bun process) | — | pgid is a kernel concept; only the spawning process can send group signals |
| Secret redaction | Backend (inline in PTY pipeline) | — | Redact before any persistence or forwarding; browser must not see secrets |
| Chat UI shell | Browser (React) | — | Three-column layout, MessageCard, ChatInput |
| Process-group orphan scan | Backend (CLI: doctor --reap) | — | Reads `~/.agenstrix/running.json`; cross-references live PIDs |

---

## Standard Stack

### Core (Backend)

| Library | Version | Purpose | Source |
|---------|---------|---------|--------|
| `bun` runtime | `1.3.14` (MUST upgrade from 1.3.12) | Runtime + PTY + SQLite + HTTP/WS | [VERIFIED: bun.com/blog/bun-v1.3.14] |
| `hono` | `^4.12.19` | HTTP + WS + SSE gateway | [VERIFIED: npm registry] |
| `drizzle-orm` | `^0.45.2` | ORM + type-safe queries | [VERIFIED: npm registry] |
| `drizzle-kit` | `^0.31.10` | Migration codegen only | [VERIFIED: npm registry] |
| `bun:sqlite` | bundled | SQLite driver | [VERIFIED: Bun docs] |
| `Bun.Terminal` | bundled in 1.3.14 | PTY spawn (primary) | [VERIFIED: bun.com/reference/bun/Terminal] |
| `bun-pty` | `^0.4.8` | PTY fallback behind PtyHandle interface | [VERIFIED: npm registry; package age 2025-05-14, source: github.com/sursaone/bun-pty] |
| `pino` | `^10.3.1` | Structured logging | [VERIFIED: npm registry] |
| `simple-git` | `^3.36.0` | Git read-only ops (index.lock scanner) | [VERIFIED: npm registry] |
| `nanoid` | `^5.1.11` | IDs for workers/events/chunks | [VERIFIED: npm registry; created 2017] |
| `get-port` | `^7.2.0` | Port availability probe in doctor | [VERIFIED: npm registry] |
| `zod` | `^4.4.3` | Route validation, WS message schemas | [VERIFIED: npm registry] |
| `@hono/zod-validator` | `^0.8.0` | Hono route body validation | [VERIFIED: npm registry] |

### Core (Frontend)

| Library | Version | Purpose | Source |
|---------|---------|---------|--------|
| `react` + `react-dom` | `^19.2.6` | UI framework | [VERIFIED: npm registry] |
| `vite` | `^8.0.13` | Dev server + build | [VERIFIED: npm registry] |
| `@vitejs/plugin-react` | latest | React plugin for Vite | [ASSUMED] |
| `tailwindcss` | `^4.3.0` | Styling (CSS-first, no JS config) | [VERIFIED: npm registry] |
| `@tailwindcss/vite` | `^4.3.0` | Vite plugin for Tailwind v4 | [VERIFIED: npm registry] |
| `shadcn/ui` (CLI) | `npx shadcn@latest` | Accessible primitives | [VERIFIED: ui.shadcn.com] |
| `tw-animate-css` | `^1.4.0` | Animations for shadcn v4 (NOT tailwindcss-animate) | [VERIFIED: npm registry] |
| `@xterm/xterm` | `^6.0.0` | PTY terminal renderer | [VERIFIED: npm registry] |
| `@xterm/addon-fit` | `^0.11.0` | Resize to container | [VERIFIED: npm registry] |
| `@xterm/addon-webgl` | `^0.19.0` | WebGL renderer (perf) | [VERIFIED: npm registry] |
| `@xterm/addon-canvas` | `^0.7.0` | Canvas fallback renderer | [VERIFIED: npm registry] |
| `@xterm/addon-unicode11` | `^0.9.0` | CJK wide-char (zh-CN default) | [VERIFIED: npm registry] |
| `@xterm/addon-serialize` | `^0.14.0` | Serialize scrollback (future replay) | [VERIFIED: npm registry] |
| `@xterm/addon-web-links` | `^0.12.0` | Click URLs in terminal | [VERIFIED: npm registry] |
| `@xterm/addon-search` | `^0.16.0` | In-terminal search | [VERIFIED: npm registry] |
| `@xterm/addon-clipboard` | `^0.2.0` | OSC-52 clipboard | [VERIFIED: npm registry] |
| `@assistant-ui/react` | `^0.14.5` | Chat composer primitives | [VERIFIED: npm registry] |
| `zustand` | `^5.0.13` | Client state (worker list, UI mode) | [VERIFIED: npm registry] |
| `@tanstack/react-query` | `^5.100.10` | Server-state cache for REST queries | [VERIFIED: npm registry] |
| `lucide-react` | `^0.500.x` | Icons (shadcn default) | [ASSUMED — latest] |
| `clsx` + `tailwind-merge` + `class-variance-authority` | shadcn-installed | className utilities | [ASSUMED — shadcn CLI installs] |

### Dev Tools

| Tool | Version | Purpose |
|------|---------|---------|
| `@biomejs/biome` | `^2.4.15` | Lint + format (no ESLint, no Prettier) |
| `typescript` | `^5.9` | Type system |
| `bun-types` | latest | Bun type definitions |

### NEVER install

- `node-pty` — NAN crashes under Bun NAPI [VERIFIED: microsoft/node-pty#644]
- `better-sqlite3` — native module, won't bundle into `bun --compile`
- `tailwindcss-animate` — v3-only, breaks Tailwind v4
- `tailwind.config.js` — v4 is CSS-first, JS config is dead
- unscoped `xterm` package — 5.x dead-end
- `drizzle-orm@1.0.0-rc.x` — RC still shipping breaking patches weekly

**Installation:**
```bash
# Backend
bun add hono @hono/zod-validator zod \
        drizzle-orm@^0.45.2 \
        pino simple-git nanoid get-port bun-pty

# Frontend
bun add react react-dom \
        @xterm/xterm @xterm/addon-fit @xterm/addon-webgl @xterm/addon-canvas \
        @xterm/addon-unicode11 @xterm/addon-serialize @xterm/addon-web-links \
        @xterm/addon-search @xterm/addon-clipboard \
        @assistant-ui/react \
        zustand @tanstack/react-query \
        lucide-react class-variance-authority clsx tailwind-merge tw-animate-css

# Dev
bun add -d typescript bun-types @types/react @types/react-dom \
           vite @vitejs/plugin-react \
           tailwindcss @tailwindcss/vite \
           drizzle-kit@^0.31.10 \
           @biomejs/biome

# shadcn after Tailwind+Vite configured
bunx shadcn@latest init
```

---

## Package Legitimacy Audit

> slopcheck was unavailable at research time. All packages below are tagged [ASSUMED] per degradation policy unless verified via official docs or Context7.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `hono` | npm | 3+ yrs | 10M+/wk | github.com/honojs/hono | N/A | Approved [VERIFIED: official docs] |
| `drizzle-orm` | npm | 3+ yrs | 3M+/wk | github.com/drizzle-team/drizzle-orm | N/A | Approved [VERIFIED: npm, docs] |
| `@xterm/xterm` | npm | 6+ yrs | 4M+/wk | github.com/xtermjs/xterm.js | N/A | Approved [VERIFIED: xtermjs.org] |
| `bun-pty` | npm | ~1 yr (2025-05-14) | Low | github.com/sursaone/bun-pty | N/A | Flagged [ASSUMED] — planner must add checkpoint:human-verify before install |
| `pino` | npm | 8+ yrs | 20M+/wk | github.com/pinojs/pino | N/A | Approved [VERIFIED] |
| `nanoid` | npm | 8+ yrs (2017) | 50M+/wk | github.com/ai/nanoid | N/A | Approved [VERIFIED] |
| `simple-git` | npm | 10+ yrs | 10M+/wk | github.com/steveukx/git-js | N/A | Approved [VERIFIED] |
| `get-port` | npm | 8+ yrs | 10M+/wk | github.com/sindresorhus/get-port | N/A | Approved [VERIFIED] |
| `@assistant-ui/react` | npm | ~1 yr | Medium | github.com/assistant-ui/assistant-ui | N/A | Flagged [ASSUMED] — pre-1.0, pin exact; planner add checkpoint:human-verify |
| `zod` | npm | 4+ yrs | 70M+/wk | github.com/colinhacks/zod | N/A | Approved [VERIFIED] |
| `zustand` | npm | 5+ yrs | 10M+/wk | github.com/pmndrs/zustand | N/A | Approved [VERIFIED] |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS] or [ASSUMED]:** `bun-pty` (age ~1yr, lower download count but confirmed: active GitHub, 20+ releases, legitimate FFI over Rust portable-pty), `@assistant-ui/react` (pre-1.0, small but legitimate)

*All packages marked [ASSUMED] require planner to add checkpoint:human-verify before install in the plan.*

---

## Architecture Patterns

### System Architecture Diagram

```
Browser (React 19 + Vite)
  ┌────────────────────────────────────────────────────────────┐
  │  Left Sidebar  │  Center: MessageCard + ChatInput  │ Right │
  │  (placeholder) │  ┌────────────────────────────┐   │ Side  │
  │                │  │ MessageCard (Master Claude) │   │ bar   │
  │                │  │  ┌──────────────────────┐  │   │(plch) │
  │                │  │  │ xterm.js renderer    │  │   │       │
  │                │  │  │ (PTY byte stream)    │  │   │       │
  │                │  │  └──────────────────────┘  │   │       │
  │                │  └────────────────────────────┘   │       │
  │                │  ChatInput (→ WS on Enter)         │       │
  └────────────────────────────────────────────────────────────┘
        │ REST GET /api/workers/:id/chunks        │
        │ WS  /ws/worker/:id  (binary, PTY bytes) │
        │ SSE /sse/events     (system events)     │
        ▼                                         ▼
Bun Process (single, localhost:3000)
  ┌──────────────────────────────────────────────────────────┐
  │  CLI Entry (src-bun/cli.ts)                              │
  │    └─ doctor() → self-test; start() → boot sequence      │
  │                                                           │
  │  HTTP/WS/SSE Gateway (Hono + hono/bun adapter)           │
  │    ├─ POST /api/workers/:id/input  (stdin inject)        │
  │    ├─ GET  /api/workers/:id/chunks (history replay REST) │
  │    ├─ WS   /ws/worker/:id          (live PTY stream)     │
  │    └─ SSE  /sse/events             (system events)       │
  │                                                           │
  │  EventBus (in-memory pub/sub)                            │
  │    ├─ Subscriber: SQLite event sink (events table)       │
  │    ├─ Subscriber: WS broadcaster (per-worker room)       │
  │    └─ Subscriber: SSE broadcaster (system events)        │
  │                                                           │
  │  PtyManager (src-bun/pty/)                               │
  │    ├─ PtyHandle interface {write, resize, kill, onData}  │
  │    ├─ BunTerminalBackend (Bun.Terminal primary)          │
  │    ├─ BunPtyBackend (bun-pty fallback, behind same iface)│
  │    ├─ ChunkBatcher (ANSI-safe, ~100KB or 250ms flush)    │
  │    └─ SecretRedactor (before SQLite AND before WS)       │
  │                                                           │
  │  WorkerSupervisor (src-bun/worker/) — minimal Phase 1    │
  │    ├─ spawn(spec) → PtyManager.spawn()                   │
  │    ├─ kill(id) → SIGTERM → 5s → SIGKILL (process group) │
  │    └─ state machine: idle→running→exited                 │
  │                                                           │
  │  DB Layer (src-bun/db/)                                  │
  │    ├─ Drizzle schema (11 tables)                         │
  │    ├─ Migration runner (boot-time)                        │
  │    ├─ Pre-migrate backup to ~/.agenstrix/backups/        │
  │    └─ WAL PRAGMAs + 5-min checkpoint ticker             │
  │                                                           │
  │  System (src-bun/system/)                                │
  │    ├─ selfTest() → which claude/git/SQLite/port          │
  │    ├─ doctorReap() → scan ~/.agenstrix/running.json      │
  │    └─ openBrowser() → platform-specific                  │
  └──────────────────────────────────────────────────────────┘
        │ Bun.Terminal (PTY)    │ Bun.spawn (detached)
        ▼                       ▼
  real `claude` process     (Phase 1: none; Phase 3+: chrome-devtools-mcp)
  (pgid = claude.pid, detached: true)
```

### Recommended Project Structure

```
/
├── src-bun/                     # Bun backend
│   ├── main.ts                  # Entry: boots DB, starts Hono, auto-spawns claude
│   ├── cli.ts                   # CLI parser: start / doctor --reap / --port N
│   ├── db/
│   │   ├── index.ts             # Drizzle singleton + runMigrations()
│   │   ├── schema.ts            # All 11 tables (Drizzle table definitions)
│   │   └── repos/               # workersRepo, ptyChunksRepo, eventsRepo, ...
│   ├── bus/
│   │   └── index.ts             # EventBus pub/sub (in-memory)
│   ├── pty/
│   │   ├── handle.ts            # PtyHandle interface + factory (BunTerminal or bun-pty)
│   │   ├── bun-terminal.ts      # Bun.Terminal implementation
│   │   ├── bun-pty.ts           # bun-pty FFI implementation (fallback)
│   │   ├── batcher.ts           # ChunkBatcher (ANSI-safe, 100KB/250ms)
│   │   └── redactor.ts          # Secret regex redactor
│   ├── worker/
│   │   ├── index.ts             # WorkerSupervisor (Phase 1 minimal: no-worktree only)
│   │   └── cwd.ts               # CwdResolver helper (realpath + git env scrub)
│   ├── gateway/
│   │   ├── index.ts             # Hono app assembly
│   │   ├── ws.ts                # WS routes (/ws/worker/:id)
│   │   ├── sse.ts               # SSE routes (/sse/events)
│   │   └── rest.ts              # REST routes (/api/*)
│   └── system/
│       ├── selftest.ts          # which claude/git, SQLite r/w, port probe
│       ├── doctor.ts            # --reap orphan scanner
│       └── browser.ts           # open/xdg-open/start
├── src-react/                   # Vite-served UI
│   ├── index.html
│   ├── index.css                # Tailwind v4 @import + @theme block (OKLCH tokens)
│   ├── main.tsx
│   ├── App.tsx                  # Three-column shell + workspace bar
│   ├── components/
│   │   ├── ui/                  # shadcn CLI-generated primitives
│   │   ├── MessageCard.tsx      # Master/Worker card (xterm embedded + fullscreen btn)
│   │   ├── WorkerTerminal.tsx   # xterm.js init + WS bridge + replay logic
│   │   ├── ChatInput.tsx        # Input → PTY stdin via WS
│   │   ├── WorkspaceBar.tsx     # Top bar (placeholder: shows cwd string only)
│   │   ├── SelfTestBanner.tsx   # Red banner for degraded-start failures
│   │   └── SelfTestDialog.tsx   # Fix instructions dialog
│   └── lib/
│       ├── store.ts             # Zustand stores
│       └── utils.ts             # shadcn cn() + clsx
├── drizzle/                     # Migration SQL files (generated, committed)
├── drizzle.config.ts
├── vite.config.ts
├── tsconfig.json
├── biome.json
├── package.json
└── bun.lock                     # Binary lockfile — COMMIT this
```

---

## Pattern 1: Bun.Terminal API Surface (Phase 1 Exact Usage)

**What:** `Bun.Terminal` is a PTY pseudo-terminal. Create it, attach it to `Bun.spawn`, receive bytes via `data` callback. [VERIFIED: bun.com/reference/bun/Terminal + bun.com/blog/bun-v1.3.14]

```typescript
// src-bun/pty/bun-terminal.ts
import type { PtyHandle } from "./handle";

export function createBunTerminalPty(opts: {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  onData: (chunk: Uint8Array) => void;
  onExit: (code: number) => void;
}): PtyHandle {
  const terminal = new Bun.Terminal({
    cols: opts.cols,
    rows: opts.rows,
    data(_term, chunk: Uint8Array) {
      opts.onData(chunk);
    },
  });

  const proc = Bun.spawn(opts.argv, {
    cwd: opts.cwd,
    env: opts.env,
    terminal,               // <-- PTY attach; makes isTTY=true for claude
    // DO NOT set stdin/stdout/stderr to "pipe" when using terminal —
    // the terminal option takes over stdio routing
  });

  // POSIX: proc.pid IS the new pgid because detached: true calls setsid()
  // Store pgid = proc.pid for group kill
  const pgid = proc.pid;

  void proc.exited.then((code) => opts.onExit(code ?? 0));

  return {
    pid: proc.pid,
    pgid,
    write: (data: string) => terminal.write(data),
    resize: (cols, rows) => terminal.resize(cols, rows),
    kill: (sig: "SIGTERM" | "SIGKILL") => {
      // KILL THE GROUP, not the PID
      try {
        process.kill(-pgid, sig === "SIGKILL" ? 9 : 15);
      } catch {
        // Process already dead — ignore ESRCH
      }
    },
    exited: proc.exited,
  };
}
```

**Critical note:** `Bun.spawn` with `terminal:` option does NOT need `stdin: "pipe"`. The terminal option replaces stdin/stdout/stderr routing. Specifying both causes unexpected behavior.

**Note on `detached: true`:** In the STACK.md research pattern, `detached: true` is used. However, the Bun docs + STACK.md code snippet does NOT show `detached: true` in the terminal-attach pattern. The behavior of `setsid` when `terminal` is used needs verification: if Bun.Terminal already calls `setsid` internally (likely, since it creates a new session for PTY), then `detached: true` may be redundant. **Recommendation:** add `detached: true` explicitly to be safe and write a unit test asserting `getpgid(pid) === pid` after spawn on POSIX. [ASSUMED — needs smoke test in Phase 1 CI]

---

## Pattern 2: PtyHandle Interface (Swap Point for bun-pty Fallback)

```typescript
// src-bun/pty/handle.ts
export interface PtyHandle {
  pid: number;
  pgid: number;          // POSIX: process group ID; Windows: same as pid (ConPTY manages group)
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
  exited: Promise<number | null>;
}

// Factory: check env/flag to choose backend
export function createPty(opts: PtySpawnOpts): PtyHandle {
  const useFallback = process.env.AGENSTRIX_PTY_BACKEND === "bun-pty"
    || process.platform === "win32"; // optionally force bun-pty on Windows if ConPTY issues
  return useFallback
    ? createBunPtyFallback(opts)
    : createBunTerminalPty(opts);
}
```

**bun-pty fallback import (Phase 1, keep dormant until needed):**

```typescript
// src-bun/pty/bun-pty.ts — static import required (bun --compile cannot dynamic-require)
import { spawn as bunPtySpawn } from "bun-pty";
```

`bun-pty` exposes `spawn(argv, { cols, rows, cwd, env })` returning `{ pid, write, resize, kill, on("data", cb), on("exit", cb) }`. [ASSUMED — based on bun-pty README; verify against actual package before wiring]

---

## Pattern 3: ANSI Splitter State Machine (ANSI-SPLITTER-01)

The xterm.js client handles split escape sequences correctly — forward raw bytes to WS immediately without waiting. The splitter is needed only for SQLite persistence atomicity.

**State machine (Paul Williams VT500-series parser, simplified for chunking):**

```typescript
// src-bun/pty/batcher.ts
const enum AnsiState {
  GROUND,
  ESC,                 // received 0x1B, waiting for next byte
  CSI_PARAM,           // received ESC [ — reading params (0x30–0x3F)
  CSI_INTERM,          // reading intermediates (0x20–0x2F)
  OSC_STRING,          // received ESC ] — reading until BEL (0x07) or ESC \
  DCS_STRING,          // received ESC P
  PM_STRING,           // received ESC ^
  APC_STRING,          // received ESC _
  SOS_STRING,          // received ESC X
  STRING_ST,           // received ESC inside string — waiting for \ to complete ST
}

export class AnsiChunkBatcher {
  private state = AnsiState.GROUND;
  private tail: Uint8Array[] = [];     // incomplete escape sequence fragments
  private flushBuffer: Uint8Array[] = [];
  private bytesSinceFlush = 0;
  private lastFlush = Date.now();

  // Returns chunk to persist (null if sequence incomplete and below threshold)
  ingest(chunk: Uint8Array, forceFlush = false): Uint8Array | null {
    // 1. Feed to WS IMMEDIATELY (caller does this before calling ingest)
    // 2. Walk bytes, track ANSI state, find sequence-safe boundary
    // 3. Accumulate; flush when: bytes >= 100KB, OR 250ms elapsed, OR sequence complete at boundary
    // 4. Never cut in the middle of an incomplete escape sequence
    //    (tail bytes carried to next ingest() call)
    ...
  }
}
```

**Sequence boundary rules:**
- CSI: starts `ESC [` (0x1B 0x5B), ends on final byte in range 0x40–0x7E (letters: A-Z, a-z except the CSI introducer bytes). The final byte terminates the sequence.
- OSC: starts `ESC ]`, ends on `BEL` (0x07) or `ESC \` (String Terminator).
- DCS/PM/APC/SOS: like OSC but different intro byte; all end on `ESC \`.
- 7-bit C1: `ESC` followed by 0x40–0x5F (simple two-byte sequences).

**The key invariant:** When the batcher reaches a flush point (100KB or 250ms) and the ANSI state is NOT GROUND, carry the tail bytes forward. Only flush when state returns to GROUND (or on forced shutdown flush).

**Windows ConPTY note:** ConPTY may re-encode sequences (semantically equivalent but not byte-identical). Do NOT byte-diff round-trips when comparing chunks stored on Windows vs POSIX. Store and replay the re-encoded bytes as-is.

---

## Pattern 4: WebSocket Bridge (PTY ↔ xterm.js)

**Server side (Hono on Bun — MUST use `hono/bun`):**

```typescript
// src-bun/gateway/ws.ts
import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "hono/bun";

const app = new Hono();

app.get("/ws/worker/:id",
  upgradeWebSocket((c) => {
    const workerId = c.req.param("id");
    let unsubscribe: (() => void) | null = null;

    return {
      onOpen(_evt, ws) {
        // Pipe PTY output → WS (binary)
        unsubscribe = bus.subscribe(`worker.output.${workerId}`, (chunk: Uint8Array) => {
          ws.send(chunk);  // binary frame
        });

        // Send heartbeat every 30s (WS-1011-01)
        const heartbeat = setInterval(() => {
          try { ws.send(new Uint8Array(0)); } catch { clearInterval(heartbeat); }
        }, 30_000);
      },
      onMessage(evt, _ws) {
        const data = evt.data;
        if (data instanceof ArrayBuffer) {
          // Raw keystrokes → PTY stdin
          const text = new TextDecoder().decode(data);
          workerSupervisor.send(workerId, text);
        } else if (typeof data === "string") {
          // Control messages: resize, ping
          try {
            const msg = JSON.parse(data);
            if (msg.type === "resize") {
              workerSupervisor.resize(workerId, msg.cols, msg.rows);
            }
          } catch { /* ignore malformed */ }
        }
      },
      onClose(_evt, _ws) {
        unsubscribe?.();
        // WS-1011-01: 1011 = server abnormal close
        // Do NOT kill the PTY — browser disconnect ≠ session end
      },
    };
  })
);

// CRITICAL: must export the websocket handler for Bun's serve()
export { app, websocket };
```

**Client side (React `WorkerTerminal.tsx`):**

```tsx
// src-react/components/WorkerTerminal.tsx
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { CanvasAddon } from "@xterm/addon-canvas";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";

export function WorkerTerminal({ workerId, lastChunkSeq }: Props) {
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!divRef.current) return;
    // MUST: container must be visible (not display:none) before term.open()
    // MUST: allowProposedApi: true for Unicode11

    const term = new Terminal({
      fontFamily: 'ui-monospace, "JetBrains Mono", "Cascadia Code", monospace',
      fontSize: 13,
      convertEol: false,      // PTY is authoritative — no EOL transforms
      cursorBlink: true,
      allowProposedApi: true, // required for Unicode11Addon
      scrollback: 100_000,    // D-07 + D-08: WeChat-style full history
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11"; // activate after loading addon
    term.loadAddon(new WebLinksAddon());

    // WebGL with canvas fallback
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      try { term.loadAddon(new CanvasAddon()); } catch { /* DOM2D fallback */ }
    }

    term.open(divRef.current);
    fit.fit();

    // --- History replay (D-07): HTTP REST one-shot ---
    let wsReady = false;
    const pendingLive: Uint8Array[] = [];

    const ws = new WebSocket(`/ws/worker/${workerId}`);
    ws.binaryType = "arraybuffer";

    ws.onmessage = (e) => {
      const chunk = new Uint8Array(e.data as ArrayBuffer);
      if (chunk.length === 0) return; // heartbeat null frame
      if (!wsReady) {
        pendingLive.push(chunk);
        return;
      }
      term.write(chunk);
    };

    // Fetch history AFTER WS is open to avoid gap
    ws.onopen = async () => {
      const resp = await fetch(`/api/workers/${workerId}/chunks`);
      const chunks: { bytes: string }[] = await resp.json();
      for (const c of chunks) {
        // chunks stored as base64 BLOB
        term.write(Uint8Array.from(atob(c.bytes), (ch) => ch.charCodeAt(0)));
      }
      // Flush any live chunks buffered during history load
      for (const chunk of pendingLive) term.write(chunk);
      pendingLive.length = 0;
      wsReady = true;
    };

    // Keystroke injection
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    // Resize
    const ro = new ResizeObserver(() => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    });
    ro.observe(divRef.current);

    return () => {
      ws.close(1000); // normal closure from client
      term.dispose();
      ro.disconnect();
    };
  }, [workerId]);

  return <div ref={divRef} style={{ width: "100%", height: "100%" }} />;
}
```

**WS-1011-01 compliance:** Server sends close code 1011 for abnormal closure (e.g., PTY crashed). Client-initiated normal close uses 1000. The PTY session outlives browser disconnects.

---

## Pattern 5: SQLite Schema (Drizzle, Phase 1)

Build all 11 tables in Phase 1 with a single migration. [VERIFIED pattern: drizzle-orm/bun-sqlite]

```typescript
// src-bun/db/schema.ts
import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workers = sqliteTable("workers", {
  id: text("id").primaryKey(),               // nanoid 21-char
  cli: text("cli").notNull(),                // 'claude' | 'codex'
  cwd: text("cwd").notNull(),
  pid: integer("pid"),
  pgid: integer("pgid"),
  state: text("state").notNull().default("idle"), // idle | running | exited | killed
  envMode: text("env_mode").notNull().default("no-worktree"),
  createdAt: integer("created_at").notNull(), // unix ms
  exitedAt: integer("exited_at"),
  exitCode: integer("exit_code"),
});

export const ptyChunks = sqliteTable("pty_chunks", {
  id: text("id").primaryKey(),
  workerId: text("worker_id").notNull().references(() => workers.id),
  ts: integer("ts").notNull(),              // unix ms
  seq: integer("seq").notNull(),            // monotonic per worker
  bytes: blob("bytes", { mode: "buffer" }).notNull(), // raw PTY bytes (redacted)
});

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  workerId: text("worker_id").references(() => workers.id),
  ts: integer("ts").notNull(),
  type: text("type").notNull(),             // 'worker.spawned' | 'worker.killed' | ...
  payload: text("payload"),                 // JSON
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  workerId: text("worker_id").references(() => workers.id),
  ts: integer("ts").notNull(),
  role: text("role").notNull(),             // 'user' | 'assistant'
  content: text("content").notNull(),
});

// Phase 1 placeholder tables (create now, populate Phase 2+)
export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  path: text("path").notNull(),
  name: text("name"),
  createdAt: integer("created_at").notNull(),
});

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").references(() => workspaces.id),
  createdAt: integer("created_at").notNull(),
});

export const repos = sqliteTable("repos", { id: text("id").primaryKey(), path: text("path").notNull() });
export const services = sqliteTable("services", { id: text("id").primaryKey(), name: text("name").notNull(), state: text("state").notNull() });
export const skills = sqliteTable("skills", { id: text("id").primaryKey(), name: text("name").notNull(), content: text("content").notNull() });
export const templates = sqliteTable("templates", { id: text("id").primaryKey(), name: text("name").notNull(), content: text("content").notNull() });
export const learnedCommands = sqliteTable("learned_commands", { id: text("id").primaryKey(), repoId: text("repo_id"), cmd: text("cmd").notNull() });
```

**Drizzle config:**
```typescript
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "sqlite",
  driver: "bun-sqlite",
  schema: "./src-bun/db/schema.ts",
  out: "./drizzle",
  casing: "snake_case",  // TS = camelCase, SQL = snake_case
});
```

**Boot sequence for DB (DB-DURABILITY-01):**
```typescript
// src-bun/db/index.ts
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import * as schema from "./schema";

const AGENSTRIX_HOME = join(process.env.HOME!, ".agenstrix");
const DB_PATH = join(AGENSTRIX_HOME, "store.db");
const BACKUP_DIR = join(AGENSTRIX_HOME, "backups");
const BACKUP_KEEP = 10;

function backupBeforeMigrate() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  if (!existsSync(DB_PATH)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(BACKUP_DIR, `store-${stamp}.db`);
  copyFileSync(DB_PATH, dest);

  // Rotate: keep only last BACKUP_KEEP files
  const backups = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("store-") && f.endsWith(".db"))
    .sort();
  while (backups.length > BACKUP_KEEP) {
    unlinkSync(join(BACKUP_DIR, backups.shift()!));
  }
}

export function initDb() {
  mkdirSync(AGENSTRIX_HOME, { recursive: true });
  backupBeforeMigrate();

  const sqlite = new Database(DB_PATH, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA synchronous = NORMAL;");  // NORMAL: safe with WAL, much faster than FULL
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA journal_size_limit = 67108864;"); // 64MB WAL cap

  const db = drizzle(sqlite, { schema });

  // NEVER use drizzle-kit push in production
  // migrate() is async even though bun:sqlite is sync internally
  void migrate(db, { migrationsFolder: "./drizzle" });

  // WAL checkpoint ticker every 5 minutes
  setInterval(() => {
    sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  }, 5 * 60 * 1000);

  return db;
}
```

**Indexes to add in migration SQL (after `bunx drizzle-kit generate`):**
```sql
CREATE INDEX IF NOT EXISTS idx_pty_chunks_worker_seq ON pty_chunks(worker_id, seq);
CREATE INDEX IF NOT EXISTS idx_events_worker_ts ON events(worker_id, ts);
```

---

## Pattern 6: Kill-Group Invariant (KILL-01)

**POSIX:**
```typescript
// src-bun/worker/index.ts
async function killWorker(id: string, graceful = true) {
  const w = workers.get(id);
  if (!w) return;

  if (graceful) {
    w.pty.kill("SIGTERM");
    const timeout = setTimeout(() => {
      // 5s grace window: time for claude to finish its current line + flush context
      w.pty.kill("SIGKILL");
    }, 5_000);

    try {
      await w.pty.exited;
      clearTimeout(timeout);
    } catch {
      clearTimeout(timeout);
      w.pty.kill("SIGKILL");
    }
  } else {
    w.pty.kill("SIGKILL");
    await w.pty.exited;
  }

  // Emit event AFTER confirmed dead
  await eventsRepo.append({ workerId: id, type: "worker.killed", payload: {} });
  workers.delete(id);
}
```

**Windows:** ConPTY cascades kill to PTY children automatically via `ClosePseudoConsole`. The `process.kill(-pgid, sig)` negative-pid syntax is POSIX only. On Windows, `process.kill(pid)` terminates the ConPTY pseudo-console, which cascades. The `PtyHandle.kill()` implementation must branch on `process.platform`.

**`running.json` persistence (for doctor --reap):**
```typescript
// Write on spawn, delete on confirmed exit
const RUNNING_FILE = join(AGENSTRIX_HOME, "running.json");

function recordPid(workerId: string, pid: number, pgid: number) {
  const existing = readRunningFile();
  existing[workerId] = { pid, pgid, startedAt: Date.now() };
  writeRunningFile(existing);
}

function clearPid(workerId: string) {
  const existing = readRunningFile();
  delete existing[workerId];
  writeRunningFile(existing);
}
```

**`agenstrix doctor --reap` logic:**
```typescript
async function reap() {
  const running = readRunningFile();
  const orphans: string[] = [];
  for (const [workerId, { pid, pgid }] of Object.entries(running)) {
    if (isProcessAlive(pid)) {
      orphans.push(`Worker ${workerId} (PID ${pid})`);
    } else {
      clearPid(workerId);
    }
  }
  if (orphans.length === 0) {
    console.log("No orphan processes found.");
    return;
  }
  console.log("Found orphan processes:", orphans.join(", "));
  // Interactive prompt — ask user before killing
  // Use Bun.stdin or readline for yes/no
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
```

---

## Pattern 7: Secret Redactor (SEC-01)

Placement: immediately after receiving bytes from PTY `onData` callback, BEFORE forwarding to WS and BEFORE calling ChunkBatcher for SQLite. Apply to the same bytes in one pass.

```typescript
// src-bun/pty/redactor.ts
const PATTERNS: Array<{ regex: RegExp; label: string }> = [
  { regex: /sk-ant-[A-Za-z0-9_-]{20,}/g,      label: "ANTHROPIC-KEY" },
  { regex: /ghp_[A-Za-z0-9]{36}/g,             label: "GITHUB-TOKEN" },
  { regex: /sk-[A-Za-z0-9]{40,}/g,             label: "OPENAI-KEY" },
  { regex: /AKIA[0-9A-Z]{16}/g,                label: "AWS-ACCESS-KEY" },
  { regex: /[A-Za-z0-9+/]{40,}={0,2}/g,        label: "UNKNOWN-SECRET" }, // broad — only with context
];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function redactChunk(chunk: Uint8Array): Uint8Array {
  // Fast-path: if no ESC or no capital letters, skip regex scan
  // (most PTY chunks are pure terminal output, not API keys)
  let str = decoder.decode(chunk);
  let redacted = false;
  for (const { regex, label } of PATTERNS) {
    const next = str.replace(regex, `[REDACTED-${label}]`);
    if (next !== str) { str = next; redacted = true; }
  }
  return redacted ? encoder.encode(str) : chunk;
}
```

**Performance note:** Regex scanning on PTY chunks at 8 workers × 100KB/s = ~800KB/s. Four targeted regexes on UTF-8 decoded string is < 1ms per 100KB chunk. The broad `[A-Za-z0-9+/]{40,}` pattern could cause false positives; apply only when surrounding context (e.g., the word "key", "token", "secret" appears within 20 bytes). [ASSUMED — needs benchmark confirmation]

**Env allowlist enforcement (spawn-time):**
```typescript
const ALLOWED_ENV_KEYS = ["PATH", "HOME", "USER", "LANG", "SHELL", "TERM"];

function buildSpawnEnv(allowlist: string[] = []): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of [...ALLOWED_ENV_KEYS, ...allowlist]) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  // GIT isolation (WORKTREE-CWD-01)
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}
```

---

## Pattern 8: CWD Resolver Helper (WORKTREE-CWD-01)

Phase 1 uses `process.cwd()` directly. The helper is scaffolded here so Phase 2/3 can swap the implementation.

```typescript
// src-bun/worker/cwd.ts
import { realpath } from "node:fs/promises";
import { execSync } from "node:child_process";

export interface CwdOptions {
  requestedPath?: string;   // Phase 2+: workspace-selected path
  workerId?: string;        // Phase 2+: resolves to worktree path
}

export async function resolveCwd(opts: CwdOptions = {}): Promise<string> {
  // Phase 1: always use startup cwd
  const raw = opts.requestedPath ?? process.cwd();

  // Resolve symlinks — critical for git worktree CWD verification
  const resolved = await realpath(raw);

  // Windows: convert to short path name for non-ASCII paths
  // (avoids MAX_PATH issues in ConPTY + old CMD)
  if (process.platform === "win32" && /[^\x00-\x7F]/.test(resolved)) {
    return getWindowsShortPath(resolved);
  }

  return resolved;
}

function getWindowsShortPath(longPath: string): string {
  // Uses kernel32.dll GetShortPathNameW via Bun FFI
  // Pattern from golutra: wrap in a small winShortPath() helper
  // ASSUMED: exact FFI signature needs verification during Windows CI smoke test
  try {
    // Fallback: try using cmd /c "for %i in (path) do echo %~si"
    const result = execSync(`cmd /c for %i in ("${longPath}") do echo %~si`, {
      encoding: "utf8",
    }).trim();
    return result || longPath;
  } catch {
    return longPath; // Best-effort; log warning
  }
}
```

**WORKTREE-CWD-01 git env scrub:** Already applied in `buildSpawnEnv()` above (deletes GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE).

---

## Pattern 9: Git Index.lock Scanner Foundation (GIT-01)

Phase 1 scaffolds the scanner even though no worktrees are created yet.

```typescript
// src-bun/system/selftest.ts (partial)
import { stat } from "node:fs/promises";
import { join } from "node:path";

async function scanGitLocks(repoPaths: string[]): Promise<string[]> {
  const stale: string[] = [];
  const STALE_AGE_MS = 5 * 60 * 1000; // 5 minutes

  for (const repoPath of repoPaths) {
    const lockPath = join(repoPath, ".git", "index.lock");
    try {
      const s = await stat(lockPath);
      const ageMs = Date.now() - s.mtimeMs;
      if (ageMs > STALE_AGE_MS) {
        stale.push(lockPath);
      }
    } catch {
      // Lock file doesn't exist — good
    }
  }
  return stale;
}

// Phase 1: repoPaths = [process.cwd()] if it's a git repo
// Phase 2+: repoPaths = all registered repos from workspaces table
```

`simple-git` is used for read-only git ops (checking if cwd is a git repo, listing branches). Lockfile detection uses `fs.stat` directly — no need for simple-git here.

---

## Pattern 10: Self-Test / Doctor (SETUP-01 + INFRA-06)

```typescript
// src-bun/system/selftest.ts
import { which } from "bun";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";

export interface SelfTestResult {
  claudeFound: boolean;
  gitFound: boolean;
  sqliteWritable: boolean;
  portAvailable: boolean;
  criticalFailure: boolean;    // SQLite not writable → hard exit
  warnings: SelfTestWarning[];
}

export interface SelfTestWarning {
  item: string;
  message: string;
  fixMac: string;
  fixLinux: string;
  fixWindows: string;
}

export async function runSelfTest(port: number): Promise<SelfTestResult> {
  const warnings: SelfTestWarning[] = [];

  // Check claude
  const claudeBin = which("claude");
  const claudeFound = claudeBin !== null;
  if (!claudeFound) {
    warnings.push({
      item: "claude",
      message: "claude CLI not found in PATH",
      fixMac: "npm install -g @anthropic-ai/claude-code",
      fixLinux: "npm install -g @anthropic-ai/claude-code",
      fixWindows: "npm install -g @anthropic-ai/claude-code",
    });
  }

  // Check git
  const gitBin = which("git");
  const gitFound = gitBin !== null;
  if (!gitFound) {
    warnings.push({
      item: "git",
      message: "git not found in PATH",
      fixMac: "brew install git",
      fixLinux: "sudo apt-get install git",
      fixWindows: "winget install Git.Git",
    });
  }

  // Check SQLite writable (critical)
  const testPath = join(process.env.HOME!, ".agenstrix", "__selftest.db");
  let sqliteWritable = false;
  try {
    mkdirSync(join(process.env.HOME!, ".agenstrix"), { recursive: true });
    const db = new Database(testPath, { create: true });
    db.exec("CREATE TABLE IF NOT EXISTS t (v TEXT)");
    db.exec("INSERT INTO t VALUES ('ok')");
    db.close();
    unlinkSync(testPath);
    sqliteWritable = true;
  } catch (err) {
    // Critical — cannot store pty_chunks
  }

  // Check port
  let portAvailable = true;
  try {
    const server = Bun.serve({ port, fetch: () => new Response("ok") });
    server.stop();
  } catch {
    portAvailable = false;
    warnings.push({
      item: "port",
      message: `Port ${port} is already in use`,
      fixMac: `Use: bunx agenstrix --port <other-port>`,
      fixLinux: `Use: bunx agenstrix --port <other-port>`,
      fixWindows: `Use: bunx agenstrix --port <other-port>`,
    });
  }

  // D-14: port occupied = error + exit (not auto-find in Phase 1)
  if (!portAvailable) {
    console.error(`Port ${port} occupied. Use --port <N> to specify another.`);
    process.exit(1);
  }

  return {
    claudeFound,
    gitFound,
    sqliteWritable,
    portAvailable,
    criticalFailure: !sqliteWritable,  // D-12: hard exit
    warnings,
  };
}
```

**Bun version check (INFRA-06):**
```typescript
const MIN_BUN = [1, 3, 14];
const [major, minor, patch] = Bun.version.split(".").map(Number);
const bunOk = major > MIN_BUN[0] || (major === MIN_BUN[0] && minor > MIN_BUN[1]) ||
              (major === MIN_BUN[0] && minor === MIN_BUN[1] && patch >= MIN_BUN[2]);
if (!bunOk) {
  console.error(`Agenstrix requires Bun >= 1.3.14 (Bun.Terminal Windows ConPTY). Current: ${Bun.version}`);
  console.error("Upgrade: bun upgrade");
  process.exit(1);
}
```

---

## Pattern 11: Repo / File Scaffold (INFRA-02 through INFRA-07)

### Files to Create (greenfield — all new)

| File Path | Role | Template |
|-----------|------|----------|
| `package.json` | Bun scripts: `dev`, `build`, `type-check`, `lint` | See below |
| `tsconfig.json` | TS config (strict, bundler module) | Standard Bun TS config |
| `biome.json` | Lint + format config | Biome v2 defaults |
| `drizzle.config.ts` | Drizzle Kit config | Pattern 5 above |
| `vite.config.ts` | Vite + Tailwind v4 + proxy | Pattern from STACK.md §8 |
| `src-react/index.html` | Vite HTML entry | Standard |
| `src-react/index.css` | Tailwind v4 CSS-first (NO tailwind.config.js) | `@import "tailwindcss"; @import "tw-animate-css"; @theme {...}` |
| `src-react/main.tsx` | React 19 DOM render | `createRoot(document.getElementById("root")).render(<App />)` |
| `src-react/App.tsx` | Three-column shell | D-05 layout |
| `src-react/components/MessageCard.tsx` | Master/Worker card with embedded xterm | Core reusable component |
| `src-react/components/WorkerTerminal.tsx` | xterm.js + WS bridge | Pattern 4 above |
| `src-react/components/ChatInput.tsx` | Input → PTY stdin | Mirror golutra ChatInput.vue |
| `src-react/components/WorkspaceBar.tsx` | Top bar (Phase 1: cwd display only) | Placeholder |
| `src-react/components/SelfTestBanner.tsx` | Red degraded-start banner | D-10 |
| `src-react/components/SelfTestDialog.tsx` | Fix instructions dialog (shadcn Dialog) | D-11 |
| `src-bun/main.ts` | Boot: selftest → initDb → spawn claude → serve | Entry |
| `src-bun/cli.ts` | CLI parser (start / doctor / --port) | Bun.argv parsing |
| `src-bun/db/index.ts` | DB singleton + boot sequence | Pattern 5 above |
| `src-bun/db/schema.ts` | Drizzle schema (11 tables) | Pattern 5 above |
| `src-bun/bus/index.ts` | In-memory EventBus | Simple Map + AsyncIterable |
| `src-bun/pty/handle.ts` | PtyHandle interface + factory | Pattern 2 above |
| `src-bun/pty/bun-terminal.ts` | Bun.Terminal implementation | Pattern 1 above |
| `src-bun/pty/bun-pty.ts` | bun-pty fallback (dormant) | Static import only in Phase 1 |
| `src-bun/pty/batcher.ts` | ANSI-aware ChunkBatcher | Pattern 3 above |
| `src-bun/pty/redactor.ts` | Secret regex redactor | Pattern 7 above |
| `src-bun/worker/index.ts` | WorkerSupervisor (Phase 1: minimal) | Pattern 6 above |
| `src-bun/worker/cwd.ts` | CwdResolver helper | Pattern 8 above |
| `src-bun/gateway/index.ts` | Hono app assembly | STACK.md §6 |
| `src-bun/gateway/ws.ts` | WS routes | Pattern 4 above |
| `src-bun/gateway/sse.ts` | SSE routes | STACK.md §5 |
| `src-bun/gateway/rest.ts` | REST routes (chunks, events, workers) | Standard Hono |
| `src-bun/system/selftest.ts` | Self-test logic | Pattern 10 above |
| `src-bun/system/doctor.ts` | Orphan reaper | Pattern 6 (running.json) |
| `src-bun/system/browser.ts` | Platform browser opener | D-16 |
| `.github/workflows/ci.yml` | CI matrix (mac/linux/windows) | See INFRA-07 section |

### Files to Modify

None — greenfield project. Only `CLAUDE.md` exists.

### package.json scripts

```json
{
  "scripts": {
    "dev": "bun run --watch src-bun/main.ts & bunx vite",
    "dev:be": "bun run --watch src-bun/main.ts",
    "dev:fe": "bunx vite",
    "build": "bun build --compile --target=bun-darwin-arm64 src-bun/main.ts --outfile dist/agenstrix",
    "lint": "bunx @biomejs/biome check --apply .",
    "type-check": "tsc --noEmit",
    "test": "bun test",
    "db:generate": "bunx drizzle-kit generate",
    "db:studio": "bunx drizzle-kit studio"
  }
}
```

---

## Pattern 12: xterm.js v6 Client Setup

**Addon load order matters:**

1. Load `FitAddon` — no dependency
2. Load `Unicode11Addon` — requires `allowProposedApi: true` in Terminal constructor
3. Call `term.unicode.activeVersion = "11"` AFTER loading, BEFORE `term.open()`
4. Load `WebLinksAddon`
5. Try `WebglAddon` in try/catch
6. If WebGL fails, try `CanvasAddon` in try/catch
7. `term.open(divRef.current!)` — container MUST be visible (not `display: none`)
8. `fit.fit()` — after open, while container has measurable size

**Load `SerializeAddon` lazily** (only when history export is needed, not on init).
**Load `SearchAddon` lazily** (only when Cmd+K triggers terminal search, Phase 5).
**Load `ClipboardAddon`** as needed (can be eager — no side effects).

---

## Pattern 13: UI Shell + assistant-ui Coexistence

Phase 1 UI layout (D-05): three-column CSS grid shell.

```tsx
// src-react/App.tsx (skeleton)
<div className="flex h-screen overflow-hidden bg-background">
  {/* Left: session sidebar placeholder */}
  <aside className="w-64 shrink-0 border-r" />

  {/* Center: workspace bar + message list + chat input */}
  <main className="flex flex-1 flex-col overflow-hidden">
    <WorkspaceBar cwd={startupCwd} />

    {/* MessageCard stream — Phase 1: one Master card */}
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <MessageCard workerId={masterWorkerId} label="Master Claude" />
    </div>

    {/* ChatInput → PTY stdin */}
    <ChatInput onSend={(text) => sendToMaster(text + "\n")} />
  </main>

  {/* Right: members sidebar placeholder */}
  <aside className="w-64 shrink-0 border-l" />
</div>
```

**MessageCard + xterm sizing:** The embedded xterm must expand to fill the card. Use CSS: card body = `height: 400px` (collapsible), fullscreen = CSS `position: fixed; inset: 0; z-index: 50` (portal approach via shadcn Dialog or React portal). Do NOT use `display: none` to hide — unmount cleanly with `term.dispose()` and remount when shown.

**assistant-ui for ChatInput:** Phase 1 only uses `@assistant-ui/react` for the composer. The full thread rendering (streaming markdown bubbles) is Phase 3. Phase 1 ChatInput sends raw text to PTY — no assistant-ui Thread needed. Use shadcn `Textarea` + `Button` instead of full assistant-ui composer to avoid over-engineering.

**`@assistant-ui/react@0.14.5` peer deps:** `react@^18 || ^19` — compatible with React 19. [VERIFIED: npm registry]

---

## Pattern 14: CI Matrix (INFRA-07)

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix:
        os: [macos-latest, ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.14"  # Pin exact version — ConPTY required
      - run: bun install
      - run: bun test
      - name: PTY smoke test (POSIX)
        if: runner.os != 'Windows'
        run: |
          bun run tests/smoke/pty-echo.test.ts
      - name: PTY smoke test (Windows)
        if: runner.os == 'Windows'
        shell: pwsh
        run: |
          bun run tests/smoke/pty-echo-win.test.ts
```

**Smoke test (POSIX):** Spawn `echo "hello"` via `Bun.Terminal`, collect bytes, assert bytes contain "hello", assert WS roundtrip delivers same bytes, assert SQLite `pty_chunks` row written.

**Smoke test (Windows):** Spawn `cmd.exe /c echo hello` via `Bun.Terminal` with ConPTY, same assertions. Windows path short-name conversion: use the `getWindowsShortPath()` helper if cwd contains non-ASCII.

**Windows-specific note:** The dev machine has Bun 1.3.12 — Windows ConPTY (1.3.14) cannot be tested locally. CI is the primary validation path for Windows. Install `bun@1.3.14` first before any PTY work.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PTY spawn | Custom child_process with pipe | `Bun.Terminal` | isTTY=false without real PTY; claude won't render its TUI |
| Terminal rendering | Custom ANSI parser in browser | `@xterm/xterm@^6` | 10+ years of edge cases; CJK, RTL, Unicode, mouse, colors |
| WS binary bridging | Custom framing protocol | Raw `arraybuffer` + length prefix | xterm expects raw PTY bytes; adding framing requires xterm-side decoding |
| ANSI sequence parsing (client) | Custom parser for browser | xterm's built-in parser | xterm handles all VT500 + OSC + DCS; battle-tested |
| Type-safe SQL | Raw SQL strings | Drizzle ORM | Schema drift, type errors at compile time instead of runtime |
| Client state | Redux or Context | Zustand | Less boilerplate, React 19 compatible |
| CSS animations | Custom keyframe CSS | `tw-animate-css` | v4-compatible; shadcn expects it |
| Chat composer | Textarea + custom markdown | `@assistant-ui/react` (Phase 3) | Streaming, abort, thread management already solved |
| Secret scanning | Custom regex on event handlers | Inline regex in redactor.ts (already prescriptive) | Simple enough to build; no library needed |

**Key insight:** The xterm.js split-sequence handling is the #1 hand-roll trap. Developers routinely assume they need to buffer and reassemble ANSI sequences before sending to xterm. They do not — xterm's internal parser handles split sequences correctly. The only place that needs the ANSI splitter is the SQLite persistence layer.

---

## Runtime State Inventory

> Included because Phase 1 is the first migration — no prior runtime state exists.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | None — greenfield | None |
| Live service config | None | None |
| OS-registered state | None | None |
| Secrets/env vars | None project-specific | None |
| Build artifacts | None | None |

**Nothing found in any category — verified by examining project root (only CLAUDE.md exists).**

---

## Common Pitfalls

### Pitfall 1: Bun.Terminal `data` callback fires before `Bun.spawn` returns

**What goes wrong:** The PTY child starts emitting bytes before the `spawn()` call completes. If the caller registers `onData` in the returned PtyHandle after spawn, early bytes are dropped.

**Why it happens:** Bun.Terminal's data callback is wired at construction time (before spawn), so bytes can arrive immediately. [Open question Q9 from STATE.md]

**How to avoid:** Wire the `onData` callback in the `Bun.Terminal` constructor, not after `Bun.spawn` returns. The design in Pattern 1 already does this correctly.

**Warning signs:** xterm shows no output for the first 1-2 seconds after spawn, then suddenly displays the full buffered startup.

### Pitfall 2: `Bun.spawn` with `stdio: ["pipe"]` and `terminal:` combined

**What goes wrong:** Specifying explicit `stdin`/`stdout`/`stderr` options alongside `terminal:` causes unexpected behavior. Claude won't see a PTY and renders in non-interactive mode (no colors, no ASCII logo).

**How to avoid:** When using `terminal:`, do NOT set `stdin`, `stdout`, or `stderr`. The terminal option takes over all stdio routing.

### Pitfall 3: xterm.js mounted in a `display: none` parent

**What goes wrong:** The WebGL context is created with 0×0 dimensions and never recovers. Calling `fit.fit()` has no effect.

**How to avoid:** The card containing xterm must be fully visible before `term.open()`. For the Phase 1 MessageCard (always visible), this is not a problem. For the fullscreen `⤢` modal, use a portal that renders into `document.body` (always visible), not a hidden drawer.

### Pitfall 4: Missing `export default { ..., websocket }` in Hono server

**What goes wrong:** WebSocket upgrades fail silently. Hono serves the page, WS connections open but close immediately with no useful error.

**How to avoid:** The Bun serve entry must export: `export default { fetch: app.fetch, websocket }`. The `websocket` export comes from `hono/bun` (not from bare `hono`).

### Pitfall 5: Drizzle migrator `await migrate()` even though bun:sqlite is sync

**What goes wrong:** If you call `migrate(db, ...)` without `await`, it returns a Promise that may complete after the first request is served. Schema tables don't exist yet; first query throws.

**How to avoid:** Always `await migrate(...)` in the boot sequence before `Bun.serve()`.

### Pitfall 6: `process.kill(-pgid, sig)` on Windows

**What goes wrong:** On Windows, the negative-PID group-kill syntax is not supported. The call throws `ENOSYS`.

**How to avoid:** Branch on `process.platform === "win32"`. On Windows, use `process.kill(pid)` which terminates the ConPTY handle and cascades.

### Pitfall 7: WAL checkpoint blocked by long-running reader

**What goes wrong:** `PRAGMA wal_checkpoint(TRUNCATE)` returns without truncating if there's an active reader (which there always is — the SSE history replay). WAL grows unbounded.

**How to avoid:** Use `PRAGMA wal_checkpoint(PASSIVE)` for the periodic ticker (non-blocking). The `TRUNCATE` mode is only safe in the shutdown path when no readers are active. [VERIFIED: SQLite docs]

### Pitfall 8: Bun.Terminal Windows ConPTY output re-encoding

**What goes wrong:** Byte-level comparison of PTY output stored on macOS vs Windows shows different escape sequence bytes for the same terminal content.

**How to avoid:** Store and replay whatever bytes ConPTY emits — do not attempt byte-for-byte round-trip verification across platforms. The xterm.js renderer will handle both forms correctly.

### Pitfall 9: `bun upgrade --version` vs `bun upgrade`

**What goes wrong:** The dev machine has Bun 1.3.12. Running `bun upgrade` may not reach 1.3.14 if the Bun channel serves a different version.

**How to avoid:** Use `curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14"` to pin exact version, or check `bun --version` immediately after upgrade. The CI matrix pins `bun-version: "1.3.14"` explicitly.

### Pitfall 10: `@xterm/addon-unicode11` requires `allowProposedApi: true` at Terminal construction time

**What goes wrong:** Loading Unicode11Addon throws `Error: The addon requires allowProposedApi to be set to true in the terminal options`.

**How to avoid:** Pass `allowProposedApi: true` in the `Terminal` constructor options — see Pattern 12.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `node-pty` for PTY in Bun | `Bun.Terminal` (POSIX) + Windows ConPTY | Bun 1.3.5 (POSIX), 1.3.14 (Windows) | `node-pty` crashes under Bun NAPI; switch mandatory |
| `xterm` (unscoped 5.x) | `@xterm/xterm@^6.0.0` (scoped) | xterm.js v6 release 2024 | 5.x is dead; v6 has performance improvements + scoped packages |
| `tailwindcss-animate` | `tw-animate-css` | Tailwind v4 launch | v3-only library; v4 uses CSS-first approach |
| `tailwind.config.js` | `@theme` block in CSS | Tailwind v4 | JS config is dead in v4 |
| `drizzle-kit push` (prod) | `generate` + `migrate()` at boot | Always bad practice | Push has destructive edge cases; SQL-file-tracked migrations only |
| `shadcn-ui` (old CLI) | `npx shadcn@latest` | 2025 | Old CLI package outdated; new scoped CLI has v4 + React 19 support |

**Deprecated/outdated:**
- `tailwindcss-animate`: do not install; use `tw-animate-css@^1.4.0`
- `xterm` (unscoped): do not install; use `@xterm/xterm@^6.0.0`
- `node-pty`: never install under Bun
- `drizzle-orm@1.0.0-rc.x`: pin to `^0.45.2`

---

## Files the Planner Needs to Instruct the Executor to CREATE

| File | Role | Source Pattern |
|------|------|----------------|
| `package.json` | Bun workspace scripts | Pattern 11 (scripts section) |
| `tsconfig.json` | TypeScript config | Standard Bun strict config |
| `biome.json` | Biome lint + format | Biome 2.x defaults |
| `drizzle.config.ts` | Drizzle Kit config | Pattern 5 |
| `vite.config.ts` | Vite + Tailwind v4 + WS proxy | STACK.md §8 |
| `src-react/index.html` | HTML entry | Vite standard |
| `src-react/index.css` | Tailwind v4 CSS (`@import "tailwindcss"; @theme {}`) | STACK.md §8 |
| `src-react/main.tsx` | React 19 mount | `createRoot(...).render(...)` |
| `src-react/App.tsx` | Three-column shell | Pattern 13 |
| `src-react/components/MessageCard.tsx` | Master/Worker card | D-05, D-06 |
| `src-react/components/WorkerTerminal.tsx` | xterm.js + WS bridge | Pattern 4 |
| `src-react/components/ChatInput.tsx` | Text → PTY stdin | Golutra `ChatInput.vue` → React |
| `src-react/components/WorkspaceBar.tsx` | Top bar placeholder | D-05 (cwd string only) |
| `src-react/components/SelfTestBanner.tsx` | Degraded-start banner | D-10 |
| `src-react/components/SelfTestDialog.tsx` | Fix instructions dialog | D-11 |
| `src-react/lib/store.ts` | Zustand stores | Workers + UI state |
| `src-bun/main.ts` | Boot entry | Selftest → DB → spawn → serve |
| `src-bun/cli.ts` | CLI arg parser | `start` / `doctor` / `--port` |
| `src-bun/db/index.ts` | DB singleton | Pattern 5 |
| `src-bun/db/schema.ts` | Drizzle schema (11 tables) | Pattern 5 |
| `src-bun/db/repos/*.ts` | Repository functions per table | Typed CRUD wrappers |
| `src-bun/bus/index.ts` | In-memory EventBus | Map + Set + async iter |
| `src-bun/pty/handle.ts` | PtyHandle interface | Pattern 2 |
| `src-bun/pty/bun-terminal.ts` | Bun.Terminal impl | Pattern 1 |
| `src-bun/pty/bun-pty.ts` | bun-pty fallback (static import, dormant) | Pattern 2 |
| `src-bun/pty/batcher.ts` | ANSI ChunkBatcher | Pattern 3 |
| `src-bun/pty/redactor.ts` | Secret redactor | Pattern 7 |
| `src-bun/worker/index.ts` | WorkerSupervisor (Phase 1 minimal) | Pattern 6 |
| `src-bun/worker/cwd.ts` | CwdResolver | Pattern 8 |
| `src-bun/gateway/index.ts` | Hono app + export | STACK.md §6 |
| `src-bun/gateway/ws.ts` | WS routes | Pattern 4 |
| `src-bun/gateway/sse.ts` | SSE routes | STACK.md §5 |
| `src-bun/gateway/rest.ts` | REST routes | chunks + workers + events |
| `src-bun/system/selftest.ts` | Self-test | Pattern 10 |
| `src-bun/system/doctor.ts` | Orphan reaper | Pattern 6 (running.json) |
| `src-bun/system/browser.ts` | Browser opener | D-16 |
| `tests/smoke/pty-echo.test.ts` | POSIX PTY smoke test | CI matrix |
| `tests/smoke/pty-echo-win.test.ts` | Windows ConPTY smoke test | CI matrix |
| `tests/unit/redactor.test.ts` | Regex redaction unit tests | SEC-01 |
| `tests/unit/batcher.test.ts` | ANSI splitter unit tests | ANSI-SPLITTER-01 |
| `.github/workflows/ci.yml` | CI matrix (mac/linux/windows) | Pattern 14 |
| `~/.agenstrix/` (runtime) | Home directory for DB + logs + backups | Created by DB boot |

### Files to MODIFY

| File | What Changes |
|------|--------------|
| `CLAUDE.md` | Conventions section — fill as patterns are established |

---

## Files the Planner Needs to Instruct the Executor to MODIFY

None beyond `CLAUDE.md` (greenfield project).

---

## Known Landmines for Phase 1 Executor

1. **Bun version must be 1.3.14+** — dev machine has 1.3.12. First task must upgrade Bun before any PTY code runs. Windows ConPTY requires exactly 1.3.14+.

2. **`Bun.spawn` + `terminal:` do NOT mix with `stdin/stdout/stderr: "pipe"`** — do not add pipe options. The terminal option is all-or-nothing for stdio routing.

3. **`process.kill(-pgid, sig)` is POSIX-only** — Windows branch required. Windows ConPTY auto-cascades kill via `ClosePseudoConsole`.

4. **`export default { fetch, websocket }` is mandatory** — forgetting the `websocket` export causes silent WS upgrade failures. No error is thrown by Hono — the upgrade just fails.

5. **xterm.js must be opened in a visible container** — never mount xterm inside `display: none`, `visibility: hidden`, or a hidden tab. The MessageCard in Phase 1 is always visible. The `⤢` fullscreen portal must render into `document.body`.

6. **`allowProposedApi: true` must be in the Terminal constructor** — cannot be set after construction. Required for Unicode11Addon.

7. **ConPTY re-encodes escape sequences** — stored bytes on Windows will differ byte-for-byte from POSIX for the same terminal session. Do not assert byte identity across platforms in tests — assert semantic equivalence (same rendered content).

8. **Drizzle `migrate()` is async even though bun:sqlite is sync** — must `await migrate(...)` before serving.

9. **WAL checkpoint `TRUNCATE` mode blocks if readers exist** — use `PASSIVE` for the periodic ticker. Use `TRUNCATE` only in shutdown when all queries are drained.

10. **`bun-pty` package is ~1 year old with moderate download count** — treat as provisional. Only wire behind the `PtyHandle` interface fallback, not as primary. The static import (Pattern 2) must exist from day 1 so `bun --compile` bundles it, but the runtime switch defaults to `Bun.Terminal`.

11. **shadcn CLI uses `npx shadcn@latest`** — NOT `npx shadcn-ui@latest` (deprecated) and NOT `bun x shadcn-ui` (wrong package). Use exactly `bunx shadcn@latest init`.

12. **`tw-animate-css` NOT `tailwindcss-animate`** — the latter is Tailwind v3 only and will silently produce no animations in v4.

13. **`drizzle-kit generate` must be run after schema changes** — executor must run `bun db:generate`, review the SQL output, then commit SQL files before any migration is applied.

14. **The `⤢` fullscreen toggle** for xterm must NOT re-create the terminal (dispose + new Terminal) — that loses history. It must re-parent the existing container DOM node to a portal, then call `fit.fit()` after re-parenting.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `bun` | Runtime | ✓ (wrong version) | 1.3.12 (need 1.3.14+) | Upgrade: `bun upgrade` or reinstall |
| `node` | Vite + shadcn CLI | ✓ | v24.15.0 | — |
| `git` | GIT-01 scanner | ✓ | 2.50.1 | — |
| `claude` | CORE-01 auto-spawn | ✓ | found at `/Users/wdx/.local/bin/claude` | Self-test banner if missing |
| macOS `open` | D-16 browser launch | ✓ | macOS 25.3.0 | Silent fallback to console URL |
| `~/.agenstrix/` | DB + logs | Created by boot | — | Auto-created |

**Missing dependencies with no fallback:**
- Bun 1.3.14 (have 1.3.12) — must upgrade before PTY work. This blocks Windows ConPTY but does NOT block POSIX PTY (which works since Bun 1.3.5).

**Missing dependencies with fallback:**
- None beyond Bun version.

---

## Validation Architecture

> `nyquist_validation` is explicitly `false` in `.planning/config.json`. This section describes the recommended test architecture for the executor's reference — the workflow gate is disabled, but the tests should still be written.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun:test` (built-in, no install needed) |
| Config file | None (bun:test auto-discovers `*.test.ts`) |
| Quick run command | `bun test tests/unit/` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File |
|--------|----------|-----------|-------------------|------|
| ANSI-SPLITTER-01 | CSI/OSC sequences don't split across chunks | unit | `bun test tests/unit/batcher.test.ts` | Wave 0 |
| SEC-01 | sk-ant-/ghp_/sk-/AKIA patterns redacted | unit | `bun test tests/unit/redactor.test.ts` | Wave 0 |
| CORE-01 | PTY spawn → bytes flow | smoke | `bun test tests/smoke/pty-echo.test.ts` | Wave 0 |
| INFRA-02 | DB init + 11 tables created | integration | `bun test tests/unit/db.test.ts` | Wave 1 |
| DB-DURABILITY-01 | WAL PRAGMA set, backup created | integration | `bun test tests/unit/db-durability.test.ts` | Wave 1 |
| WS-1011-01 | WS heartbeat sent every 30s | integration | `bun test tests/smoke/ws-heartbeat.test.ts` | Wave 2 |
| KILL-01 | SIGTERM → 5s → SIGKILL group kill | smoke | `bun test tests/smoke/kill-group.test.ts` | Wave 2 |
| INFRA-07 (Windows) | PTY echo smoke test on ConPTY | smoke | `bun test tests/smoke/pty-echo-win.test.ts` | CI-only |

### Wave 0 Gaps (create before implementation)

- [ ] `tests/unit/batcher.test.ts` — ANSI-SPLITTER-01 tests: CSI color codes, OSC window title, DCS, boundary-crossing sequences
- [ ] `tests/unit/redactor.test.ts` — SEC-01: Anthropic key, GitHub token, OpenAI key, AWS access key
- [ ] `tests/smoke/pty-echo.test.ts` — POSIX: spawn `echo` via Bun.Terminal, assert bytes received

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Single-user local tool; no auth |
| V3 Session Management | No | PTY sessions are single-user local |
| V4 Access Control | Partial | Env minimization prevents privilege escalation via worker env |
| V5 Input Validation | Yes | User keystrokes forwarded as-is to PTY (intentional); WS message type-checked via Zod |
| V6 Cryptography | No | No encryption needed Phase 1; localhost only |

### Known Threat Patterns for PTY Orchestration

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secret exfiltration via PTY output | Information Disclosure | Regex redactor on PTY bytes before SQLite + WS (SEC-01) |
| Shell escape via user input | Tampering | PTY stdin is forwarded as-is (intentional — user controls their own claude session); no shell metachar processing needed |
| Env variable leak to worker process | Information Disclosure | Env allowlist: only PATH/HOME/USER/LANG/SHELL passed to spawn (SEC-01) |
| Orphan processes burning API credits | Denial of Service (financial) | detached + pgid group kill + doctor --reap (KILL-01) |
| SQLite corruption from crash mid-write | Tampering | WAL mode + PRAGMA synchronous=NORMAL + pre-migrate backup (DB-DURABILITY-01) |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `Bun.spawn` with `terminal:` + `detached: true` creates a new process group (pgid = pid) on POSIX | Pattern 1 (kill-group) | Group kill `process.kill(-pgid)` won't propagate; orphan processes on SIGTERM |
| A2 | `bun-pty@0.4.8` exposes `spawn(argv, opts)` with `write/resize/kill/on("data")` API similar to node-pty | Pattern 2 | bun-pty fallback won't wire without API verification |
| A3 | The broad regex `/[A-Za-z0-9+/]{40,}={0,2}/g` for "UNKNOWN-SECRET" hits < 1% of typical PTY chunks | Pattern 7 | Performance degradation at high PTY throughput |
| A4 | Windows `GetShortPathNameW` via `cmd /c for %i in (path) do echo %~si` fallback works for non-ASCII cwd | Pattern 8 | Non-ASCII cwd fails on Windows ConPTY |
| A5 | `@vitejs/plugin-react` latest version is compatible with React 19 + Vite 8 | Standard Stack | Build failures; may need specific version pin |
| A6 | `lucide-react@^0.500.x` latest is tree-shakeable and compatible with React 19 | Standard Stack | Icon rendering failures |
| A7 | `PRAGMA wal_checkpoint(PASSIVE)` does not block long-running readers | Pattern 5 (WAL) | WAL grows unbounded even with periodic ticker |

**If this table is empty:** it would not be — 7 assumptions are logged above. The planner must add human-verify checkpoints for A1 (add unit test) and A2 (verify bun-pty API before wiring fallback).

---

## Open Questions (RESOLVED)

1. **Q1: Does `Bun.spawn` with `terminal:` automatically set `detached: true` (PGID isolation)?**
   - What we know: STACK.md says use `detached: true`. The Bun.Terminal blog post doesn't mention it explicitly. The PtyHandle design assumes pgid = pid.
   - What's unclear: Whether `terminal:` option implies session isolation.
   - Recommendation: Write a unit test asserting `getpgid(proc.pid) === proc.pid` on POSIX immediately in Wave 0. If false, add `detached: true` explicitly.
   - **Resolution:** Resolved by Plan 01-01 Task 2 Step 6 (`detached: true` written defensively into `src-bun/pty/bun-terminal.ts`) + Plan 01-04 Task 1 Step 4 (smoke test asserts `process.pgid === process.pid` for the child PID via `ps -o pgid= -p <pid>`). POSIX-only — Windows ConPTY auto-cascades via `ClosePseudoConsole`.

2. **Q2: Is `bun-pty@0.4.8` API exactly `spawn(argv, {cols, rows, cwd, env}): { pid, write, resize, kill, on("data", cb) }`?**
   - What we know: Package exists, has Rust/FFI backing, 20+ releases, 1 year old.
   - What's unclear: Exact constructor signature vs `node-pty` API parity.
   - Recommendation: Read bun-pty's TypeScript declarations before wiring the fallback. Adjust PtyHandle adapter if API differs.
   - **Resolution:** Resolved as ASSUMED for v1. Plan 01-01 Task 2 Step 7 wires the fallback to throw `Error('bun-pty fallback not yet wired — verify API and uncomment')` so we don't silently regress to an untested code path. The static import remains so `bun --compile` bundles it. Real wiring (read bun-pty TS declarations, adapt PtyHandle, add unit test) is deferred to a future patch — invoked only when `AGENSTRIX_PTY_BACKEND=bun-pty` is set.

3. **Q3: History replay gap race — can WS receive chunks between REST fetch completing and WS `onopen` firing?**
   - What we know: Pattern 4 buffers `pendingLive` during history load. The race window is minimal if WS opens first.
   - What's unclear: The exact order of `ws.onopen` vs `ws.onmessage` relative to the REST fetch.
   - Recommendation: Open WS first, buffer live chunks, then start REST fetch in `ws.onopen`. Already reflected in Pattern 4.
   - **Resolution:** Resolved by Pattern 4 (buffer in `onopen`): client appends incoming chunks to a transient `pendingLive` buffer until the REST `/replay` response is received, then flushes the buffer into xterm. Implemented in Plan 01-01 Task 3 (`WorkerTerminal.tsx`).

---

## Sources

### Primary (HIGH confidence)

- `bun.com/reference/bun/Terminal` — Bun.Terminal constructor, methods
- `bun.com/blog/bun-v1.3.14` — Windows ConPTY launch, caveats (no termios, re-encoding)
- `bun.com/blog/bun-v1.3.5` — POSIX PTY launch, spawn-with-terminal pattern
- `drizzle-team/drizzle-orm-docs` (via STACK.md research) — bun-sqlite migrator, snake_case casing
- `ui.shadcn.com/docs/tailwind-v4` — CSS-first Tailwind v4, tw-animate-css
- `.planning/research/STACK.md` — full verified stack, all production gotchas
- `.planning/research/ARCHITECTURE.md` — module decomposition, event taxonomy
- `.planning/research/PITFALLS.md` — pitfalls 1, 2, 3, 4, 6, 7
- `.planning/research/SUMMARY.md` — top 5 risks, phase ordering rationale
- npm registry (verified 2026-05-17): all package versions in Standard Stack table

### Secondary (MEDIUM confidence)

- `github.com/sursaone/bun-pty` — bun-pty FFI wrapper, API surface, age 2025-05-14
- `github.com/microsoft/node-pty#644` — NAPI Bun incompatibility (HIGH: maintainer-confirmed)
- `oven-sh/bun#25565` — Windows Terminal request, closed by Bun 1.3.14

### Tertiary (LOW / ASSUMED)

- Windows `GetShortPathNameW` via cmd fallback — pattern from golutra; exact FFI signature needs verification
- `bun-pty` exact API surface — package exists, API inferred from node-pty parity claim in README

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions npm-verified 2026-05-17
- Bun.Terminal API (POSIX): HIGH — official docs confirmed
- Bun.Terminal Windows ConPTY: MEDIUM — shipped 2026-05-13, 4 days before research, no field reports yet
- Architecture patterns: HIGH — derived from locked stack + prior ARCHITECTURE.md research
- Kill-group (POSIX): HIGH — PITFALLS.md + ARCHITECTURE.md + golutra reference implementation
- ANSI splitter: HIGH — VT500-series parser is well-specified (Paul Williams)
- xterm.js addon sequence: HIGH — STACK.md + xtermjs.org confirmed
- bun-pty fallback API: MEDIUM — package exists, API assumed from README
- Windows path short-name: MEDIUM — golutra pattern reference, exact FFI unverified

**Research date:** 2026-05-17
**Valid until:** 2026-06-17 (Bun.Terminal Windows: re-validate after 30 days of field reports)
