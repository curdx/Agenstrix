---
phase: 01-first-pty-demo
plan: "06"
subsystem: cross-platform-ci
tags: [ci, windows, conpty, short-path, smoke-tests, github-actions, infra]
dependency_graph:
  requires: [01-04, 01-05]
  provides: [ci-matrix, win-short-path, cross-platform-smoke-tests, readme]
  affects: [all-smoke-tests, cwd-resolver]
tech_stack:
  added:
    - GitHub Actions (three-OS matrix, Bun 1.3.14 pinned)
    - cmd.exe for %i in (...) do @echo %~si (Windows short-path conversion)
  patterns:
    - TDD RED/GREEN for win-short-path
    - test.skipIf(platform) for OS-specific test gating
    - biome-ignore for intentional noControlCharactersInRegex
key_files:
  created:
    - .github/workflows/ci.yml
    - src-bun/system/win-short-path.ts
    - tests/smoke/pty-echo.test.ts
    - tests/smoke/pty-echo-win.test.ts
    - tests/smoke/win-short-path.test.ts
    - README.md
  modified:
    - src-bun/worker/cwd.ts (replace inline stub with import)
decisions:
  - "Windows short-path uses cmd.exe cmd /c for %i in... approach (not kernel32.dll FFI) — simpler, no bun:ffi dependency, adequate for spawn-time latency (50-200ms ok for cwd resolution). FFI upgrade deferred to Phase 2 if needed."
  - "Windows-only tests use test.skipIf(process.platform !== 'win32') — CI is the primary validation path, not local dev."
  - "CI fail-fast: false so all three OS results visible in parallel (macOS/Linux/Windows outcomes independent)"
  - "ASCII fast-path in getWindowsShortPath skips cmd.exe entirely for pure-ASCII cwds — no latency hit for typical dev environments."
metrics:
  duration: "373 seconds"
  completed: "2026-05-18"
  tasks_completed: 2
  files_modified: 7
  checkpoint_at: Task 3 (human verification of Windows CI run)
---

# Phase 1 Plan 06: INFRA-07 Cross-Platform CI — Summary

**One-liner:** GitHub Actions three-OS matrix (macOS/Linux/Windows, Bun 1.3.14) + Windows-specific ConPTY smoke tests + cmd.exe-based Windows short-path helper.

## What Was Built

### Task 1: Cross-platform PTY smoke tests + Windows short-path implementation

**`src-bun/system/win-short-path.ts`** — New module (`getWindowsShortPath`):

- No-op on POSIX (returns input unchanged)
- No-op for ASCII-only Windows paths (fast path, no cmd.exe call)
- For non-ASCII Windows paths: calls `cmd /c for %i in ("<path>") do @echo %~si` (synchronous, blocking, only at spawn time)
- JSDoc warns that `execSync` is blocking and must not be called in hot paths
- Per RESEARCH.md §Assumption A4 and §Pattern 8 — this approach is "simpler than kernel32.dll FFI" for Phase 1

**`src-bun/worker/cwd.ts`** — Updated to import `getWindowsShortPath` from the new module:

- Removed the inline placeholder function (`ASSUMED: exact kernel32.dll FFI signature needs verification`)
- The import means the canonical implementation is now reusable by other callers

**`tests/smoke/pty-echo.test.ts`** — Cross-platform smoke test:

- POSIX: `sh -c "echo hello; sleep 5"`, asserts bus pipeline delivers "hello" within 3s
- Windows: `cmd.exe /c "echo hello & timeout /t 5 /nobreak >NUL"`, same assertion + kill path check
- Tests POSIX kill path (force kill on cleanup); Windows kill path validated explicitly on Windows runner

**`tests/smoke/pty-echo-win.test.ts`** — Windows-only ConPTY tests (skipped on macOS/Linux):

- `test 1`: cmd.exe echo hello → CRLF byte assertion (ConPTY re-encoding, Pitfall #8)
- `test 2`: cmd.exe /c ver → bytes received without exception, "microsoft" string present
- Both tests assert `process.kill(pid)` kill path works (not `-pgid` which is POSIX-only)

**`tests/smoke/win-short-path.test.ts`** — Windows-only short-path tests (skipped on macOS/Linux):

- Creates tmpdir with non-ASCII name (`agenstrix-测试-...`)
- Asserts result is ASCII-only and the path still exists
- POSIX no-op test runs locally (confirms pass-through works)

### Task 2: GitHub Actions CI matrix + README

**`.github/workflows/ci.yml`** — Three-OS matrix:

```yaml
matrix:
  os: [macos-latest, ubuntu-latest, windows-latest]
```

- `oven-sh/setup-bun@v2` with `bun-version: "1.3.14"` (pinned per RESEARCH.md Pitfall #9)
- `bun install --frozen-lockfile` (T-01-06-01 supply-chain threat mitigation)
- tsc → biome → unit tests → smoke tests (per-platform shell)
- Windows smoke step uses `shell: pwsh` for correct env handling
- `fail-fast: false` — all three OS results visible even when one fails
- `timeout-minutes: 15` — guards against ConPTY slow boot (T-01-06-02)

**`README.md`** — Quickstart documentation:

- Platform prereqs table (Bun >= 1.3.14, Windows 10 1809+ floor)
- Subcommands (`agenstrix`, `doctor --reap`, `--port`)
- Data location (`~/.agenstrix/`)
- CI badge (placeholder owner until first push)
- Platform support table noting Windows 10 1809+ ConPTY requirement

## ConPTY Byte Re-encoding Handling (Pitfall #8)

Per RESEARCH.md Pitfall #8: ConPTY re-encodes escape sequences so they are semantically equivalent but NOT byte-identical to what cmd.exe emits. The smoke tests handle this correctly:

- `pty-echo-win.test.ts` asserts `text.toLowerCase().includes("hello")` (semantic, not byte-level)
- CRLF assertion (`combined.includes(0x0d)`) validates that Windows CR bytes are present, but doesn't compare exact escape sequence offsets
- The test explicitly documents this constraint with a comment referencing Pitfall #8

## Windows Kill Path Validation

The Windows ConPTY kill path (from Plan 04) is exercised by:

- `pty-echo.test.ts`: on `process.platform === "win32"`, calls `killWorker(id, false)` + polls `isProcessAlive(pid)` for 2s
- `pty-echo-win.test.ts`: explicit Windows tests with the same pattern

The POSIX kill-group cascade is already validated in `tests/smoke/kill-group.test.ts` (Plan 04) which uses `test.skipIf(IS_WINDOWS)`.

## Windows Short-Path Design Notes

The cmd.exe approach was chosen over kernel32.dll FFI because:

1. No bun:ffi dependency to manage
2. Simpler to reason about — pure child process call
3. Acceptable latency (50-200ms) at spawn time only (not in hot paths)
4. RESEARCH.md specifically notes "exact kernel32.dll FFI signature needs verification" — the cmd.exe approach is less risky for Phase 1

**Phase 2 upgrade path:** If the 50-200ms cmd.exe latency becomes noticeable (unlikely since spawn is async), upgrade to `bun:ffi` calling `kernel32.GetShortPathNameW` directly — that reduces latency to <1ms. The function signature would be:
```typescript
const GetShortPathNameW = lib.symbols.GetShortPathNameW as FFIFunction;
// WCHAR[] lpszLongPath, WCHAR[] lpszShortPath, DWORD cchBuffer
```

## Fallback Plan: bun-pty as Windows Default

If `Bun.Terminal` Windows ConPTY proves unreliable on the CI runner, the fallback is:

```typescript
// src-bun/pty/handle.ts factory:
if (process.platform === "win32") {
  return createBunPtyFallback(opts); // bun-pty (portable-pty FFI)
}
return createBunTerminalPty(opts);
```

This is a 5-line change. `bun-pty@0.4.8` is already in `package.json` as a dependency.

## Checkpoint Status

**Task 3 is a `checkpoint:human-verify`** — CI must be exercised on the actual `windows-latest` GitHub Actions runner since `Bun.Terminal` ConPTY shipped only 2026-05-13. Local macOS validation confirms POSIX path only.

## Deviations from Plan

None — plan executed exactly as written.

The plan specified `cmd /c for %i in ("<path>") do @echo %~si` as the implementation approach; that is what was implemented.

The plan specified `test.skipIf(process.platform !== 'win32')` for Windows-only tests; that is what was implemented.

## Known Stubs

None. All functions are fully implemented:

- `getWindowsShortPath`: real cmd.exe call, not a stub
- `resolveCwd`: imports canonical implementation, not inline stub
- CI workflow: real GitHub Actions YAML, not a template placeholder

## Threat Flags

No new security-relevant surface introduced beyond the plan's threat model.

`bun install --frozen-lockfile` in CI is explicitly per T-01-06-01 (supply chain).

## Self-Check: PASSED

**Files:**
- FOUND: .github/workflows/ci.yml
- FOUND: src-bun/system/win-short-path.ts
- FOUND: tests/smoke/pty-echo.test.ts
- FOUND: tests/smoke/pty-echo-win.test.ts
- FOUND: tests/smoke/win-short-path.test.ts
- FOUND: README.md
- FOUND: src-bun/worker/cwd.ts
- FOUND: .planning/phases/01-first-pty-demo/01-06-SUMMARY.md

**Commits:**
- FOUND: cf3f09a — test(01-06): add failing tests
- FOUND: e03add1 — feat(01-06): win-short-path + cwd.ts
- FOUND: c4dcf38 — refactor(01-06): biome fixes
- FOUND: bbd2792 — ci(01-06): GitHub Actions + README

**Local test results:**
- `bun test tests/unit/` — 63 pass, 0 fail
- `bun test tests/smoke/` — 12 pass, 4 skip (Windows-only), 0 fail
- `bunx tsc --noEmit` — pass
- `bunx @biomejs/biome check` (my files only) — no errors
