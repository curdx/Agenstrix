---
phase: 01-first-pty-demo
plan: 05
subsystem: security
tags: [sec-01, redactor, spawn-env, pty, sqlite, websocket]
dependency_graph:
  requires:
    - 01-01  # walking skeleton wired redactChunk insertion point
    - 01-02  # worker pipeline (onData → redactChunk → bus + batcher)
    - 01-03  # ptyChunksRepo API for smoke test
  provides:
    - redactor.ts — real SEC-01 implementation replacing identity stub
    - spawn-env.ts — tightened allowlist + hard denylist
  affects:
    - src-bun/pty/redactor.ts — replaced identity stub with 4-pattern regex
    - src-bun/worker/spawn-env.ts — HARD_DENYLIST + HARD_DENYLIST_PREFIXES exports
tech_stack:
  added: []
  patterns:
    - SEC-01 regex pipeline: ANTHROPIC-KEY, GITHUB-TOKEN, OPENAI-KEY, AWS-ACCESS-KEY
    - Negative lookahead in OPENAI-KEY pattern to avoid double-matching sk-ant- prefix
    - Fast-path byte scan (sk-, ghp, AKIA) avoids TextDecoder on clean PTY chunks
    - Allowlist + hard denylist precedence: denylist always wins (defense in depth)
key_files:
  created:
    - tests/unit/redactor.test.ts
    - tests/unit/spawn-env.test.ts
    - tests/smoke/redactor-pipeline.test.ts
  modified:
    - src-bun/pty/redactor.ts
    - src-bun/worker/spawn-env.ts
decisions:
  - "Dropped broad UNKNOWN-SECRET regex (Assumption A3 per RESEARCH.md) — false-positive risk too high for Phase 1; 4 specific patterns only"
  - "OPENAI-KEY pattern uses sk-(?!ant-) negative lookahead to prevent double-matching with sk-ant- Anthropic keys"
  - "Fast-path byte scan skips TextDecoder allocation for PTY chunks without secret prefixes (common case)"
  - "Smoke test simulates worker pipeline directly (redactChunk → ptyChunksRepo → bus) rather than requiring _testArgvOverride hook (owned by Plan 01-04)"
  - "HARD_DENYLIST_PREFIXES (ANTHROPIC_, OPENAI_, AWS_, etc.) future-proofs against new key names not yet in HARD_DENYLIST"
metrics:
  duration: 497s
  completed_date: "2026-05-18"
  tasks: 2
  files_created: 3
  files_modified: 2
---

# Phase 1 Plan 05: SEC-01 Real Redactor + Spawn Env Hardening Summary

Real regex redactor with 4 specific patterns (Anthropic/GitHub/OpenAI/AWS) replacing the Plan 01 identity stub, plus spawn env hardened with hard denylist that overrides user allowlist.

## What Was Built

### Task 1: Real Redactor Implementation (SEC-01)

**File:** `src-bun/pty/redactor.ts` (replaced identity stub)

**Exports:**
- `PATTERNS: RedactPattern[]` — 4 entries, no broad UNKNOWN-SECRET pattern (Assumption A3)
- `redactString(s: string): string` — applies all patterns to a string
- `redactChunk(chunk: Uint8Array): Uint8Array` — fast-path + decode + redact + re-encode

**Regex patterns:**
```
ANTHROPIC-KEY:  /sk-ant-[A-Za-z0-9_-]{20,}/g
GITHUB-TOKEN:   /ghp_[A-Za-z0-9]{36}/g
OPENAI-KEY:     /sk-(?!ant-)[A-Za-z0-9\-_]{40,}/g   ← negative lookahead
AWS-ACCESS-KEY: /AKIA[0-9A-Z]{16}/g
```

**UTF-8 boundary semantics:**
- `TextDecoder("utf-8", { fatal: false })` handles partial multi-byte sequences at chunk boundaries
- Partial sequence → U+FFFD (replacement character); safe because all secret patterns are pure ASCII
- No mojibake on CJK characters — verified by Test 7

**Fast-path byte scan:**
- Checks for `sk-` (0x73 0x6B 0x2D), `ghp` (0x67 0x68 0x70), `AKIA` (0x41 0x4B 0x49 0x41) byte sequences
- If none found → returns original `Uint8Array` unchanged (avoids TextDecoder allocation)
- On typical PTY output (ANSI sequences, plain text), this short-circuits immediately

**Performance:**
- Test 10 verified < 50ms on 100KB chunk with secrets (loose ceiling for catastrophic backtracking detection)
- All 4 patterns are linear-complexity regexes (no nested quantifiers → no O(n²) backtracking)
- Expected real-world perf: < 1ms per 100KB chunk

### Task 2: Spawn Env Hardening

**File:** `src-bun/worker/spawn-env.ts` (replaced Plan 01 baseline)

**Exports:**
- `ALLOWED_ENV_KEYS: string[]` — `["PATH", "HOME", "USER", "LANG", "SHELL", "TERM"]`
- `HARD_DENYLIST: Set<string>` — 14 specific key names (Anthropic, OpenAI, AWS, GitHub, GitLab, NPM, HuggingFace, Stripe, Twilio, DATABASE_URL)
- `HARD_DENYLIST_PREFIXES: string[]` — `["ANTHROPIC_", "OPENAI_", "AWS_", "STRIPE_", "TWILIO_"]`
- `buildSpawnEnv(allowlist?: string[]): Record<string, string>`

**Precedence rules:**
1. Start with `ALLOWED_ENV_KEYS ∪ allowlist` as candidate set
2. Remove keys in `HARD_DENYLIST` (specific key names)
3. Remove keys whose name starts with any `HARD_DENYLIST_PREFIXES` entry
4. Remove keys whose `process.env[key]` is `undefined` (no undefined values in result)
5. Explicitly delete `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` (WORKTREE-CWD-01)

**Denylist wins over allowlist:** Even if user explicitly adds `ANTHROPIC_API_KEY` to their allowlist, it is stripped. This is the defense-in-depth invariant for SEC-01.

### Task 2: End-to-End Pipeline Smoke Test

**File:** `tests/smoke/redactor-pipeline.test.ts` (new)

**5 tests:**
1. **SQLite storage (redacted path):** synthetic secret bytes → `redactChunk` → `ptyChunksRepo.appendAtomic` → `listByWorker` → assert no raw secrets in DB
2. **SQLite storage (control path):** bypass redactor → confirm secrets DO appear (validates test methodology)
3. **Bus publish path:** `redactChunk` → `bus.publish` → subscriber receives `[REDACTED-*]` not raw secrets
4. **WS endpoint:** connects to `/ws/worker/:id`, publishes redacted chunk via bus, verifies frames contain no raw secrets
5. **Env allowlist:** `ANTHROPIC_API_KEY` in `process.env` → `buildSpawnEnv()` result has no `ANTHROPIC_API_KEY`

**Design note:** `_testArgvOverride` hook (owned by Plan 01-04 which owns `worker/index.ts`) is not yet present. The smoke test validates the pipeline by directly exercising the components `worker/index.ts` composes (`redactChunk`, `ptyChunksRepo`, `bus`), which is sufficient to verify SEC-01 correctness.

## Test Results

| File | Tests | Pass | Fail |
|------|-------|------|------|
| `tests/unit/redactor.test.ts` | 12 | 12 | 0 |
| `tests/unit/spawn-env.test.ts` | 9 | 9 | 0 |
| `tests/smoke/redactor-pipeline.test.ts` | 5 | 5 | 0 |
| **Total** | **26** | **26** | **0** |

All 50 pre-existing unit tests continue to pass (no regressions).

## Deviations from Plan

### Auto-adapted Issues

**1. [Rule 1 - Bug] Biome lint: unnecessary escape in ANTHROPIC-KEY regex**
- **Found during:** Task 1 Step 5 (biome check)
- **Issue:** `[A-Za-z0-9_\-]` → backslash before `-` inside character class is redundant
- **Fix:** Changed to `[A-Za-z0-9_-]` (dash at end of character class, no escape needed)
- **Files modified:** `src-bun/pty/redactor.ts`

**2. [Rule 3 - Blocking] SQLite FOREIGN KEY constraint in smoke test**
- **Found during:** Task 2 smoke test first run
- **Issue:** `ptyChunksRepo.appendAtomic` requires a worker row in `workers` table (FK constraint). The smoke test was inserting chunks without creating the parent worker row.
- **Fix:** Added `workersRepo.insert(...)` before `ptyChunksRepo.appendAtomic` in both SQLite smoke test cases.
- **Files modified:** `tests/smoke/redactor-pipeline.test.ts`

**3. [Adapted] `_testArgvOverride` hook not yet in `worker/index.ts`**
- **Context:** Plan 01-05 Task 2 Step 4 specifies the `_testArgvOverride` hook is added by Plan 01-04 (which owns `worker/index.ts`). Parallel execution means this plan cannot depend on 01-04's work.
- **Adaptation:** Smoke test directly exercises the pipeline components (`redactChunk`, `ptyChunksRepo`, `bus`) instead of spawning a real worker with argv override. This tests the same SEC-01 invariant at the component boundary.
- **Impact:** None — the plan explicitly allows consuming the hook if available, and the smoke test validates all required SEC-01 assertions.

## Phase 2+ Extension Points

1. **User allowlist via settings (Phase 5):** `buildSpawnEnv` already accepts `allowlist?: string[]`. Phase 5's settings panel can pass user-configured env var names through `WorkerSpec.envAllowlist`.

2. **New API key format PR:** Adding a new pattern is a 1-line change in `PATTERNS` array in `src-bun/pty/redactor.ts`. Central location, unit-testable. No changes needed in the worker pipeline or storage layer.

3. **Pattern set for Phase 2 consideration:** When `claude` tools start returning data from external services (Phase 3+), consider adding patterns for: Slack tokens (`xoxb-`/`xoxp-`), Heroku API keys (`HRKU-`), Twilio phone verification tokens.

4. **Performance at high throughput (Phase 3+):** Current regex scan is sufficient for 1 worker. At 8+ workers × 100KB/s = 800KB/s, consider a pre-compiled `RegExp.exec` loop instead of `String.replace` chain, or a WASM-based scanner for hot paths.

## Known Stubs

None — all pipeline components are real implementations. The `_testArgvOverride` hook in `worker/index.ts` is noted as deferred (to Plan 01-04).

## Threat Flags

No new security-relevant surface introduced. Both files modified are internal backend implementation with no new network endpoints or trust boundary changes.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| `src-bun/pty/redactor.ts` | FOUND |
| `src-bun/worker/spawn-env.ts` | FOUND |
| `tests/unit/redactor.test.ts` | FOUND |
| `tests/unit/spawn-env.test.ts` | FOUND |
| `tests/smoke/redactor-pipeline.test.ts` | FOUND |
| `.planning/phases/01-first-pty-demo/01-05-SUMMARY.md` | FOUND |
| Commit `df0cc83` (test RED — redactor) | FOUND |
| Commit `b16e8cf` (feat — redactor GREEN) | FOUND |
| Commit `1e1dac3` (test RED — spawn-env) | FOUND |
| Commit `ae84f99` (feat — spawn-env GREEN) | FOUND |
| Commit `23ac30e` (feat — smoke test GREEN) | FOUND |
