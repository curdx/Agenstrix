---
phase: 01-first-pty-demo
plan: 02
subsystem: real-claude-pty
tags: [bun, bun-terminal, ansi-splitter, websocket, heartbeat, claude-pty, tdd, d01-auto-spawn]
dependency_graph:
  requires:
    - 01-01 (walking-skeleton — PtyHandle, WorkerSpec, AnsiChunkBatcher stub, bus, DB repos)
  provides:
    - ansi-splitter-vt500
    - real-claude-pty-wiring
    - ws-heartbeat-hardening
    - d01-auto-spawn-on-boot
    - selftest-recheck-endpoint
    - worker-exited-sse-broadcast
  affects:
    - 01-03 (kill-group hardens the SIGTERM→5s→SIGKILL path this plan wires)
    - 01-04 (PTY redactor replaces the stub redactChunk used here)
    - 01-05 (CI validates ANSI splitter across POSIX + Windows ConPTY byte streams)
tech_stack:
  added:
    - which() from bun (path resolution for claude/codex binaries)
    - EventSource API in MessageCard.tsx (native browser SSE)
  patterns:
    - VT500 ANSI state machine (GROUND/ESC/CSI_PARAM/CSI_INTERM/OSC_STRING/DCS_STRING/…/STRING_ST)
    - Tail-carry-forward for ANSI boundary safety in SQLite persistence
    - D-01 conditional boot: claudeFound → real claude, else echo-skeleton + warning
    - SSE fan-out for worker lifecycle events (worker.exited → MessageCard status dot)
key_files:
  created: []
  modified:
    - src-bun/pty/batcher.ts (ANSI-SPLITTER-01 VT500 state machine — prior executor)
    - tests/unit/batcher.test.ts (9 unit tests covering CSI/OSC/DCS/boundary edge cases — prior executor)
    - tests/smoke/ws-heartbeat.test.ts (RED: 35s idle + empty binary heartbeat — prior executor; GREEN: this plan)
    - tests/smoke/claude-pty.test.ts (RED: D-01 auto-spawn + ANSI bytes + Ctrl+D exit — prior executor; GREEN: this plan)
    - tests/smoke/skeleton-echo.test.ts (adapted for D-01: explicitly spawnWorker echo-skeleton)
    - src-bun/worker/index.ts (buildArgv uses which() for claude; SSE bus publish on worker.exited)
    - src-bun/main.ts (D-01: claudeFound gating; no hardcoded id to avoid DB UNIQUE collisions)
    - src-bun/gateway/rest.ts (POST /api/selftest/recheck — INFRA-06)
    - src-react/components/MessageCard.tsx (SSE subscription; gray dot on exited; uptime stops)
decisions:
  - "D-01 implemented: main.ts gates on selfTest.claudeFound — real claude spawns on boot; echo-skeleton in degraded mode"
  - "D-03 implemented: bare argv=[claudeBin] — no --print, no --mcp-config; MCP injection deferred to Phase 3"
  - "D-04 maintained: single-Worker prototype; the auto-spawned worker IS the master"
  - "worker ID is nanoid-generated (not hardcoded 'master-claude') to survive repeated test runs on same DB"
  - "skeleton-echo.test.ts adapted: now spawnWorker echo-skeleton explicitly post-startServer for D-01 compatibility"
  - "claude-pty exit wait extended from 5s to 15s + double Ctrl+D for slow claude startup environments"
metrics:
  duration: "~45 minutes (includes 35s ws-heartbeat wait in test)"
  completed: "2026-05-18"
  tasks_completed: 2
  files_modified: 9
  commits: 4
---

# Phase 01 Plan 02: Real claude PTY + ANSI Splitter + WS Hardening Summary

Real `claude` CLI runs in the browser via Bun.Terminal PTY, bytes batched with a VT500 ANSI state machine for atomic SQLite rows, WebSocket connections hardened with idleTimeout:0 + 30s empty-frame heartbeat.

## What Was Built

### ANSI-SPLITTER-01 VT500 State Machine (prior executor — commits f415c26 + 680367a)

`src-bun/pty/batcher.ts` implements a 10-state VT500 ANSI state machine:
- States: `GROUND | ESC | CSI_PARAM | CSI_INTERM | OSC_STRING | DCS_STRING | PM_STRING | APC_STRING | SOS_STRING | STRING_ST`
- Invariant: `onFlush` callback only receives bytes that ended in `GROUND` state (atomic ANSI sequences). Partial sequences carry forward to the next `ingest()` call.
- Force-flush via `flushNow()` emits incomplete sequences (needed for SIGINT shutdown — Test 8).
- Auto-flush on 100KB accumulation or 250ms timer.
- 9 unit tests covering: passthrough, CSI intact, CSI split across chunks, OSC title across boundary, 200KB force-size flush, 250ms timer flush, DCS sequence, no-infinite-hold on `flushNow()`, 500KB byte-sum preservation.

### WS Heartbeat (prior executor RED — commit 7994454; this executor GREEN)

`src-bun/gateway/ws.ts` (unchanged from Plan 01-01 — already correct):
- `setInterval(() => ws.send(new Uint8Array(0)), 30_000)` — empty binary frame every 30s
- `idleTimeout: 0` on `Bun.serve()` — prevents Bun's default 120s idle disconnect
- Verified by ws-heartbeat smoke test: open WS, do nothing for 35s, assert `readyState === OPEN` and `heartbeatCount >= 1`

### D-01 Auto-Spawn Real claude on Boot (this executor)

`src-bun/main.ts` now gates worker spawn on `selfTest.claudeFound`:
- `claudeFound === true`: `spawnWorker({ cli: 'claude', cwd: process.cwd() })` — real claude in PTY
- `claudeFound === false`: `spawnWorker({ cli: 'echo-skeleton' })` + warning log — degraded mode
- Worker ID is nanoid-generated each boot (no hardcoded `"master-claude"`) to avoid UNIQUE constraint failures when tests reinitialize the same DB in a single process.

`src-bun/worker/index.ts` — `buildArgv(cli)` now resolves the full binary path:
- `claude`: `which("claude")` → throws if not found (self-test guard)
- `codex`: `which("codex")` → throws if not found
- D-03: bare argv `[claudeBin]` — no `--print`, no `--mcp-config`, no initial prompt

### SSE worker.exited Broadcast

When a worker's PTY exits, `worker/index.ts` `onExit` handler now publishes to `sse.event` bus topic in addition to persisting to DB:
```typescript
bus.publish("sse.event", { type: "worker.exited", workerId, payload: { exitCode: code } });
```
`MessageCard.tsx` subscribes via `new EventSource("/sse/events")` and flips the status dot to gray + shows "Exited with code N" footer.

### REST /api/selftest/recheck (INFRA-06)

`src-bun/gateway/rest.ts` POST endpoint now re-runs `runSelfTest(0)` (port=0 to skip port check while already serving), broadcasts `selftest.recompleted` event via SSE, and persists to events table. Wires the SelfTestDialog "Re-check" button from Plan 01-01 Task 3.

## Commits in This Plan

| Commit | Type | Description | Files |
|--------|------|-------------|-------|
| `f415c26` | test | ANSI-SPLITTER-01 batcher unit tests (RED — 9 tests) | `tests/unit/batcher.test.ts` |
| `680367a` | feat | ANSI-SPLITTER-01 VT500 state machine implementation (GREEN — 9/9 pass) | `src-bun/pty/batcher.ts` |
| `7994454` | test | claude-pty + ws-heartbeat smoke tests (RED) | `tests/smoke/claude-pty.test.ts`, `tests/smoke/ws-heartbeat.test.ts` |
| `c3c60c9` | feat | D-01 real claude auto-spawn + WS heartbeat GREEN + REST recheck | 6 files |

## Test Results

All tests pass:
- `bun test tests/unit/batcher.test.ts` → 9 pass, 0 fail
- `bun test tests/smoke/healthz.test.ts` → 1 pass, 0 fail
- `bun test tests/smoke/skeleton-echo.test.ts` → 1 pass, 0 fail
- `bun test tests/smoke/claude-pty.test.ts` → 1 pass, 0 fail (claude in PATH)
- `bun test tests/smoke/ws-heartbeat.test.ts` → 1 pass, 0 fail (35s wait)
- `bunx tsc --noEmit` → 0 errors

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] skeleton-echo.test.ts adapted for D-01**
- **Found during:** Task 2 GREEN implementation
- **Issue:** skeleton-echo test implicitly assumed startServer always spawns echo-skeleton; after D-01 if claude is in PATH, startServer spawns claude — test would then look for "Hello from Agenstrix skeleton" bytes in a claude PTY, failing immediately.
- **Fix:** Test now explicitly calls `spawnWorker({ cli: "echo-skeleton" })` after `startServer()` to test the skeleton path independently of D-01 auto-boot behavior.
- **Files modified:** `tests/smoke/skeleton-echo.test.ts`
- **Commit:** `c3c60c9`

**2. [Rule 1 - Bug] claude exit timeout too short for slow startup environments**
- **Found during:** Task 2 GREEN — first test run showed `worker.exited` not found in 5s after Ctrl+D
- **Issue:** claude takes several seconds to fully load its TUI before Ctrl+D is processed; on first run / cold cache this can exceed 5s.
- **Fix:** Extended exit wait to 15s, double Ctrl+D with 500ms gap, 45s test timeout.
- **Files modified:** `tests/smoke/claude-pty.test.ts`
- **Commit:** `c3c60c9`

**3. [Rule 1 - Bug] Hardcoded worker ID "master-claude" caused UNIQUE constraint violation in tests**
- **Found during:** Task 2 GREEN — running healthz.test.ts + skeleton-echo.test.ts together caused `SQLITE_CONSTRAINT_PRIMARYKEY` on the second startServer() call.
- **Issue:** DB is shared within a bun test process via module singleton; inserting "master-claude" twice fails.
- **Fix:** Removed hardcoded `id: "master-claude"` from spawnWorker call in main.ts; let nanoid auto-generate a unique ID each boot.
- **Files modified:** `src-bun/main.ts`
- **Commit:** `c3c60c9`

## Notes for Future Plans

- **Plan 03 (kill-group):** `killWorker()` SIGTERM→5s→SIGKILL path is wired; Plan 03 hardens PGID-based group kill. Do NOT change `batcher.flushNow()` call placement in killWorker — it must remain before the SIGTERM.
- **Plan 04 (PTY redactor):** `redactChunk()` is called on every `onData` byte before both WS forward and batcher.ingest. The stub passes bytes through unchanged. Plan 04 replaces the stub body — the call site in worker/index.ts is the single choke point.
- **Plan 05 (CI):** The ANSI splitter's `flushNow()` path (forced flush mid-sequence) must survive cross-platform validation. Windows ConPTY re-encodes escape sequences — test Plan 05 verifies byte-sum preservation on ConPTY output, not byte-identity.
- **WS-1011-01 invariant:** `idleTimeout: 0` + 30s heartbeat. If Bun's WS behavior changes in a patch, the ws-heartbeat.test.ts will catch it at 35s.

## Known Stubs

None — all plan deliverables are fully implemented. `redactChunk` in `src-bun/pty/redactor.ts` is a passthrough stub but that is Plan 04's scope and is explicitly tracked in the plan dependency graph.

## Self-Check

### Created files exist:
- `src-bun/pty/batcher.ts` — exists and has `AnsiState` enum (9 states)
- `tests/unit/batcher.test.ts` — exists (9 tests)
- `tests/smoke/ws-heartbeat.test.ts` — exists
- `tests/smoke/claude-pty.test.ts` — exists

### Commits exist:
- `f415c26` — ANSI batcher RED tests
- `680367a` — ANSI batcher GREEN impl
- `7994454` — smoke tests RED
- `c3c60c9` — D-01 + GREEN implementation

### All tests pass: CONFIRMED (run results above)

## Self-Check: PASSED
