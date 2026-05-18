---
phase: 01-first-pty-demo
verified: 2026-05-18T08:45:00Z
status: human_needed
score: 6/6 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Launch `bunx agenstrix` on a machine that has `claude` in PATH; open browser to http://localhost:3000; verify the xterm.js panel shows real `claude` ASCII logo, ANSI colors, and permission prompts rendering byte-perfectly."
    expected: "Three-column shell loads, xterm renders real claude TUI output with full ANSI color/logo, no blank terminal"
    why_human: "Requires actual claude CLI and PTY rendering in a real browser — grep cannot verify xterm visual correctness or the PTY byte passthrough quality"
  - test: "Close the browser tab entirely, reopen to http://localhost:3000; verify the same terminal history is replayed from SQLite (no blank terminal on reload)"
    expected: "History chunks replay from /api/workers/:id/chunks in seq order, terminal shows same output as before refresh"
    why_human: "WeChat-style replay requires real browser session and SQLite state to be populated by a real PTY run"
  - test: "Type a message in ChatInput and press Enter; verify the text reaches claude stdin (claude shows acknowledgement or processes the input)"
    expected: "ChatInput POSTs { data: text } to /api/workers/:id/input; clauderesponds (or echoes in echo-skeleton mode)"
    why_human: "Wire-complete chat path (CR-01 fix) can only be validated by seeing claude react to input in a real browser session"
  - test: "Click the SelfTestBanner (simulating a missing-claude scenario) → SelfTestDialog opens → click Re-check; verify the dialog calls POST /api/selftest/recheck and updates warnings"
    expected: "Re-check button fires the correct POST endpoint (not GET /healthz); warnings update or dialog closes on all-green"
    why_human: "UI interaction flow requires a real browser; the CR-02 fix wires the endpoint but only human can confirm the UX loop works end-to-end"
  - test: "On Windows 10 1809+ runner: verify GitHub Actions run #26022537500 (post CR-fixes CI re-run) shows all three OS green with 0 failures"
    expected: "macos-latest / ubuntu-latest / windows-latest all pass; Windows runner exercises ConPTY pty-echo-win smoke tests"
    why_human: "CI run is in_progress at time of verification; Windows ConPTY result cannot be checked without the completed GitHub Actions output"
---

# Phase 1: First PTY Demo — Verification Report

**Phase Goal:** First PTY Demo / Walking Skeleton — prove the Bun + Drizzle/SQLite + Hono (HTTP/WS/SSE) + React 19/Vite 8/Tailwind v4/shadcn-ui + xterm.js + PTY stack works end-to-end; user can type into ChatInput and see real `claude` output streamed via PTY → bus → WS → xterm; refresh-replay from SQLite; self-test/doctor + reaper + git lock scanner + SEC-01 redactor + cross-platform CI all green.

**Verified:** 2026-05-18T08:45:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User chat path is wire-complete: ChatInput → POST /api/workers/:id/input (with `{ data }`) → sendToWorker → PTY stdin → real claude / echo → bus → WS → xterm | ✓ VERIFIED | `App.tsx:107` sends `{ data: text }`. `rest.ts:72` validates `z.object({ data: z.string() })`. `sendToWorker(workerId, data)` calls `entry.pty.write(data)`. Regression test `post-input-contract.test.ts` asserts `{ data }` returns 200 and `{ text }` returns 400. |
| 2 | WeChat-style replay: tab close + reopen → REST GET /api/workers/:id/chunks → xterm.write → live WS resumes | ✓ VERIFIED | `WorkerTerminal.tsx` opens WS first (buffers live), fetches history in `ws.onopen`, sorts by seq, writes via `term.write(bytes)`, flushes pending live chunks. `rest.ts:55` returns base64-encoded chunks from `ptyChunksRepo.listByWorker`. |
| 3 | Self-test runs at boot: missing claude shows red banner + shadcn Dialog with platform fix commands + Re-check button that POSTs to /api/selftest/recheck | ✓ VERIFIED | `selftest.ts` checks `which("claude")`; `SelfTestBanner.tsx` shows red destructive chips; `SelfTestDialog.tsx:82` calls `POST /api/selftest/recheck` (CR-02 fix confirmed). |
| 4 | Killing a claude worker: SIGTERM → 5s grace → SIGKILL terminates the entire process group; orphan detection via running.json + doctor --reap | ✓ VERIFIED | `bun-terminal.ts`: POSIX uses `process.kill(-pgid, sig)`, Windows uses `process.kill(pid)`. `killWorker` in `worker/index.ts:220` implements 5s timeout. `running-file.ts` records PID on spawn + clears on exit. `doctor.ts` implements full `reap()`. Smoke test `kill-group.test.ts` verifies cascading child kill. |
| 5 | SEC-01 redactor: 4 patterns (sk-ant-, ghp_, sk-, AKIA) replace secrets BEFORE bus.publish AND BEFORE batcher.ingest; spawn env hard denylist cannot be overridden | ✓ VERIFIED | `redactor.ts` has 4 regex patterns with negative lookahead for OpenAI/Anthropic. `worker/index.ts:139` calls `redactChunk(rawChunk)` then publishes to bus AND ingests to batcher — single redacted copy. `spawn-env.ts` has `HARD_DENYLIST` (14 entries) + `HARD_DENYLIST_PREFIXES`. 26 tests in `redactor.test.ts` + `spawn-env.test.ts` + `redactor-pipeline.test.ts` all pass. |
| 6 | Cross-platform CI: GitHub Actions three-OS matrix (macos-latest, ubuntu-latest, windows-latest) with Bun 1.3.14 pinned; POSIX-only tests skip on Windows; Windows tests skip on POSIX | ✓ VERIFIED | `.github/workflows/ci.yml` has `matrix: os: [macos-latest, ubuntu-latest, windows-latest]`, `bun-version: "1.3.14"`, `fail-fast: false`. Windows runner uses `shell: pwsh`. `test.skipIf(IS_WINDOWS)` in `kill-group.test.ts`; `test.skipIf(process.platform !== 'win32')` in `pty-echo-win.test.ts` and `win-short-path.test.ts`. CI run #26020120914 confirmed green on all 3 OS. |

**Score:** 6/6 truths verified

---

### Deferred Items

No items deferred to later phases.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src-bun/main.ts` | Boot sequence: parseCli → selfTest → initDb → spawnWorker → Bun.serve → openBrowser | ✓ VERIFIED | 228 lines; full boot flow implemented; CR-03 fix confirmed (no AGENSTRIX_HOME constant, uses lazy `getAgenstrixHome()`) |
| `src-bun/cli.ts` | Argv parser for `start | doctor --reap | --port <N>` | ✓ VERIFIED | Exports `parseCli`; handles `--yes` / `-y` flag |
| `src-bun/db/schema.ts` | Drizzle schema — 11 tables including ptyChunks | ✓ VERIFIED | `export const ptyChunks` present; all 11 tables: workers, pty_chunks, events, messages, workspaces, conversations, repos, services, skills, templates, learned_commands |
| `src-bun/db/index.ts` | WAL mode, backupBeforeMigrate, scheduleWalCheckpoint (PASSIVE) | ✓ VERIFIED | PRAGMA WAL set; `backupBeforeMigrate()` called before `migrate()`; `scheduleWalCheckpoint` uses PASSIVE (not TRUNCATE); CR-03 constant removed |
| `src-bun/db/backups.ts` | backupBeforeMigrate, listBackups, rotateBackups, restoreBackup | ✓ VERIFIED | All 4 functions exported; `restoreBackup` uses `path.sep` for Windows path traversal guard (CI fix `bfe61de`) |
| `src-bun/pty/batcher.ts` | AnsiChunkBatcher VT500 state machine (10 states), tail-carry invariant | ✓ VERIFIED | `AnsiState` enum with 10 states (GROUND, ESC, CSI_PARAM, CSI_INTERM, OSC_STRING, DCS_STRING, PM_STRING, APC_STRING, SOS_STRING, STRING_ST); tail-carry buffer present |
| `src-bun/pty/bun-terminal.ts` | Bun.Terminal PtyHandle; POSIX detached:true, Windows detached:false; POSIX group kill; Windows ConPTY kill | ✓ VERIFIED | `detached: !isWindows` pattern present; POSIX: `process.kill(-pgid, sig)`; Windows: `process.kill(proc.pid)`; CI fix `e51a75f` confirmed |
| `src-bun/pty/redactor.ts` | 4 real SEC-01 regexes replacing identity stub; UTF-8 safe; fast-path byte scan | ✓ VERIFIED | 4 patterns: ANTHROPIC-KEY, GITHUB-TOKEN, OPENAI-KEY (negative lookahead), AWS-ACCESS-KEY; `hasSecretPrefix` byte scan; `TextDecoder("utf-8", { fatal: false })` |
| `src-bun/worker/spawn-env.ts` | Allowlist + HARD_DENYLIST + HARD_DENYLIST_PREFIXES; GIT_* scrub | ✓ VERIFIED | `HARD_DENYLIST` (14 entries), `HARD_DENYLIST_PREFIXES` (5 prefixes); explicit `delete env.GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE`; Windows ALLOWED_ENV_KEYS extended (CI fix `ecf6086`) |
| `src-bun/worker/index.ts` | spawnWorker; redactChunk before bus.publish AND batcher.ingest; recordPid/clearPid; appendAtomic | ✓ VERIFIED | `redactChunk` called on raw chunk before both `bus.publish` and `batcher.ingest`; `recordPid` on spawn, `clearPid` on exit; `ptyChunksRepo.appendAtomic` in batcher onFlush |
| `src-bun/system/running-file.ts` | recordPid, clearPid, readRunning, writeRunning, isProcessAlive; atomic write | ✓ VERIFIED | All 5 functions exported; atomic write via rename; `isProcessAlive` uses signal-0 trick |
| `src-bun/system/git-lock-scanner.ts` | scanGitLocks (5-min threshold); removeLock with path guard | ✓ VERIFIED | `STALE_AGE_MS = 300_000`; `removeLock` checks `endsWith("/.git/index.lock")` (POSIX) or `\\.git\\index.lock` (Windows) |
| `src-bun/system/doctor.ts` | Full reap() implementation; interactive + --yes mode; POSIX group kill, Windows PID kill | ✓ VERIFIED | `reap()` reads running.json, clears dead PIDs, kills/prompts for live orphans; POSIX: `process.kill(-pgid, 9)`; Windows: `process.kill(pid)` |
| `src-bun/system/selftest.ts` | HOME-aware path resolution; staleGitLocks; orphanWorkers; claude/git/SQLite/port checks | ✓ VERIFIED | CR-04 fix confirmed: uses `getAgenstrixHome()` (not `os.homedir()`) for SQLite probe; `staleGitLocks` + `orphanWorkers` fields present |
| `src-bun/system/win-short-path.ts` | getWindowsShortPath; no-op on POSIX; cmd.exe approach for non-ASCII Windows paths | ✓ VERIFIED | ASCII fast-path guard; `cmd /c for %i in...` for non-ASCII; no-op on non-Windows |
| `src-bun/gateway/index.ts` | Hono assembly; `export default { fetch, websocket }` for Bun WS | ✓ VERIFIED | `export default { fetch: app.fetch, websocket }` present; routes mounted for rest, ws, sse |
| `src-bun/gateway/ws.ts` | idleTimeout:0 in Bun.serve; 30s heartbeat; binary input → PTY stdin; resize messages | ✓ VERIFIED | `idleTimeout: 0` in `main.ts:122`; `setInterval(() => ws.send(new Uint8Array(0)), 30_000)` in ws.ts; binary ArrayBuffer → sendToWorker |
| `src-bun/gateway/rest.ts` | POST /api/workers/:id/input validates `{ data: z.string() }`; POST /api/selftest/recheck | ✓ VERIFIED | `zValidator("json", z.object({ data: z.string() }))` at line 72; `/api/selftest/recheck` POST endpoint at line 83 |
| `src-react/App.tsx` | Three-column shell; ChatInput POSTs `{ data: text }`; SSE subscription | ✓ VERIFIED | CR-01 fix confirmed: `JSON.stringify({ data: text })` at line 107; SSE EventSource at line 72 |
| `src-react/components/WorkerTerminal.tsx` | xterm v6 + addon chain (FitAddon → Unicode11 → WebLinks → WebGL/Canvas); WeChat replay | ✓ VERIFIED | `allowProposedApi: true`, `convertEol: false`, `scrollback: 100_000`; addon load order correct; WeChat replay D-07 pattern with WS-first + history fetch in `ws.onopen` |
| `src-react/components/SelfTestDialog.tsx` | Re-check calls POST /api/selftest/recheck; updates store warnings | ✓ VERIFIED | CR-02 fix confirmed: `fetch("/api/selftest/recheck", { method: "POST" })` at line 82; `setSelfTestWarnings(fresh)` updates store |
| `.github/workflows/ci.yml` | Three-OS matrix; Bun 1.3.14; unit + smoke + tsc + biome | ✓ VERIFIED | matrix.os = [macos-latest, ubuntu-latest, windows-latest]; bun-version: "1.3.14"; steps: tsc, biome check, unit tests, smoke tests (platform-conditional) |
| `tests/smoke/post-input-contract.test.ts` | Regression test for CR-01: { data } returns 200, { text } returns 400 | ✓ VERIFIED | File exists; asserts `okResp.status === 200` for `{ data }` and `badResp.status === 400` for `{ text }` |
| `drizzle/0000_init.sql` | SQL migration creating all 11 tables | ✓ VERIFIED | File exists in drizzle/ directory |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `App.tsx (ChatInput)` | `rest.ts POST /api/workers/:id/input` | `fetch(url, { body: { data: text } })` | ✓ WIRED | CR-01 fix: field name `data` matches Zod schema `z.object({ data: z.string() })` |
| `rest.ts POST /api/workers/:id/input` | `worker/index.ts sendToWorker` | `sendToWorker(workerId, data)` | ✓ WIRED | Direct import + call in rest.ts:76 |
| `sendToWorker` | PTY stdin | `entry.pty.write(data)` | ✓ WIRED | `worker/index.ts:250-252`: looks up registry, calls `pty.write(data)` |
| `worker/index.ts onData` | `pty/redactor.ts` | `redactChunk(rawChunk)` | ✓ WIRED | `worker/index.ts:139`: raw chunk → `redactChunk` before both bus and batcher |
| `worker/index.ts onData` | `bus.publish → WS → xterm` | `bus.publish("worker.output.${workerId}", chunk)` | ✓ WIRED | `ws.ts:30`: subscribes to `worker.output.${workerId}`; forwards as binary frames |
| `worker/index.ts onData (batcher)` | `ptyChunksRepo.appendAtomic` | `batcher.ingest(chunk)` → `onFlush: appendAtomic` | ✓ WIRED | `worker/index.ts:121-128`: batcher onFlush calls `ptyChunksRepo.appendAtomic` |
| `WorkerTerminal ws.onopen` | `rest.ts GET /api/workers/:id/chunks` | `fetch("/api/workers/${workerId}/chunks")` | ✓ WIRED | `WorkerTerminal.tsx:117`: fetches chunks in ws.onopen, replays via `term.write(bytes)` |
| `db/index.ts initDb()` | `db/backups.ts backupBeforeMigrate()` | `backupBeforeMigrate()` before `migrate()` | ✓ WIRED | `db/index.ts:81`: `backupBeforeMigrate()` called before Drizzle migrate |
| `db/index.ts` | WAL PASSIVE checkpoint | `scheduleWalCheckpoint(sqlite)` every 5 min | ✓ WIRED | `db/index.ts:100`: `scheduleWalCheckpoint(sqlite)` using PASSIVE mode |
| `cli.ts doctor --reap` | `doctor.ts reap()` | `if command === 'doctor' → await reap()` | ✓ WIRED | `main.ts:205-208`: `args.command === "doctor"` → `await reap({ yes: args.yes })` |
| `selftest.ts` | `git-lock-scanner.ts scanGitLocks` | `staleGitLocks = await scanGitLocks([process.cwd()])` | ✓ WIRED | `selftest.ts:138`: scans process.cwd() for stale locks at boot |
| `worker/index.ts spawnWorker` | `running-file.ts recordPid` | `recordPid(workerId, entry)` | ✓ WIRED | `worker/index.ts:202-208`: records PID after spawn |
| `SelfTestDialog Re-check` | `POST /api/selftest/recheck` | `fetch("/api/selftest/recheck", { method: "POST" })` | ✓ WIRED | CR-02 fix confirmed at `SelfTestDialog.tsx:82` |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `WorkerTerminal.tsx` | `term.write(chunk)` (live) | `bus.subscribe("worker.output.${workerId}")` → WS → PTY onData → `redactChunk` → `bus.publish` | Yes — raw PTY bytes from Bun.Terminal | ✓ FLOWING |
| `WorkerTerminal.tsx` | `term.write(bytes)` (replay) | `GET /api/workers/:id/chunks` → `ptyChunksRepo.listByWorker` → SQLite `pty_chunks` | Yes — persisted via `appendAtomic` | ✓ FLOWING |
| `SelfTestBanner.tsx` | `warnings` prop | `App.tsx` → `/healthz` → `_startupInfo.selfTestWarnings` (set by `runSelfTest` at boot) | Yes — from real `which()` checks + scanGitLocks + readRunning | ✓ FLOWING |
| `SelfTestDialog.tsx` (re-check) | `fresh` warnings | `POST /api/selftest/recheck` → `runSelfTest(0)` → live checks | Yes — re-runs all self-test checks | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Unit tests (63 tests) | `bun test tests/unit/` | 63 pass, 0 fail | ✓ PASS |
| Smoke tests (13 pass, 4 skip) | `bun test tests/smoke/` | 13 pass, 4 skip (Windows-only), 0 fail | ✓ PASS |
| CR-01 regression test | `post-input-contract.test.ts` | `{ data }` → 200; `{ text }` → 400 | ✓ PASS |
| WS heartbeat (35s idle) | `ws-heartbeat.test.ts` | WS stays OPEN, heartbeatCount >= 1 | ✓ PASS |
| ANSI batcher (9 unit tests) | `batcher.test.ts` | CSI/OSC/DCS boundary cases all pass | ✓ PASS |
| Redactor (12 unit tests) | `redactor.test.ts` | All 4 patterns match; no false positives; UTF-8 safe | ✓ PASS |
| Spawn-env denylist (9 tests) | `spawn-env.test.ts` | ANTHROPIC_API_KEY always stripped | ✓ PASS |
| Kill-group cascade | `kill-group.test.ts` | POSIX child process killed within 6s (skipped on Windows) | ✓ PASS |
| DB durability (7 tests) | `db-durability.test.ts` | WAL, FK, journal_size_limit=67108864, PASSIVE checkpoint | ✓ PASS |
| Backup rotation (5 tests) | `db-backup.test.ts` | timestamped backup, rotate-to-10, path-traversal guard | ✓ PASS |
| Replay ordering (7 tests) | `repos-replay.test.ts` | seq ASC order, appendAtomic monotonic, JSON round-trip | ✓ PASS |

---

### Probe Execution

No explicit probe scripts declared. CI run #26020120914 serves as the integration probe:

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| GitHub Actions CI (pre-fix) | Three-OS matrix on run #26020120914 | macOS: 61s PASS / Ubuntu: 54s PASS / Windows: 137s PASS | ✓ PASS |
| GitHub Actions CI (post-4-criticals) | Run #26022537500 | In-progress at verification time | ? HUMAN NEEDED |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| INFRA-02 | 01-01 | SQLite persistence, 11 tables, Drizzle + bun:sqlite | ✓ SATISFIED | `db/schema.ts` 11 tables; `drizzle/0000_init.sql`; WAL mode in `db/index.ts` |
| INFRA-03 | 01-01, 01-02 | PTY byte stream persistence + ANSI-safe replay | ✓ SATISFIED | `ptyChunksRepo.appendAtomic`; batcher VT500 state machine; `listByWorker` seq-ordered |
| INFRA-04 | 01-01, 01-03 | Event sourcing — worker.spawned/exited/killed to events table | ✓ SATISFIED | `eventsRepo.append` called in spawnWorker, onExit, killWorker; JSON payload |
| INFRA-05 | 01-01, 01-03 | pino logger split — user-facing + diagnostics | ✓ SATISFIED | `logger.ts` exports `logger` (agenstrix-YYYY-MM-DD.log) + `diagnosticsLogger` (diagnostics-YYYY-MM-DD.log) |
| INFRA-06 | 01-01, 01-02 | Self-test: claude/codex/git/SQLite/port checks + recheck endpoint | ✓ SATISFIED | `selftest.ts` checks all 5 items; `POST /api/selftest/recheck` returns fresh results |
| INFRA-07 | 01-06 | Cross-platform CI: macOS/Linux/Windows 10 1809+ | ✓ SATISFIED | `.github/workflows/ci.yml` three-OS matrix; Windows `detached:false` fix; short-path helper |
| DB-DURABILITY-01 | 01-03 | journal_size_limit=64MB; PASSIVE checkpoint; pre-migrate backup (keep 10) | ✓ SATISFIED | All 3 PRAGMAs in `db/index.ts`; `backupBeforeMigrate()` + `rotateBackups(10)` in `backups.ts` |
| CORE-01 | 01-01, 01-02 | Master is real interactive claude in PTY | ✓ SATISFIED | D-01 auto-spawn: `claudeFound → spawnWorker({ cli: 'claude' })`; Bun.Terminal PTY; browser xterm |
| CORE-04 | 01-01, 01-02 | Worker is real claude/codex in PTY mode | ✓ SATISFIED | `buildArgv` resolves `which("claude")`; bare argv (D-03); echo-skeleton fallback |
| CORE-05 | 01-01, 01-02, 01-04 | SIGTERM → 5s → SIGKILL kill sequence | ✓ SATISFIED | `killWorker` in worker/index.ts: SIGTERM + `setTimeout(SIGKILL, 5000)`; kill-group smoke test |
| KILL-01 | 01-04 | Cascading process group kill + orphan detection + doctor --reap | ✓ SATISFIED | `process.kill(-pgid, sig)` on POSIX; `running-file.ts` tracks PIDs; `doctor.ts` full reap |
| GIT-01 | 01-04 | git worktree serialization foundation; startup .git/index.lock scanner | ✓ SATISFIED | `git-lock-scanner.ts` scans process.cwd() at boot; 5-min staleness threshold; `removeLock` path guard |
| SEC-01 | 01-05 | Minimal spawn env; 4-pattern redactor before write AND WS forward | ✓ SATISFIED | `spawn-env.ts` HARD_DENYLIST; `redactor.ts` 4 patterns; single redaction point in `worker/index.ts:139` before bus+batcher |
| WS-1011-01 | 01-01, 01-02 | idleTimeout:0 + 30s heartbeat; replay on reconnect | ✓ SATISFIED | `idleTimeout: 0` in `main.ts:122`; 30s heartbeat in `ws.ts`; ws-heartbeat smoke test (35s idle, still open) |
| ANSI-SPLITTER-01 | 01-02 | VT500 batcher; no ANSI sequences split at chunk boundaries | ✓ SATISFIED | `AnsiChunkBatcher` 10-state machine; tail-carry invariant; 9 unit tests cover CSI/OSC/DCS boundary splits |
| WORKTREE-CWD-01 | 01-04, 01-05 | GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE scrubbed; cwd resolves symlinks | ✓ SATISFIED | `spawn-env.ts:109-111` explicit `delete env.GIT_*`; `resolveCwd` in `cwd.ts` uses `realpathSync`; unit tests confirm |
| SETUP-01 | 01-01, 01-04 | CLI detection wizard: which claude/git; install instructions + re-check | ✓ SATISFIED | `selftest.ts` checks claude+git; SelfTestBanner/SelfTestDialog with platform-specific fix commands + Re-check |

**All 17 requirement IDs verified: 17/17**

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src-bun/gateway/sse.ts` | 32, 39 | Double `stream.onAbort()` — two separate calls registering two handlers | Warning (WR-06 from code review) | Hono 4.12.x happens to keep both handlers; fragile — future Hono update could drop first handler and leak bus subscription. Out of Phase 1 scope. |
| `src-bun/gateway/ws.ts` | 34 | `ws.send(payload.buffer as ArrayBuffer)` — full backing ArrayBuffer sent, ignoring Uint8Array view bounds | Warning (WR-03 from code review) | Current data path produces fresh Uint8Arrays so no data leak today; foot-gun if subarray views are introduced later. Out of Phase 1 scope. |
| `src-bun/system/running-file.ts` | 88-95 | `isProcessAlive`: catch-all treats EPERM (alive, different owner) same as ESRCH (dead) | Warning (WR-01 from code review) | Orphans owned by other UIDs are silently cleared instead of reported. Edge case for single-user dev tool. Out of Phase 1 scope. |
| `src-bun/pty/redactor.ts` | 65-70 | `regex.lastIndex = 0` reset — dead code for `String.replace` with `/g` flag | Info (WR-08 from code review) | Harmless but misleading comment could confuse future maintainers. Out of Phase 1 scope. |

No `TBD`, `FIXME`, or `XXX` markers found in Phase 1 source files. All 4 items above are explicitly out-of-scope per orchestrator instructions (11 warnings + 6 infos from 01-REVIEW.md remain open for Phase 2 / Phase 1.1).

---

### Human Verification Required

#### 1. Real claude PTY in Browser

**Test:** Launch `bunx agenstrix` on a machine with `claude` in PATH; open http://localhost:3000.
**Expected:** Three-column shell loads with Master Claude xterm panel showing real `claude` ASCII logo, ANSI colors, permission prompts rendered byte-perfectly. No blank or garbled terminal.
**Why human:** Requires real claude CLI + Bun.Terminal PTY + WebGL xterm rendering in actual browser. Grep cannot verify visual correctness of PTY byte passthrough.

#### 2. Refresh-Replay from SQLite (WeChat-style)

**Test:** After seeing claude output in browser, close and reopen the tab.
**Expected:** Terminal history replays from SQLite `pty_chunks` (ordered by seq) — same output as before refresh, no blank terminal on reload.
**Why human:** Requires actual PTY session to populate DB + real browser session to verify replay renders correctly.

#### 3. Chat Input → claude stdin → visible response

**Test:** Type a message in ChatInput, press Enter. Observe claude response in xterm.
**Expected:** Input is POSTed as `{ data: text }` → reaches claude stdin → claude acknowledges or responds in the terminal.
**Why human:** End-to-end interactive loop requires running claude CLI + real browser interaction to confirm CR-01 fix works in practice.

#### 4. Re-check Button UX Loop

**Test:** Simulate missing-claude scenario (or rename claude binary temporarily); launch Agenstrix; click SelfTestBanner → SelfTestDialog → click "重新检查" button.
**Expected:** Button fires POST /api/selftest/recheck (not GET /healthz); warnings update dynamically; dialog closes if all checks pass after fixing.
**Why human:** UI interaction flow; CR-02 fix is wired in code but only human can confirm the UX state transitions work correctly end-to-end.

#### 5. Post-Fix CI Run (#26022537500) — Windows ConPTY Confirmation

**Test:** Check GitHub Actions run #26022537500 (the re-CI triggered after the 4 critical fixes) result.
**Expected:** All three OS runners (macos-latest / ubuntu-latest / windows-latest) pass. Windows runner specifically exercises `pty-echo-win.test.ts` (ConPTY path) without regression from the CR-01/02/03/04 fixes.
**Why human:** Run was in_progress at verification time. The post-fix CI result cannot be verified without the completed Actions output. Prior run #26020120914 was green but predated the 4 critical commits.

---

### Gaps Summary

No gaps found. All 6 phase-level must-haves are fully verified at code level (existence, substantive implementation, correct wiring, and real data flow). All 17 requirement IDs map to plan frontmatter and are satisfied by concrete implementation artifacts.

The 4 code-review critical findings (CR-01 through CR-04) have been fixed with dedicated commits:
- CR-01 (`6830814`): ChatInput now POSTs `{ data }` matching server Zod schema
- CR-02 (`06ccac6`): SelfTestDialog Re-check calls POST /api/selftest/recheck
- CR-03 (`a502b70`): AGENSTRIX_HOME constant removed; main.ts uses lazy `getAgenstrixHome()`
- CR-04 (`5919801`): selftest.ts uses HOME-aware path resolution

5 items are deferred to human verification because they require running browser + real claude CLI interaction and/or the completed post-fix CI run result.

---

_Verified: 2026-05-18T08:45:00Z_
_Verifier: Claude (gsd-verifier)_
