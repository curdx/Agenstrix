---
phase: 01-first-pty-demo
reviewed: 2026-05-18T12:00:00Z
depth: standard
files_reviewed: 56
files_reviewed_list:
  - .gitattributes
  - .github/workflows/ci.yml
  - README.md
  - biome.json
  - drizzle.config.ts
  - package.json
  - src-bun/bus/index.ts
  - src-bun/cli.ts
  - src-bun/db/backups.ts
  - src-bun/db/index.ts
  - src-bun/db/repos/eventsRepo.ts
  - src-bun/db/repos/messagesRepo.ts
  - src-bun/db/repos/ptyChunksRepo.ts
  - src-bun/db/repos/workersRepo.ts
  - src-bun/db/schema.ts
  - src-bun/gateway/index.ts
  - src-bun/gateway/rest.ts
  - src-bun/gateway/sse.ts
  - src-bun/gateway/ws.ts
  - src-bun/main.ts
  - src-bun/pty/batcher.ts
  - src-bun/pty/bun-pty.ts
  - src-bun/pty/bun-terminal.ts
  - src-bun/pty/handle.ts
  - src-bun/pty/redactor.ts
  - src-bun/system/browser.ts
  - src-bun/system/doctor.ts
  - src-bun/system/git-lock-scanner.ts
  - src-bun/system/logger.ts
  - src-bun/system/running-file.ts
  - src-bun/system/selftest.ts
  - src-bun/system/win-short-path.ts
  - src-bun/worker/cwd.ts
  - src-bun/worker/index.ts
  - src-bun/worker/spawn-env.ts
  - src-react/App.tsx
  - src-react/components/ChatInput.tsx
  - src-react/components/MessageCard.tsx
  - src-react/components/SelfTestBanner.tsx
  - src-react/components/SelfTestDialog.tsx
  - src-react/components/WorkerTerminal.tsx
  - src-react/components/WorkspaceBar.tsx
  - src-react/index.css
  - src-react/index.html
  - src-react/lib/store.ts
  - src-react/lib/utils.ts
  - src-react/main.tsx
  - tests/smoke/claude-pty.test.ts
  - tests/smoke/healthz.test.ts
  - tests/smoke/kill-group.test.ts
  - tests/smoke/pty-echo-win.test.ts
  - tests/smoke/pty-echo.test.ts
  - tests/smoke/redactor-pipeline.test.ts
  - tests/smoke/skeleton-echo.test.ts
  - tests/smoke/win-short-path.test.ts
  - tests/smoke/ws-heartbeat.test.ts
  - tests/unit/batcher.test.ts
  - tests/unit/db-backup.test.ts
  - tests/unit/db-durability.test.ts
  - tests/unit/db.test.ts
  - tests/unit/git-lock-scanner.test.ts
  - tests/unit/redactor.test.ts
  - tests/unit/repos-replay.test.ts
  - tests/unit/running-file.test.ts
  - tests/unit/spawn-env.test.ts
  - tsconfig.json
  - vite.config.ts
findings:
  critical: 4
  warning: 11
  info: 6
  total: 21
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-05-18T12:00:00Z
**Depth:** standard
**Files Reviewed:** 56
**Status:** issues_found

## Summary

Phase 1 walking-skeleton ships a coherent Bun + Hono + Drizzle/SQLite + xterm.js + Bun.Terminal stack and the three-OS CI matrix is green. The architecture is sound: PtyHandle abstraction is clean, the AnsiChunkBatcher correctly implements VT500 boundary detection, the redactor pipeline runs before persistence and WS forward, and the env allowlist + hard denylist gives defense-in-depth against secret leakage.

That said, the implementation has several real correctness defects that escape the smoke tests because the affected paths are exercised by tests through different (lower-level) code, not through the user-facing HTTP/UI flow:

- **The chat input is wire-broken end-to-end.** `App.tsx` POSTs `{ text }` but `rest.ts` Zod-validates `{ data: z.string() }`. Every user message hits HTTP 400; smoke tests bypass this by calling `sendToWorker` directly. (BLOCKER, CR-01.)
- **The "Re-check" self-test button doesn't re-check.** `SelfTestDialog` calls `GET /healthz` (returns cached warnings) instead of `POST /api/selftest/recheck`. (BLOCKER, CR-02.)
- **`AGENSTRIX_HOME` constant is computed at module-load time** even though its docstring claims it's a "getter-based constant that respects test HOME overrides." It does not. The `mkdirSync(getAgenstrixHome(), …)` call uses the lazy form on the next line so first-launch detection in `main.ts` (which uses the constant) can misfire under test HOME overrides. (BLOCKER, CR-03.)
- **`selftest.ts` writes its probe DB to the real `os.homedir()`**, ignoring `process.env.HOME` overrides — bypassing the test-isolation discipline the rest of the codebase carefully follows. Unit tests that override HOME for isolation still mutate the developer's actual `~/.agenstrix/` directory. (BLOCKER, CR-04.)

Warnings cover process-management corner cases (EPERM ≠ ESRCH in `isProcessAlive`), unvalidated WS resize input despite a comment claiming Zod validation, an ArrayBuffer aliasing risk in the WS send path, several SSE wiring issues, and the misleading `regex.lastIndex` reset in the redactor.

The 4 BLOCKERs must be fixed before this phase can be called shippable. The walking-skeleton claim "real `claude` PTY in the browser end-to-end" is currently inaccurate because the browser → server stdin path returns 400.

## Critical Issues

### CR-01: ChatInput POST body field mismatch — every chat message returns HTTP 400

**File:** `src-react/App.tsx:104`
**Issue:**
`App.tsx` sends `body: JSON.stringify({ text })` but `src-bun/gateway/rest.ts:72` validates `z.object({ data: z.string() })`. Zod-validator rejects requests missing the `data` field, returning HTTP 400 with no input ever reaching the PTY. The smoke tests (`skeleton-echo.test.ts`, `claude-pty.test.ts`) cover this path with `sendToWorker(workerId, ...)` directly, not through the REST endpoint, so the bug is not caught.

The `handleSend` `try/catch` swallows the rejection silently, so the user sees their message vanish from the textarea with no error — the worst possible UX for a broken pipe.

**Fix:** Change one side to match. Recommend fixing the frontend to align with the documented contract:
```ts
// src-react/App.tsx
await fetch(`/api/workers/${skeletonWorkerId}/input`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ data: text }), // was: { text }
});
```
Also surface fetch failures (don't swallow `!resp.ok` in the catch) so this kind of breakage is visible during development.

---

### CR-02: SelfTestDialog "Re-check" button does not re-run self-test

**File:** `src-react/components/SelfTestDialog.tsx:75-91`
**Issue:**
`handleRecheck()` calls `fetch("/healthz")`, which returns the cached `_startupInfo.selfTestWarnings` set once during `startServer()`. It never re-invokes `runSelfTest`. The dedicated re-check endpoint `POST /api/selftest/recheck` (`rest.ts:83`) is implemented but never wired to the UI, so:
- "Re-check" can only ever return the original boot-time result
- A user installing `claude` after Agenstrix is running, clicking "Re-check", still sees the warning forever (unless they restart the server)

INFRA-06 in `01-RESEARCH.md` specifies the recheck endpoint exists precisely to fix this; the wiring step was dropped.

**Fix:**
```ts
// src-react/components/SelfTestDialog.tsx
async function handleRecheck() {
  setRechecking(true);
  try {
    const resp = await fetch("/api/selftest/recheck", { method: "POST" });
    if (resp.ok) {
      const data = (await resp.json()) as { warnings?: SelfTestWarning[] };
      setSelfTestWarnings(data.warnings ?? []);
      if ((data.warnings ?? []).length === 0) onClose();
    }
  } catch {
    // Network error — keep dialog open
  } finally {
    setRechecking(false);
  }
}
```
Also: the recheck endpoint passes `port=0` to `runSelfTest`. The comment says "skip port check" but `runSelfTest` will still execute `Bun.serve({ port: 0, … })` (Bun assigns a random free port). Harmless but the comment lies.

---

### CR-03: `AGENSTRIX_HOME` constant is eagerly evaluated — getter comment is false

**File:** `src-bun/db/index.ts:19-22`
**Issue:**
```ts
// Re-export for backward compat (main.ts uses AGENSTRIX_HOME constant).
// Note: since getAgenstrixHome() is lazy, this getter-based constant respects
// process.env.HOME overrides used in tests.
export const AGENSTRIX_HOME = getAgenstrixHome();
```
The comment is factually wrong. `export const X = fn();` evaluates `fn()` once at module-load time and binds the resulting string to `X` for the lifetime of the process. This is *not* a getter, *not* lazy, and does *not* respect later `process.env.HOME` mutations.

Concrete impact: `main.ts:47` does `const firstLaunch = !existsSync(AGENSTRIX_HOME);` and `main.ts:60` interpolates `AGENSTRIX_HOME` into the FATAL error message. Both use the frozen module-load value. A test that overrides HOME via `process.env.HOME = tmpdir` after `db/index.ts` has been imported still sees the old developer-home path in the error message. The `mkdirSync(getAgenstrixHome(), …)` call inside `initDb` correctly uses the lazy form — proving the author knew the distinction and just got it wrong here.

This is also a security/observability concern: the FATAL error message could leak the developer's real `~/.agenstrix` path in CI logs even when the test asks for an isolated home.

**Fix:** Make it lazy at every call site (matches the pattern already established by `getDbPath`, `getBackupDir`):
```ts
// src-bun/db/index.ts — delete the bogus constant.

// src-bun/main.ts:23
import { initDb, shutdownDb } from "./db/index";
import { getAgenstrixHome } from "./db/backups";

// src-bun/main.ts:47
const home = getAgenstrixHome();
const firstLaunch = !existsSync(home);

// src-bun/main.ts:60
`Fix: ensure ${home} exists and is writable.\n` +
```

---

### CR-04: `selftest.ts` bypasses the HOME-override discipline and writes to the developer's real `~/.agenstrix/`

**File:** `src-bun/system/selftest.ts:99-103`
**Issue:**
```ts
const testPath = join(os.homedir(), ".agenstrix", "__selftest.db");
try {
  mkdirSync(join(os.homedir(), ".agenstrix"), { recursive: true });
  const db = new Database(testPath, { create: true });
  ...
```
Every other module that touches `~/.agenstrix/` (`db/backups.ts`, `system/logger.ts`, `system/running-file.ts`) follows the pattern `process.env.HOME ?? os.homedir()` so that tests can isolate to a tmpdir. `selftest.ts` calls `os.homedir()` directly twice. Consequences:

1. Any unit/smoke test that runs `runSelfTest()` (the smoke server starts via `startServer` → `runSelfTest`) writes a `__selftest.db` to the developer's *real* home directory, polluting it with leftover artifacts even when the test believes HOME has been redirected.
2. CI runs on macos-latest/ubuntu-latest/windows-latest write to the *runner's* real `~`, which is fine in clean CI but masks the bug locally.
3. The "criticalFailure (SQLite unwritable) → hard exit" decision tree in D-12 is supposed to gate on whether the *target* home is writable. With this bug, the gate is on whether the *developer's* real home is writable — a different question.

**Fix:** Use the lazy helpers already in `backups.ts`:
```ts
// src-bun/system/selftest.ts
import { getAgenstrixHome } from "../db/backups";
// ...
const home = getAgenstrixHome();
const testPath = join(home, "__selftest.db");
try {
  mkdirSync(home, { recursive: true });
  const db = new Database(testPath, { create: true });
  // ...
```
The unlinkSync(testPath) cleanup is already best-effort with a try/catch, so the rename is safe.

## Warnings

### WR-01: `isProcessAlive` treats EPERM as "dead" — orphan misclassification

**File:** `src-bun/system/running-file.ts:88-95`
**Issue:**
```ts
export function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}
```
On POSIX, `process.kill(pid, 0)` throws `ESRCH` if no process exists with that PID, and `EPERM` if the PID exists but is owned by a different UID. The catch-all returns `false` for both, which means:
- In `doctor.ts:50`, a still-alive orphan owned by another user is silently classified as dead and `clearPid()`'d from `running.json` without being killed.
- In `selftest.ts:156`, the same alive-but-not-ours orphan never increments `orphanWorkers` so the user doesn't see a warning.

For a single-user dev tool this is rare but real (e.g., system-wide claude installation run as a service account). The block comment in `doctor.ts:10-12` already acknowledges T-01-04-05 says "EPERM throws are caught and logged" — the code doesn't actually do that.

**Fix:** Distinguish the two error codes:
```ts
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM") return true; // exists but not ours
    return false; // ESRCH and everything else
  }
}
```

---

### WR-02: WS resize message has no Zod validation — comment lies

**File:** `src-bun/gateway/ws.ts:60-67`
**Issue:**
```ts
} else if (typeof data === "string") {
  // Control messages: resize, ping
  try {
    const msg = JSON.parse(data) as { type?: string; cols?: number; rows?: number };
    if (msg.type === "resize" && msg.cols !== undefined && msg.rows !== undefined) {
      resizeWorker(workerId, msg.cols, msg.rows);
    }
  } catch {
    // Ignore malformed JSON (T-01-01: Zod validation for resize)
  }
}
```
The comment claims "T-01-01: Zod validation for resize" but there is no Zod schema — just an unchecked TypeScript type assertion. `msg.cols` and `msg.rows` could be:
- Negative numbers → `pty.resize(-1, -1)` is undefined behavior in ConPTY/POSIX
- `NaN`, `Infinity`, fractional values
- Massive integers that allocate huge buffers in xterm/PTY
- Non-numeric (string "100" coerces silently through `> 0` checks if you added them)

`resizeWorker` (`worker/index.ts:255`) does no bounds checking either. A malicious client (or a buggy proxy/browser extension that strips type-correctness) can send `{type:"resize", cols:1, rows:1}` repeatedly to make the terminal unusable, or `{type:"resize", cols:99999, rows:99999}` to stress the PTY.

**Fix:**
```ts
import { z } from "zod";
const ResizeSchema = z.object({
  type: z.literal("resize"),
  cols: z.number().int().positive().max(2000),
  rows: z.number().int().positive().max(2000),
});

try {
  const parsed = ResizeSchema.safeParse(JSON.parse(data));
  if (parsed.success) {
    resizeWorker(workerId, parsed.data.cols, parsed.data.rows);
  }
} catch { /* malformed JSON */ }
```

---

### WR-03: `ws.send(payload.buffer)` can leak unrelated bytes via Uint8Array aliasing

**File:** `src-bun/gateway/ws.ts:34`
**Issue:**
```ts
unsubscribe = bus.subscribe(`worker.output.${workerId}`, (payload: unknown) => {
  if (payload instanceof Uint8Array) {
    try { ws.send(payload.buffer as ArrayBuffer); }
    ...
```
`Uint8Array.prototype.buffer` returns the *entire* underlying ArrayBuffer regardless of `byteOffset`/`byteLength`. If a chunk is ever passed through as a `.subarray()` view (the batcher does this internally with `input.subarray(segStart, lastGroundIdx + 1)` — though those instances go through `onFlush`, not the bus), the WS would broadcast the entire backing buffer, leaking neighboring bytes potentially including unredacted memory.

Current Phase 1 path is safe by luck: `redactChunk` either returns the original Uint8Array (which from `Bun.Terminal.data` callback is a fresh allocation), or `encoder.encode(redacted)` (also fresh). But this is a foot-gun — any future refactor that introduces a `subarray()` view between PTY and bus.publish silently turns into a data-disclosure bug.

**Fix:** Send the Uint8Array directly (Bun's WebSocket accepts Uint8Array as a binary frame and respects the view bounds):
```ts
ws.send(payload);
```
If you must hand off ArrayBuffer, slice to the view's bounds:
```ts
const ab = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
ws.send(ab);
```

---

### WR-04: Two `EventSource("/sse/events")` connections per worker — pool exhaustion at scale

**File:** `src-react/App.tsx:72`, `src-react/components/MessageCard.tsx:57`
**Issue:**
Both `App.tsx` and each `MessageCard` open their own `new EventSource("/sse/events")`. Browsers cap concurrent connections-per-origin at ~6. Phase 1 has 1 worker so 2 connections is fine; Phase 3+ ships N workers, each with its own MessageCard, so 1 + N connections. With N >= 5 the browser silently queues SSE upgrade requests, and the topology graph (Phase 3) will need its own SSE too, hitting the cap.

Additionally, each connection on the server side creates its own bus subscription — N MessageCards × 1 user = N x bus subscribers on the same topic, all fan-outing the same payload.

**Fix:** Lift SSE subscription into a singleton (zustand store or React context). Components subscribe to the store, not directly to EventSource. Pattern is straightforward and matches the existing zustand-as-singleton design.

---

### WR-05: SSE `selftest.warning` events broadcast at boot are lost — no subscribers yet

**File:** `src-bun/main.ts:126-129`
**Issue:**
```ts
// Broadcast self-test warnings via SSE so UI banner can show them (D-10)
for (const warning of selfTest.warnings) {
  publishSseEvent({ type: "selftest.warning", warning });
}
```
This runs synchronously inside `startServer()`, *before* `Bun.serve` has accepted any connections. The in-memory bus has no subscribers yet, so these events are dropped silently. The frontend retrieves warnings via `/healthz` instead, so the UI works — but the SSE broadcast is dead code that gives a false sense of "warnings are real-time."

**Fix:** Either delete the loop (warnings are sourced from `/healthz`) or push them through `eventsRepo.append` so they're durable and replayable via REST. Don't pretend bus.publish without subscribers is a feature.

---

### WR-06: `streamSSE` registers two `stream.onAbort` callbacks — second overwrites or queues the first

**File:** `src-bun/gateway/sse.ts:32-40`
**Issue:**
```ts
stream.onAbort(() => { unsubscribe(); });
// ...
await new Promise<void>((resolve) => {
  stream.onAbort(resolve);
});
```
Hono's `stream.onAbort` is documented to register a single abort handler. Calling it twice depending on the version either:
(a) replaces the first handler (leaking the bus subscription) — Hono 4.x behavior is implementation-dependent, or
(b) keeps both — works coincidentally.

The pattern works today because Hono 4.12.x happens to support multiple handlers, but this is fragile. The intent — "use onAbort as a long-running Promise — should be one handler that does both jobs.

**Fix:**
```ts
await new Promise<void>((resolve) => {
  stream.onAbort(() => {
    unsubscribe();
    resolve();
  });
});
```

---

### WR-07: TextDecoder allocated per WS keystroke — minor but unbounded

**File:** `src-bun/gateway/ws.ts:56`
**Issue:**
```ts
if (data instanceof ArrayBuffer) {
  const text = new TextDecoder().decode(data);
  sendToWorker(workerId, text);
}
```
A new `TextDecoder` is constructed for every inbound keystroke. While each construction is cheap, this is also the wrong primitive: PTY stdin is byte-oriented, not text-oriented. Forcing a UTF-8 decode/re-encode round-trip will corrupt:
- Binary clipboard pastes
- Non-UTF-8 input (legacy CP-936 on Windows zh-CN, BIG5)
- Keypresses that send raw bytes (function keys, escape sequences from xterm)

`sendToWorker` then encodes back to bytes via `terminal.write(data: string)` — another UTF-8 round-trip. In practice xterm sends UTF-8 ASCII so this works for the demo, but the design is wrong.

**Fix:** Pass bytes through without re-encoding. Either change `sendToWorker` to accept `Uint8Array` and use `terminal.write(bytes)`, or use a top-level cached decoder and document the UTF-8 assumption explicitly:
```ts
// Better long-term:
sendToWorkerBytes(workerId, new Uint8Array(data));
// Short-term band-aid:
const decoder = new TextDecoder("utf-8", { fatal: false });
```

---

### WR-08: `regex.lastIndex = 0` reset is dead code (and the comment justifies it incorrectly)

**File:** `src-bun/pty/redactor.ts:65-71`
**Issue:**
```ts
for (const { regex, label } of PATTERNS) {
  // Reset lastIndex since we reuse the same regex object across calls
  regex.lastIndex = 0;
  out = out.replace(regex, `[REDACTED-${label}]`);
}
```
`String.prototype.replace(regex, replacer)` with a `/g` flag iterates through *all* matches internally and ignores `regex.lastIndex` for the iteration. `lastIndex` only matters for `regex.exec()` / `regex.test()` in stateful loops. The reset is harmless but misleading — future maintainers will think there's a stateful concern that doesn't exist.

This is a code-quality issue but flagged here because the misleading comment ("reset lastIndex since we reuse the same regex object across calls") implies a correctness reason. Anyone refactoring to `exec()` later will copy the comment and *not* understand the actual stateful semantics.

**Fix:** Delete the `regex.lastIndex = 0;` line and the comment. The PATTERNS array is reused safely without it.

---

### WR-09: `removeLock` Windows path check accepts only `\.git\index.lock` but not `\.git\\index.lock`

**File:** `src-bun/system/git-lock-scanner.ts:67-74`
**Issue:**
```ts
const normalised = resolve(lockPath);
const isValidPosix = normalised.endsWith("/.git/index.lock");
const isValidWindows = normalised.endsWith("\\.git\\index.lock");
```
`path.resolve()` on Windows normalizes separators to `\` and does not collapse mixed separators in all edge cases. If `lockPath` is passed in with mixed slashes (`C:\\repo/.git/index.lock`), after resolve it might end with `.git\index.lock` (correctly), but if Windows path UNC prefix `\\?\C:\repo\.git\index.lock` is involved, the literal endsWith check still works. The check is mostly fine but brittle on UNC paths.

More critically, the Posix check requires forward-slash `/.git/index.lock` but `path.resolve` on POSIX always returns forward slashes — so safe there.

**Fix:** Use `path.basename(path.dirname(p))` + `path.basename(p)` instead of endsWith to be path-separator-agnostic:
```ts
import { basename, dirname } from "node:path";
const baseValid = basename(normalised) === "index.lock";
const dirValid = basename(dirname(normalised)) === ".git";
if (!baseValid || !dirValid) {
  throw new Error(`removeLock: refusing to remove '${lockPath}'`);
}
```

---

### WR-10: `bun-pty` stub throws on activation — silent failure for users who deliberately set `AGENSTRIX_PTY_BACKEND=bun-pty`

**File:** `src-bun/pty/bun-pty.ts:16-26`
**Issue:**
```ts
export function createBunPtyFallback(_opts: PtySpawnOpts): PtyHandle {
  throw new Error(
    "bun-pty fallback not yet wired — implementation deferred to Plan 02. " +
    "Set AGENSTRIX_PTY_BACKEND=bun-terminal (default) to use Bun.Terminal backend."
  );
}
```
The error message tells the user to set `AGENSTRIX_PTY_BACKEND=bun-terminal` to use the default, but the factory in `handle.ts:34` already defaults to `bun-terminal` *unless* the env var is exactly `"bun-pty"`. So if the user set it to anything else (typo, "bunpty", etc.), they get the default behavior — which is correct, but the error message is unreachable except when they deliberately set the value to `"bun-pty"`. A user who set it to `"bun-pty"` to test fallback gets a hard crash at spawn time with a message that says "set AGENSTRIX_PTY_BACKEND=bun-terminal", which is exactly what they did NOT want.

Two issues: stub crashes when explicitly requested (acceptable for Phase 1) AND the error message is confusing.

**Fix:** Reword to make Phase-1 status explicit:
```ts
throw new Error(
  "bun-pty FFI backend is a Phase 2 fallback and is not wired in Phase 1. " +
  "Unset AGENSTRIX_PTY_BACKEND to use the default Bun.Terminal backend, " +
  "or wait for Phase 2 if you specifically need bun-pty's FFI path."
);
```

---

### WR-11: `db-durability.test.ts` Test 6 monkey-patches `sqlite.exec` but the lambda interval is 1ms — racy and could miss the TRUNCATE in Test 7

**File:** `tests/unit/db-durability.test.ts:108-141`
**Issue:**
Test 6 swaps `sqlite.exec` with an instrumenting closure, schedules a 1ms checkpoint interval, waits 50ms, cancels, and asserts. The interval timer can fire many times in 50ms — the instrumented exec captures all SQL including the eventual shutdown TRUNCATE. Then `finally { await shutdownDb(); }` runs — but the monkey-patch has already been restored to `originalExec` on line 132, so Test 7 (which restarts with `initDb()`) should be clean. However, the cleanup ordering depends on whether `shutdownDb` succeeds in flushing the `setInterval` before the test exits. If a stray interval fires after `cancel()`, the closure references the now-detached `capturedSql` array — but the original `setInterval` returned by `scheduleWalCheckpoint(sqlite, 1)` was never returned/exposed; we only have `cancel()`. So one stray fire is possible after `cancel()` if the JS event-loop is starved.

Tests pass, so this is a latent flake risk rather than a bug — but the monkey-patch pattern is fragile.

**Fix:** Use a counter/spy injected into `scheduleWalCheckpoint` instead of monkey-patching `sqlite.exec`. Add an optional `_testHook` parameter:
```ts
export function scheduleWalCheckpoint(sqlite, intervalMs, _testHook?: (sql: string) => void) {
  const timer = setInterval(() => {
    const sql = "PRAGMA wal_checkpoint(PASSIVE);";
    _testHook?.(sql);
    sqlite.exec(sql);
  }, intervalMs);
  // ...
}
```
This eliminates the monkey-patch and the cleanup races.

## Info

### IN-01: `package.json` `lint` script uses `--apply` flag

**File:** `package.json:13`
**Issue:** `"lint": "bunx @biomejs/biome check --apply ."` — `--apply` writes fixes. A "lint" script in CI/CD is conventionally read-only; the writing variant is usually called `lint:fix`. CI runs `bunx @biomejs/biome check .` (no `--apply`) per `.github/workflows/ci.yml:31`, so this only affects developers who type `bun run lint` locally. Convention: rename to `lint:fix` and add a `lint` script without `--apply`.

---

### IN-02: `lucide-react` pinned to `^1.16.0` but CLAUDE.md and TECH_STACK both recommend `^0.500.x` (latest)

**File:** `package.json:58`
**Issue:** `package.json` declares `"lucide-react": "^1.16.0"` but the tech-stack lockfile in CLAUDE.md specifies `^0.500.x`. Lucide-react does not (yet) have a 1.x release per upstream — this version is suspicious. Either the version is fabricated (npm install would fail) or the resolved version differs from the declared range. Either way, this should be reconciled to match the documented stack and verified via `bun install --frozen-lockfile`.

---

### IN-03: `shadcn: ^4.7.0` listed as a runtime dependency

**File:** `package.json:63`
**Issue:** `"shadcn": "^4.7.0"` appears in `dependencies`, but `shadcn` is the CLI tool used to scaffold components — its runtime API is empty. It should either move to `devDependencies` or be removed entirely (you can always `bunx shadcn@latest add …` without installing it locally). CLAUDE.md "What NOT to Use" explicitly warns: "`assistant-ui` (unscoped CLI) as a runtime dep — that's the CLI, not the React library." Same anti-pattern applies here.

---

### IN-04: `App.tsx` SSE listener for `worker.started` event — but backend never publishes this event type

**File:** `src-react/App.tsx:79`
**Issue:**
```ts
if (payload.type === "worker.started" && typeof payload.workerId === "string") {
  setSkeletonWorker(...);
}
```
Searching the backend (`worker/index.ts`, `main.ts`) shows the backend publishes `"worker.spawned"` and `"worker.exited"` (and `"selftest.warning"`) — never `"worker.started"`. The handler is dead code. Either:
- The backend should publish `worker.started` (rename for SSE consumption distinct from DB event types), or
- Delete the dead branch.

---

### IN-05: `WorkerTerminal` does not unhandle/dispose addons; relies on `term.dispose()` cascade

**File:** `src-react/components/WorkerTerminal.tsx:63-81`
**Issue:** Addons (FitAddon, Unicode11Addon, WebLinksAddon, WebglAddon/CanvasAddon) are loaded but no `addon.dispose()` is called on cleanup. `term.dispose()` does cascade-dispose loaded addons in xterm 6.x, so functionally this works, but if WebglAddon failed to load (it lives in the try/catch) and you later try to load a different renderer, references can leak. Phase 1 only has one terminal lifecycle so this is benign; flagging for awareness.

---

### IN-06: `formatUptime` rolls over silently past 99 hours

**File:** `src-react/components/MessageCard.tsx:27-34`
**Issue:** Past 99 hours the display reads "100h 0m" then "1000h 0m" etc., which is correct but visually awkward in a small header. A real Master Claude session running for weeks would show "672h 0m" instead of "4w 0d 0h". Phase 1 doesn't really hit this — typical session is minutes — so this is purely cosmetic. Switch to `Intl.RelativeTimeFormat` or split into days when hours > 48.

---

_Reviewed: 2026-05-18T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
