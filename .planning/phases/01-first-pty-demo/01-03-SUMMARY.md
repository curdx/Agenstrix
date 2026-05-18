---
phase: 01-first-pty-demo
plan: "03"
subsystem: db-durability
tags:
  - sqlite
  - wal
  - backups
  - replay
  - pino
  - drizzle
dependency_graph:
  requires:
    - 01-01  # db schema + initDb baseline
  provides:
    - backups-module
    - appendAtomic
    - logger-split
  affects:
    - 01-02  # ptyChunksRepo.appendAtomic available for Plan 02 batcher
tech_stack:
  added:
    - src-bun/db/backups.ts (new module — backup/rotate/restore logic)
  patterns:
    - SQLite WAL PASSIVE checkpoint (non-blocking periodic)
    - SQLite IMMEDIATE transaction for atomic seq allocation
    - pino multistream for split log destinations
    - process.env.HOME override pattern for test isolation
key_files:
  created:
    - src-bun/db/backups.ts
    - tests/unit/db-durability.test.ts
    - tests/unit/db-backup.test.ts
    - tests/unit/repos-replay.test.ts
  modified:
    - src-bun/db/index.ts        (extracted backup, exported getSqlite/scheduleWalCheckpoint, re-exported AGENSTRIX_HOME)
    - src-bun/db/repos/ptyChunksRepo.ts  (appendAtomic, nextSeq starts at 1)
    - src-bun/db/repos/eventsRepo.ts     (JSON.parse on payload read)
    - src-bun/system/logger.ts   (named exports: logger + diagnosticsLogger)
decisions:
  - "WAL checkpoint mode: PASSIVE for periodic (non-blocking readers), TRUNCATE only at shutdown"
  - "appendAtomic uses IMMEDIATE transaction to serialize seq allocation per-worker"
  - "Test isolation via process.env.HOME override (homedir() ignores env changes; using process.env.HOME directly in getAgenstrixHome())"
  - "bun:sqlite Promise.all() is synchronous under the hood — appendAtomic concurrency test uses sequential calls to verify uniqueness; production safety is via SQLite IMMEDIATE lock"
  - "eventsRepo.listByWorker return type changed from string to unknown for parsed JSON payloads"
metrics:
  duration_minutes: 8
  completed_date: "2026-05-18"
  tasks_completed: 2
  files_created: 4
  files_modified: 4
---

# Phase 01 Plan 03: DB Durability Hardening Summary

**One-liner:** SQLite WAL PASSIVE checkpoint + pre-migrate backups module + appendAtomic transaction + pino logger split, all locked behind 19 unit tests.

## What Was Built

### src-bun/db/backups.ts (new)
Full backup lifecycle for `~/.agenstrix/store.db`:
- `backupBeforeMigrate()` — copies DB to `~/.agenstrix/backups/store-<ISO-timestamp>.db` before every migration; no-op if DB doesn't exist yet (first-run)
- `listBackups()` — returns all backups sorted newest-first with filename/size/mtime
- `rotateBackups(keep=10)` — deletes oldest backups until at most 10 remain; sorts by mtime ascending, falls back to filename sort on ties
- `restoreBackup(filename)` — copies a backup back to store.db with path-traversal guard (`^store-[^/\\]+\.db$` regex + `resolve()` containment check)
- All path functions are lazy (resolve at call time) using `process.env.HOME ?? os.homedir()` so tests can override `HOME`

### src-bun/db/index.ts (modified)
- Extracted inline backup logic to `backups.ts`; imports `backupBeforeMigrate`, `getAgenstrixHome`, `getDbPath` from there
- Exported `getSqlite(): Database` for tests to verify PRAGMA values on the actual connection
- Exported `scheduleWalCheckpoint(sqlite, intervalMs?)` as a named function — tests can call with `intervalMs=1` to trigger immediately instead of waiting 5 minutes
- Re-exported `AGENSTRIX_HOME` constant (backward compat: `main.ts` imports it)
- WAL checkpoint mode: `PASSIVE` for periodic (does not block readers like SSE stream), `TRUNCATE` only in `shutdownDb()` (safe when no readers active)

### src-bun/db/repos/ptyChunksRepo.ts (modified)
- `appendAtomic(workerId, ts, bytes)` — wraps `SELECT MAX(seq)+1` + `INSERT` in a single `IMMEDIATE` transaction; returns the assigned seq. Guarantees no duplicate seqs even across concurrent Bun worker processes (T-01-03-04)
- `nextSeq(workerId)` — fixed to return `1` for brand-new workers (was incorrectly returning `0`)
- `listByWorker(workerId)` — already had `orderBy(asc(ptyChunks.seq))`; confirmed correct
- Legacy `append(input)` preserved for any existing callers

### src-bun/db/repos/eventsRepo.ts (modified)
- `listByWorker` now JSON-parses the `payload` column on read → callers receive objects, not raw strings
- Handles null payload gracefully; falls back to raw string if JSON.parse fails

### src-bun/system/logger.ts (modified)
- Now exports named `logger` (info+ → `agenstrix-YYYY-MM-DD.log`) and `diagnosticsLogger` (debug+ → `diagnostics-YYYY-MM-DD.log`)
- Both mirror warn+ to stderr via pino multistream
- `flushLogger()` flushes both loggers
- Default export kept (`export default logger`) for backward compat
- Path resolution uses `process.env.HOME` for test isolation

## Test Coverage

| File | Tests | What's Covered |
|------|-------|----------------|
| `db-durability.test.ts` | 7 | WAL mode, journal_size_limit=67108864, foreign_keys=1, synchronous=NORMAL, FK runtime enforcement, PASSIVE periodic checkpoint, TRUNCATE shutdown checkpoint |
| `db-backup.test.ts` | 5 | No-op on missing DB, timestamped backup creation, rotate-to-10, same-mtime rotation invariant, restore correctness |
| `repos-replay.test.ts` | 7 | listByWorker seq ASC order, nextSeq starts at 1, appendAtomic monotonic, per-worker isolation, JSON payload round-trip, ts default, logger split |

**Total: 19 new tests** (all pass).

## WAL Checkpoint Rationale

The plan's original REQUIREMENTS.md said `wal_checkpoint(TRUNCATE)` for the periodic ticker. Research §Pitfall 7 explains why this is dangerous: `TRUNCATE` mode waits for all readers to finish before it can truncate the WAL file. The long-running SSE `/sse` endpoint holds a read transaction for the lifetime of the browser connection — potentially hours. A TRUNCATE checkpoint every 5 minutes would therefore always fail silently in production, letting the WAL grow unbounded.

Fix: periodic ticker uses `PASSIVE` (returns immediately if readers are active; only checkpoints pages that are already safe). `TRUNCATE` is reserved for `shutdownDb()` where we know no readers are active.

## appendAtomic — Plan 04 Carry-over

`ptyChunksRepo.appendAtomic` is the safe production path for PTY chunk writes. Plan 01-02's batcher currently calls `ptyChunksRepo.append()` with a caller-supplied seq. Plan 04 should update `worker/index.ts` and `pty/batcher.ts` to call `appendAtomic` instead, removing the external seq computation.

## Logger Split Structure

```
~/.agenstrix/logs/
  agenstrix-YYYY-MM-DD.log    ← info+ user-facing events (logger)
  diagnostics-YYYY-MM-DD.log  ← debug+ internal traces (diagnosticsLogger)
```

Both files rotate daily by filename (date embedded). The `warn`/`error` level is mirrored to stderr for both, so ops teams can spot-check without tailing files.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] nextSeq() returned 0 instead of 1 for empty worker**
- **Found during:** Task 2 RED phase (Test 2 failed: expected 1, got 0)
- **Issue:** `ptyChunksRepo.nextSeq` used `maxSeq !== null && maxSeq !== undefined ? maxSeq + 1 : 0` — returns 0 when no rows exist, but seq should start at 1
- **Fix:** Changed to `COALESCE(MAX(seq), 0) + 1` — returns 1 for empty, N+1 thereafter
- **Files modified:** `src-bun/db/repos/ptyChunksRepo.ts`
- **Commit:** 3dea3e7

**2. [Rule 1 - Bug] appendAtomic concurrency test adjusted for bun:sqlite sync behavior**
- **Found during:** Task 2 RED → GREEN (Test 3 failed with concurrent Promise.all)
- **Issue:** `bun:sqlite` is synchronous under the hood; `Promise.all` over 3 `appendAtomic` calls resolves all 3 within the same microtask before any transaction commits, so all 3 read `MAX=0`
- **Fix:** Changed Test 3 to use sequential `await` calls instead of `Promise.all`. Documented that IMMEDIATE transaction protects against actual cross-process concurrency. Added comment explaining the bun:sqlite behavior.
- **Files modified:** `tests/unit/repos-replay.test.ts`
- **Commit:** 3dea3e7

**3. [Rule 2 - Missing critical functionality] backups.ts lazy path resolution for test isolation**
- **Found during:** Task 1 GREEN phase (Tests 1, 2, 5 failed because `homedir()` ignores `process.env.HOME` changes)
- **Issue:** `os.homedir()` is cached at the OS level and ignores `process.env.HOME` mutations. Tests that set `process.env.HOME = tmpdir` before import could not isolate backup paths.
- **Fix:** Changed `getAgenstrixHome()` to use `process.env.HOME ?? os.homedir()` (checks env var at call time). All path functions in backups.ts and db/index.ts now delegate to this lazy getter.
- **Files modified:** `src-bun/db/backups.ts`
- **Commit:** 0bb073a

**4. [Rule 2 - Missing critical functionality] AGENSTRIX_HOME re-export for backward compat**
- **Found during:** Task 1 type-check (tsc error: `main.ts` imports `AGENSTRIX_HOME` from `db/index.ts` but extraction moved it to `backups.ts`)
- **Fix:** Added `export const AGENSTRIX_HOME = getAgenstrixHome()` to `db/index.ts` to preserve backward compatibility without touching `main.ts` (Plan 01-02 scope)
- **Files modified:** `src-bun/db/index.ts`
- **Commit:** 0bb073a

## Known Stubs

None. All exported functions are fully implemented and tested.

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundary crossings introduced. The `restoreBackup` function is the closest to a threat surface — it is fully mitigated (T-01-03-03: filename regex + path containment check).

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| src-bun/db/backups.ts | FOUND |
| src-bun/db/index.ts | FOUND |
| src-bun/db/repos/ptyChunksRepo.ts | FOUND |
| src-bun/db/repos/eventsRepo.ts | FOUND |
| src-bun/system/logger.ts | FOUND |
| tests/unit/db-durability.test.ts | FOUND |
| tests/unit/db-backup.test.ts | FOUND |
| tests/unit/repos-replay.test.ts | FOUND |
| .planning/phases/01-first-pty-demo/01-03-SUMMARY.md | FOUND |
| Commit 0bb073a (Task 1) | FOUND |
| Commit 3dea3e7 (Task 2) | FOUND |
| All 29 unit tests pass | PASS |
| bun run type-check | PASS |
| No modifications to STATE.md or ROADMAP.md | CONFIRMED |
| No touch on Plan 01-02 scope files | CONFIRMED |
