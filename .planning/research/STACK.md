# Stack Research — Agenstrix

**Domain:** Multi-agent CLI orchestrator (web-first, Tauri 2 desktop in v2)
**Researched:** 2026-05-17
**Confidence:** HIGH (versions verified via npm registry & Bun/Tauri/Hono official docs on the day of research)

## Executive Summary

The locked stack is sound. The single most consequential, **non-obvious 2026 update** is that **`node-pty` is fundamentally incompatible with the Bun runtime** (NAN crashes; the maintainer-merged NAPI port still misbehaves under Bun's NAPI implementation). Two clean alternatives now exist that make `node-pty` unnecessary for v1:

1. **`Bun.Terminal`** — first-party PTY API shipped in Bun 1.3.5 (Dec 2025) for POSIX, with **Windows ConPTY support shipped in Bun 1.3.14 on 2026-05-13** (4 days before this research).
2. **`bun-pty`** (FFI wrapper over Rust `portable-pty`) — third-party, no native build step, cross-platform, prebuilt FFI binaries.

Default recommendation: **`Bun.Terminal` everywhere** (now that Windows works), with `bun-pty` as a safety net if any Windows ConPTY edge case bites. Do **not** ship `node-pty` — it will not load in a `bun build --compile` binary.

Second consequential decision: **pin Drizzle ORM to the 0.45.x stable series, not 1.0.0-rc.x**. `latest` on npm is `0.45.2`; `rc` is `1.0.0-rc.2`. RC is end-of-the-tunnel but still moving; for a brand-new greenfield where schemas are about to churn, you want maximum tooling stability.

Third: **xterm.js v6 (stable: `@xterm/xterm@6.0.0`)** is what to install. The `xterm` (unscoped) package is the legacy 5.x line — do not use. v6.1 is in beta.

Everything else converges cleanly: React 19.2 + Vite 8 + Tailwind v4.3 + shadcn/ui (now Tailwind-v4-native and React-19-native), Hono 4.12 with `streamSSE`, MCP TypeScript SDK 1.29, Tauri 2.11.

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

```bash
# --- Bootstrap (Bun is the package manager; do NOT use npm/pnpm) ---
bun init -y
bun add hono @hono/zod-validator zod \
        drizzle-orm@^0.45.2 \
        @modelcontextprotocol/sdk \
        pino simple-git chokidar get-port nanoid

# Frontend
bun add react react-dom \
        @xyflow/react \
        @xterm/xterm @xterm/addon-fit @xterm/addon-web-links \
        @xterm/addon-search @xterm/addon-webgl @xterm/addon-canvas \
        @xterm/addon-serialize @xterm/addon-unicode11 @xterm/addon-clipboard \
        @assistant-ui/react \
        zustand @tanstack/react-query \
        react-dropzone \
        react-i18next i18next \
        lucide-react class-variance-authority clsx tailwind-merge tw-animate-css

# Dev tooling
bun add -d \
        typescript bun-types @types/react @types/react-dom \
        vite @vitejs/plugin-react \
        tailwindcss @tailwindcss/vite \
        drizzle-kit@^0.31.10 \
        @biomejs/biome

# Initialize shadcn (after Tailwind v4 + Vite are set up)
bunx shadcn@latest init           # pick: default style, OKLCH, src/components/ui

# v2 (defer to Tauri milestone — do not install during v1)
bun add @tauri-apps/api \
        @tauri-apps/plugin-shell \
        @tauri-apps/plugin-fs \
        @tauri-apps/plugin-dialog \
        @tauri-apps/plugin-notification
bun add -d @tauri-apps/cli
```

> **Confidence: HIGH** for every package — versions verified via `npm view <pkg> version` on 2026-05-17.

## Critical Integration Patterns

### 1. Bun + PTY (the v1 path) — use `Bun.Terminal`, not `node-pty`

```ts
// src/server/pty/spawn.ts
import { spawn } from "bun";

export interface WorkerPty {
  pid: number;
  write(input: string): void;
  resize(cols: number, rows: number): void;
  onData(cb: (chunk: Uint8Array) => void): void;
  kill(signal?: "SIGTERM" | "SIGKILL"): void;
  exited: Promise<number>;
}

export function spawnClaudeWorker(opts: {
  argv: string[];          // ["claude"] or ["codex"]
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  onData: (chunk: Uint8Array) => void;
}): WorkerPty {
  const terminal = new Bun.Terminal({
    cols: opts.cols,
    rows: opts.rows,
    data: (_term, chunk) => opts.onData(chunk),
  });

  const proc = Bun.spawn(opts.argv, {
    cwd: opts.cwd,
    env: opts.env,
    terminal,                          // <-- this is the PTY attach
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });

  return {
    pid: proc.pid,
    write: (s) => { terminal.write(s); },
    resize: (c, r) => { terminal.resize(c, r); },
    onData: (cb) => { /* already wired via constructor */ },
    kill: (sig = "SIGTERM") => { proc.kill(sig === "SIGKILL" ? 9 : 15); },
    exited: proc.exited,
  };
}
```

**Hide this behind an interface.** If Windows ConPTY misbehaves for a specific user, swap to `bun-pty` in 5 lines.

### 2. Bun + Drizzle migration pattern (production)

```ts
// src/server/db/index.ts
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

const dbPath = `${process.env.HOME}/.agenstrix/store.db`;
const sqlite = new Database(dbPath, { create: true });
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA synchronous = NORMAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

export const db = drizzle(sqlite, { schema });

// Run at boot, BEFORE serving requests
export function runMigrations() {
  migrate(db, { migrationsFolder: "./drizzle" });
}
```

```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "sqlite",
  driver: "bun-sqlite",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
});
```

Workflow: edit `schema.ts` → `bunx drizzle-kit generate` → review SQL → commit SQL file → app applies via `migrate()` at boot. **Never use `drizzle-kit push` in production**, only for local prototyping.

### 3. Bun `--compile` + Tauri 2 sidecar (the non-obvious recipe)

```bash
# Build the sidecar binary on each host platform you target.
# Inside src-bun/ (where main.ts is the Hono entrypoint):

# macOS Apple Silicon
bun build --compile --target=bun-darwin-arm64 ./src-bun/main.ts \
  --outfile ../src-tauri/binaries/agenstrix-server-aarch64-apple-darwin

# macOS Intel
bun build --compile --target=bun-darwin-x64 ./src-bun/main.ts \
  --outfile ../src-tauri/binaries/agenstrix-server-x86_64-apple-darwin

# Linux x64 (glibc)
bun build --compile --target=bun-linux-x64 ./src-bun/main.ts \
  --outfile ../src-tauri/binaries/agenstrix-server-x86_64-unknown-linux-gnu

# Linux ARM64
bun build --compile --target=bun-linux-arm64 ./src-bun/main.ts \
  --outfile ../src-tauri/binaries/agenstrix-server-aarch64-unknown-linux-gnu

# Windows x64 (must add .exe!)
bun build --compile --target=bun-windows-x64 ./src-bun/main.ts \
  --outfile ../src-tauri/binaries/agenstrix-server-x86_64-pc-windows-msvc.exe
```

**Tauri config** (`src-tauri/tauri.conf.json`):

```json
{
  "bundle": {
    "externalBin": ["binaries/agenstrix-server"]
  }
}
```

Tauri's CLI auto-picks the file matching the current `rustc --print host-tuple`. The basename must match across platforms; only the suffix changes.

**Spawning from the Tauri frontend** (long-running, streamed, NOT one-shot):

```ts
import { Command } from "@tauri-apps/plugin-shell";

const cmd = Command.sidecar("binaries/agenstrix-server", ["--port", "0"]);
cmd.on("close", (data) => console.log("server exited", data.code));
cmd.stdout.on("data", (line) => console.log("[server]", line));
cmd.stderr.on("data", (line) => console.error("[server]", line));
const child = await cmd.spawn();
// Don't `execute()` — that blocks. `spawn()` returns the pid and streams.
```

**Capability file** (`src-tauri/capabilities/default.json`) must include:
```json
{
  "permissions": [
    "shell:default",
    { "identifier": "shell:allow-spawn", "allow": [{ "name": "binaries/agenstrix-server", "sidecar": true }] }
  ]
}
```

### 4. SQLite embedding in compiled binary

```ts
// If you want to ship a seed DB inside the binary (e.g., built-in spells templates):
import seedDb from "./seed.db" with { type: "sqlite", embed: "true" };
```
The DB is bundled directly into the compiled binary — no path resolution at runtime. Use for read-only resources only; runtime data goes to `~/.agenstrix/store.db`.

### 5. Hono SSE with backpressure (Master → UI streaming)

```ts
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

const app = new Hono();

app.get("/api/threads/:id/stream", (c) =>
  streamSSE(c, async (stream) => {
    const threadId = c.req.param("id");
    const sub = subscribeToThread(threadId);   // your internal EventBus

    stream.onAbort(() => sub.close());          // critical: client navigated away

    for await (const event of sub) {
      // writeSSE awaits the underlying flush → natural backpressure
      await stream.writeSSE({
        event: event.type,        // 'master.thinking' | 'worker.spawn' | ...
        data: JSON.stringify(event.data),
        id: String(event.seq),
      });
    }
  })
);
```

**Backpressure note:** `streamSSE` returns the underlying `Response` whose body is a `ReadableStream` Bun handles natively. The `await stream.writeSSE(...)` resolves only when the chunk has been accepted — that's where backpressure happens. Don't bypass it with synchronous fire-and-forget.

### 6. Bun + Hono WebSocket (worker terminal stream)

```ts
import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "hono/bun";

const app = new Hono();

app.get("/ws/worker/:id",
  upgradeWebSocket((c) => {
    const id = c.req.param("id");
    return {
      onOpen(_evt, ws) {
        bindWorkerPtyToSocket(id, ws);    // pipe terminal.onData → ws.send
      },
      onMessage(evt, _ws) {
        // user keystroke
        getWorker(id).pty.write(String(evt.data));
      },
      onClose() {
        unbindWorkerPty(id);
      },
    };
  })
);

export default { fetch: app.fetch, websocket };  // MUST export websocket!
```

The `export default { ..., websocket }` is the most-forgotten Bun-specific detail.

### 7. xterm.js ↔ WebSocket bridging (manual, for backpressure)

```tsx
// src/ui/WorkerTerminal.tsx
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";

useEffect(() => {
  const term = new Terminal({
    fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
    fontSize: 13,
    convertEol: false,        // raw PTY bytes
    cursorBlink: true,
    allowProposedApi: true,   // needed for unicode11
  });

  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = "11";
  try { term.loadAddon(new WebglAddon()); } catch { /* canvas fallback */ }
  term.open(divRef.current!);
  fit.fit();

  const ws = new WebSocket(`/ws/worker/${workerId}`);
  ws.binaryType = "arraybuffer";
  ws.onmessage = (e) => term.write(new Uint8Array(e.data as ArrayBuffer));
  term.onData((data) => ws.send(data));         // user keystrokes
  term.onResize(({ cols, rows }) => ws.send(JSON.stringify({ type: "resize", cols, rows })));

  const ro = new ResizeObserver(() => fit.fit());
  ro.observe(divRef.current!);

  return () => { ws.close(); term.dispose(); ro.disconnect(); };
}, [workerId]);
```

Crucial details:
- `convertEol: false` — never let xterm transform bytes; PTY is authoritative.
- `binaryType = "arraybuffer"` — avoid string-encoding overhead.
- `WebglAddon` in try/catch — context creation can throw on some Linux setups.
- `Unicode11Addon` mandatory for CJK users (default UI language is `zh-CN`).

### 8. shadcn/ui + Tailwind v4 + React 19 setup

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/sse": { target: "http://localhost:3000", changeOrigin: true },
      "/ws":  { target: "ws://localhost:3000",   ws: true },
    },
  },
});
```

```css
/* src/index.css — Tailwind v4 is CSS-first */
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:where(.dark, .dark *));

@theme {
  /* shadcn OKLCH tokens go here — shadcn CLI generates these */
}
```

```json
// components.json (shadcn CLI v3)
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui" },
  "iconLibrary": "lucide"
}
```

### 9. react-flow state management (don't fight the library)

Use **react-flow's own `useNodesState` / `useEdgesState` hooks for the canvas**, and a **separate Zustand store for "Workers domain state"** (lifecycle, token count, role). Sync them in a single `useEffect`. Don't store nodes inside Zustand — `@xyflow/react` re-renders the canvas optimally only when you mutate via its own dispatcher.

```tsx
const { workers } = useWorkersStore();
const [nodes, setNodes, onNodesChange] = useNodesState([]);
useEffect(() => setNodes(workersToNodes(workers)), [workers]);
```

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

**If running v1 (web-only):**
- Bun process listens on `localhost:3000`; Vite dev server on `5173` proxies `/api` + `/sse` + `/ws`.
- No Tauri deps installed.
- PTY uses `Bun.Terminal` directly.

**If running v2 (Tauri desktop):**
- Bun is compiled to `agenstrix-server-<target-triple>(.exe)` and placed in `src-tauri/binaries/`.
- Tauri Rust shell spawns it via `tauri_plugin_shell::ShellExt::shell().sidecar(...)` on startup.
- Frontend connects to `http://localhost:<auto-port>` (port handshake via Tauri event).
- Capabilities allow `shell:allow-spawn` for the sidecar only — no general shell access.

**If on Windows specifically:**
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

---
*Stack research for: Agenstrix multi-agent CLI orchestrator (v1 web + v2 Tauri)*
*Researched: 2026-05-17*
