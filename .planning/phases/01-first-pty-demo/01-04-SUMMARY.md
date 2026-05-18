---
phase: 01-first-pty-demo
plan: "04"
subsystem: kill-group-orphan-reaper
tags:
  - kill-group
  - posix
  - process-group
  - orphan-reaper
  - running-json
  - git-lock-scanner
  - worktree-cwd
  - doctor
  - selftest
dependency_graph:
  requires:
    - 01-01  # walking-skeleton
    - 01-02  # real claude PTY spawn
    - 01-03  # appendAtomic from ptyChunksRepo
  provides:
    - kill-group-end-to-end
    - running-json-pid-tracking
    - doctor-reaper
    - git-lock-scanner-foundation
    - worktree-cwd-test-coverage
  affects:
    - 01-05 (redactor tests use _testArgvOverride hook added here)
    - Phase 2 (git-lock-scanner.ts scanGitLocks extended to all registered repos)
tech_stack:
  added:
    - src-bun/system/running-file.ts (new — PID tracking module)
    - src-bun/system/git-lock-scanner.ts (new — GIT-01 foundation)
  patterns:
    - "Atomic rename for running.json writes: writeFileSync(tmp); renameSync(tmp, real)"
    - "process.kill(-pgid, 9) for POSIX process group kill; process.kill(pid) for Windows"
    - "process.kill(pid, 0) trick for isProcessAlive — no POSIX kill -0 subprocess needed"
    - "WorkerSpec._testArgvOverride / AGENSTRIX_ARGV_OVERRIDE env for test injection"
    - "ptyChunksRepo.appendAtomic replaces append+external-seq in worker/index.ts"
    - "scanGitLocks: statSync mtime check, STALE_AGE_MS = 300_000 (5 min)"
    - "removeLock safety guard: path must end with /.git/index.lock"
key_files:
  created:
    - src-bun/system/running-file.ts
    - src-bun/system/git-lock-scanner.ts
    - tests/unit/running-file.test.ts
    - tests/unit/git-lock-scanner.test.ts
    - tests/smoke/kill-group.test.ts
  modified:
    - src-bun/worker/index.ts (running-file module, resolveArgv, appendAtomic)
    - src-bun/system/doctor.ts (full reap implementation replacing stub)
    - src-bun/system/selftest.ts (staleGitLocks + orphanWorkers fields)
    - src-bun/cli.ts (--yes / -y flag added to CliArgs)
    - src-bun/main.ts (reap result printed as JSON)
    - src-bun/pty/bun-terminal.ts (Windows platform branch already present; verified)
decisions:
  - "POSIX group kill uses process.kill(-pgid, sig): pgid === workerPid because detached:true calls setsid()"
  - "Windows kill omits -pgid: ConPTY's ClosePseudoConsole cascades to PTY children automatically"
  - "running.json writes are atomic via rename (write .tmp then rename) — T-01-04-04"
  - "STALE_AGE_MS = 300_000 (5 min): conservative enough to avoid false positives on slow git ops"
  - "removeLock safety: path must end with /.git/index.lock to prevent arbitrary file deletion (T-01-04-01)"
  - "doctor --reap skips interactive prompt in non-TTY environments (defaults to 's'=skip for piped stdin)"
  - "_testArgvOverride consolidated into worker/index.ts (same file owner as kill-group test); AGENSTRIX_ARGV_OVERRIDE env var as CI alternative"
  - "Plan 03 carry-over closed: batcher onFlush now uses ptyChunksRepo.appendAtomic"
metrics:
  duration_minutes: 18
  completed_date: "2026-05-18"
  tasks_completed: 2
  files_created: 5
  files_modified: 6
---

# Phase 01 Plan 04: Kill-Group + Orphan Reaper + Git Lock Scanner Summary

**One-liner:** POSIX process-group kill validated end-to-end with cascading-child smoke test, orphan PID tracking via `~/.agenstrix/running.json`, `doctor --reap` command, git lock scanner foundation, and WORKTREE-CWD-01 unit-test coverage.

## What Was Built

### src-bun/system/running-file.ts (new)

Full PID tracking module used by `worker/index.ts` on spawn and exit:
- `RUNNING_FILE_PATH()` — lazy getter (`process.env.HOME ?? os.homedir()`) so tests can override HOME
- `readRunning()` — returns `{}` on missing file or malformed JSON (warns via diagnosticsLogger)
- `writeRunning(state)` — atomic write: `writeFileSync(tmp)` then `renameSync(tmp, real)` (T-01-04-04)
- `recordPid(workerId, entry)` — read + mutate + write with `RunningEntry { pid, pgid, startedAt, cli, cwd }`
- `clearPid(workerId)` — read + delete + write
- `isProcessAlive(pid)` — `process.kill(pid, 0)` trick; works on all platforms

### src-bun/system/git-lock-scanner.ts (new)

GIT-01 foundation (Phase 2+ extends to all registered repos):
- `scanGitLocks(repoPaths)` — checks `<repo>/.git/index.lock` mtime; returns stale entries (age > 5 min)
- `removeLock(lockPath)` — safety guard: throws if path doesn't end with `/.git/index.lock`; then `unlinkSync` (T-01-04-01)
- `STALE_AGE_MS = 300_000` — 5-minute staleness threshold

### src-bun/system/doctor.ts (full replacement of Plan 01 stub)

Full orphan reaper:
- `reap(opts?)` — reads running.json, clears dead-PID entries (hygiene), for live PIDs either kills (--yes) or prompts interactively
- `killOrphan()` — POSIX: `process.kill(-pgid, 9)` (whole group); Windows: `process.kill(pid)` — EPERM/ESRCH caught silently (T-01-04-05)
- Interactive mode uses `Bun.stdin` line-by-line; falls back to `"s"` (skip) for non-TTY pipes
- Returns `ReapResult { found, killed, cleared }` (JSON-printed by main.ts)
- `promptUserKill()` preserved for API compatibility

### src-bun/worker/index.ts (updated)

Three changes from Plan 02:
1. **running-file integration**: removed inline running.json code; imports `recordPid`/`clearPid` from `system/running-file`; `recordPid` now uses full `RunningEntry` shape (cli + cwd added)
2. **`_testArgvOverride` + `AGENSTRIX_ARGV_OVERRIDE`**: new `resolveArgv(spec)` wrapper checks override first, then env var, then CLI resolution — Plan 05 tests use this hook
3. **`appendAtomic` carry-over**: batcher `onFlush` now calls `ptyChunksRepo.appendAtomic(workerId, Date.now(), Buffer.from(chunk))` — closes Plan 03's documented carry-over item

### src-bun/system/selftest.ts (updated)

`SelfTestResult` now includes:
- `staleGitLocks: StaleLock[]` — from `scanGitLocks([process.cwd()])` at boot
- `orphanWorkers: number` — live PIDs from running.json with `startedAt` before current process start
Both populate `warnings[]` with fix commands (manual `rm` for locks; `bunx agenstrix doctor --reap` for orphans).

### CLI + main.ts

- `CliArgs.yes: boolean` added; `--yes` / `-y` parsed by `parseCli`
- `reap({ yes: args.yes })` call in main.ts entry point; result printed as JSON

## Kill-Group Semantics

### POSIX (macOS, Linux)
`Bun.spawn(..., { detached: true })` calls `setsid()` → new process session → pgid === pid. `process.kill(-pgid, sig)` sends signal to the entire process group, killing the shell AND any children it forked (`sleep 600`, etc.). Smoke test verifies: `ps -o pgid= -p <workerPid>` returns `workerPid` itself, then after `killWorker()`, `ps -o pid= -g <pgid>` returns empty.

### Windows (ConPTY path — CI-only in Phase 1)
`ClosePseudoConsole` cascades SIGHUP-equivalent to all processes attached to the pseudo-console. `process.kill(pid)` on the top-level process triggers this cascade. No negative-PID syntax needed (not supported by Win32).

## running.json Schema + Lifecycle

```json
{
  "<workerId>": {
    "pid": 12345,
    "pgid": 12345,
    "startedAt": 1748000000000,
    "cli": "claude",
    "cwd": "/Users/user/project"
  }
}
```

Written by `recordPid` after `spawnWorker` returns. Removed by `clearPid` in both `killWorker` and the PTY `onExit` hook. After a backend crash (SIGKILL), the entry persists and `doctor --reap` detects it.

## Git Lock Scanner: 5-min Staleness Threshold Rationale

Git lock operations under normal circumstances complete in milliseconds. Even large repos rarely hold `index.lock` longer than 30 seconds (for `git add -A` on tens of thousands of files). 5 minutes (300s) is conservative enough to avoid false positives on slow filesystems or NFS mounts, while still catching locks left by a crashed git process.

`removeLock` Phase 1 behavior: only warn + provide manual `rm` command. Phase 2 will inspect the lock file contents (lock files can contain the holder's PID on some git versions) to confirm the holder is dead before auto-removing.

## WORKTREE-CWD-01 Test Coverage

Two tests added to `tests/unit/running-file.test.ts`:
- **Test 7 (env-scrub)**: `buildSpawnEnv([])` never includes `GIT_DIR`, `GIT_WORK_TREE`, or `GIT_INDEX_FILE` even if set in `process.env`
- **Test 8 (realpath)**: `resolveCwd({ requestedPath: symlink })` returns `realpathSync(target)`, not the symlink path; `realpathSync` on both sides normalizes macOS `/var → /private/var`

Phase 2 worktree creation can safely pass CWD to `git worktree add` knowing these invariants are test-locked.

## Test Results

| File | Tests | Result |
|------|-------|--------|
| tests/unit/running-file.test.ts | 8 | pass |
| tests/unit/git-lock-scanner.test.ts | 5 | pass |
| tests/smoke/kill-group.test.ts | 1 (skipped on Win) | pass |
| All pre-existing unit tests | 34 | pass |

## Commits in This Plan

| Commit | Type | Description | Files |
|--------|------|-------------|-------|
| `ebbc2a3` | test | running-file + kill-group RED tests | `tests/unit/running-file.test.ts`, `tests/smoke/kill-group.test.ts` |
| `5cb9f63` | feat | running-file + _testArgvOverride + appendAtomic GREEN | `src-bun/system/running-file.ts`, `src-bun/worker/index.ts` |
| `56c8d22` | test | git-lock-scanner RED tests | `tests/unit/git-lock-scanner.test.ts` |
| `66ac17f` | feat | doctor reaper + git lock scanner + selftest + CLI --yes GREEN | 5 files |
| `34431ef` | chore | Biome lint fixes in Plan 04 files | 4 files |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] macOS /var symlink in realpath test (WORKTREE-CWD-01)**
- **Found during:** Task 1 RED phase — initial test used `realpathSync(realDir)` for expected value but used `realDir` directly for assertion
- **Issue:** macOS `/var` is a symlink to `/private/var`; `resolveCwd` returns the fully-resolved `/private/var/...` path while the test's `realDir` (created via `join(tmpdir(), ...)`) was not resolved
- **Fix:** Both sides of the assertion use `realpathSync(realDir)` as the expected value
- **Files modified:** `tests/unit/running-file.test.ts`
- **Commit:** (corrected before first commit)

**2. [Rule 1 - Bug] `describe` skip option not supported by bun:test**
- **Found during:** Task 1 — tsc reported `Expected 1-2 arguments, but got 3`
- **Issue:** `describe("...", { skip: true }, callback)` is not a valid bun:test API
- **Fix:** Changed to `describe("...", () => { test.skipIf(IS_WINDOWS)(...) })`
- **Files modified:** `tests/smoke/kill-group.test.ts`
- **Commit:** (corrected before first commit)

**3. [Rule 1 - Bug] Biome lint: useless `continue` in catch block**
- **Found during:** Lint check on git-lock-scanner.ts
- **Issue:** `continue` in a catch block at the end of a loop is redundant
- **Fix:** Removed the `continue` statement
- **Files modified:** `src-bun/system/git-lock-scanner.ts`
- **Commit:** `34431ef`

None of these deviations required architectural changes.

## Known Stubs

None. All plan deliverables are fully implemented and tested.

## Threat Surface Scan

New surface from this plan:
- `doctor --reap` can send SIGKILL to arbitrary PIDs in running.json. Mitigated: `process.kill` requires same UID (EPERM on mismatched ownership — T-01-04-05). running.json is user-writable but only contains worker PIDs the user's own backend spawned.
- `removeLock(path)` accepts arbitrary path as argument from CLI. Mitigated: path validation (T-01-04-01) enforced.

No new network endpoints or auth paths introduced.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| src-bun/system/running-file.ts | FOUND |
| src-bun/system/git-lock-scanner.ts | FOUND |
| src-bun/system/doctor.ts | FOUND (full reap implementation) |
| src-bun/system/selftest.ts | FOUND (staleGitLocks + orphanWorkers) |
| src-bun/worker/index.ts | FOUND (_testArgvOverride, appendAtomic, recordPid) |
| src-bun/cli.ts | FOUND (--yes flag) |
| tests/unit/running-file.test.ts | FOUND (8 tests) |
| tests/unit/git-lock-scanner.test.ts | FOUND (5 tests) |
| tests/smoke/kill-group.test.ts | FOUND (1 test, POSIX) |
| Commit ebbc2a3 (RED tests Task 1) | FOUND |
| Commit 5cb9f63 (GREEN impl Task 1) | FOUND |
| Commit 56c8d22 (RED tests Task 2) | FOUND |
| Commit 66ac17f (GREEN impl Task 2) | FOUND |
| Commit 34431ef (lint fixes) | FOUND |
| bun run type-check | PASS |
| bun test running-file + git-lock-scanner + kill-group | 14/14 PASS |
| No modifications to STATE.md or ROADMAP.md | CONFIRMED |
| No touch on Plan 01-05 scope files (redactor.ts, spawn-env.ts) | CONFIRMED |
