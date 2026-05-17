# Architecture Research — Agenstrix

**Domain:** Multi-agent CLI orchestrator (Bun backend + React frontend + real `claude`/`codex` CLIs in PTYs + MCP plugin to autonomous Master)
**Researched:** 2026-05-17
**Confidence:** HIGH (component model derived from locked stack; data flows verified against MCP stdio spec, Hono SSE/WS adapter, Bun.Terminal API, and validated competitor architectures — golutra, swarm-ide, Composio ao)

---

## Executive Summary

Agenstrix is **one Bun process** acting as the central nervous system. Everything else is either:
- a **child process** the Bun process spawned (every `claude` / `codex` PTY, every dev `service`, the embedded `chrome-devtools-mcp`),
- a **WebSocket / SSE consumer** of the Bun process (the React UI, including Master's PTY and every Worker's PTY mirror),
- a **stdio MCP client** of the Bun process (the real `claude` Master, which the Bun process spawned with `Bun.Terminal` and to which it presented itself as an MCP server via a stdio FD pair injected through Claude Code's plugin/MCP config mechanism).

The single most consequential architecture decision is **one process owns everything**. There is no microservice boundary, no IPC bus across processes for state. State lives in two places: **in-memory Bun objects** (hot — live PTYs, live WS clients, in-flight tool calls) and **SQLite** (cold — anything that must survive process death). Communication crosses process boundaries via **four distinct transports**, each chosen for what it does best:

| Transport | Use | Rationale |
|---|---|---|
| `Bun.Terminal` (PTY bytes) | Bun ↔ `claude`/`codex` CLIs | The CLIs are TUIs; only a real PTY makes them render |
| stdio (JSON-RPC over an MCP server transport) | Bun (MCP server) ↔ `claude` Master (MCP client) | The ONLY documented mechanism for Claude Code to discover Agenstrix's action tools |
| WebSocket (binary) | Bun ↔ Browser, per Worker terminal | Bidirectional, raw bytes, backpressure-friendly, native in Bun via `hono/bun` |
| SSE (text events) | Bun ↔ Browser, per conversation | One-way streaming for Master thinking events, topology mutations, service status |

The component model that follows is the minimum set of modules to keep responsibilities crisp while staying out of microservice/DDD over-engineering. Eight backend modules + three frontend slices is the right size — fewer and modules conflate concerns (e.g., merging `PtyManager` with `WorkerSupervisor` makes lifecycle bugs impossible to trace); more and you fragment for fragmentation's sake.

The build order is non-negotiable in one specific way: **the DB layer ships before the PTY manager**, because every PTY chunk must be persisted for replay (INFRA-03), and the EventBus → SQLite sink should exist before any PTY emits anything. Get this wrong and you rebuild plumbing twice.

---

## System Overview

### 30,000-foot Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Browser (React 19)                               │
│  ┌─────────────┐  ┌────────────────┐  ┌──────────────────────────────────┐   │
│  │ Chat panel  │  │ Topology canvas │  │ Worker PTY drawer (xterm.js)     │   │
│  │(assistant-ui│  │(react-flow)     │  │ — one or more, lazy-mounted      │   │
│  └──────┬──────┘  └────────┬───────┘  └─────────────┬────────────────────┘   │
│         │ SSE              │ SSE                      │ WebSocket (binary)    │
│         │ /sse/threads/:id │ /sse/topology            │ /ws/worker/:id        │
└─────────┼──────────────────┼─────────────────────────┼────────────────────────┘
          │                  │                         │
┌─────────┴──────────────────┴─────────────────────────┴────────────────────────┐
│                          Bun Process (single)                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐ │
│  │                       HTTP/WS/SSE Gateway (Hono)                          │ │
│  │  /api/*  REST    /sse/*  SSE     /ws/*  WebSocket    /mcp  (internal)    │ │
│  └────────┬─────────────────┬─────────────────┬───────────────────┬─────────┘ │
│           │                 │                 │                   │           │
│           ▼                 ▼                 ▼                   ▼           │
│  ┌────────────────────────────── EventBus (in-mem pub/sub) ──────────────────┐│
│  └───────┬──────────┬──────────┬───────────┬───────────┬──────────┬─────────┘│
│          │          │          │           │           │          │          │
│          ▼          ▼          ▼           ▼           ▼          ▼          │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐ │
│  │ Master   │ │ Worker   │ │ MCP     │ │ Service  │ │Workspace│ │   PTY   │ │
│  │Controller│ │Supervisor│ │ Server  │ │Supervisor│ │Detector │ │ Manager │ │
│  └────┬─────┘ └────┬─────┘ │(stdio + │ └────┬─────┘ └────┬───┘ └────┬─────┘ │
│       │            │       │ HTTP)   │      │            │          │       │
│       │            │       └────┬────┘      │            │          │       │
│       │            │            │           │            │          │       │
│       └────────────┴────────────┴───────────┴────────────┴──────────┤       │
│                                                                       ▼      │
│  ┌─────────────────────────── DB Layer (Drizzle + bun:sqlite, WAL) ────────┐ │
│  │  workspaces / conversations / messages / workers / pty_chunks /         │ │
│  │  events / skills / templates / repos / services / learned_commands      │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└──────────┬──────────────────────────┬──────────────────────────┬──────────────┘
           │ Bun.Terminal             │ Bun.spawn (no PTY)       │ Bun.spawn (stdio)
           ▼                          ▼                          ▼
   ┌────────────────┐          ┌────────────────┐         ┌──────────────────────┐
   │ Master process │          │ Service procs  │         │ chrome-devtools-mcp  │
   │ `claude`       │          │ pnpm dev /     │         │ (npx, stdio)         │
   │ (interactive)  │          │ uvicorn / etc  │         │  + user-added MCP    │
   │                │          │                │         │  servers             │
   │ ── stdio ──────┼─►connects│                │         │                      │
   │   back to Bun  │   to Bun │                │         │                      │
   │   MCP server   │   via    │                │         │                      │
   │   (over a 2nd  │   stdio  │                │         │                      │
   │   FD pair      │   FDs    │                │         │                      │
   │   injected by  │          │                │         │                      │
   │   Bun via      │          │                │         │                      │
   │   --mcp-config │          │                │         │                      │
   │   on spawn)    │          │                │         │                      │
   └────────────────┘          └────────────────┘         └──────────────────────┘

   ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
   │ Worker 1       │  │ Worker 2       │  │ Worker N       │
   │ `claude` PTY   │  │ `codex` PTY    │  │ ...            │  (all owned by
   │ in worktree A  │  │ in worktree B  │  │                │   WorkerSupervisor,
   └────────────────┘  └────────────────┘  └────────────────┘   spawned via
                                                                PtyManager)
```

**Three rings:** Browser (presentation only), Bun process (everything), Subprocesses (the real CLIs + services + MCP children). The Bun process is the **only** thing with persistent state and the **only** thing that talks to SQLite.

---

## Component Boundaries (Backend)

Eight modules. Each gets a single-paragraph mandate, an explicit non-responsibilities list, and the interfaces it exposes.

### 1. `db/` — DB Layer

**Owns:** Drizzle schema, migration runner, the singleton `Database` handle, all SQL queries. Wraps `bun:sqlite` with WAL/`foreign_keys=ON`. Exposes typed repository functions (`workersRepo.create()`, `ptyChunksRepo.appendChunk()`, `eventsRepo.append()`).

**Does NOT:** know what a Worker / Service / Event semantically means; subscribe to anything; spawn processes; talk to the network. Pure data plumbing.

**Public surface:** `repos.workers`, `repos.ptyChunks`, `repos.events`, `repos.workspaces`, `repos.services`, `repos.learnedCommands`, `repos.skills`, `repos.templates`, `repos.repos`, `repos.conversations`, `repos.messages`.

**Why split out:** Every other module reads/writes SQLite. Centralizing the schema + connection lets us flip WAL, change DB path (test vs prod), or move to libsql in v3 without touching consumers.

### 2. `bus/` — EventBus

**Owns:** A single in-memory pub/sub (`Map<topic, Set<Subscriber>>`) with backpressure-aware async iteration. Every state-changing operation in the system emits an event here. Subscribers include the SSE gateway, the SQLite event sink (for INFRA-04 event sourcing), the topology projector, and the cost aggregator.

**Does NOT:** persist itself (the SQLite event sink does); know about HTTP; know about PTYs.

**Public surface:** `bus.publish(topic, event)`, `bus.subscribe(topic | pattern): AsyncIterable<Event>`, `bus.shutdown()`.

**Event taxonomy (10 root topics):**
- `master.*` — `spawned`, `input`, `output_chunk`, `tool_call`, `tool_result`, `exited`
- `worker.*` — `spawned`, `output_chunk`, `tool_call`, `state_changed`, `exited`, `killed`
- `service.*` — `starting`, `ready`, `down`, `port_conflict`
- `workspace.*` — `repo_added`, `repo_detected`, `command_learned`, `command_failed`
- `mcp.*` — `tool_invoked`, `tool_resolved`, `tool_errored`
- `dep_graph.*` — `node_added`, `edge_added`, `node_waiting`, `node_ready`
- `cost.*` — `delta` (token / dollar increment with attribution)
- `skill.*` — `loaded`, `injected`
- `system.*` — `health_check`, `startup`, `shutdown_initiated`
- `client.*` — `ws_connected`, `ws_disconnected`, `sse_aborted`

**Why split out:** Without a single bus, every module would need explicit wiring to every other module — quadratic dependency graph. The bus is what makes the architecture composable.

### 3. `pty/` — PTY Manager

**Owns:** Spawning `claude` / `codex` via `Bun.Terminal` + `Bun.spawn({ terminal })`; wrapping each spawn in a `PtyHandle` interface (`write`, `resize`, `kill`, `onData`, `exited`); attaching a chunk-batcher that flushes to `db.repos.ptyChunks` every ~100KB or 250ms (HR-04 backpressure). Cross-platform shim hidden here: POSIX uses `Bun.Terminal` directly; Windows uses `Bun.Terminal` 1.3.14+ with ConPTY (with `bun-pty` fallback wired behind the same `PtyHandle` interface). On Linux, sets `detached: true` so SIGTERM hits the entire process group (`claude` spawns its own subprocesses).

**Does NOT:** know whether the PTY is a Worker or the Master; decide kill timing; decide what bytes to write; assign worktrees; route output to WebSockets (the gateway subscribes to the bus).

**Public surface:** `pty.spawn(opts: SpawnOpts): PtyHandle`, `pty.get(id): PtyHandle | undefined`, `pty.list(): PtyHandle[]`, `pty.shutdownAll()`.

**Why split out:** PTY semantics (ConPTY quirks, process-group kill, byte chunking, replay) are gnarly and version-specific. Containing them in one module means the Stack research's "swap to bun-pty if Windows misbehaves" is a 5-line change, not a refactor.

### 4. `worker/` — Worker Supervisor

**Owns:** The lifecycle of a Worker — from "Master asked for one" through environment preparation (worktree create / merge / inherit / no-worktree), prompt construction (system prompt + injected Skills + token budget cap), spawn via `pty.spawn()`, monitoring (state transitions: `idle → running → waiting → done | error`), graceful kill (SIGTERM → 5s → SIGKILL via CORE-05), and cleanup (commit, `git worktree remove`, emit `worker.exited`). Owns the dependency graph: when a Worker's deps are satisfied, the Supervisor triggers downstream Workers; before triggering, it calls `ServiceSupervisor` to bring up required services and waits for `service.ready`.

**Does NOT:** spawn the PTY itself (delegates to `pty/`); know HTTP; know UI; decide which Worker to spawn (Master does, via MCP tool).

**Public surface:** `worker.spawn(spec: WorkerSpec): WorkerId`, `worker.send(id, input)`, `worker.kill(id, opts)`, `worker.get(id): WorkerState`, `worker.list()`, `worker.declareDep(downstreamId, upstreamIds)`.

**`WorkerSpec` shape:**
```ts
{
  cli: 'claude' | 'codex',
  envMode: 'isolated' | 'inherit' | 'merged' | 'no-worktree',
  repo?: string,                    // repo path, required unless no-worktree
  inheritFrom?: WorkerId,           // for 'inherit' mode
  mergeFrom?: WorkerId[],           // for 'merged' mode
  cwd?: string,                     // for no-worktree
  task: string,                     // injected as initial prompt
  skills?: string[],                // skill names to inject in system prompt
  tokenBudget?: number,             // HR-01 cap
  requiredServices?: string[],      // services to start before this worker runs
  dependsOn?: WorkerId[],           // dep graph parents
}
```

**Why split out:** The lifecycle has many decision points (env mode, dep waits, cleanup on crash vs graceful exit). Forcing these into the PtyManager would mix process-level concerns with workflow concerns, and forcing them into the Master Controller would couple workflow to the MCP transport.

### 5. `master/` — Master Controller

**Owns:** The single privileged PTY that runs the user's real `claude` CLI. Spawns it with the MCP plugin config that points back at the Bun process's MCP server (see below). Routes user chat-panel input to the Master PTY's stdin. Subscribes to `master.output_chunk` and forwards to SSE clients on `/sse/threads/:id/stream`. Implements the "Thinking drawer" (UI-05) by parsing Master's structured tool-call events (Claude Code emits these on a side channel; we capture them via the MCP server tool-call traffic).

**Does NOT:** spawn Workers (Master decides via MCP tool call, which lands on the MCP server, which delegates to `worker/`); know about service lifecycle; persist messages (DB layer does, triggered by bus subscribers).

**Public surface:** `master.start(workspaceId)`, `master.sendUserInput(text)`, `master.stop()`, `master.status(): { running, pid, costSoFar }`.

**Why split out:** The Master is privileged (only one), has a different prompt + permission model than Workers, and is the bridge between user chat and MCP tool world. Mixing it into Worker Supervisor would conflate "the one" with "the many."

### 6. `mcp/` — MCP Server (+ MCP Client)

**Owns:** Two facets:
1. **MCP Server** (Agenstrix → Master): exposes the **action tool catalog** to the Master's `claude` process over a stdio transport. The Master process is spawned by `MasterController` with an `--mcp-config` arg (or `CLAUDE_MCP_CONFIG` env var) pointing at a JSON file we generate at boot, registering Agenstrix as a stdio MCP server whose command is *another* Bun spawn that pipes JSON-RPC over an FD pair back to the parent Bun process. (Alternative discovered during research: a Streamable HTTP MCP server on `localhost:<port>/mcp` referenced from the config file — simpler to wire but adds an HTTP hop. Default to **stdio bridge** for v1 because it's the documented happy path; fall back to HTTP if the stdio bridge proves fragile.)
2. **MCP Client** (Agenstrix → third-party MCP servers): manages connections to `chrome-devtools-mcp` (built-in) and user-added MCP servers (MCP-03). Exposes their tools to Workers that opt in via their `WorkerSpec`.

**Tools the MCP server exposes to Master** (initial set; expandable per CORE-02):
- `spawn_worker(spec)` → `workerId`
- `send_to_worker(workerId, input)`
- `list_workers()`
- `kill_worker(workerId)`
- `start_service(serviceId)` / `stop_service(serviceId)`
- `list_services()`
- `wait_for_workers(workerIds[])` (returns when all complete)
- `read_worker_log(workerId)` (HR-19: last 50 PTY lines + final commit msg)
- `list_skills()`
- `inject_skill(workerId, skillName)`
- `update_learned_command(repo, command, port)` (DF-07: Master corrects workspace knowledge from chat)
- `add_dep(downstreamId, upstreamId)` (CORE-07)

**Does NOT:** decide what to do with tool calls (delegates to `worker/`, `service/`, `workspace/`); render anything; persist anything directly (each handler emits events and lets the bus persist).

**Public surface:** `mcp.serve(): { transport, dispose }`, `mcp.connectClient(name, transport): ToolList`, `mcp.invokeOnWorker(workerName, toolName, args)`.

**Why split out:** MCP transport is the single non-trivial protocol surface in the project. Co-locating server + client also lets us reuse the `@modelcontextprotocol/sdk` JSON-RPC plumbing for both directions.

### 7. `service/` — Service Supervisor

**Owns:** Lifecycle of dev servers (long-running, non-PTY child processes). Spawns via `Bun.spawn` with `stdio: ["ignore", "pipe", "pipe"]` (services are not TUIs; don't need PTY), captures stdout/stderr to a rolling log file (`~/.agenstrix/logs/services/<name>.log`), monitors via `health_check_url` (HTTP 2xx — HR-17, not just port open) and process existence, emits `service.ready` / `service.down`. Handles port conflict (SVC-05) with confirmation flow (HR-06) before killing the conflicting process; otherwise picks next free port via `get-port`. Tracks `services` table state in SQLite.

**Does NOT:** decide *which* services exist (workspace detector does that); know about Workers.

**Public surface:** `service.start(id)`, `service.stop(id)`, `service.list(): Service[]`, `service.health(id): 'up' | 'down' | 'starting'`.

**Why split out:** "Service" is a first-class concept (SVC-* requirements). Folding it into WorkspaceDetector would conflate "what is this project?" with "is the dev server alive?" — two different lifecycles.

### 8. `workspace/` — Workspace Detector & Learner

**Owns:** When a repo is added (WS-01), runs the detection pipeline (WS-02: `package.json` / `pyproject.toml` / etc; WS-03: scripts.dev → README grep → defaults; WS-04: port from configs); persists results to `repos` + `services` + `learned_commands`. Owns the trial-start flow (WS-05): asks `ServiceSupervisor` to start the candidate command; on failure, generates intelligent diagnostic + suggestion (WS-06) and emits `workspace.command_failed` (which the Master sees via MCP tool `list_workspace_failures` and can prompt the user). On user correction (WS-09), updates `learned_commands`.

**Does NOT:** run services (delegates to `service/`); render UI; decide when to add a repo (the user does via drag-drop, the gateway receives, calls workspace.add).

**Public surface:** `workspace.addRepo(path): RepoDetectionResult`, `workspace.list(): Repo[]`, `workspace.removeRepo(id)`, `workspace.updateLearnedCommand(repoId, fix)`, `workspace.diagnose(repoId): Diagnostic[]`.

**Why split out:** Detection logic is heuristic-heavy and per-language; it deserves a sandbox where we can grow signature recognition without touching the rest of the system.

### 9. `gateway/` — HTTP + SSE + WebSocket Gateway

**Owns:** The Hono app. Routes:
- `POST /api/workspace/repos` — add repo (drag-drop endpoint)
- `GET /api/workspace/repos` — list
- `POST /api/messages` — user typed in chat (→ `master.sendUserInput`)
- `GET /sse/threads/:id/stream` — Master output + tool events + topology mutations for one thread
- `GET /sse/system/health` — service status + cost ticker (single global SSE channel)
- `GET /ws/worker/:id` — Worker PTY bytes (binary), bidirectional (keystrokes via UI-04)
- `GET /ws/master` — Master PTY bytes (binary), bidirectional (chat panel mirror; optional)
- (Internal) `/mcp` — Streamable HTTP MCP fallback if stdio bridge proves unreliable

For each WS connection, sets up a bus subscription, pipes events to the socket, applies backpressure (`await ws.send(...)`). For SSE, uses Hono's `streamSSE` with `stream.onAbort()` cleanup.

**Does NOT:** spawn anything; persist anything (calls into modules above); contain business logic — just translates HTTP/WS/SSE ↔ module method calls + bus subscriptions.

**Public surface:** `gateway.listen(port): Server`.

**Why split out:** Separating transport from domain logic means we can mount the same modules in a test harness without HTTP, and the Tauri sidecar version can swap to a different port-handshake without touching modules.

### 10. `system/` — Process-level Concerns

**Owns:** Startup health check (INFRA-06 + HR-10): `which claude`, `which codex`, git version, SQLite writability, port availability — each with OS-specific fix instructions; graceful exit (SETUP-04): the **shutdown ordering protocol** (see Failure Modes below); pino-based logging (INFRA-05) — JSON to daily-rotated files in `~/.agenstrix/logs/`; ID generation (nanoid wrapper); cross-platform path helpers (Windows `GetShortPathNameW` via FFI for INFRA-07).

**Does NOT:** know domain concepts.

**Public surface:** `system.healthCheck(): HealthReport`, `system.installShutdownHandlers()`, `system.logger`, `system.newId(prefix)`.

---

## Frontend Component Boundaries

Three slices (matching the dual-view UI):

### 1. `ui/chat/` — Chat Panel (assistant-ui + react-i18next)

**Owns:** Markdown / code / diff streaming of Master messages, user composer with `@worker-N` mention parser (UI-10 → desugars to MCP `send_to_worker` call routed via the Master), Master Thinking drawer (UI-05) toggle. Subscribes to `/sse/threads/:id/stream`.

**Does NOT:** render terminal bytes; show topology.

### 2. `ui/topology/` — Topology Canvas (react-flow + Zustand)

**Owns:** The DAG of Master + Workers + dependency edges (DF-09 wait-line styling for unmet deps). Click on Worker → opens PTY drawer. Hover → shows last 3 tool calls (HR-14). State sync: Zustand store `workersStore` is the source of truth for worker domain state; react-flow's own `useNodesState` mirrors it (see Stack research §9). Subscribes to the same SSE stream as chat plus `dep_graph.*` events.

**Does NOT:** render terminal bytes (drawer does); persist state.

### 3. `ui/terminal/` — Worker PTY Drawer (xterm.js + addons)

**Owns:** One xterm.js instance per opened Worker (lazy-mounted; closing drawer disposes term but Worker stays alive, UI-04). Mounts WebGL renderer + Unicode11 addon + fit addon. WebSocket bridge to `/ws/worker/:id` for bytes in/out. On open, replays history via `pty_chunks` HTTP fetch + serialize-addon hydrate, then live-tail from WS.

**Does NOT:** know workflow logic; have its own state store beyond ephemeral term instance.

**Shared (`ui/common/`):** Zustand stores (`workersStore`, `servicesStore`, `costStore`, `workspaceStore`), tanstack-query for one-shot REST fetches (workspace list, settings), i18n.

---

## Data Flows (3 Demo Scenarios)

### Flow 1: User types in chat → Master responds

```
[User keystroke in ChatComposer]
   │ (HTTP POST /api/messages { threadId, text })
   ▼
[Gateway HTTP handler]
   │ master.sendUserInput(text)
   ▼
[MasterController]
   │ this.masterPty.write(text + "\r")        ← writes to Bun.Terminal stdin
   ▼
[PtyManager → Bun.Terminal]
   │ bytes flow to `claude` subprocess's PTY
   ▼
[claude CLI processes input, calls LLM, streams response back to its TTY stdout]
   │ Bun.Terminal `data` callback fires with chunks
   ▼
[PtyManager onData(chunk)]
   │ 1. db.repos.ptyChunks.appendChunk(masterId, chunk)   ← persistence (batched)
   │ 2. bus.publish('master.output_chunk', { masterId, chunk, seq })
   ▼
[EventBus]
   │ fans out to:
   │   a) SSE subscriber for thread (was subscribed when GET /sse/threads/:id/stream)
   │   b) Cost aggregator (parses for token counts if present in Claude's output)
   │   c) Master Thinking projector (if chunk contains tool-call markers)
   ▼
[Hono streamSSE handler]
   │ await stream.writeSSE({ event: 'master.output_chunk', data: JSON.stringify(...) })
   ▼
[Browser EventSource onmessage]
   │ chatStore.appendChunk(threadId, chunk)
   ▼
[ChatPanel re-renders with streamed markdown via assistant-ui]
```

**Latency target:** First chunk visible in UI within ~50ms of `claude` emitting it. Hop count: 4 (PTY → Bun → SSE → Browser).

**Key invariant:** Master output is captured *before* it reaches the user — every chunk is persisted *and* event-published in the same `onData` callback. SSE backpressure (via `await stream.writeSSE`) does not block PTY persistence (which is synchronous SQLite via WAL).

### Flow 2: Master spawns Worker (the orchestration moment)

```
[Master claude decides "I need a worker"]
   │ Master emits an MCP tool call (JSON-RPC over its stdio MCP transport)
   │   { jsonrpc: "2.0", id: 42, method: "tools/call",
   │     params: { name: "spawn_worker",
   │       arguments: { cli: "claude", envMode: "isolated",
   │         repo: "/Users/me/myapp-backend",
   │         task: "Add POST /register endpoint with email validation",
   │         tokenBudget: 50000 } } }
   ▼
[MCP stdio bridge subprocess]
   │ Forwards JSON-RPC frame over FD pair to parent Bun process
   ▼
[Bun MCP Server handler in mcp/]
   │ Matched to tool `spawn_worker`
   │ → workerSupervisor.spawn(spec)
   ▼
[WorkerSupervisor]
   │ 1. workerId = nanoid()
   │ 2. db.repos.workers.create({ id: workerId, ...spec, state: 'spawning' })
   │ 3. bus.publish('worker.spawned', { workerId, spec })     ← UI sees node appear
   │ 4. Prepare environment:
   │      - envMode='isolated': simple-git: `git worktree add .agenstrix/wt/<id> -b agenstrix/<id>`
   │      - copy/symlink only tracked files (HR-07: no .env leakage)
   │      - cwd = the new worktree path (HR-18)
   │ 5. Construct prompt: system-prompt header + injected skills + task + token-budget cap
   │ 6. pty.spawn({
   │       argv: ['claude'],
   │       cwd: worktreePath,
   │       env: { ...process.env, CLAUDE_INITIAL_PROMPT: prompt },
   │       cols: 120, rows: 30,
   │       onData: chunk => {
   │         db.repos.ptyChunks.appendChunk(workerId, chunk);
   │         bus.publish('worker.output_chunk', { workerId, chunk, seq });
   │       }
   │    })
   │ 7. db.repos.workers.update(workerId, { state: 'running', pid })
   │ 8. bus.publish('worker.state_changed', { workerId, state: 'running' })
   ▼
[MCP server returns to Master]
   │ { jsonrpc: "2.0", id: 42, result: { workerId: "wk_abc123" } }
   ▼
[Master claude continues, knows workerId for later send_to_worker / wait_for_workers calls]

   (meanwhile, in parallel:)

[Worker's claude renders ASCII logo, takes initial prompt, starts working]
   │ output chunks flow to bus per (6)
   ▼
[Two subscribers fan out:]
   │
   ├─► [Topology projector]
   │      → bus.publish('dep_graph.node_added', { workerId, role, cli })
   │      → SSE 'topology' event to all browser clients
   │      → Browser's topologyStore adds a node; react-flow re-renders
   │
   └─► [WS Gateway (if a browser drawer is open for this worker)]
          → ws.send(chunk)  (binary)
          → Browser xterm.js term.write(chunk)
          → User sees real claude UI rendering live
```

**Hop count from Master's decision to UI showing the new node:** 6 (Master PTY → stdio bridge → MCP handler → WorkerSupervisor → bus → SSE → Browser). Typically <100ms. The PTY spawn itself is the longest step (~1-2s for claude's startup); the node appears with a "spawning" state immediately and transitions to "running" when the spawn completes (HR-11 spawn target ≤ 3s).

### Flow 3: Worker completes → conditional next spawn → service auto-start chain

This is the load-bearing demo flow.

```
[Worker-1 (backend) writes code, commits, types `/exit` in claude]
   │ claude subprocess exits cleanly with code 0
   ▼
[Bun.Terminal's child exit fires]
   │ PtyManager: pty.exited.resolve(0)
   ▼
[WorkerSupervisor.onPtyExit(workerId, code)]
   │ if envMode === 'isolated' or 'inherit':
   │   simple-git: `git add -A && git commit -m "agenstrix: worker <id> task"`
   │   simple-git: `git worktree remove --force .agenstrix/wt/<id>`
   │ // HR-15: even if worker crashed (code !== 0), still cleanup worktree
   │ db.repos.workers.update(workerId, { state: 'done', exitCode: 0 })
   │ bus.publish('worker.exited', { workerId, code, branch: 'agenstrix/<id>' })
   ▼
[Dep graph reconciler (subscribes to worker.exited)]
   │ For each downstream worker W' whose deps now all satisfied:
   │   1. Collect W'.requiredServices
   │   2. For each service S not running:
   │        serviceSupervisor.start(S)
   │        → bus.publish('service.starting', { id: S })
   │        → Bun.spawn(<learned command>, { cwd: <learned repo>, env, stdio: ["ignore","pipe","pipe"] })
   │        → ServiceSupervisor begins HTTP 2xx polling on healthCheckUrl
   │        → on first 2xx: bus.publish('service.ready', { id: S })   ← HR-17
   │   3. Wait for all required services to publish 'ready' (with timeout)
   │   4. workerSupervisor.spawn(W'.spec)  ← same flow as Flow 2
   ▼
[Worker-2 (frontend) spawns now that backend service is up]
   │ ... (same as Flow 2)

   (later, Worker-1 AND Worker-2 both 'done')
   ▼
[Dep graph reconciler]
   │ Worker-3 (test, codex, no-worktree, requiredServices=[backend, frontend])
   │ frontend service not yet started → ServiceSupervisor.start('frontend-dev')
   │ Wait for both 'ready'
   │ Worker-3 spawns with codex CLI, MCP client tool-list includes chrome-devtools-mcp
   │ (codex sees chrome-devtools-mcp tools because we wired the MCP client at worker spawn)
   ▼
[Worker-3 calls chrome-devtools-mcp tools, opens browser, runs tests]
   │ Test output streams to its PTY → bus → UI → user sees it live
   ▼
[Worker-3 exits → bus.publish('worker.exited')]
   │ Dep graph reconciler: no downstream workers, no auto-action
   │ Master claude still running; can be told (via send_to_worker fan-in if Master
   │ wired a wait_for_workers call) that all done. Master summarizes to user.
```

**Critical detail:** the Dep graph reconciler is a **separate subscriber** to `worker.exited`, not a method on WorkerSupervisor — this keeps "manage one worker" separate from "manage the DAG."

**Service auto-start "ready" semantics:** port-open is *not* enough. ServiceSupervisor polls `GET <healthCheckUrl>` until HTTP 2xx with a 5s grace period after the process spawns. Without this, Worker-3 hits 502 on a still-warming Next.js dev server and reports a false test failure (HR-17, cited as a top failure mode).

---

## Suggested Build Order

The locked stack constrains options heavily. The right ordering minimizes throwaway work and keeps the system testable end-to-end as early as possible.

### Phase 1 — "Hollow Bun" (the chassis)

**Order matters within this phase. Do not parallelize the first three.**

1. **`system/` + `db/`** — pino logger, SQLite + Drizzle schema for all 11 tables, migrations runner, health-check skeleton. *Why first:* every other module logs and persists. Without the schema, you can't write Worker spawn code without making up shapes that change later.
2. **`bus/`** — in-memory pub/sub with async iterators and the topic taxonomy. *Why second:* every spawn / lifecycle change emits events. Writing modules that "we'll add the bus calls later" guarantees you forget them.
3. **EventBus → SQLite sink** (lives in `system/`) — every event auto-persisted to `events` table for INFRA-04 event sourcing + HR-13 crash recovery. *Why now:* retrofitting persistence onto an emitting bus that's already populated wastes time.
4. **`gateway/` skeleton** — Hono app, REST `/api/health`, SSE `/sse/system/health` that just streams `system.health_check` events. *Why now:* you need a way to verify the previous three from a browser before adding subprocess complexity.

**Exit criteria:** Bun starts, browser opens, sees health-check ticks streaming via SSE. No PTYs yet. ~2-3 days of work.

### Phase 2 — "First PTY" (prove the foundation)

5. **`pty/`** — `Bun.Terminal` wrapper, `PtyHandle` interface, chunk batcher, process-group detach for SIGTERM propagation. Smoke-test by spawning `bash` and round-tripping a few commands.
6. **Worker terminal WS bridge** in `gateway/` — `/ws/worker/:id`, bind a PTY to a WebSocket, browser xterm.js bridge.
7. **`worker/` minimal** — `spawn`/`kill`/`list` for the simplest case: `no-worktree` mode, no deps, no skills. Spawn `claude` and `codex` interactively; verify TUI renders intact in xterm.js with the ASCII logo, permission prompts, diff cards.

**Exit criteria:** From the browser, you can spawn a real `claude` Worker, type into it, see it render, kill it. INFRA-03 persistence works (you can close the drawer and reopen to a replayed log). This validates the riskiest part of the locked stack (Bun.Terminal + claude TUI fidelity).

### Phase 3 — "Smart Workspace"

8. **`workspace/`** — drag-drop endpoint, detection pipeline (WS-02/03/04), persistence to `repos`.
9. **`service/`** — spawn dev servers, HTTP 2xx health check, port conflict handling (with confirmation event), service status SSE.
10. **WS-05 trial-start** — on `workspace.addRepo`, ask `service/` to try the candidate command; success → persist; failure → emit `workspace.command_failed` with diagnostic.
11. **UI: workspace bar + service status** (UI-11 + SVC-04) — the first user-visible "wow" feature.

**Exit criteria:** Drag two folders in, see them auto-detected, see dev servers come up, see green dots. The 5-minute onboarding gauntlet works up to t+2:00.

### Phase 4 — "Master + MCP"

12. **`mcp/` server** — stdio transport, register Agenstrix tools, plumb to `worker/` and `service/`. Test with the MCP Inspector standalone first (no Master yet).
13. **`master/`** — spawn the user's real `claude` with the MCP config pointing at our server. The Master can now call `spawn_worker`, `list_workers`, etc.
14. **Chat panel + Master streaming** — `/api/messages`, `/sse/threads/:id/stream`, assistant-ui rendering.
15. **`mcp/` client** — wire `chrome-devtools-mcp` as built-in; user can configure additional servers (SETUP-03).

**Exit criteria:** User types "spawn a backend worker," Master decides, calls MCP tool, Worker appears with output streaming. The demo loop is closed.

### Phase 5 — "Topology + Dep Graph"

16. **Topology canvas** — react-flow + topology projector subscriber on `worker.*` and `dep_graph.*` events.
17. **Dep graph reconciler** — service auto-start between Workers, wait-edges, the full Flow 3.
18. **4 environment modes** — extend `worker/` to handle `inherit`, `merged`, `no-worktree`; `merged` is the gnarliest (git merge with conflict handling).
19. **Master Thinking drawer (UI-05)** — projector that re-renders Master tool-call events into a structured event log.

**Exit criteria:** End-to-end demo scenario in PROJECT.md (Worker-1 → service auto-start → Worker-2 → both ready → Worker-3 with chrome-devtools).

### Phase 6 — "Production polish"

20. HR-01/02 (token budgets), HR-05 (cascading kill), HR-07 (gitignore-aware), HR-15 (worktree cleanup on crash), HR-19 (worker exit summary tool), HR-13 (crash recovery via event replay).
21. Cross-platform validation on Windows; bun-pty fallback path.
22. SETUP-04 graceful exit ordering protocol (see Failure Modes).
23. Cost dashboard (UI-07), `@worker-N` mention syntax (UI-10), Skills (ASSET-02).

### Build order rationale (the "why")

- **DB before PTY**, because every PTY spawn writes chunks; retrofitting persistence to a working PTY bridge means rewriting the chunk handler.
- **Bus before modules**, because cross-module communication is the topology of the architecture; modules built without the bus invariably grow ad-hoc direct calls that must be ripped out.
- **PTY before Workers**, because PTY is the riskiest unverified part of the locked stack (Bun.Terminal on Windows is 4 days old at research time); failing here would force a stack change, so prove it works before building dependents.
- **Smart Workspace before MCP/Master**, because (a) it's the unique-value gate per FEATURES.md Phase B reasoning, (b) it's testable without Master, and (c) Master+MCP is more complex; you want to debug each in isolation.
- **MCP server before topology UI**, because the topology shows what MCP-driven actions produced; without MCP working, topology is a static demo.
- **Dep graph after MCP**, because deps are declared via MCP tool calls (`spawn_worker` with `dependsOn`); the reconciler is a consumer of bus events that the MCP handlers produce.
- **Polish (HR-*) at the end**, because most are hardening of existing flows, not new functionality. Exception: HR-17 (service ready 2xx) must be in Phase 3 — without it, Phase 5 demo fails.

---

## State Ownership

The single biggest source of bugs in multi-process systems is unclear state ownership. The table below covers **every piece of state** in Agenstrix.

| State | Lives In | Mutator | Reader(s) | Persistence | Notes |
|---|---|---|---|---|---|
| Workspace repos & detected metadata | SQLite `repos` | `workspace/` | `workspace/`, `worker/`, `service/`, UI | Yes (durable) | One row per repo; never deleted on close |
| Learned start commands & ports | SQLite `learned_commands` | `workspace/` (auto + user correction) | `service/` | Yes | Single source of truth for SVC config |
| Service definitions | SQLite `services` | `workspace/` (on detect) | `service/` | Yes | One row per service ever detected |
| Service runtime state (running/down/PID) | In-memory in `service/` | `service/` | `service/`, `worker/` (deps), UI via SSE | No (transient — re-derived on start) | Persisting "is it running?" across crashes is misleading |
| Worker definitions (one row per ever-spawned) | SQLite `workers` | `worker/` | `worker/`, UI, `master/` (via MCP `list_workers`) | Yes | Includes spec, exit code, branch, timing |
| Worker runtime PTY handle | In-memory in `pty/` | `pty/` | `worker/`, `gateway/` WS bridge | No | Dies with Bun process; replay from `pty_chunks` |
| Worker PTY byte stream history | SQLite `pty_chunks` | `pty/` (auto-batched) | `gateway/` (replay on drawer open), `master/` (via `read_worker_log`) | Yes | ~100KB chunks; HR-04 ring-buffer if disk thresh |
| Master conversation history | SQLite `conversations` + `messages` | `master/`, `gateway/` HTTP handler | `gateway/` SSE, UI | Yes | Streamed assemblage from `master.output_chunk` events |
| Master PTY byte stream | SQLite `pty_chunks` (same table, masterId as key) + in-memory `pty/` handle | `pty/` | `master/`, UI replay | Yes | Master treated as a special Worker for storage purposes |
| Master Claude's own conversation context | Inside the `claude` subprocess (not Agenstrix-accessible) | `claude` CLI internals | `claude` CLI only | No (lives in Claude Code's own state files in `~/.claude/`) | We cannot inspect or modify; we only see PTY bytes and MCP tool calls |
| Worker Claude/Codex's own context | Inside each worker subprocess | the CLI itself | The CLI itself | No | Same as Master |
| Event log (every state change) | SQLite `events` | `bus/` sink subscriber | `master/` (history queries), HR-13 crash recovery, debug tools | Yes | Append-only; never updated |
| Dependency graph (deps between workers) | SQLite `workers.dependsOn` JSON column + in-memory derived adjacency in `worker/` | `worker/` (via MCP `add_dep`) | Dep reconciler, topology UI | Yes (the deps) / No (adjacency cache) | Re-derived on restart from rows |
| Skills (frontmatter + body) | SQLite `skills` + watched filesystem `~/.agenstrix/skills/*.md` | `workspace/` watcher (chokidar) | `worker/` spawn prep, Master via `list_skills` | Yes | File is source of truth; SQLite is index |
| Templates (.md spells + .agenstrix-pack) | SQLite `templates` + watched filesystem | Same pattern as Skills | Master, UI | Yes | Same pattern as Skills |
| MCP tool registry (Agenstrix's exposed tools) | Hardcoded in `mcp/` | Compile-time | MCP transport handler | No | Versioned with code |
| MCP client connections to 3rd-party servers | In-memory in `mcp/` + SQLite `mcp_servers` for config | `mcp/` | `worker/` spawn prep | Config: Yes / connections: No | Reconnect on Bun start |
| Cost ticker (current session $) | In-memory aggregator subscribed to `cost.delta` events | `cost` aggregator (in `system/` or `gateway/`) | UI via SSE | No (events durable) | Re-derivable by replaying events |
| SSE / WS active subscriber map | In-memory in `gateway/` | `gateway/` (on connect/disconnect) | `gateway/` only | No | Connection state |
| Active conversation thread ID per user | URL state in browser only | Browser router | Browser only | No (URL is the state) | Single-user assumption |
| User settings (CLI paths, theme, lang, worktree root, MCP servers list) | SQLite `settings` (single-row table) | `gateway/` PUT `/api/settings` | All modules | Yes | Reload some on change (e.g., theme is FE only; mcpServers requires MCP client reconnect) |
| i18n active locale | Browser localStorage + `settings.lang` | Browser | Browser only | Yes (Browser) | Bun doesn't need to know |

**The most important row:** *Master Claude's own conversation context* lives **inside the subprocess we cannot inspect**. Agenstrix's view of "what does Master know" is reconstructed entirely from (a) PTY bytes we captured and (b) MCP tool calls we received. This is why the event log + the Master Thinking projector matter so much — they're our *only* window into Master's reasoning.

---

## Failure Boundaries & Recovery

A multi-process system needs to be explicit about every failure mode, what survives it, and what recovery looks like.

### Failure mode matrix

| What fails | What dies with it | What survives | Recovery |
|---|---|---|---|
| **Bun process crash (OOM, kernel kill, panic)** | All child PTYs (including Master), all Service procs, all MCP server connections, in-memory bus/state, WS/SSE clients | SQLite (WAL ensures durability), worktrees on disk, conversation history, learned commands, event log up to last fsync | On restart: replay `events` to reconstruct dep graph & topology; show "Last session terminated unexpectedly. [Resume / Start fresh]" (HR-13). Resume re-spawns Master with conversation context recap injected as prompt; Workers do not auto-resume (their state is in their own context inside the dead subprocess); offer "kill orphan worktrees" cleanup |
| **One Worker crashes** | Its PTY only | All other Workers, Master, services, Bun process | WorkerSupervisor sees PTY exit with nonzero code → emits `worker.exited { code: N, error: true }` → marks worker `error` in DB → still runs worktree cleanup (HR-15) → Dep reconciler does **not** spawn dependents (cascading hold). Master sees via `wait_for_workers` poll and decides what to do |
| **Master `claude` crashes** | Master PTY only | Workers continue, services continue, Bun process | This is the hard one. Workers in-flight have no parent to report to. Two policies (we choose B): (A) hard-stop everything; (B) keep Workers running until they self-exit, mark conversation "Master disconnected", offer user "Restart Master with recap" which spawns new claude with summary of recent events as initial prompt. Critically the MCP transport is broken until restart, so Master cannot spawn more Workers |
| **Service process dies (dev server crashes)** | Just the service | Workers depending on it keep running but will fail HTTP calls; other Workers unaffected; Master can see via `list_services` | ServiceSupervisor's health check detects within 5s, emits `service.down`, no auto-restart (HR-15 — auto-restart hides bugs). User or Master can call `start_service` to retry |
| **MCP stdio bridge crashes (the bridge subprocess between Master and Bun)** | Master loses ability to call MCP tools | Master PTY itself, Workers, services | Bun process detects bridge exit via Bun.spawn exited promise, respawns bridge, updates MCP config — but Master claude already started with old config and won't reconnect mid-session. Practical recovery: surface to user; user restarts Master |
| **`chrome-devtools-mcp` or other MCP-client child dies** | Tools from that server unavailable to Workers wired to it | Everything else | MCP client auto-reconnect with exponential backoff up to 5 attempts; if still down, mark unavailable, emit `mcp.tool_errored` for any in-flight call |
| **Disk full** | Next SQLite write fails; PTY chunk batch fails | Everything else briefly; cascading writes will fail | HR-04: PtyManager has soft ring-buffer mode when `pty_chunks` table > N MB/session — drops oldest chunks instead of crashing. Critical writes (workers, events) escalate to alert |
| **Network blip (browser ↔ Bun)** | One WS or SSE connection drops | All else | Browser auto-reconnect to WS (xterm.js bridge has retry); SSE EventSource auto-reconnects with Last-Event-ID for replay. Bun side: subscribers cleaned up via `stream.onAbort()` and WS `onClose`. **Zero impact on backend** because backend doesn't *push* — it publishes to bus; if no subscriber, events still go to SQLite |
| **Bun shutdown signal (SIGINT / Ctrl+C / window close / Tauri quit)** | Controlled, see protocol below | Everything that should — conversation, learned commands, event log | SETUP-04 graceful exit |
| **Worktree on disk gets clobbered externally** | Worker writing there will get git errors | Other workers fine | Worker writes will fail loudly; HR-15 garbage collector on next startup scans for orphaned `<repo>/.git/worktrees/agenstrix-*` and removes |

### Graceful shutdown protocol (SETUP-04)

Order is critical — wrong order = orphan processes + lost commits.

```
1. system/ receives signal (SIGINT / SIGTERM / Tauri quit event)
2. bus.publish('system.shutdown_initiated')
3. gateway/ stops accepting new HTTP / WS / SSE
4. master/ blocks new master.sendUserInput calls; injects "" or Ctrl+C to claude to let it finish current turn
5. worker/ for each running Worker:
     a. send SIGTERM to PTY (via Bun.Terminal.kill(15) which hits process group due to detached:true)
     b. wait up to 5s for exit
     c. if still alive, send SIGKILL
     d. run worktree cleanup (commit + worktree remove) even on forced kill (HR-15)
6. master/ kill Master PTY same protocol
7. service/ stop all services (SIGTERM, 3s grace, SIGKILL)
8. mcp/ disconnect all MCP clients
9. db/ explicit checkpoint: sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)")
10. bus/ flush remaining events to SQLite sink
11. Bun process exits 0
```

**Cross-platform note (HR-05 cascading kill):** On Linux, step 5a relies on `detached: true` setting the PTY child as its own process group leader, so `kill(-pgid, SIGTERM)` reaches the whole `claude` tree. On macOS, same. On Windows, ConPTY handles this via the kernel; `Bun.spawn`'s `kill()` propagates correctly. Bun.spawn does *not* yet expose `setpgid` directly (per Bun GH#1442); use `detached: true` as the equivalent. If a child still escapes (rare), a fallback `taskkill /F /T /PID <pid>` (Windows) or `pkill -P <pid>` (POSIX) sweep runs as last resort.

### Crash recovery (HR-13)

On Bun startup, before serving:
1. Run migrations.
2. Check `events` table for an unterminated session (most recent `system.startup` without subsequent `system.shutdown_initiated`).
3. If found: display modal "Last session ended unexpectedly with N Workers running. Resume?" — Resume re-derives last topology from events, replays last 20 Master messages into a context recap, but does **not** automatically respawn Workers (their internal state is gone with their dead subprocesses); just shows them as `terminated`.
4. Optionally cleanup orphan worktrees: scan `<each repo>/.git/worktrees/` for `agenstrix-*` directories with no matching active Worker row → prompt user to remove.

---

## Cross-Process Communication Patterns

Five distinct boundaries, each with its own protocol. Mixing them up = subtle bugs. This section is the protocol reference.

### Boundary 1: Bun process ↔ Worker / Master PTY subprocess

**Protocol:** `Bun.Terminal` PTY (POSIX) or ConPTY (Windows) for byte-stream I/O.

**Inbound (Bun → CLI subprocess):** `Bun.Terminal.write(bytes)` — raw bytes; what the user types in chat or what a UI keystroke injection sends. For Master, also includes the initial prompt injected on spawn via `CLAUDE_INITIAL_PROMPT` env var or as the first `write()` call after spawn settles.

**Outbound (CLI subprocess → Bun):** `Bun.Terminal` constructor's `data: (term, chunk) => ...` callback — raw bytes including ANSI escape sequences, cursor moves, color codes. Bun does NOT interpret these; they're persisted to `pty_chunks` and forwarded to subscribers verbatim. xterm.js on the browser is the only thing that renders them.

**Lifecycle:** Spawn via `Bun.spawn(argv, { terminal, cwd, env, detached: true })` returning a `Subprocess` whose `.exited` is a Promise. Kill via `proc.kill(15)` then `proc.kill(9)` after 5s.

**Gotcha (HR-04):** the `data` callback can fire 1000+ times per second on heavy output (e.g., `npm install`). Chunk batcher must aggregate to ~100KB or 250ms boundaries before SQLite write; otherwise SQLite WAL fills with thousands of tiny commits.

### Boundary 2: Bun process (MCP server) ↔ Master `claude` (MCP client)

**Protocol:** JSON-RPC 2.0 over a stdio transport, using `@modelcontextprotocol/sdk`'s `Server` class with `StdioServerTransport`.

**Setup:** At Master spawn, Bun:
1. Generates a per-session MCP config file at `~/.agenstrix/runtime/master-mcp-config.json`:
   ```json
   {
     "mcpServers": {
       "agenstrix": {
         "type": "stdio",
         "command": "<path-to-bun-binary>",
         "args": ["<path-to-agenstrix>/mcp-bridge.ts", "--session", "<sessionId>"]
       }
     }
   }
   ```
2. Spawns Master `claude` with env `CLAUDE_MCP_CONFIG=<that path>` (or the project-local `.claude.json` mechanism — Claude Code searches several locations; the env-var path is the most explicit).
3. Master's `claude` reads the config, spawns the `mcp-bridge.ts` as its own subprocess.
4. `mcp-bridge.ts` is a tiny Bun script that opens a connection back to the parent Bun process — either via a Unix-domain socket at `~/.agenstrix/runtime/mcp-<sessionId>.sock` (POSIX) / named pipe (Windows), or via a localhost TCP port. The bridge forwards JSON-RPC frames between Master's stdio and the parent Bun.
5. Parent Bun's `mcp/` module accepts the connection and routes tool calls to handler functions that delegate to `worker/`, `service/`, `workspace/`.

**Why the bridge?** Because Claude Code spawns its MCP servers as its own child processes via the config — there's no documented way to give it an open FD pair to an existing process. The bridge subprocess is the glue.

**Alternative (simpler, less robust):** point the config at a Streamable HTTP MCP server hosted by the gateway:
```json
{ "mcpServers": { "agenstrix": { "type": "http", "url": "http://localhost:3000/mcp" } } }
```
Trades: simpler wiring (no bridge subprocess), but adds an HTTP hop and is documented as `Streamable HTTP` per MCP spec. Use this as fallback if the stdio bridge proves fragile across Claude Code version updates.

**Tool surface (initial set):** see `mcp/` component above.

**Versioning:** the MCP server advertises a version + tool list at initialization; the Master sees these and uses them. Adding a new tool is a no-rebuild action on the Master side — just a Bun deploy.

### Boundary 3: Bun process (MCP client) ↔ Third-party MCP servers (chrome-devtools-mcp, user-added)

**Protocol:** Same JSON-RPC over stdio, but Bun is the *client*. Uses `@modelcontextprotocol/sdk`'s `Client` class + `StdioClientTransport`.

**Setup:** For built-in chrome-devtools-mcp:
```ts
const transport = new StdioClientTransport({
  command: "npx",
  args: ["chrome-devtools-mcp"],
  env: { ...process.env, /* any user config */ }
});
const client = new Client({ name: "agenstrix", version: "1.0" }, {});
await client.connect(transport);
const tools = await client.listTools();
```

For user-added MCP servers (MCP-03), config in SQLite `settings.mcpServers` JSON, reconnect on Bun start.

**Exposure to Workers:** When a Worker is spawned with `useMcpServers: ['chrome-devtools-mcp']`, the WorkerSupervisor generates a per-Worker MCP config file (same pattern as Master) listing those servers, and the Worker's `claude`/`codex` reads it. So **third-party MCP tools are NOT proxied through Agenstrix** — they're direct stdio between the Worker subprocess and the third-party server. This avoids Agenstrix becoming an MCP bottleneck (HR-09) and isolates failures.

**Rate-limiting (HR-09):** when Agenstrix itself is calling a third-party MCP server (rare; mostly for orchestration tools we add later), wrap calls in a per-server p-limit (e.g., max 3 concurrent).

### Boundary 4: Bun process ↔ Browser, SSE channel

**Protocol:** Server-Sent Events over HTTP (text). Hono's `streamSSE` helper.

**Channels:**
- `/sse/threads/:threadId/stream` — Master output, tool events, Master Thinking events for one conversation. Closes when thread closes.
- `/sse/topology` — `worker.spawned`, `worker.state_changed`, `dep_graph.*` events for the whole workspace.
- `/sse/system` — `service.*`, `cost.delta`, `workspace.*` for the global header / status bar.

**Frame format:**
```
event: worker.state_changed
id: 12847
data: {"workerId":"wk_abc","state":"done","exitCode":0}

```

**Reconnection:** EventSource auto-reconnects; we honor `Last-Event-ID` for replay from `events` table. Subscriber cleanup via `stream.onAbort()`.

**Why SSE not WS for these?** One-way is sufficient; SSE survives HTTP proxies better; auto-reconnect is built-in; lower per-message overhead than WS for small text frames.

### Boundary 5: Bun process ↔ Browser, WebSocket channel

**Protocol:** WebSocket via `hono/bun`'s `upgradeWebSocket` + the **required** `export default { fetch, websocket }`. Binary frames.

**Channels:**
- `/ws/worker/:workerId` — bidirectional. Server → client: raw PTY bytes. Client → server: keystrokes (UI-04) and resize control messages (`{"type":"resize","cols":N,"rows":M}` as JSON text frame).
- `/ws/master` — same shape for Master PTY mirror (used by chat panel if user wants raw view; optional).

**Backpressure:** `await ws.send(bytes)`. If the client is slow, this blocks the bus subscriber for that connection. Bus is per-subscriber, so other subscribers unaffected.

**Keepalive:** Bun's default `idleTimeout: 120` will close idle sockets; we set `idleTimeout: 0` *or* send a periodic null frame every 30s (preferred — `idleTimeout: 0` disables detection of dead sockets).

**Why WS not SSE for PTY bytes?** Bidirectional (keystrokes); binary (no UTF-8 encoding overhead on ANSI escapes); explicit close semantics for the lazy-mount pattern.

### Boundary 6: Bun process ↔ Service subprocesses

**Protocol:** `Bun.spawn` with `stdio: ["ignore", "pipe", "pipe"]` (no PTY — services are not TUIs).

**Stdout/stderr handling:** piped to a per-service log file at `~/.agenstrix/logs/services/<id>-<date>.log` via Bun stream piping. Last N kilobytes also kept in memory for fast UI display.

**Lifecycle signals:** SIGTERM with 3s grace, then SIGKILL. Process-group detach so `pnpm dev` (which spawns its own children) gets fully torn down.

**Health checking:** out-of-band — ServiceSupervisor's polling loop hits `healthCheckUrl` every 1s with 2s timeout until 2xx (HR-17), then drops to 5s interval for liveness.

### Boundary 7: Bun process ↔ SQLite

**Protocol:** Synchronous calls via `bun:sqlite` + Drizzle, all queries on the main thread. **No worker threads** for DB.

**Why synchronous?** SQLite (WAL mode) writes are fast enough (~0.1ms typical); the async overhead of a worker thread is higher than the query time for everything except multi-megabyte BLOBs. The only operation that could justify async is `pty_chunks` writes if they become a bottleneck — measure first.

**Migrations:** `migrate()` is async (its only async API) and runs once at boot, before serving.

**Connection:** single `Database` instance shared across the Bun process (SQLite handles concurrent reads natively with WAL).

---

## Anti-Patterns to Avoid

### AP-1: Putting MCP tool handlers in the Master Controller

**What people do:** "spawn_worker is a Master-initiated action, so put the handler in `master/`."

**Why wrong:** Couples the MCP transport surface to Master internals. Also makes it hard to invoke the same tool from tests, the CLI, or a future "second Master" scenario.

**Do instead:** `mcp/` owns the tool surface; handlers delegate to `worker/`, `service/`, `workspace/`. The Master is just one MCP client of many possible.

### AP-2: Storing live PTY state in SQLite

**What people do:** "Update workers.status='running' on every PTY event so the UI is always consistent."

**Why wrong:** Burns SQLite writes for ephemeral state; UI updates from SQLite polling instead of the live event stream; on crash, stale "running" rows mislead recovery.

**Do instead:** Live state in memory + event bus; SQLite stores facts that must survive crash (spec, exit code, transitions as events). UI subscribes to the event stream.

### AP-3: Letting any module write to SQLite directly

**What people do:** Import `db` from anywhere; sprinkle `db.insert(...)` across modules.

**Why wrong:** Schema changes touch every module; query duplication; can't change DB engine.

**Do instead:** `db/` exposes typed repository functions; other modules call those. The schema lives in one place.

### AP-4: Synchronous fan-out from PTY data callback

**What people do:** Inside `Bun.Terminal`'s `data` callback, run several `await`s — persist, then publish, then update topology, then call MCP, then…

**Why wrong:** PTY data is high-frequency. Blocking the callback drops bytes (Bun buffers some, but not unlimited) and creates head-of-line blocking.

**Do instead:** Callback does one thing — `bus.publish(...)`. Persistence happens in a bus subscriber (batched). Everything else is its own subscriber. Bus subscribers run on the event loop, not in the callback.

### AP-5: Sharing one WS for everything

**What people do:** Open one WS, multiplex all events through it with a `type` field.

**Why wrong:** Lazy-mount is hard (you can't unsubscribe from one event stream cleanly); backpressure on one stream blocks others; no Hono route-level type safety.

**Do instead:** One WS per Worker terminal, separate SSE for topology / chat / system. Per-channel lifecycle.

### AP-6: Auto-restarting failed services or Workers

**What people do:** "Worker crashed? Spawn a new one with the same prompt."

**Why wrong:** Same prompt → same crash → infinite loop burning tokens. Hides bugs the user needs to see.

**Do instead:** Mark as `error`, surface to user / Master, let the human (or the Master with judgement) decide. v2+ may add explicit `retry_worker(workerId)` MCP tool with idempotency keys.

### AP-7: Coupling topology rendering to the dep graph reconciler

**What people do:** Topology UI directly reads from the reconciler's in-memory adjacency map.

**Why wrong:** UI now must reach across the architecture; reconciler updates without UI; tight coupling.

**Do instead:** Reconciler emits `dep_graph.*` events; topology projector (separate subscriber) maintains the UI view model; UI subscribes to projector via SSE. Three loosely coupled stages.

### AP-8: Putting xterm.js state in Zustand

**What people do:** Store the terminal buffer, scroll position, etc., in a Zustand store for "consistency."

**Why wrong:** xterm.js has its own internal buffer; mirroring breaks performance and creates two sources of truth.

**Do instead:** xterm.js owns terminal state; Zustand owns "is this drawer open" + "what worker is selected." Marriage by reference, not state mirroring.

---

## Integration Points Summary

### External services

| Service | Integration Pattern | Notes |
|---|---|---|
| `claude` CLI | `Bun.Terminal` + `Bun.spawn`, full PTY, with `--mcp-config` env var | The "real CLI" promise. Cannot use `claude -p` or SDK |
| `codex` CLI | Same as `claude` | Worker only (no `--mcp-config` mechanism documented for codex; Workers don't need to call back into Agenstrix anyway) |
| Git | `simple-git` library (shells to `git`) | Worktree create/remove/merge; commit on worker exit |
| `chrome-devtools-mcp` | `@modelcontextprotocol/sdk` `Client` over stdio (`npx chrome-devtools-mcp`) | Built-in for test Workers |
| User-added MCP servers | Same SDK Client pattern, configs in SQLite | MCP-03 |
| Tauri v2 host (desktop only) | This Bun process runs as sidecar binary; Tauri provides system tray + file drop events | v2 milestone |

### Internal boundaries (module ↔ module)

| Boundary | Communication | Notes |
|---|---|---|
| `worker/` ↔ `pty/` | Direct method call (`pty.spawn(...)`) | `worker/` owns lifecycle; `pty/` owns transport |
| `worker/` ↔ `service/` | Bus event (`service.ready`) + direct method call (`service.start(id)`) | Worker waits on event; triggers via method |
| `mcp/` ↔ `worker/`, `service/`, `workspace/` | Direct method call (handler delegation) | MCP is the integration surface, not a translator |
| `master/` ↔ `pty/` | Direct method call | Master is a privileged PTY |
| `master/` ↔ `mcp/` | Bus event (`mcp.tool_invoked`) for observation only | MCP server gets calls from Master claude, not from `master/` module |
| All modules → `db/` | Direct method call (typed repos) | One-way dependency |
| All modules → `bus/` | `bus.publish(...)` | One-way write |
| `gateway/` → bus | `bus.subscribe(...)` per HTTP connection | One-way read |
| `gateway/` ↔ all modules | Direct method call (for REST handlers) | One-way (gateway depends on modules, not vice versa) |

**The dependency graph is a DAG with `bus/` and `db/` as roots; no cycles.**

---

## Scaling Considerations

For Agenstrix the scaling axis is *not* "more users" (single-user / self-host by design). It's *more Workers in parallel*. Targets:

| Scale | Architecture Adjustments |
|---|---|
| 1-4 concurrent Workers | Default works. ~200MB RAM. No tuning. |
| 4-8 concurrent Workers | Need WebGL renderer for xterm.js (HR-20). PTY chunk batcher tuned to 250ms windows. Watch SQLite WAL size. |
| 8-16 concurrent Workers | Lazy-mount xterm.js (HR-20 mandated). Service health-check intervals stagger to avoid thundering herd. Consider WAL checkpoint every 5min. Master needs HR-01 token budget caps to keep costs bounded — at 16 Workers a runaway is $20/min. |
| 16+ concurrent Workers | Out of v1 scope. Real-world: most user laptops can't run 16 `claude` instances anyway (RAM + LLM API rate limits). v3 would consider work-stealing scheduler. |

### Scaling priorities (what breaks first, in order)

1. **Browser CPU at 8+ open terminals** — xterm.js × 8 active = ~80% CPU on M1 Air. Solution: lazy-mount + WebGL + dispose on close (only one drawer at a time anyway in current UX).
2. **SQLite WAL growth from PTY chunks** — 8 Workers × 100KB/s = 800KB/s × 1hr = 2.88GB. Solution: HR-04 ring buffer + periodic `wal_checkpoint(TRUNCATE)`.
3. **MCP server saturation if multiple Workers query Agenstrix simultaneously** — only Master is wired as an Agenstrix MCP client today, so this is mostly moot for v1; if it changes, p-limit handler concurrency.
4. **Anthropic / OpenAI API rate limits hitting from 8 concurrent CLIs** — user's account problem, not ours, but surface 429 errors clearly via PTY passthrough.

---

## Sources

### Context7 (HIGH)
- `/oven-sh/bun` — `Bun.Terminal`, `Bun.spawn`, `bun:sqlite`, `--compile`
- `/llmstxt/hono_dev_llms-full_txt` — `streamSSE`, `hono/bun` WebSocket
- `/drizzle-team/drizzle-orm-docs` — `bun-sqlite` driver, migrator
- `/modelcontextprotocol/typescript-sdk` — `Server`, `Client`, `StdioServerTransport`, `StdioClientTransport`

### Official docs (HIGH)
- [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp) — stdio transport config format, server discovery semantics
- [Bun child process / spawn](https://bun.com/docs/runtime/child-process) — process group, PTY (`terminal` option), `detached`
- [Bun.spawn API reference](https://bun.com/reference/bun/spawn) — `kill()` semantics, `exited` promise
- [Bun.Terminal API](https://bun.com/reference/bun/Terminal) — PTY data callback, resize, kill
- [Hono streaming guide](https://hono.dev/helpers/streaming) — SSE backpressure, abort cleanup

### Validated competitor architectures (MEDIUM)
- golutra (Rust + TS + Vue Tauri) — process management & PTY patterns; their `detached + pgid` approach informs our HR-05 + INFRA-07
- swarm-ide (TS Next.js) — autonomous Master + Agent-Graph pattern; their lack of real PTY validates our component split
- Composio agent-orchestrator (TS) — multi-CLI + worktree, no autonomous master; informs the `worker/` ↔ `master/` boundary

### Research-informed (MEDIUM)
- [GitHub issue oven-sh/bun#1442](https://github.com/oven-sh/bun/issues/1442) — process group / gid / uid status in Bun.spawn; informs HR-05 fallback strategy
- [Building MCP Servers for Claude Code](https://www.sitepoint.com/building-mcp-servers-custom-context-for-claude-code/) — stdout-reserved-for-JSON-RPC gotcha (must log to stderr)
- [Configuring MCP Tools in Claude Code](https://scottspence.com/posts/configuring-mcp-tools-in-claude-code) — `.claude.json` config file format reference

---
*Architecture research for: Agenstrix multi-agent CLI orchestrator (Bun + React + MCP + PTY)*
*Researched: 2026-05-17*
