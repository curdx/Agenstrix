# Pitfalls Research — Agenstrix

**Domain:** Multi-agent CLI orchestrator (Bun + PTY-wrapped `claude`/`codex` + MCP plugin to autonomous Master + git worktrees + smart workspace)
**Researched:** 2026-05-17
**Confidence:** HIGH for items cross-referenced to GitHub issues / official docs; MEDIUM for the few items derived from ecosystem post-mortems alone.

## Scope & Cross-references

This file is the **forward-looking failure catalog** for Agenstrix. It extends — does not duplicate — the failure information already documented elsewhere:

- **STACK.md "Known Production Gotchas"** — version-locked stack quirks (Bun.Terminal Windows, drizzle-kit push, xterm.js WebGL parent-size, Hono adapter, etc.). Where this file references a known gotcha, it adds the *operational* consequence (warning signs, recovery) the stack research doesn't cover.
- **FEATURES.md "Hidden Requirements" (HR-01..HR-20)** — silent feature requirements derived from competitor failure modes. This file links each pitfall to the HR-* it corresponds to and adds the *engineering guard* that prevents it.
- **ARCHITECTURE.md "Failure Boundaries & Recovery"** and **"Anti-Patterns to Avoid"** — process-level crash recovery and module-shape anti-patterns. This file adds the **finer-grained code-level pitfalls** that the architecture doc treats as one-liners.

When a pitfall is already named elsewhere, this file gives it the warning-signs + recovery + phase-mapping treatment the downstream roadmapper needs, and never re-states stack-known facts.

---

## Critical Pitfalls

### Pitfall 1: SIGTERM does not propagate to `claude`'s child processes (orphan `node`/`rg`/`grep` storms)

**What goes wrong:**
You kill a Worker with `proc.kill(SIGTERM)` and the `claude` PTY exits — but the subprocesses that `claude` spawned (the `node` MCP bridge, `rg` searches, language-server children, opened browsers from `chrome-devtools-mcp`) keep running. Hours later your `ps` shows dozens of orphan processes still holding open API connections, file locks, and ports. Worst case: orphan `claude` itself keeps polling the Anthropic API and the user gets billed for an "interrupted" session.

**Why it happens:**
Bun does not yet expose `setpgid()` directly (oven-sh/bun#1442); without it, `proc.kill(15)` signals only the immediate child PID, not the process group. `claude` spawns its tools (MCP servers, search, edit subprocesses) under its own PID, and on POSIX those subprocesses inherit the parent's pgid only if you established a new group at spawn time. On Windows, ConPTY does handle cascading kill via the kernel, but only for the ConPTY pseudo-handle itself — not for browser processes that `chrome-devtools-mcp` launched.

**Warning signs:**
- `ps -ef | grep -E 'claude|node|rg' | wc -l` keeps climbing across sessions even after "all done"
- `~/.agenstrix/store.db` shows `workers.state='done'` but Activity Monitor / Task Manager shows the matching PIDs alive
- Chrome / Chromium windows from `chrome-devtools-mcp` persist after Worker exit
- Disk doesn't reclaim worktree space because a `node` child still has the cwd open
- `lsof` shows open file descriptors against deleted worktree paths

**Prevention (Phase 2 PTY, Phase 4 MCP):**
1. **Always spawn with `detached: true`** so Bun calls `setsid()` and the child becomes process-group leader. ARCHITECTURE.md already mandates this; treat it as a unit-test invariant — write a test that asserts `process.getpgid(child.pid) === child.pid` after spawn on POSIX.
2. **Kill the group, not the PID**, on POSIX: send `process.kill(-pgid, signal)` (negative PID = group). Wrap `pty.kill(handle, sig)` so callers can't accidentally bypass it.
3. **Last-resort sweep** in `system.shutdownAll()`: after the 5s SIGKILL window, run `pkill -P <bunpid>` (POSIX) / `taskkill /F /T /PID <bunpid>` (Windows) to reap escapees. Document this as the "best-effort cleanup" tier.
4. For `chrome-devtools-mcp`: at Worker shutdown, also call the MCP client's `close()` so the server can tear down browser sessions (Chromium is *not* a process-group descendant — it forks via the OS browser process model).
5. **Atexit guard:** install `process.on('beforeExit')` and `process.on('uncaughtException')` handlers that fire the same cascading kill — otherwise a Bun crash leaves the entire tree orphan.

**Recovery:**
- Provide a built-in `agenstrix doctor --reap` CLI subcommand that finds processes whose argv contains the Agenstrix sandbox path or that are descendants of any dead Agenstrix PID, and SIGKILLs them. Surface from UI as "Found 4 orphan processes from a previous session — reap?"
- Crash recovery (HR-13) must include this sweep at boot, not just at shutdown.

**Phase to address:** **Phase 2** (PTY foundation) for prevention #1–#3; **Phase 4** (MCP) for #4; **Phase 6** (polish) for the doctor command. **Reap on startup is Phase 6/Polish but must ship in v1.**

**Related:** HR-05 (cascading kill), HR-15 (worktree cleanup on crash).

---

### Pitfall 2: MCP stdio bridge corrupted by accidental `console.log` to stdout

**What goes wrong:**
The Master `claude` process silently disconnects from Agenstrix's MCP server. Tools (`spawn_worker`, `kill_worker`, `list_services`) become unavailable mid-session; from the user's perspective Master "stops being useful" but the chat panel still works. Looking at logs shows the JSON-RPC stream got polluted with a free-form log message:

```
Unexpected token 'S', "[server] Starting w..." is not valid JSON
```

**Why it happens:**
The MCP stdio transport reserves **stdout for JSON-RPC frames only**. Any other write to stdout from anywhere in the bridge subprocess — a `console.log`, a `process.stdout.write`, even a third-party library doing startup banner output — corrupts the protocol stream and the client immediately disconnects (this is enforced by stricter parsing Anthropic deployed in their July 23, 2025 breaking change). Every TypeScript MCP server in the ecosystem learns this lesson the hard way.

**Warning signs:**
- Master claude shows the tool list at startup but tool calls return errors after some output
- `pino` log file for the bridge subprocess shows `JSON parse error` events
- The bridge subprocess exited with code 1 shortly after `master.spawned`
- `bus.publish` events for `mcp.tool_*` stop arriving even though Master is clearly trying

**Prevention (Phase 4 MCP):**
1. **Bridge subprocess uses `pino` configured with `destination: 2`** (stderr) for *every* log, including startup. Never `console.log` anywhere in `mcp-bridge.ts`.
2. **Add a startup unit test** that runs the bridge with a noop transport, verifies `proc.stdout` receives only well-formed JSON-RPC frames over a 5-second window (any non-JSON line fails the test).
3. **Lint rule**: enable Biome's `noConsole` for `src/mcp/bridge/**` (or add a custom rule via Biome's plugin API) so `console.log` cannot be merged into bridge code.
4. **Audit every dependency** the bridge imports: if any third-party lib writes to stdout (rare in TS, common in Rust/Python), patch via `process.stdout = process.stderr` swap *only* in the bridge entry, or wrap the lib.
5. **Use `MCP_DEBUG=1` flag** on the bridge that re-routes logs to a file (`~/.agenstrix/logs/mcp-bridge-<pid>.log`) for development — never to stdout regardless of debug level.

**Recovery:**
- The bridge subprocess crash is *visible* (the parent Bun process sees `proc.exited` resolve). Catch it, surface a "Master lost its tools — restart Master?" modal. Auto-restart is a v2 feature (HR pattern says: surface, don't hide).
- A respawned bridge cannot re-attach to an already-running `claude` — the user must restart Master, which loses the conversation context. Document this in the modal.

**Phase to address:** **Phase 4** (Master + MCP). Add the stdout-purity unit test in the same PR as the bridge implementation.

**Related:** STACK.md `@modelcontextprotocol/sdk` gotchas; ARCHITECTURE.md Boundary 2.

---

### Pitfall 3: Worktree creation races on `.git/index.lock` when Master spawns N Workers in parallel

**What goes wrong:**
Master calls `spawn_worker` three times in rapid succession against the same repo (e.g., one for backend, one for tests, one for migrations). All three Worker setups try to `git worktree add` simultaneously. Two succeed; the third fails with `fatal: Unable to create '/path/.git/index.lock': File exists.` In some cases the lock survives a crash and *all subsequent* worktree operations against that repo fail until a human manually removes it.

**Why it happens:**
Git is fundamentally a single-process tool. Even though each worktree gets its own index, the *creation* of a worktree mutates `.git/worktrees/` and `HEAD` in the shared repo, which goes through `.git/index.lock`. Concurrent invocations of `git worktree add` against one repo deadlock-by-design. Confirmed by `anthropics/claude-code#57102` (stale `.git/index.lock` left behind during normal Claude Code CLI operation) and well-documented for multi-agent workflows in 2026 ecosystem blogs.

**Warning signs:**
- WorkerSupervisor emits `worker.spawn_failed` with stderr matching `Unable to create '.+/index.lock'`
- Stale `.git/index.lock` file persists after Worker crash (find via `find <repo>/.git -name index.lock -mmin +5`)
- Subsequent `git worktree add` invocations against the same repo *all* fail until the lock is removed
- `worker.state='spawning'` rows in SQLite with `spawned_at` >30s ago and no further transitions

**Prevention (Phase 2 PTY foundation + Phase 5 dep graph):**
1. **Per-repo serialization queue.** In `worker/`, maintain a `Map<repoPath, Promise<void>>` that chains `git worktree add` invocations per repo. Two Workers targeting the same repo run their git setup sequentially even if Master called them in parallel. The actual `claude` work runs in parallel afterwards — only the git setup serializes.
2. **Use `GIT_OPTIONAL_LOCKS=0`** for all read-only git invocations (e.g., status checks, branch lookups) to reduce contention with write operations.
3. **Stale-lock cleaner at boot.** During health check, scan each registered repo for `.git/index.lock` older than 60s with no live git process — remove with explicit user confirmation ("Found stale git lock from prior session. Remove?"). Never auto-remove without prompt — could mask a real concurrent process.
4. **Wrap simple-git with a retry-on-lock policy** for transient `index.lock` collisions: retry 3× with 250ms backoff before failing.
5. **Test scenario in CI**: integration test spawns 8 Workers in parallel against one repo, asserts zero failures and zero stale locks afterward.

**Recovery:**
- Surface the lock collision as a Worker spawn failure with a one-click "Clear lock and retry" action in the UI.
- For mid-session orphans, expose via `agenstrix doctor` (see Pitfall 1) — same cleanup tier.
- If a worktree itself gets into a bad state (e.g., `git worktree list` shows it but the directory is gone), `git worktree prune` is the safe operation.

**Phase to address:** **Phase 2** (per-repo queue lands when WorkerSupervisor minimal lands); **Phase 5** (orchestration tests with 8 Workers); **Phase 6** (boot-time cleaner).

**Related:** HR-15 (worktree cleanup on crash); the per-repo queue is a *new* invariant not currently in ARCHITECTURE.md and should be added there.

---

### Pitfall 4: `.env` and untracked files leak from main worktree into Worker's prompt context

**What goes wrong:**
Worker spawned in a fresh worktree, and `claude` reads `.env`, `.env.local`, or `secrets.json` from the source repo (because git worktrees share the working dir tree for tracked files but `.env` files are typically `.gitignore`d, so they're *not in the worktree* — but users often `symlink` them or copy with shell scripts to make Workers "just work"). Worker now has DB creds, API keys, OAuth secrets in its context. Those get sent to Anthropic / OpenAI in tool-call summaries, get persisted to `~/.agenstrix/store.db` `pty_chunks`, and become permanent in `events` log. If a user later shares a `.agenstrix-pack` or exports diagnostic bundle: secret exfiltration.

**Why it happens:**
- `git worktree add` includes only **tracked** files by default. Convenience-oriented users will copy `.env` over to get the dev server running in the worktree.
- Claude Code's default behavior is to scan working directory contents; an `.env` in cwd is fair game.
- PTY persistence (INFRA-03) captures *everything* the user / Worker sees; secrets that flash on screen even briefly are persisted forever.

**Warning signs:**
- `pty_chunks` rows containing strings matching `[A-Z_]+_TOKEN|API_KEY|SECRET|PASSWORD` (build a periodic scanner)
- User reports "my dev server works in the Worker" but you never copied `.env` — find the symlink they made
- `.agenstrix-pack` export size suspiciously matches the size of repo `.env` files

**Prevention (Phase 2 + Phase 3):**
1. **Worker spawn never copies untracked files.** Document explicitly in WorkerSupervisor: the spawn ONLY uses `git worktree add`; never adds `cp .env` or symlink logic. If a dev server in the worktree needs `.env`, the Worker must request it via an explicit MCP tool call (`request_env_var('DATABASE_URL')`) that prompts the user.
2. **Per-repo `.agenstrix/env-allowlist`** file (yes, this is the one acceptable per-repo config — opt-in via Master action, never auto-detected). Lists env vars the Worker may inherit from the parent shell. Default: empty. If user wants Worker to see `DATABASE_URL`, they explicitly add it. Persists in SQLite, not in the repo.
3. **Worker spawn env minimalization.** Pass `env: { PATH, HOME, USER, LANG, SHELL, ...envAllowlist }` only. Never `...process.env`. This prevents accidental inheritance of secrets the user set in their shell.
4. **PTY chunk redaction at write time.** Apply a regex redactor to outgoing pty_chunks: any token matching common secret patterns (Anthropic keys `sk-ant-`, GitHub `ghp_`, OpenAI `sk-`, AWS `AKIA`, generic `[a-zA-Z0-9+/]{40,}` only with surrounding context) gets replaced with `[REDACTED]`. Configurable but on by default.
5. **Export-time redaction.** When generating `.agenstrix-pack` or diagnostic bundle (HR-13 recovery export), apply a *stricter* redactor that also scans the `events` table and replaces matches.

**Recovery:**
- Add a `agenstrix scrub-secrets` CLI command that scans all `pty_chunks` + `events` rows in the DB and rewrites matches to `[REDACTED]`. Document this in the README as the "I leaked something, help" command.
- For the worst case (already shared a pack containing secrets), document the procedure: revoke the leaked credentials at the upstream provider, then `scrub-secrets` to clean local store.

**Phase to address:** **Phase 2** (env minimalization + spawn-time guards); **Phase 3** (the env-allowlist mechanism lands with Smart Workspace as part of `learned_commands`); **Phase 6** (redaction + scrub command).

**Related:** HR-07 (`.gitignore`-aware worktree) covers this at the surface; this pitfall fills in the actual mechanism.

---

### Pitfall 5: Cost runaway — Master loops between Workers, burns $200 unattended overnight

**What goes wrong:**
User starts a non-trivial task, walks away. Master decides Worker-1 didn't quite succeed, spawns Worker-2 with similar prompt. Worker-2 hits the same edge case, fails subtly. Master spawns Worker-3 (same pattern). Each Worker burns 50k tokens. After 8 hours: 16 Workers, $190 in Anthropic charges. User opens laptop in the morning, sees disaster. Worse, none of the Workers actually *succeeded* — they all hit the same logical bug.

**Why it happens:**
- No per-session global budget; Master will keep using `spawn_worker` as long as MCP tool calls succeed.
- No per-Worker budget enforcement — `claude` doesn't natively cap its own spend mid-session.
- Loop detection is a known *open feature request* on `anthropics/claude-code#4277` as of 2026 — not implemented in Claude Code itself.
- The "subagent fan-out" pattern is explicitly named in 2026 cost analyses ($500–$2000/month) as a top reason for runaway charges.

**Warning signs:**
- `cost.delta` events ticking continuously for > 30 minutes with no user input
- `workers.created_at` timestamps clustering: 5+ Workers in 5 minutes against same repo
- Hash of `(workerType, prompt)` repeating > 3 times in `workers` table
- Total session spend crossed $5, $10, $50 thresholds
- Same MCP tool call hash repeating across Workers (`tools/call hash`)

**Prevention (Phase 4 + Phase 6):**
1. **Hard session budget**, default $5 for v1 (configurable in settings). When exceeded, Bun:
   - Refuses further `spawn_worker` MCP calls with an error message Master sees: `"Session budget exhausted ($5.00). User must approve continuation."`
   - Sends SIGTERM to all running Workers (graceful — they commit-and-exit).
   - Surfaces a single, undismissible modal: "Session at $X.XX. Stop / Continue with new budget / Kill all."
2. **Per-Worker budget** (HR-01) — injected into each Worker's initial prompt: `"You have a maximum of 50,000 tokens for this task. At 85% (42,500), pause and report status."` Verified by polling `/cost` periodically and on threshold, calling `kill_worker`.
3. **Loop detection at Master level.** In `mcp/`, hash every `spawn_worker` invocation by `(repo, task_summary_first_200_chars, envMode)`. If the same hash appears 3 times within 10 minutes → reject the call with `"Possible loop detected: this is the 3rd spawn with this signature."` and surface to user.
4. **Loop detection at Worker level.** Subscribe to `worker.tool_call` events; hash by `(workerId, tool_name, args_normalized)`. If same hash >5× in same Worker → warn in UI, offer "interrupt and ask Master."
5. **Idle-but-spending check.** If no user input for 30+ minutes AND total cost > $1 → push a "Long-running session — pause?" notification to the UI / Tauri tray.
6. **Cost ceiling per Worker spawn** in `WorkerSpec`: required field, no default that lets you forget it.

**Recovery:**
- Killing all Workers via the modal must complete graceful-commit cleanup (HR-15) — don't lose work just to stop spending.
- Cost log per Worker (in `workers` table: `tokens_used`, `dollars_spent`) so the post-mortem is auditable.
- "What did all these Workers actually accomplish?" — surface the summary tool output for each (HR-19) in a single roll-up screen.

**Phase to address:** **Phase 4** (loop detection on Master spawn — same PR as MCP server, see ARCHITECTURE.md `mcp/`); **Phase 6** (per-worker + session budget enforcement + idle-spend check).

**Related:** HR-01, HR-02, HR-03 from FEATURES.md.

---

### Pitfall 6: SQLite WAL grows unbounded under continuous PTY chunk writes

**What goes wrong:**
After a few hours of heavy multi-Worker sessions, `~/.agenstrix/store.db-wal` is 8GB. App becomes sluggish. Future writes slow to crawl. Eventually the next checkpoint fails (disk full) and Bun crashes mid-Worker, losing recent events.

**Why it happens:**
SQLite WAL mode has a known checkpoint-starvation pattern: if there is *always* an active reader, WAL can't truncate, even after the auto-checkpoint threshold (1000 pages by default) is crossed. Agenstrix has continuous readers (SSE streaming subscribers, periodic UI fetches, event-sourcing replays during crash recovery), and the `pty_chunks` table is the highest-volume writer (8 Workers × 100KB/s × 1hr = ~2.88GB of new content per hour). The combination guarantees WAL growth. Documented in multiple 2026 SQLite operations write-ups including the "20GB WAL file" post-mortem.

**Warning signs:**
- `~/.agenstrix/store.db-wal` > 500MB
- `pty_chunks` table count growing linearly with no plateau
- SQLite `PRAGMA wal_checkpoint(PASSIVE)` returns `busy=1` repeatedly
- Disk free space dropping faster than worker output should account for
- Query latency on `events` table increases (WAL reads slow down)

**Prevention (Phase 1 + Phase 6):**
1. **Set `journal_size_limit` aggressively**: `PRAGMA journal_size_limit = 67108864;` (64MB). Forces SQLite to physically truncate WAL on checkpoint when it exceeds this.
2. **Explicit periodic `wal_checkpoint(TRUNCATE)`** every 5 minutes from a `system/` ticker. Requires briefly halting *all* readers (use a coarse RW-mutex in `db/` for this single operation). Log how long it took (> 250ms = warning).
3. **Pty chunk ring-buffer mode (HR-04).** Once `pty_chunks` for an active session exceeds 100MB, switch that Worker's persistence from "append-all" to "ring-buffer last 50MB" — drop oldest chunks on insert. The user still has scrollback via xterm.js itself; we just don't keep eternal history.
4. **Periodic vacuum** (manual, not auto-vacuum which has its own quirks). Daily at idle: `VACUUM INTO '<temp>'` then atomic swap. Run only if `pragma_freelist_count` > 10000.
5. **Backpressure on writes**, not just on read subscribers. The PTY chunk batcher (ARCHITECTURE.md `pty/`) flushes every 100KB or 250ms — don't let it bypass to per-byte writes when load drops.

**Recovery:**
- If WAL is already huge: stop accepting new writes (pause Workers via SIGTERM with grace), run `wal_checkpoint(TRUNCATE)`, resume.
- If checkpoint won't complete: close all reader connections, reopen DB, run checkpoint, reopen pool. Surface as "Database optimization in progress — Workers paused (10s)."
- Worst case (disk full mid-write): SQLite transaction will fail; bus subscriber for the write must NOT propagate to other subscribers (per-subscriber try/catch). User sees alert: "Disk full — please clear N MB before continuing."

**Phase to address:** **Phase 1** (`journal_size_limit` + WAL setup in the initial `db/` schema work — cheap to do up front, expensive to retrofit); **Phase 6** (checkpoint ticker, ring-buffer mode, vacuum).

**Related:** STACK.md "Drizzle/bun:sqlite gotchas"; HR-04.

---

### Pitfall 7: ConPTY re-encodes ANSI escapes; byte-level diffing / replay breaks on Windows

**What goes wrong:**
Replay from `pty_chunks` works on macOS/Linux but on Windows the replayed output looks subtly wrong — color codes off by one, cursor positions slightly different, occasional spurious characters in scrollback. Worse: an event-log assertion that compares Worker output to a golden file passes on macOS CI and fails on Windows CI.

**Why it happens:**
Windows ConPTY (the kernel pseudo-console) parses ANSI escape sequences *out* of the child process's output and re-emits them in a normalized form. This is documented behavior — `microsoft/terminal#12166`, `#1965`, `#362`, `#2011`. The re-encoding is *semantically* equivalent (same intent: "set foreground to red") but *byte* different (`\e[31m` may come back as `\e[0;31m` or differently ordered with other SGR params). Worse, ConPTY can split a single escape sequence across two `data` callback invocations.

**Warning signs:**
- `pty_chunks` content for the same `claude` command differs in byte-length between OSes by single-digit percentages
- Replay on Windows shows "garbage" characters that the live session didn't
- Any golden-file test of PTY output passes on POSIX, fails on Windows
- OSC 8 (hyperlinks) or OSC 52 (clipboard) sequences malformed when echoed back

**Prevention (Phase 2 PTY foundation):**
1. **Never byte-diff PTY output as a regression test.** Compare *rendered* state instead: spin up a headless xterm.js, replay the chunks, snapshot the resulting cell buffer, diff that.
2. **Document the re-encoding** in the persistence comment of `pty/` chunk batcher: "Bytes are post-ConPTY normalized on Windows. Do not treat as round-trippable to original child output."
3. **Don't assume `\e[...]` arrives whole.** The chunk batcher must NOT split arbitrary 100KB boundaries that fall inside an escape sequence. Implement a tiny ANSI-aware splitter that finds the last complete escape boundary before the cutoff and defers the rest to the next chunk. (Equivalently: don't split a chunk that ends mid-`\e[...]`; carry the tail.)
4. **OSC 8 / OSC 52 escapes:** add explicit smoke tests for these (`claude` uses OSC 8 for clickable URLs, OSC 52 for clipboard) — if they're corrupted, the entire UI claim "real `claude` UX" breaks.
5. **CI matrix runs on Windows from day 1.** Don't catch Windows-specific ConPTY issues two phases late.

**Recovery:**
- If a chunk is corrupted in storage (carries a half-escape), xterm.js will glitch but not crash. Visually correct on next full redraw.
- For long-term storage: if an event-sourcing replay needs to be authoritative, store xterm.js *cell snapshots* (via `@xterm/addon-serialize`) at checkpoints, not raw byte history.

**Phase to address:** **Phase 2** (PTY foundation includes the ANSI-aware splitter); **Phase 6** (cross-platform validation matrix).

**Related:** STACK.md "Bun.Terminal Windows ConPTY caveats"; INFRA-07.

---

### Pitfall 8: xterm.js flickers / pegs CPU when rendering `claude`'s TUI redraws

**What goes wrong:**
User opens 3 Worker PTY drawers. Each is running `claude` which redraws its status line on every keystroke / every tool-call cycle using cursor-positioning ANSI sequences. Browser CPU shoots to 80%+ on an M1 Air; topology canvas freezes; xterm.js drops frames. `claude` flickering inside the drawer is reported as a known issue (`anthropics/claude-code#1913`, `#769`, `#9935`).

**Why it happens:**
- `claude`'s TUI uses cursor moves + line-clears for status updates, redrawing the same screen region thousands of times per second under heavy LLM streaming.
- Under terminal multiplexers / wrappers, this generates 4000–6700 scroll events per second per terminal (instrumented in `claude-code#9935`).
- Each xterm.js terminal instance has its own renderer (WebGL or canvas). At 3+ concurrent active terminals, the GPU contention compounds.
- React's render cycle on the topology canvas + each terminal's renderer fight for the same frame budget.

**Warning signs:**
- Browser tab CPU consumption > 50% with no user activity
- DevTools Performance recording shows long `paint` tasks (>16ms) inside xterm.js
- Visible flicker when scrolling the topology canvas while a terminal is active
- `requestAnimationFrame` callbacks dropping below 30fps in the terminal panes
- Fan kicking in audibly on the user's machine after a few minutes

**Prevention (Phase 2 + Phase 6):**
1. **Lazy-mount terminals.** Only one xterm.js instance is alive at a time (matches current UX: one drawer open). Closing a drawer disposes the term; reopening hydrates from `pty_chunks` via `@xterm/addon-serialize`. ARCHITECTURE.md frontend §3 already plans this; treat as a non-negotiable invariant.
2. **WebGL renderer always**, with canvas fallback in try/catch. Default `WebglAddon`; never run the default DOM renderer in production.
3. **Mark inactive terminals as "paused"** — don't render incoming bytes into the live xterm; just persist to the bus → SQLite. When user re-opens, replay from history. (Caveat: this changes "live" semantics for off-screen terminals to "deferred"; surface as a small badge "3 new lines" on closed drawers.)
4. **Throttle topology re-renders.** Topology updates from `dep_graph.*` events should coalesce into ≤10 fps; use a `requestIdleCallback` or `requestAnimationFrame` based debouncer in the react-flow store sync.
5. **Synchronized updates** — opt the terminal in via DEC mode `?2026` if/when xterm.js supports it (issue tracked); helps `claude`'s redraws batch.
6. **HR-20 budget test**: load test with 8 simulated PTYs streaming at 500KB/s each into the backend, one open drawer in the browser; assert browser tab CPU < 50% sustained.

**Recovery:**
- If a user hits the wall: surface a "Performance mode" toggle that disables WebGL (use canvas) on weak GPUs and caps PTY render rate to 10fps for off-screen terminals.
- Crash recovery is automatic — xterm.js doesn't lose state because state is in `pty_chunks`.

**Phase to address:** **Phase 2** (lazy-mount + WebGL from day 1); **Phase 6** (throttling, performance mode).

**Related:** HR-20.

---

### Pitfall 9: Smart workspace mis-detects script-y subdir as a backend service

**What goes wrong:**
User drags `~/projects/myapp/` which has subdirs `scripts/`, `docs/`, `tools/cli/`, `apps/web/`, `apps/api/`. Workspace detector recurses (or doesn't), and decides `tools/cli/` is a "FastAPI backend" because it has a `requirements.txt` with `fastapi` in it (it's actually a one-off internal CLI that imports fastapi-utils). Tries to run `uvicorn main:app` — fails. Or worse: tries every `package.json` it finds (including `node_modules/something/package.json` in the rare case node_modules is committed).

**Why it happens:**
- Naive "find all package.json / requirements.txt" globs match too aggressively.
- Monorepo signal detection (`turbo.json`, `nx.json`, `pnpm-workspace.yaml`, `lerna.json`) is not always present even in monorepos.
- Turborepo explicitly does *not* support nested packages — `apps/a` and `apps/a/b` is an error. Naive detection would discover both.
- README-grep for start commands hits false positives in `archive/` or `examples/` dirs.

**Warning signs:**
- WS-05 trial start fails on subdirs that look like services but aren't
- Detection produces 6 candidate services for a repo that has 2
- `learned_commands` rows piling up with `start_failed` for the same path
- User reports "stop trying to start that, it's not a thing" — Master should never have surfaced it

**Prevention (Phase 3 Smart Workspace):**
1. **Respect glob roots from workspace declarations.**
   - If `package.json` at root has `"workspaces": [...]`, only treat those as project roots.
   - If `pnpm-workspace.yaml` exists, use its `packages:` globs.
   - If `turbo.json` exists, only descend into workspace-declared paths (and never below them — Turborepo forbids nested).
   - If `nx.json` exists, use `projects/*/project.json` to enumerate.
   - For Python: `pyproject.toml` is the canonical root; never descend past one.
2. **Exclude common noise dirs always**: `node_modules/`, `.git/`, `.venv/`, `__pycache__/`, `dist/`, `build/`, `out/`, `.next/`, `target/`, `.turbo/`, `.cache/`.
3. **Require a "service signal," not just a signature file.** A `package.json` is detected as a service only if it ALSO has one of: `scripts.dev` / `scripts.start` / `scripts.serve` (not `scripts.build` alone). Python: `pyproject.toml` + (one of: `[tool.poetry.scripts]`, `[project.scripts]`, a `main.py` or `wsgi.py` / `asgi.py` at root, or README mentions `uvicorn|gunicorn|hypercorn`).
4. **Detect first; trial-start only on user confirmation when ambiguous.** If detection finds > 2 services in one repo, surface a "Detected 4 services. Start which? [ ] api [ ] web [ ] worker [ ] cli" picker before trial-start. WS-06 fallback dialog generalizes.
5. **README is a last-resort hint, not a primary source.** Parse README only when scripts/configs are missing; never override an explicit `scripts.dev`.

**Recovery:**
- Per-service "ignore" toggle in the workspace bar UI. Persisted to `learned_commands` as `disabled=1`.
- User correction via chat ("ignore the cli folder") → Master calls `update_learned_command(repoId, path: 'tools/cli', disabled: true)` (WS-09 + DF-07 plumbing).

**Phase to address:** **Phase 3** (Smart Workspace — this is the *unique-value gate* per ARCHITECTURE Phase B reasoning; detection that's overly aggressive directly damages the "wow" claim).

**Related:** WS-02..06; FEATURES.md DF-02.

---

### Pitfall 10: Service "ready" detected at port-open instead of HTTP 2xx → test Worker hits 502

**What goes wrong:**
Dep graph reconciler waits for service `frontend-dev` to be ready before spawning test Worker. ServiceSupervisor polls `127.0.0.1:5173` with a TCP connect; port opens within 500ms (Vite starts listening immediately) but Vite hasn't actually compiled yet. Test Worker spawns, opens browser via `chrome-devtools-mcp`, gets a 502 / hang / "module not found" overlay. Reports "test failed" — except it's actually a race, not a real failure.

**Why it happens:**
- TCP port-open ≠ HTTP request-served. Vite, Next.js dev server, FastAPI/uvicorn with `--reload` all bind the port *before* finishing initial compile.
- The first request to a dev server in dev mode often takes 5–15s while bundling.
- `chrome-devtools-mcp` doesn't natively retry 5xx responses; it surfaces them to the agent verbatim.

**Warning signs:**
- Worker-3 (test) reports failure on the *first run* of any session but passes when re-run
- Logs show `GET / 502` immediately followed by `GET / 200` after a delay
- `service.ready` events fire within 1s of `service.starting` for any non-trivial dev server (suspicious — should typically be ≥3s for Next.js / Vite)
- Tests that exercise SSR/SSG endpoints fail nondeterministically while client-only assets pass

**Prevention (Phase 3 Service Supervisor):**
1. **HTTP 2xx polling**, not just port-open. HR-17 mandates this. Implementation:
   - Start a `setInterval` of 1s after `Bun.spawn`, do `fetch(healthCheckUrl)` with 2s timeout.
   - Accept `ready` only on a 2xx response OR a redirect chain ending in 2xx.
   - 4xx counts as ready (means the server is responding; it just doesn't have that route — fine for health).
   - 5xx / network error counts as not-ready, keep polling.
2. **Per-framework health endpoints.** Built-in mappings:
   - Next.js: `GET /` (or `/_next/static/chunks/pages/_app.js` if you can detect a build manifest)
   - Vite: `GET /@vite/client` (always served once the dev server is up)
   - FastAPI / Django / Flask: `GET /` (or `/health` if user defines one)
   - Express: `GET /` (or user-overridable)
   The mapping is in workspace learning — `learned_commands` table stores `health_url`.
3. **First-request warmup window**: even after 2xx, hold `service.ready` event for an additional 1s. Dev servers that compile-on-first-request often serve initial requests slowly.
4. **Distinguish "ready" from "warm"** in the service state model: `starting → port_open → responding → ready` (responding = first 2xx; ready = stable 2xx after warmup). UI shows green only at `ready`.
5. **Surface a timeout**: if a service doesn't reach `ready` within 60s, emit `service.start_timeout`, mark `error`, surface to UI with the captured stderr tail. Don't silently hang.

**Recovery:**
- If a Worker reports failure that looks like a race (first run fails, retry passes), suggest "your test failed during service warmup — retry once?" before reporting to user.
- Manual override: user can mark a service as `always-ready` (skip health check). Persisted to `learned_commands`.

**Phase to address:** **Phase 3** (Service Supervisor — this is exactly HR-17 from FEATURES.md and is called out as Phase 3 must-have in ARCHITECTURE build order; mis-implementation kills Phase 5 demo).

**Related:** HR-17, SVC-03, MCP-04.

---

### Pitfall 11: Drizzle SQLite "table recreation" migration silently drops cascade data

**What goes wrong:**
You add a `NOT NULL` column without a default to an existing `workers` table. Drizzle generates a "table recreation" SQL (SQLite can't `ALTER TABLE` add NOT NULL in-place). The recreation drops the old table, creates new, copies data. But the `pty_chunks` foreign key cascade-deletes during the drop — and `drizzle-kit` doesn't warn (`drizzle-team/drizzle-orm#4938`). Migration "succeeds." 8GB of `pty_chunks` is gone.

**Why it happens:**
- SQLite's lack of full `ALTER TABLE` forces full table recreation for many schema changes.
- Drizzle generates this SQL but doesn't audit for cascade implications.
- `PRAGMA foreign_keys = ON;` (which Agenstrix enables) makes cascade real.
- Devs review generated SQL but miss the implicit FK cascade trigger of `DROP TABLE`.

**Warning signs:**
- A migration SQL file contains `CREATE TABLE __new_<name>` + `INSERT INTO __new_<name> SELECT * FROM <name>` + `DROP TABLE <name>` + `ALTER TABLE __new_<name> RENAME TO <name>` for any table with FK references
- After running migration locally, `pty_chunks` row count dropped to zero (or to the count of rows surviving the recreation)
- User reports "all my history is gone" after an upgrade

**Prevention (Phase 1 db/ setup + every schema-change PR):**
1. **Every generated migration is human-reviewed.** Treat the `drizzle/<n>_*.sql` file as code, not generated config. Specifically scan for `DROP TABLE` against any FK parent table and either:
   - Manually rewrite to `ALTER TABLE` + data migration that preserves FK integrity, OR
   - Wrap in `PRAGMA foreign_keys=OFF; ...; PRAGMA foreign_keys=ON;` with explicit data-preservation INSERT statements.
2. **Test migrations with realistic data.** CI step: seed a DB with 1000 fake `workers` + 100k `pty_chunks` rows, apply pending migrations, assert counts preserved (or explicitly down-migrated as intended).
3. **Backup before migration in production.** At Bun startup, before `migrate()`, if there are pending migrations to apply: `cp ~/.agenstrix/store.db ~/.agenstrix/backups/store-<timestamp>.db`. Keep last 10. Cheap insurance.
4. **Never use `drizzle-kit push`** in production (STACK.md and FEATURES.md already say this; here it's the *operational consequence*).
5. **Schema-breaking changes require a major version bump** of Agenstrix and an explicit pre-flight notice. Treat `pty_chunks` like user data — irreplaceable.

**Recovery:**
- If a migration deleted data: restore from the most recent `~/.agenstrix/backups/store-*.db`. Document this path in startup logs so users can find it.
- If user didn't have backups: data is gone. Worker conversation history can be reconstructed approximately by replaying `events` if `events` survived (different FK shape). Plan for this in HR-13 recovery.

**Phase to address:** **Phase 1** (initial schema + migration policy + backup step lands with `db/` from day 1). Every subsequent phase must respect the policy.

**Related:** STACK.md drizzle gotchas.

---

### Pitfall 12: Tauri 2 sidecar notarization fails on macOS because Bun binary isn't signed

**What goes wrong:**
You ship Tauri 2 desktop in milestone v2. Build succeeds locally. Upload to notarization → Apple rejects: the embedded `agenstrix-server-aarch64-apple-darwin` sidecar isn't signed with the same developer certificate as the outer Tauri bundle. Or it signs but Gatekeeper still blocks because the entitlements don't permit launching a hardened-runtime sidecar. Reported in `tauri-apps/tauri#11992`.

**Why it happens:**
- Tauri's bundler signs the outer `.app` and (since 1.5+) external binaries — but only if the cert is correctly wired in `tauri.conf.json` AND the entitlements include `com.apple.security.cs.allow-jit` (Bun's JS engine uses JIT) plus `com.apple.security.cs.disable-library-validation` (for the sidecar to load).
- The hardened runtime is required for notarization. Sidecars must be signed with the same team identifier.
- Apple's notarization can take hours; quick local testing misses the issue.

**Warning signs:**
- `codesign --verify -dvvv agenstrix-server-*` fails or shows different TeamIdentifier than the .app
- Notarization log: `"hardened runtime not enabled"` for the sidecar
- Gatekeeper assessment: `spctl -a -t exec -vv path/to/sidecar` returns "rejected"
- First run on a clean Mac: "Apple cannot check this app for malicious software" dialog
- App opens but the spawn of the sidecar silently fails (`Command.spawn` error event with cryptic message)

**Prevention (v2 milestone — but plan in v1 packaging design):**
1. **Sign the Bun binary directly** before Tauri packaging, using the same developer ID:
   ```bash
   codesign --force --options runtime --timestamp \
     --entitlements src-tauri/sidecar.entitlements \
     --sign "Developer ID Application: <Name> (TEAMID)" \
     src-tauri/binaries/agenstrix-server-*
   ```
2. **Entitlements file `src-tauri/sidecar.entitlements`** must include:
   - `com.apple.security.cs.allow-jit` (Bun uses JIT)
   - `com.apple.security.cs.allow-unsigned-executable-memory` (Bun's JSC engine)
   - `com.apple.security.cs.disable-library-validation` (sidecar loads from non-system path)
   - `com.apple.security.cs.allow-dyld-environment-variables` (if you use any `DYLD_*` for cross-bundle path mods)
3. **Stapled notarization ticket**. After Apple approves, `xcrun stapler staple <bundle>.app`. This lets Gatekeeper verify offline.
4. **CI smoke test**: spin up a fresh macOS runner, install the signed `.dmg`, launch the app, verify the sidecar spawns. Catch notarization regressions in CI, not user reports.
5. **Windows signing parallel**: Code-sign the `.exe` with an EV certificate; without it, Microsoft Defender SmartScreen will block first-run for 1–4 weeks until the app earns reputation. Plan budget for the cert ($300–$500/yr).

**Recovery:**
- If a release is already shipped and Gatekeeper-blocked: emergency `.dmg` rebuild with correct signing; in-app updater (if implemented) can push it. Without updater: users must redownload manually.
- For un-notarized first-run: document the right-click → Open workaround in the README + first-run docs.

**Phase to address:** **Phase 6+** (v2 Tauri milestone). But the *design* — entitlements file, signing pipeline, CI smoke — must be sketched in v1 so the v2 path is not a 3-day surprise.

**Related:** STACK.md Tauri gotchas.

---

### Pitfall 13: WebSocket idle timeout drops Worker terminal stream during long thinks

**What goes wrong:**
User opens Worker drawer, watches `claude` start thinking. Worker pauses on a long LLM call (30–60s). No bytes flow. Bun's default `idleTimeout: 120s` is fine for one such pause, but a chain of long tool calls (each 60–90s) eventually trips it. WebSocket closes with code 1011. xterm.js shows nothing; user thinks Worker froze. Reload re-attaches but loses live state.

**Why it happens:**
- Bun WebSocket server defaults to 120s idle timeout (configurable). STACK.md notes this.
- Claude's tool-call cycle (think → call → wait → think → call) can easily exceed 120s of no terminal output during heavy reasoning.
- Browser's `WebSocket` does NOT auto-reconnect; xterm.js attach addon doesn't either.

**Warning signs:**
- WebSocket connection logs show `code: 1011` (or `1006` on network blip) after long pauses
- `client.ws_disconnected` events for `/ws/worker/*` mid-Worker
- Browser console: `WebSocket connection closed before establishment`
- User complaints: "the terminal froze" during expected-long operations

**Prevention (Phase 2 + Phase 4):**
1. **Disable idle timeout for PTY WebSockets**: pass `idleTimeout: 0` to `upgradeWebSocket` for `/ws/worker/:id` and `/ws/master`. STACK.md mentions this; treat as mandatory.
2. **Heartbeat layer regardless**: every 30s, if no bytes have flowed in either direction, server sends a noop binary frame (single zero byte that xterm.js will swallow or interpret as a noop). Belt-and-braces against rare proxy-level idle disconnects (relevant in v2 Tauri with WebView proxy variations).
3. **Browser-side reconnect.** Wrap the WS in a thin client that auto-reconnects on close with exponential backoff (up to 30s). On reconnect: re-fetch missed `pty_chunks` since the last `seq` received, replay, then re-attach to live stream. Pattern matches SSE's `Last-Event-ID`.
4. **Surface disconnects in UI**: a small "Reconnecting…" badge in the terminal drawer; clears when bytes resume.

**Recovery:**
- The auto-reconnect + replay path *is* the recovery. Test it: kill the Bun process mid-Worker, restart, reopen drawer — should resume from last persisted chunk.
- If the Worker process itself was killed by Bun's shutdown (not the WS): user sees the final state from `pty_chunks` replay and the badge "Worker terminated."

**Phase to address:** **Phase 2** (`idleTimeout: 0` lands with first WS bridge); **Phase 4** (heartbeat + browser reconnect lands when chat panel + Master streaming go live and the patterns are needed broadly).

**Related:** STACK.md Bun WebSocket gotchas.

---

### Pitfall 14: Master `claude` restart loses ALL Worker context (Workers are orphans to the new Master)

**What goes wrong:**
Master `claude` crashes (segfault, OOM, user accidentally quit it). Bun process and Workers continue. User reopens chat: a new Master spawns. The new Master has no idea Workers exist. User says "what's W-2 doing?" — Master replies "I don't have any workers." Meanwhile W-2 is still chewing $0.40/min in the background.

**Why it happens:**
- Each `claude` process has its own internal context (in `~/.claude/`). A new `claude` invocation starts fresh.
- The Master ↔ Worker relationship lives in the *Master's claude context*, not in Agenstrix. Agenstrix knows the Worker exists but the Master doesn't know it owns it.
- MCP tool `list_workers()` would surface them — but only if Master thinks to call it. New Master has no prompt-level reason to.

**Warning signs:**
- After a Master crash, Workers continue running per the `workers` table but Master never calls `list_workers` / `send_to_worker` / `wait_for_workers` against them
- User asks Master about prior Workers and gets confused responses
- Cost continues accruing on Workers Master no longer manages
- The dep graph reconciler waits forever for a Worker the Master abandoned (because Master never called `wait_for_workers` post-restart)

**Prevention (Phase 4 + Phase 5):**
1. **Master restart prompt injection.** When MasterController spawns a new claude after a crash, the initial prompt MUST include a recap:
   ```
   You were interrupted. There are 2 active Workers from your previous session:
   - W-1 (claude, backend, running 4m, task: "Add POST /register endpoint")
   - W-2 (codex, frontend, waiting on W-1, task: "Build registration form")
   Service `backend-dev` is running. Call list_workers() for current state, or wait_for_workers(['W-1', 'W-2']) to resume coordination.
   ```
   This is the equivalent of the human user telling them what they were doing.
2. **List_workers / list_services in default Master system prompt**: bake into the system prompt "When resuming or unsure, call `list_workers` and `list_services` first." This makes Master self-orient on any restart.
3. **Detect "abandoned" Workers.** After a Master crash and restart, mark Workers as `state=orphan` if Master hasn't called `send_to_worker` or `wait_for_workers` against them within 30s of restart. Surface to user: "Master may not be tracking these 2 Workers. Kill them?"
4. **Persist user's last 20 chat turns** verbatim (already in `messages` table); include them as a "previous conversation" recap section in the resumed Master's initial prompt.
5. **Idempotent worker IDs in chat.** When chatting with the Master after restart, the UI references Workers by stable IDs (W-1, W-2). The recap is what teaches the new Master what those IDs map to.

**Recovery:**
- The "abandoned" detection + prompt = automatic recovery for the common case.
- For Workers that Master can't pick back up gracefully: offer "Terminate orphan workers" one-click action.
- Worst case: user can manually `kill_worker(id)` via chat or UI.

**Phase to address:** **Phase 4** (initial Master + MCP work — recap on first-spawn pattern; "list at startup" prompt convention); **Phase 5** (orphan detection is part of the dep graph reconciler's awareness).

**Related:** ARCHITECTURE.md failure-boundary "Master crashes."

---

### Pitfall 15: Concurrent service auto-start picks the same "free" port (TOCTOU)

**What goes wrong:**
Dep graph reconciler decides to start `backend-dev` and `worker-tool-server` in parallel (both required by Worker-3). Both call `get-port` to find a free port. Both get told 5174 is free (because nothing's bound it yet — `get-port` checks current state). Both spawn dev servers with `--port=5174`. One wins the bind; the other fails with `EADDRINUSE`.

**Why it happens:**
- `get-port` (and any "find free port" library) has an inherent time-of-check-to-time-of-use race. They check, return; the bind happens later.
- Parallel service starts in dep graph reconciler don't coordinate port reservation.
- SVC-05's port conflict logic handles user-conflict but not self-conflict.

**Warning signs:**
- `service.start_failed` event with stderr matching `EADDRINUSE|address already in use`
- The failing service's `chosenPort` matches another service that started simultaneously
- Phase 5 demo fails intermittently when multiple services need to come up

**Prevention (Phase 3 Service Supervisor + Phase 5 Dep Graph):**
1. **Serialize port allocation.** All `get-port` calls go through a small `portAllocator` that holds a mutex and tracks "reserved" ports until the spawn is observed to have bound them. Even one-at-a-time `getPort()` calls are guaranteed unique within the process.
2. **Reserve before spawn, release on bind-success/failure.**
   ```ts
   const port = await portAllocator.reserve(preferredPort);  // mutex inside
   try {
     const proc = await Bun.spawn([...cmd, `--port=${port}`], ...);
     await waitForHttpReady(`http://localhost:${port}`, 60_000);
     portAllocator.confirm(port);
   } catch (e) {
     portAllocator.release(port);  // release on any failure
     throw e;
   }
   ```
3. **Bind-then-spawn fallback**: if the framework allows, bind a TCP socket on the chosen port FIRST in Bun, hand the FD to the spawn (some frameworks support this), then close the Bun handle just before spawn. This eliminates the TOCTOU entirely. (Not all dev servers support FD passing; treat as advanced.)
4. **EADDRINUSE retry policy**: if the spawn loses the race, immediately retry once with a fresh `getPort` (the next call sees the reservation list, picks a different port). Retry max 3 times.
5. **Per-framework port discovery in stdout.** Some dev servers (Vite, Next.js) print the actual chosen port to stdout after a bump. Parse this and update `learned_commands.port` so subsequent runs use the actual port. Avoids drift.

**Recovery:**
- A failed-spawn surfaces via `service.start_failed`; reconciler should auto-retry once (covering the TOCTOU narrow window).
- If retries exhausted: surface to UI as a normal service failure with the port-conflict message; user can manually free a port or pick a different one.

**Phase to address:** **Phase 3** (Service Supervisor — port allocator is part of `service/` from day 1, not an afterthought).

**Related:** SVC-05; HR-06.

---

### Pitfall 16: EventBus subscriber leak — closed SSE/WS leaves dangling iterator, blocks shutdown

**What goes wrong:**
Browser tabs open and close throughout the day. Each opened a `bus.subscribe('master.*')` for an SSE stream. The `stream.onAbort()` cleanup occasionally doesn't fire (browser crashed; network blip; Hono version regression). Subscribers accumulate. RAM creeps up. At shutdown, `bus.shutdown()` hangs waiting for all subscribers to drain.

**Why it happens:**
- AsyncIterator-based pub/sub with manual lifecycle is leak-prone if any path forgets to call `.return()` / abort.
- Hono's `stream.onAbort()` fires on client disconnect *most* of the time but not all (`HEAD` requests, certain proxy behaviors).
- EventEmitter-style listeners are easy to add, hard to track removals.

**Warning signs:**
- `bus.subscriberCount()` grows monotonically across a session
- Bun heap snapshot shows `Set` / `Map` entries for subscribers from connections closed minutes ago
- Memory usage growing ~1MB per opened/closed connection
- `system.shutdown_initiated` hangs > 10s on bus flush

**Prevention (Phase 1 bus/ + Phase 4 gateway):**
1. **AbortSignal-first API.** `bus.subscribe(topic, { signal: AbortSignal })` — when the signal fires, the iterator terminates and the subscriber is removed atomically. All callers MUST pass a signal — make it required, not optional.
2. **Connect AbortSignal to Hono stream**: `streamSSE(c, async (stream) => { const ac = new AbortController(); stream.onAbort(() => ac.abort()); for await (const e of bus.subscribe('topic', { signal: ac.signal })) {...} })`. Same pattern for WS — wire `ws.onClose` to `ac.abort()`.
3. **Timeout-based subscriber GC.** Every 60s, sweep subscribers: any subscriber whose connection hasn't acked in 5min gets force-removed. Logs the source for debugging.
4. **Bus diagnostics endpoint** `GET /api/_debug/bus`: returns count of subscribers per topic + age of oldest. Use in dev to spot leaks early.
5. **Subscriber count metric in startup health check.** Healthy idle Agenstrix has < 5 internal subscribers (sink, projectors). Anything more during idle = leak smell.

**Recovery:**
- Restart Bun. (Subscribers don't persist.) The cost is dropping any in-flight SSE/WS streams; clients reconnect.
- If shutdown hangs: SIGINT twice = hard exit (kills bus pending too); document this fallback.

**Phase to address:** **Phase 1** (bus/ AbortSignal-first design from day 1; retrofitting is painful); **Phase 4** (gateway wiring uses the pattern correctly).

**Related:** ARCHITECTURE.md anti-pattern AP-5 (sharing one WS).

---

### Pitfall 17: Bun.spawn cwd unchanged for Worker but git operations target main worktree

**What goes wrong:**
Worker spawned in worktree at `/repo/.agenstrix/wt/wk_123/`. Worker's `claude` runs `git add -A && git commit`. The commit lands… on the *main worktree's* branch. Because `claude`'s git invocation didn't get the right `cwd`, or because `GIT_DIR` env var inherited from parent overrode it.

**Why it happens:**
- `Bun.spawn({ cwd })` sets the child's working directory. But if `GIT_DIR` or `GIT_WORK_TREE` env vars are set in the parent (e.g., if Bun was launched from a hook script that exports them), they override `cwd`.
- Subshells (`bash -c "git ..."`) don't always inherit cwd consistently with native invocation.
- If the worktree path is a symlink and `claude` resolves it, git commands behave on the resolved path which may not be a worktree.

**Warning signs:**
- Worker commits show up on `main` branch instead of `agenstrix/<id>` branch
- `git log` in the main worktree shows commits with messages "agenstrix: worker …"
- Worker's `git status` reports files from the main worktree, not its own files
- Two Workers' commits interleave on the same branch despite supposed isolation

**Prevention (Phase 2 + Phase 5):**
1. **Sanitize the spawn env**: explicitly delete `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_NAMESPACE` from the spawn env. Document why.
2. **Test cwd enforcement**: integration test spawns a Worker, has it run `pwd && git rev-parse --show-toplevel`, asserts both equal the expected worktree path.
3. **Resolve symlinks at workdir creation** (`fs.realpath` the worktree path before `Bun.spawn(cwd)`). If user's `--worktree-root` setting points at a symlink, normalize.
4. **Branch name discipline**: every worktree is created with `-b agenstrix/<workerId>` on the exact commit user is on; never reuse branch names; never check out an existing branch in a worktree.
5. **Verify before commit**: WorkerSupervisor's cleanup step (`simple-git: git commit`) runs with explicit `{ baseDir: worktreePath }` and checks `repo.revparse(['--show-toplevel'])` matches expected before commit. Refuses to commit if mismatch.

**Recovery:**
- If a wrong commit landed on `main`: `git reset --soft HEAD~N` in main, recreate as a branch — but this requires user intervention. Document recovery in README.
- Better: detect the mismatch and surface to user *before* committing, with an "Apply on dedicated branch" one-click action.

**Phase to address:** **Phase 2** (env sanitization is part of PTY/worker spawn); **Phase 5** (verify-before-commit is part of the cleanup step that lands with full env-mode support).

**Related:** HR-18.

---

### Pitfall 18: Chokidar watcher on Skills dir thrashes when user does mass file ops

**What goes wrong:**
User uses `mv` to reorganize their `~/.agenstrix/skills/` (50 files moved at once). Chokidar fires 50 `unlink` + 50 `add` events in rapid succession. The Skill loader thrashes — parses 50 files, hits SQLite 50 times, re-loads cached Skill list, broadcasts 50 `skill.loaded` events. UI re-renders 50 times. Brief lockup.

**Why it happens:**
- Chokidar's filesystem watchers are noisy; mass operations generate event storms.
- Without debouncing, every event triggers full reprocessing.
- SQLite writes are serialized; 50 sequential `upsert`s = ~50ms of write latency back-to-back.

**Warning signs:**
- UI freezes briefly after user manipulates the skills folder externally
- `skill.loaded` events arriving in bursts of 10+
- `events` table shows `skill.loaded` flood-fills with same wall-clock second
- File operations on the user's part are responsive in Finder/Explorer but the app stutters

**Prevention (Phase 4 ASSET-02 + general):**
1. **Debounce filesystem events**: collect events for 250ms, then process the deduplicated set as a single batch. Chokidar has `awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }` — enable it.
2. **Batch SQLite writes** with a single transaction per debounce window.
3. **Coalesce bus events**: emit a single `skill.batch_changed` event with the list, not individual events. UI subscribes to the batch event.
4. **Worst-case fallback**: if > 100 events arrive in a 1s window, switch to "fully rescan" mode (drop all watcher events, list dir, sync state to DB once).

**Recovery:**
- The thrash is transient — no data loss. If UI is frozen > 5s, that's a bug worth investigating.
- Skills index can be rebuilt at any time: `agenstrix rescan-skills` CLI command for manual recovery.

**Phase to address:** **Phase 4** (Skills come online here per ARCHITECTURE.md / Phase 4 of features).

---

### Pitfall 19: Auto-restart of failed Workers/services creates infinite-cost loop

**What goes wrong:**
Worker crashes (say, OOM from a runaway command). Well-intentioned dev adds auto-restart "for resilience." New Worker spawns with the same prompt, hits the same OOM, crashes. Loop. Each cycle costs $0.10 in claude startup. 30 cycles/min × $0.10 = $180/hour silent burn.

**Why it happens:**
- Auto-restart hides bugs. Anti-pattern AP-6 in ARCHITECTURE.md is explicit, but easy to violate in a "fix the broken thing" PR.
- Cron-like supervisor patterns (systemd, pm2 muscle memory) train devs to expect auto-restart as a feature.

**Warning signs:**
- `workers` table shows a single `task` repeating with `state=error` 5+ times in 10 minutes
- `cost.delta` events at suspiciously regular intervals
- `worker.exited` events with cluster of identical `exitCode` for same `task` hash
- User reports "the app keeps doing the same thing"

**Prevention (Phase 4 + cultural):**
1. **NO auto-restart** of Workers or services. AP-6 from ARCHITECTURE.md, restated as a code-review rule. Mark `// AUTO-RESTART DISALLOWED — see PITFALL-19` in the relevant module headers.
2. **Explicit `retry_worker(workerId)` MCP tool** for Master to invoke deliberately with idempotency: tool requires a `retryToken` Master generates, and refuses if Master has retried > 3 times with same token. Surfaces "Retry refused — task may be infeasible" to Master.
3. **Service auto-restart equally disallowed**. Service down → emit event, wait for user/Master to call `start_service` again. No background watcher restarts.
4. **Code review checklist** for any PR touching `worker/` or `service/`: "Does this introduce a restart loop possibility? If so, decline."

**Recovery:**
- If a loop is in flight: the modal from Pitfall 5 (cost runaway) catches it via the budget. That's the safety net.
- Manual kill via UI.

**Phase to address:** **Phase 4** (when MCP tool retry is designed); **Phase 6** (review-checklist + automated detection of restart loops).

**Related:** ARCHITECTURE.md AP-6.

---

### Pitfall 20: MCP tool schema drift between Agenstrix versions breaks running Master

**What goes wrong:**
You ship v1.2 of Agenstrix that renames the `kill_worker` tool to `terminate_worker`, or adds a required `reason: string` parameter. User upgrades; mid-session their Master still has the old tool spec cached (Master claude was spawned before the upgrade and is still alive). Master's next tool call uses old signature; MCP server rejects; Master gets confused, hallucinates retries, costs spike.

**Why it happens:**
- MCP servers advertise their tool schema at handshake. Live clients don't re-fetch unless they reconnect.
- Agenstrix upgrades that touch the MCP tool surface invalidate live Master sessions.
- Backward incompatibility in tool args isn't immediately visible — Master may "see" the new tool list on next initialize but if no re-initialize happens, it doesn't.

**Warning signs:**
- After upgrade, Master tool calls fail with `"unknown tool"` or `"invalid argument"` errors
- Error rate spike on `mcp.tool_errored` immediately following an upgrade
- Master hallucinates / loops because tool calls have unexpected errors
- Users report "I just upgraded and the Master is confused"

**Prevention (Phase 4 + every release):**
1. **Additive-only tool schema changes within a major version.** Same rule as DB migrations. New tool: fine. New optional arg: fine. New required arg / renamed tool / removed tool: requires version bump + forced Master restart on upgrade.
2. **Detect Master started with older MCP schema version.** Bake schema version into the initial handshake: `serverInfo.version: "1.2.0"`. When bumping, the server advertises new version; bridge subprocess on startup compares against a `EXPECTED_MIN_AGENSTRIX_VERSION` env var Agenstrix sets at Master spawn. If mismatch (Agenstrix was upgraded mid-Master-session), bridge cleanly disconnects with a structured error → Bun detects → surfaces "Master is using outdated tool spec. Restart Master to apply the upgrade."
3. **Versioned tool catalog file**: keep the tool list as a typed catalog (e.g., `tools/v1.ts`, `tools/v2.ts`), so changes go through code review and you can spot breaking ones.
4. **Upgrade-time test**: on bumping a Master session via the auto-update mechanism (v2 Tauri), prompt user "Restart Master to apply tool upgrades?" rather than silently in-place upgrading.

**Recovery:**
- The "restart Master" modal is the recovery. Conversation context is approximated via HR-13's recap mechanism.

**Phase to address:** **Phase 4** (MCP tool catalog design); **Phase 6** (upgrade path, ties to v2 Tauri auto-updater).

---

## Technical Debt Patterns

Shortcuts that look reasonable but compound:

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|---|---|---|---|
| Use string concatenation to build the Worker initial prompt instead of a typed builder | Faster initial implementation | Skill / token-budget / cwd / scope injection becomes a maze; bugs at runtime when fields collide | Never — typed builder from Phase 2 |
| Stuff multi-purpose data into `learned_commands` JSON blob without a schema | Easy to evolve | Becomes a tangle; queries that need a field can't index it | Acceptable for v1 if blob is documented; revisit at first scale issue |
| Skip the PTY chunk batcher; write each `data` callback chunk to SQLite directly | Less code | WAL bloat + per-write fsync = sluggish under load | Only in a `--debug` flag for traceability work; never in default path |
| Hardcode timeouts (e.g., 5s wait, 30s spawn budget) as magic numbers across modules | Reads cleaner upfront | Tuning becomes archaeology; users on slow machines bounce | Acceptable for v1 if centralized in a `constants/timing.ts`; never sprinkled |
| Use `simple-git` for `git worktree merge` (CORE-03 merged mode) | Quick win | `simple-git` doesn't handle conflicts well; merge mode is gnarliest spawn variant | Acceptable for non-conflict merges; for conflict path, drop to `Bun.spawn(['git', ...])` for control |
| Skip the per-repo `git` serialization queue (Pitfall 3) because "users rarely spawn 3 Workers at once" | Saves a day | First user with a complex Master workflow hits Pitfall 3 immediately and rage-quits | Never — implement from Phase 2 |
| Skip Master-restart prompt recap (Pitfall 14) for v1 | Saves a day | First user who hits a Master crash never recovers their session | Never — Phase 4 must-have |
| Single shared WebSocket multiplexing all events | "Simpler" architecture | Backpressure on one stream blocks everything; debugging is hell | Never — AP-5 |
| Auto-restart failed Workers "for resilience" | Looks like a feature | Cost runaway (Pitfall 19) | Never — AP-6 |
| Use `drizzle-kit push` in dev only | Faster iteration | Easy to leak into production with no migration history | Acceptable in dev-only; CI must reject push-based schema in PRs |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|---|---|---|
| `Bun.spawn` PTY children | Forgetting `detached: true`; using `proc.kill(15)` only on the PID | `detached: true`; kill the process group via `process.kill(-pgid, sig)` (Pitfall 1) |
| Claude Code MCP plugin | Putting any output on stdout from the bridge subprocess | All logs → stderr; lint-enforce no `console.log` in `mcp-bridge/*` (Pitfall 2) |
| Claude Code MCP plugin | Using `claude -p` instead of interactive `claude` | Use full interactive `claude` with `--mcp-config` pointing at our bridge (per ARCHITECTURE.md) |
| `simple-git` `worktree add` | Calling it in parallel for the same repo | Per-repo serialization queue (Pitfall 3) |
| `bun:sqlite` WAL | Leaving auto-checkpoint at default and never inspecting WAL size | `journal_size_limit` + periodic explicit checkpoint (Pitfall 6) |
| `bun:sqlite` migration | Trusting `drizzle-kit generate` output without reading the SQL | Human review every migration; backup before apply (Pitfall 11) |
| `@modelcontextprotocol/sdk` Client | Connecting to many MCP servers from many Workers via Agenstrix as a proxy | Workers connect directly to MCP servers; Agenstrix proxies only when adding value (ARCHITECTURE.md Boundary 3) |
| `chrome-devtools-mcp` | Treating it as a library import | Spawn as stdio subprocess; close client on Worker exit so browser closes (Pitfall 1) |
| `node-pty` | Using it under Bun | Don't. STACK.md is explicit. `Bun.Terminal` / `bun-pty` only |
| Hono `streamSSE` | Forgetting `stream.onAbort()` cleanup | Always wire `onAbort` to subscriber abort signal (Pitfall 16) |
| Hono `hono/bun` WS | Forgetting `export default { fetch, websocket }` | Both required; WS messages silently dropped without it (STACK.md) |
| `react-flow` (`@xyflow/react`) | Storing nodes inside Zustand and dispatching there | Use `useNodesState` for canvas state; mirror from Zustand via `useEffect` (STACK.md §9) |
| xterm.js | Mounting in `display:none` parent | Mount visible; call `fit.fit()` after parent has nonzero size (STACK.md) |
| xterm.js | Skipping `WebglAddon` because it's optional | Always WebGL with canvas fallback (Pitfall 8) |
| Tauri 2 sidecar | Skipping hardened-runtime entitlements for Bun sidecar | Explicit entitlements for JIT + library validation off (Pitfall 12) |
| Tauri 2 sidecar | `Command.execute()` for long-running server | `Command.spawn()` always (STACK.md) |
| Get-port | Calling in parallel for service auto-start | Serialize via portAllocator with mutex + reservation (Pitfall 15) |
| Chokidar | Watching skill dir without debounce | `awaitWriteFinish` + 250ms event coalescing (Pitfall 18) |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows. Scale axis is "concurrent Workers" — Agenstrix is single-user.

| Trap | Symptoms | Prevention | When It Breaks |
|---|---|---|---|
| Per-byte SQLite writes from PTY data callback | WAL growth >100MB/hr; high write latency | Chunk batcher: 100KB or 250ms windows | 2+ active Workers, immediate |
| Synchronous fan-out in PTY data callback (AP-4) | Dropped bytes; head-of-line blocking | Callback only `bus.publish()`; subscribers async | 1 high-output Worker (`npm install`) |
| Render every off-screen xterm.js | 80%+ CPU; fan spin-up | Lazy-mount; only one drawer alive (Pitfall 8) | 3+ open drawers, immediate |
| Coarse SSE event ("topology changed", "fetch new") | Excess HTTP fetches; UI lag | Granular events with delta payloads; subscribers patch state | 4+ Workers, visible at 8+ |
| No coalesce on topology re-render | React Flow re-layout storms | `requestAnimationFrame` throttle + memoized `nodeTypes` (STACK.md §9) | 8+ nodes, visible at 12+ |
| MCP tool calls without per-server rate limiting | API errors cascading | p-limit wrapper per server (HR-09) | 4+ Workers calling same MCP server |
| Repeated full table scans on `pty_chunks` for replay | Replay drawer takes seconds | Index on `(worker_id, seq)`; paginate replay | One Worker with 1hr+ history |
| Single shared connection to Anthropic (theoretical — claude CLIs handle their own) | API rate limit headers shared | (N/A — each `claude` instance owns its connection) | At 8+ Workers, hits Anthropic per-org tier limit (user's problem) |
| In-memory subscriber map without GC | RAM creeps; shutdown hangs | AbortSignal subscriptions + 60s sweep (Pitfall 16) | After ~50 tab opens/closes; ~6hr session |
| No WAL truncation policy | DB disk usage doubles every hour | `wal_checkpoint(TRUNCATE)` ticker (Pitfall 6) | 3+ Workers × 1hr+; immediate at 8 Workers |

---

## Security Mistakes

Domain-specific to multi-agent CLI orchestrator (local-first, single-user, but still real risks):

| Mistake | Risk | Prevention |
|---|---|---|
| Inheriting full `process.env` into Worker spawns | Secrets in env (DB creds, API keys) leak into Worker context, then into PTY logs and event log | Allowlist env vars per repo; explicit `request_env_var` MCP tool when needed (Pitfall 4) |
| Copying `.env` files into worktrees for "convenience" | Secrets persisted to `pty_chunks` forever; leaked on diagnostic export | Never copy untracked files into worktrees; use explicit env allowlist (Pitfall 4) |
| Storing PTY bytes verbatim without redaction | Anthropic/OpenAI API keys, GitHub tokens, AWS keys end up in SQLite | Regex redactor at write time for known secret patterns (Pitfall 4) |
| Binding HTTP server on `0.0.0.0` instead of `127.0.0.1` | Anyone on local network can spawn Workers with user's `claude` subscription | Default bind `127.0.0.1`; require explicit opt-in for LAN access (cite SETUP-03 settings) |
| Bridging MCP server over HTTP without origin check | Web pages in user's browser could hit the MCP endpoint via DNS rebinding | Origin allowlist on `/mcp`; CSRF token for non-stdio transports |
| Allowing arbitrary user-added MCP servers without sandboxing | A malicious MCP server has full stdio access; can read fs via tool calls | Surface untrusted-source warning when user adds an MCP server; require explicit user confirmation per server's tool list before exposure |
| `chrome-devtools-mcp` runs full Chromium with no profile isolation | Tests visit malicious pages, exploits could land on user's machine | Always spawn Chromium with `--user-data-dir=<temp>` + `--disable-extensions` flags; sandbox by default |
| Diagnostic bundle export including raw `pty_chunks` + `events` | User shares bundle → secrets exposed | Apply stricter redactor at export time; require user confirmation per included table |
| Skills/templates loaded from user's filesystem without source verification | Malicious Skill in a `.agenstrix-pack` could prompt-inject Workers to exfiltrate code | Each Skill manifest shows "trust score" (signed pack / unsigned / local-only); user confirms first-time use |
| Tauri v2 capabilities granting broad shell access | Renderer XSS → arbitrary command execution | Tightest capabilities: `shell:allow-spawn` for the sidecar only; no general `shell:default` |
| `agenstrix-pack` import auto-overwrites local Skills with same name | Malicious pack overwrites user's trusted Skill | Conflict resolution UI (already in ASSET-04 spec); never auto-overwrite |
| Worktree branch names contain user-controllable content | `git checkout -b "; rm -rf /"` style if branch name comes from chat | Branch names are `agenstrix/<nanoid>` always; never user-supplied (ARCHITECTURE.md establishes this; restate as security invariant) |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---|---|---|
| Showing tool-name as opaque ID in Thinking drawer (e.g., "spawn_worker called") | User can't tell what's happening — black box returns | Show "Master is spawning a backend Worker to: Add /register endpoint" — humanized one-line summary derived from args |
| Modal interruptions for every confirmation (kill, delete, etc.) | Confirmation fatigue; users start blindly clicking through | Tiered: instant for low-risk (close drawer), 5s undo for medium (kill Worker), modal only for irreversible (delete workspace) |
| Hiding cost until end of session | Bill shock | Live cost ticker (TS-04); per-Worker cost on hover (HR-14); warn at $1 / $5 / $25 thresholds |
| "Master is thinking..." with no progress signal | Looks frozen | Stream Master's reasoning tokens as they arrive (UI-05); show last tool call as a pulsing badge |
| Workspace detection failing silently | User wonders why nothing happens | Always surface what was detected, even when partial: "Found Next.js, couldn't infer start command — what do you run?" (WS-06) |
| Worker terminal looks blank for first 1–2s of spawn | User thinks Worker died | Render "claude starting..." spinner immediately; fade in real PTY content when first bytes arrive |
| Topology view requires explicit toggle to switch from chat | Users miss the "wow" moment | Auto-pop topology side when first Worker spawns; remember preference for subsequent sessions |
| Generic error messages ("MCP failed", "service failed") | User has no recourse | Always include the OS-level error (e.g., `EADDRINUSE port 5173`), the likely cause, and a one-click action |
| Showing claude's permission prompt buried inside the PTY drawer | User misses it; Master appears stuck waiting | Bubble permission prompts up to a notification badge on the Worker node + an OS notification if user is away |
| Treating Master and Workers visually identically | User can't tell who's "in charge" | Master gets distinct color/border treatment in topology + chat avatar; Workers cluster underneath |
| Deeply nested folder picker for adding workspaces | Friction at the onboarding moment | Drag-drop is primary; folder picker is a fallback only |
| "Spawning Worker..." takes 3-5 seconds with no feedback | Feels broken | HR-11 + topology placeholder node appears within 100ms with "spawning" state; pulsing spinner; transitions to "running" when PTY emits first byte |
| Chat losing scroll position when Master streams long output | User can't read; manually has to scroll up | Stick-to-bottom only when user is already at bottom; preserve scroll otherwise (assistant-ui handles this; verify default) |

---

## "Looks Done But Isn't" Checklist

Things that pass smoke test but fail under real load or edge case.

- [ ] **Worker spawn:** verify on Windows ConPTY *with a non-ASCII path in cwd* — must work via `GetShortPathNameW` (INFRA-07)
- [ ] **Worker kill:** verify all subprocesses die, not just the PID — use `ps -ef` 5s after kill (Pitfall 1)
- [ ] **MCP bridge:** verify zero stdout output across 1000-tool-call stress test — `expect(proc.stdout).toEqual(<only JSON-RPC>)` (Pitfall 2)
- [ ] **Worktree creation:** verify 8 parallel spawns against same repo all succeed — integration test (Pitfall 3)
- [ ] **Secret leak:** verify `.env` containing `FAKE_KEY=sk-test` in main worktree does NOT appear in any `pty_chunks` after Worker spawn (Pitfall 4)
- [ ] **Cost budget:** verify session budget triggers — set $0.01 budget, watch enforcement (Pitfall 5)
- [ ] **WAL growth:** verify `db-wal` < 100MB after 1hr of 4-Worker stress run (Pitfall 6)
- [ ] **ANSI on Windows:** verify chunks containing OSC 8 hyperlinks survive ConPTY round-trip without corruption (Pitfall 7)
- [ ] **xterm.js perf:** verify 3 open Worker drawers + topology + chat stay <50% CPU on M1 Air (Pitfall 8)
- [ ] **Workspace detect:** verify `~/projects/turborepo-monorepo` doesn't try to start every `package.json` in `node_modules/` (Pitfall 9)
- [ ] **Service ready:** verify dev server `service.ready` event fires only on HTTP 2xx, not port-open (Pitfall 10)
- [ ] **Migration safety:** verify a schema change to `workers` does not delete `pty_chunks` rows (Pitfall 11)
- [ ] **Tauri sidecar (v2):** verify codesigned Bun binary launches on a fresh Mac without Gatekeeper prompt (Pitfall 12)
- [ ] **WS idle:** verify Worker drawer stays connected through a 5-minute idle (Pitfall 13)
- [ ] **Master restart:** verify new Master spawned after crash sees existing Workers via recap (Pitfall 14)
- [ ] **Port allocation:** verify 4 services starting in parallel don't collide (Pitfall 15)
- [ ] **Subscriber leak:** verify `bus.subscriberCount()` returns to baseline after closing all browser tabs (Pitfall 16)
- [ ] **Worker cwd:** verify Worker commits land on `agenstrix/<id>` branch, NOT `main` (Pitfall 17)
- [ ] **Chokidar storm:** verify mass `mv` in skills dir doesn't freeze UI > 500ms (Pitfall 18)
- [ ] **No auto-restart:** code review verifies no code path spawns a new Worker/service in response to one exiting (Pitfall 19)
- [ ] **MCP schema versioning:** verify upgrading Agenstrix mid-Master-session surfaces "restart Master" prompt cleanly (Pitfall 20)

---

## Recovery Strategies

When pitfalls occur despite prevention.

| Pitfall | Recovery Cost | Recovery Steps |
|---|---|---|
| Pitfall 1 — orphan processes | LOW | `agenstrix doctor --reap` CLI scans + kills orphans; integrated into boot health check |
| Pitfall 2 — MCP bridge corrupted by stdout | LOW (operationally) | Detect via `proc.exited`; surface "Master lost tools — restart Master?" modal. User restarts Master; conversation context recap (Pitfall 14 recovery) |
| Pitfall 3 — stale `.git/index.lock` | LOW | Doctor command removes stale locks (>60s old, no process holding); per-repo queue prevents recurrence |
| Pitfall 4 — secret leak | HIGH | `agenstrix scrub-secrets` rewrites known patterns to `[REDACTED]`. User must revoke leaked credentials at the source — no software can un-leak |
| Pitfall 5 — cost runaway | MEDIUM | Budget modal fires; user picks "stop all" → graceful kill all Workers + commit-and-exit |
| Pitfall 6 — WAL bloat | MEDIUM | Pause Workers; `wal_checkpoint(TRUNCATE)`; resume. If checkpoint won't run: close all readers, retry. Worst case: copy DB, vacuum, swap |
| Pitfall 7 — ConPTY re-encoding | LOW | No recovery needed for normal operation; for byte-diff failures, switch test to rendered-state diff |
| Pitfall 8 — xterm.js perf | MEDIUM | "Performance mode" toggle disables WebGL + caps render rate; restart browser tab. If pervasive: reduce concurrent open drawers (only 1 at a time enforced as v1 default) |
| Pitfall 9 — workspace mis-detect | LOW | User "ignore this folder" toggle; persisted as `learned_commands.disabled=1` |
| Pitfall 10 — false test failures | LOW | Retry-on-first-failure pattern in test Worker spawn; one click to "wait longer for service" if recurring |
| Pitfall 11 — migration data loss | HIGH | Restore from `~/.agenstrix/backups/store-<timestamp>.db`. Without backup: irrecoverable; documented in README |
| Pitfall 12 — Gatekeeper block | HIGH (release-time), LOW (per-user fix) | Per-user: right-click → Open. Release-time: rebuild signed `.dmg`; push via auto-update if available |
| Pitfall 13 — WS dropped | LOW | Browser auto-reconnect + replay from `pty_chunks` since last `seq` |
| Pitfall 14 — Master restart loses Workers | LOW | Recap injection on Master spawn includes Worker list; "abandoned" detection offers user one-click cleanup |
| Pitfall 15 — port collision | LOW | EADDRINUSE retry with fresh port allocation; up to 3 attempts |
| Pitfall 16 — subscriber leak | LOW | Restart Bun; subscribers reset. Sweep ticker prevents accumulation |
| Pitfall 17 — wrong-worktree commit | MEDIUM | `git reset --soft HEAD~N` in the polluted worktree (manual); offer "Move my last commit to the worker branch" one-click |
| Pitfall 18 — chokidar storm | LOW | Self-resolving once debounce window passes; UI unfreezes |
| Pitfall 19 — restart loop | MEDIUM | Budget cap (Pitfall 5) catches it; manual kill via UI; root cause requires code fix |
| Pitfall 20 — MCP schema drift | LOW | "Restart Master" modal; recap reattaches |

---

## Top-5 Priority — MUST-PREVENT-IN-V1

These five pitfalls would each, on first occurrence, do enough damage that a user would either (a) lose money meaningfully, (b) lose work irrecoverably, (c) leak secrets, or (d) uninstall and tell others not to use it. **They are the immovable safety floor of v1.**

### Rank 1 — Pitfall 5: Cost runaway
**Why #1:** The user trust contract is "uses your Claude subscription" — if Agenstrix's first session generates a $200 bill, no second user ever installs it. This is existential for the product. Reputation damage is permanent and orders-of-magnitude larger than the individual bill.
**Investment required:** Session budget + Master loop detection + per-Worker token cap + idle-spend check. ~3–5 days of engineering. Must be in v1 day 1.
**Phase home:** Phase 4 (loop detection) + Phase 6 (budget enforcement).

### Rank 2 — Pitfall 4: Secret leak from `.env` / process.env into PTY logs
**Why #2:** A single accidental leak of an AWS credential, GitHub token, or OAuth refresh token can result in fraud, data breach, or repository compromise that costs the user thousands (or career). Even non-malicious users will rage-quit when they realize `~/.agenstrix/store.db` contains plaintext keys.
**Investment required:** Env minimalization at spawn + redaction at write + scrub command. ~2–3 days.
**Phase home:** Phase 2 + Phase 6.

### Rank 3 — Pitfall 1: Orphan processes / cascading kill failure
**Why #3:** Combined effect amplifies Pitfalls 5 and 4: orphan `claude` processes continue to consume API credits silently, and orphan `chrome-devtools-mcp` browser sessions retain authentication cookies + sensitive page content. Users discover by way of "Why is my fan running?" or "Why is my activity monitor showing 30 node processes?" Either way, they uninstall.
**Investment required:** `detached: true` invariant + process-group kill + doctor command. ~2 days.
**Phase home:** Phase 2.

### Rank 4 — Pitfall 11: Migration data loss
**Why #4:** Losing a user's accumulated `pty_chunks` (their entire Worker history), `learned_commands` (the smart workspace's accumulated wisdom), or `skills` would feel like a betrayal — Agenstrix specifically promised "we remember so you don't have to configure." A single bad migration that wipes this is a "version 1.x.0 ruined my setup" story that follows the project for years.
**Investment required:** Backup-before-migrate + migration review policy + integration test with realistic data. ~1 day per release; ~2 days infrastructure.
**Phase home:** Phase 1 (policy from day 1; infrastructure with `db/`).

### Rank 5 — Pitfall 3: Concurrent worktree creation deadlock
**Why #5:** Directly blocks the v1 demo (Phase B's "drag two folders and watch parallel agents work") because Master spawning multiple Workers against the same repo is the *core* expected scenario. If 8% of demo runs fail because of `index.lock` collision, the product feels flaky and beta-quality. Stale locks then persist and infect future sessions.
**Investment required:** Per-repo queue + stale-lock cleaner + integration test. ~2 days.
**Phase home:** Phase 2 (queue) + Phase 5 (8-parallel test).

**Combined v1 budget for the top-5 floor:** ~10–14 engineer-days. Skip these and the project cannot ship credibly.

---

## Pitfall-to-Phase Mapping

How roadmap phases should address pitfalls. Phases align with ARCHITECTURE.md "Suggested Build Order."

| Pitfall | Prevention Phase(s) | Verification |
|---|---|---|
| 1 — Orphan processes | **Phase 2** (PTY) + Phase 4 (MCP children) + Phase 6 (doctor) | Integration test: spawn + kill Worker, assert no PIDs survive in `ps` 5s later (POSIX) / Process Explorer (Windows) |
| 2 — MCP stdout pollution | **Phase 4** (MCP bridge) | Unit test: bridge stdout receives only valid JSON-RPC over 1000-call stress |
| 3 — Worktree lock contention | **Phase 2** (per-repo queue) + Phase 5 (8-parallel test) | Integration test: 8 parallel Worker spawns against one repo, 100% success rate |
| 4 — Secret leak via `.env` / env | **Phase 2** (env minimalization) + Phase 3 (env allowlist plumbing) + Phase 6 (redaction + scrub) | Integration test: seed `.env` with `FAKE_KEY=sk-test`, spawn Worker, scan `pty_chunks` for the literal — must be absent |
| 5 — Cost runaway | **Phase 4** (loop detection) + **Phase 6** (budget enforcement) | Manual test: set $0.01 budget, watch Master refusal; loop-detect test: simulate 3 identical `spawn_worker` hashes, assert rejection |
| 6 — SQLite WAL bloat | **Phase 1** (`journal_size_limit` + WAL setup) + Phase 6 (checkpoint ticker, ring-buffer) | Integration test: 4 Workers streaming for 1hr, assert `db-wal` < 100MB |
| 7 — ConPTY ANSI re-encoding | **Phase 2** (ANSI-aware splitter) + Phase 6 (cross-platform CI) | Snapshot test on Windows: replay chunks through xterm.js, compare cell buffer (not bytes) to expected |
| 8 — xterm.js perf | **Phase 2** (lazy-mount + WebGL default) + Phase 6 (throttling + perf mode) | Manual perf test: 3 drawers open + topology + chat on M1 Air, CPU < 50% sustained |
| 9 — Workspace mis-detect | **Phase 3** (Smart Workspace) | Fixture test: detect against turborepo, nx, pnpm-workspace, plain monorepo fixtures; assert correct service set |
| 10 — Port-open mistaken for ready | **Phase 3** (Service Supervisor — HR-17) | Integration test: spawn Next.js dev server, time between `port_open` and `responding` events ≥ 1s |
| 11 — Migration data loss | **Phase 1** (policy + backup) + every release | CI: apply pending migrations against seeded DB with FK relationships; assert row counts preserved |
| 12 — Tauri sidecar notarization | **Phase 6+ / v2** | CI: fresh macOS runner installs `.dmg`, verifies sidecar spawn without Gatekeeper prompt |
| 13 — WS idle timeout | **Phase 2** (`idleTimeout: 0`) + Phase 4 (heartbeat + reconnect) | Integration test: Worker drawer open, no traffic for 5min, WS still connected |
| 14 — Master restart context loss | **Phase 4** (recap prompt) + Phase 5 (orphan detection) | Integration test: spawn Master with 2 Workers, SIGKILL Master, respawn, assert new Master can `list_workers` and sees them |
| 15 — Port allocation race | **Phase 3** (portAllocator + mutex) | Integration test: 4 services start in parallel, all bind unique ports |
| 16 — Subscriber leak | **Phase 1** (AbortSignal-first bus) + Phase 4 (gateway wiring) | Manual: open/close 100 tabs, assert `bus.subscriberCount()` returns to baseline + ≤ 10 sec |
| 17 — Worker cwd not enforced | **Phase 2** (env sanitization) + Phase 5 (verify-before-commit) | Integration test: Worker runs `pwd && git rev-parse --show-toplevel`, both equal worktree path; commits land on `agenstrix/<id>` branch |
| 18 — Chokidar storm | **Phase 4** (Skills loader debounce) | Manual: bulk `mv` of 50 skill files, assert UI freeze < 500ms, single batch event emitted |
| 19 — Auto-restart loop | **Phase 4** (review checklist) + Phase 6 (automated detector) | Code review checklist enforced via Biome custom rule or `grep` pre-commit hook |
| 20 — MCP schema drift | **Phase 4** (versioned catalog) + Phase 6 (upgrade path) | Manual: bump tool catalog version, launch Master with old version env, assert structured disconnect |

---

## Sources

### GitHub issues / PRs (HIGH confidence — direct evidence)
- [oven-sh/bun#1442](https://github.com/oven-sh/bun/issues/1442) — Bun.spawn `setpgid` / process-group support status (cited by ARCHITECTURE.md; informs Pitfall 1)
- [oven-sh/bun#20908](https://github.com/oven-sh/bun/issues/20908) — UID/GID in Bun.spawn vs Node child_process
- [anthropics/claude-code#57102](https://github.com/anthropics/claude-code/issues/57102) — stale `.git/index.lock` left behind during Claude Code CLI ops (macOS)
- [anthropics/claude-code#4277](https://github.com/anthropics/claude-code/issues/4277) — feature request: agentic loop detection service
- [anthropics/claude-code#1913](https://github.com/anthropics/claude-code/issues/1913) — terminal flickering in Claude Code
- [anthropics/claude-code#769](https://github.com/anthropics/claude-code/issues/769) — in-progress call causes screen flickering
- [anthropics/claude-code#9935](https://github.com/anthropics/claude-code/issues/9935) — excessive scroll events in terminal multiplexers (4000-6700/s)
- [anthropics/claude-code#48866](https://github.com/anthropics/claude-code/issues/48866) — MCP stdio server docs missing stdout/stderr protocol guidance
- [ruvnet/claude-flow#835](https://github.com/ruvnet/claude-flow/issues/835) — MCP server stdio mode corrupted by stdout log messages
- [microsoft/terminal#12166](https://github.com/microsoft/terminal/issues/12166) — ConPTY modifies escape sequences passed to process input
- [microsoft/terminal#1965](https://github.com/microsoft/terminal/issues/1965) — ConPTY escape sequences behave strangely when VirtualTerminalLevel is set
- [microsoft/terminal#362](https://github.com/microsoft/terminal/issues/362) — ConPTY translating `[49m` to `[m`
- [microsoft/terminal#2011](https://github.com/microsoft/terminal/issues/2011) — VT escape sequence reordering in ConPTY output
- [drizzle-team/drizzle-orm#4938](https://github.com/drizzle-team/drizzle-orm/issues/4938) — migration generator silently causes cascade data loss during SQLite table recreation
- [tauri-apps/tauri#11992](https://github.com/tauri-apps/tauri/issues/11992) — MacOS codesigning + notarization issue with `externalBin`
- [xtermjs/xterm.js#802](https://github.com/xtermjs/xterm.js/issues/802) — alternate screen buffer scrollback issues
- [xtermjs/xterm.js#1701](https://github.com/xtermjs/xterm.js/issues/1701) — resize from the left causes flickering

### Official documentation (HIGH)
- [Bun.spawn — detached option](https://bun.com/reference/bun/Spawn/SpawnOptions/detached) — process-group semantics on POSIX
- [Bun.Terminal API](https://bun.com/reference/bun/Terminal) — PTY data callback / resize / kill
- [SQLite WAL Mode official docs](https://sqlite.org/wal.html) — checkpoint semantics, growth conditions
- [MCP Debugging guide](https://modelcontextprotocol.io/docs/tools/debugging) — stdout protocol-reservation rule
- [Drizzle ORM migrations](https://orm.drizzle.team/docs/migrations) — generation workflow
- [Tauri 2 macOS code signing](https://v2.tauri.app/distribute/sign/macos/) — sidecar signing requirements
- [Tauri 2 sidecar guide](https://v2.tauri.app/develop/sidecar) — externalBin behavior
- [Turborepo structuring a repository](https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository) — workspace boundaries
- [Microsoft ConPTY introduction](https://devblogs.microsoft.com/commandline/windows-command-line-introducing-the-windows-pseudo-console-conpty/) — architectural overview

### Ecosystem post-mortems & analysis (MEDIUM)
- [The 20GB WAL File That Shouldn't Exist — SQLite Checkpoint Starvation (Loke.dev)](https://loke.dev/blog/sqlite-checkpoint-starvation-wal-growth)
- [SQLite performance tuning (phiresky.github.io)](https://phiresky.github.io/blog/2020/sqlite-performance-tuning/)
- [Drizzle ORM Migrations in Production: Zero-Downtime Schema Changes](https://dev.to/whoffagents/drizzle-orm-migrations-in-production-zero-downtime-schema-changes-e71)
- [Git Worktree Conflicts with Multiple AI Agents: Diagnosis and Fixes (Termdock)](https://www.termdock.com/en/blog/git-worktree-conflicts-ai-agents)
- [How to Use Git Worktrees for Parallel AI Agent Execution (Augment Code)](https://www.augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution)
- [git index.lock file exists: safe fix by root cause (2026) (DevToolbox)](https://devtoolbox.dedyn.io/blog/git-index-lock-file-exists-fix-guide)
- [Building MCP Servers: Custom Context for Claude Code (SitePoint)](https://www.sitepoint.com/building-mcp-servers-custom-context-for-claude-code/)
- [MCP Server stdout pollution causing Invalid JSON-RPC messages (Postman Community)](https://community.postman.com/t/mcp-server-stdout-pollution-causing-invalid-json-rpc-messages-in-claude-desktop/89753)
- [Fix: Claude Desktop MCP JSON parsing errors after July 23, 2025 breaking change](https://github.com/fkesheh/code-context-mcp/pull/4)
- [AI Agent Token Budget Management: How Claude Code Prevents Runaway API Costs (MindStudio)](https://www.mindstudio.ai/blog/ai-agent-token-budget-management-claude-code)
- [The Real Cost of AI Coding in 2026 (Morph)](https://www.morphllm.com/ai-coding-costs)
- [Ship Your Tauri v2 App Like a Pro: Code Signing (DEV)](https://dev.to/tomtomdu73/ship-your-tauri-v2-app-like-a-pro-code-signing-for-macos-and-windows-part-12-3o9n)
- [Shipping a Production macOS App with Tauri 2.0 (DEV)](https://dev.to/0xmassi/shipping-a-production-macos-app-with-tauri-20-code-signing-notarization-and-homebrew-mc3)
- [Understanding MCP Connection Options: A Technical Deep Dive (harrylaou.com)](https://harrylaou.com/llm/understanding-mcp-connection-options-technical-deep-dive/)

### Cross-references (internal)
- `.planning/research/STACK.md` "Known Production Gotchas" — version-specific gotchas extended here
- `.planning/research/FEATURES.md` "Hidden Requirements" — HR-01 through HR-20 are the silent failure modes; this file maps each to a concrete engineering guard
- `.planning/research/ARCHITECTURE.md` "Failure Boundaries & Recovery" + "Anti-Patterns to Avoid" — process-level failures and architectural traps; this file adds module-level pitfalls
- `.planning/PROJECT.md` Constraints + Key Decisions — the locked stack + decisions that constrain pitfall responses

---
*Pitfalls research for: Agenstrix multi-agent CLI orchestrator (Bun + React + MCP + real `claude`/`codex` PTYs + smart workspace)*
*Researched: 2026-05-17*
