# Project Research Summary — Agenstrix

**Project:** Agenstrix — multi-agent CLI orchestrator (autonomous `claude` Master + real-CLI Workers + smart workspace)
**Domain:** Local-first, single-user developer tooling — Bun backend + React UI; v2 Tauri desktop
**Researched:** 2026-05-17
**Confidence:** **HIGH** (versions npm-verified day-of; competitor coverage cross-validated against 10+ projects; pitfalls grounded in GitHub issues + 2026 ecosystem post-mortems)

This document is the **single entry-point** for the Phase-1 planner and the roadmapper. It distills four research files into the decisions, must-have requirements, phase ordering, and risks that govern v1. Detail lives in the underlying files (linked in §7).

---

## 1. TL;DR — What Research Changes About Agenstrix Planning

The locked stack is sound but **one constraint in `PROJECT.md` is wrong as of 2026-05-17**: `node-pty` does not work under Bun and must be replaced with **`Bun.Terminal`** (first-party, POSIX since Bun 1.3.5, Windows ConPTY since Bun 1.3.14 shipped 4 days before this research) with `bun-pty` as the FFI fallback. Beyond that single correction, research validates the product hypothesis — **"autonomous real-`claude` Master + smart workspace + service-as-first-class"** is genuinely uncontested in the 2026 ecosystem (golutra has real CLIs but no autonomous Master; swarm-ide has autonomous Master but fake CLI; nobody has smart workspace). The competitive moat is real, narrow, and load-bearing on four features that must ship together to demonstrate it: `WS-02..06` smart detect, `CORE-01/02` real-claude-as-Master via MCP plugin, `SVC-*` + `DF-04` service auto-start chain, and `MCP-02` built-in chrome-devtools-mcp. Everything else is plumbing around this story. The biggest non-obvious risks are **cost runaway** (HR-01/02 + Pitfall 5: $200 overnight is documented), **SIGTERM not propagating to `claude`'s subprocess group** (Pitfall 1: orphaned `node`/Chromium burns API credits silently), **MCP stdio stream corruption from stray `console.log`** (Pitfall 2: breaks all tools mid-session), and **per-repo git lock contention** when Master parallel-spawns Workers (Pitfall 3: blocks the entire DAG). The 6-phase build order is non-negotiable: DB+bus first, PTY second, Smart Workspace before Master+MCP, dep graph after MCP, polish last.

---

## 2. Critical Stack Corrections to PROJECT.md

Apply these before roadmap work begins. Each is HIGH-confidence (npm registry + maintainer-merged GitHub issues).

| Location in PROJECT.md | Current text | Correction | Reason |
|---|---|---|---|
| Constraints → Tech stack — Backend | `+ node-pty` | **Remove `node-pty`; add `Bun.Terminal` (default, Bun 1.3.14+) with `bun-pty` as FFI fallback** | `node-pty` NAN crashes under Bun (`napi_define_properties` failure); NAPI port author explicitly recommends "skip bun"; will not load in `bun build --compile` output. STACK.md §"What NOT to Use" and §Confidence-Levels (HIGH). |
| Constraints → Tech stack — Backend (implicit) | `bun:sqlite` (no version pinning guidance) | **Pin Drizzle ORM to `^0.45.2` stable, NOT `1.0.0-rc.x`** | npm `latest` dist-tag is `0.45.2`; `rc` line still ships breaking patches weekly. Pair with `drizzle-kit@^0.31.10`. STACK.md "Recommended Stack." |
| Constraints → Tech stack — Frontend | `xterm.js` (unscoped or unversioned) | **Use `@xterm/xterm@^6.0.0` (scoped v6 line), NOT the legacy unscoped `xterm` package** | Unscoped `xterm` is the 5.x dead-end; v6 ships only under `@xterm/*` scope. Avoid v6.1 betas. STACK.md "What NOT to Use." |
| Constraints → Tech stack — Frontend (implicit) | Tailwind v4 | **`tailwind.config.js` does not exist in Tailwind v4; use `@theme` in CSS + `@tailwindcss/vite`** | Tailwind v4 is CSS-first; shadcn/ui v4 templates require `tw-animate-css` (NOT `tailwindcss-animate` which is v3-only). |
| Constraints → Cross-platform | "Windows v1 必须能跑 (ConPTY + 路径短名兼容, 抄 golutra)" | **Document Windows minimum: Windows 10 1809+ (ConPTY requirement)** | Older Windows lacks ConPTY entirely. STACK.md "Known Production Gotchas — Bun.Terminal (Windows ConPTY)." |
| Key Decisions table | (no decision recorded re: PTY library) | **Add row: "PTY = `Bun.Terminal` (default) + `bun-pty` (fallback behind `PtyHandle` interface) — never `node-pty`"** | Critical decision; should be reified as a Key Decision now. |
| Constraints → Tech stack — Backend | (no biome version) | **Biome 2.x (`@biomejs/biome@^2.4.15`) — JSON-only `biome.json`** | The 2026 line. |
| Constraints → Tech stack — Desktop | "Tauri 2" | Add: **Tauri 2 sidecar requires per-platform `bun build --compile --target=bun-<os>-<arch>` outputs named `agenstrix-server-<rust-target-triple>(.exe)`** | The non-obvious recipe for `externalBin`. Plan in v1 so v2 isn't a 3-day surprise. STACK.md §"Bun --compile + Tauri 2 sidecar recipe." |

**Recommended action for the roadmapper:** edit PROJECT.md Constraints + Key Decisions in the same PR as the v1 roadmap is created, citing this SUMMARY.

---

## 3. Top 10 Must-Have v1 Requirements Not Yet Explicit in PROJECT.md

Surfaced from FEATURES.md (HR-01..HR-20) and PITFALLS.md (Top-5). These are gaps in PROJECT.md's `Active` list that the v1 roadmap must add.

| # | Proposed ID | Requirement | Source | Phase |
|---|---|---|---|---|
| 1 | **COST-01** | Per-Worker token budget cap: inject `"You have N tokens; pause at 85%"` into Worker system prompt + poll `/cost`; auto-kill at 100%. Default 50k/Worker. | FEATURES HR-01; PITFALLS Pitfall 5 | Phase 6 |
| 2 | **COST-02** | Session-wide budget kill-switch: default $5; on cross, refuse `spawn_worker` MCP calls + graceful-stop running Workers + modal "Stop / Continue with new budget / Kill all" | FEATURES HR-02; PITFALLS Pitfall 5 | Phase 4 + Phase 6 |
| 3 | **KILL-01** | Cascading kill — `claude` PTY child *and* its subprocess group + chrome-devtools-mcp browser children + reap-orphan sweep on shutdown AND on next-startup | FEATURES HR-05; PITFALLS Pitfall 1 (CRITICAL) | Phase 2 + Phase 6 |
| 4 | **GIT-01** | **Per-repo `git worktree add` serialization queue**: Master parallel-spawning 3 Workers against same repo must not race on `.git/index.lock`. + boot-time stale-lock scanner. | PITFALLS Pitfall 3 (CRITICAL) | Phase 2 |
| 5 | **SEC-01** | Worker spawn env **minimalization** — pass only `{PATH, HOME, USER, LANG, SHELL, ...envAllowlist}`, never `...process.env`; never copy untracked files (`.env`) into worktrees; `request_env_var` MCP tool when needed; redactor on `pty_chunks` writes for `sk-ant-`, `ghp_`, `sk-`, `AKIA` | FEATURES HR-07; PITFALLS Pitfall 4 (CRITICAL) | Phase 2 + Phase 6 |
| 6 | **MCP-PURITY-01** | **MCP stdio bridge stdout reserved for JSON-RPC only.** No `console.log` anywhere in bridge code (Biome lint rule); all bridge logs → stderr; startup unit test asserts 5s of stdout is parseable JSON. | PITFALLS Pitfall 2 (CRITICAL) | Phase 4 |
| 7 | **SVC-READY-01** | **Service "ready" = HTTP 2xx (not port-open)** + 1s warmup hold + per-framework health-URL mapping (Vite `/@vite/client`, Next `/`); 60s timeout → `service.start_timeout` event with stderr tail. | FEATURES HR-17; PITFALLS Pitfall 10 | Phase 3 |
| 8 | **WS-DETECT-01** | **Workspace-aware detection roots only.** Respect `package.json#workspaces`, `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, `pyproject.toml`; exclude `node_modules/.venv/dist/build/.next/target/.turbo`; require signature file AND `scripts.dev` before declaring a service. | PITFALLS Pitfall 9 | Phase 3 |
| 9 | **DB-DURABILITY-01** | SQLite invariants from day 1: `PRAGMA journal_size_limit=67108864`, `wal_checkpoint(TRUNCATE)` ticker every 5min, **human-review every Drizzle migration** for FK-cascade-on-DROP, **backup `store.db` before each migration** to `~/.agenstrix/backups/` (keep 10), never `drizzle-kit push` in production. | PITFALLS Pitfall 6 + Pitfall 11 | Phase 1 |
| 10 | **MASTER-RESUME-01** | Master crash recovery via prompt recap: spawn new `claude` with injected recap listing active Workers (W-1..N), running services, last 20 chat turns; system-prompt convention "call `list_workers`/`list_services` first when resuming"; orphan-Worker detection (no `send_to_worker` within 30s post-restart → kill modal). | FEATURES HR-13; PITFALLS Pitfall 14 | Phase 4 |

**Honorable mention (P2):** HR-03 reasoning-loop detection, HR-20 8+ xterm.js perf via lazy-mount+WebGL, PORT-ALLOC-01 serialized port allocator, WS-1011-01 `idleTimeout: 0` + heartbeat, ANSI-SPLITTER-01 escape-sequence-aware chunk batcher, WORKTREE-CWD-01 git env scrub + cwd verify.

---

## 4. Phase Ordering Recommendation — Six Phases for v1

Order is **derived jointly** from ARCHITECTURE.md build order + FEATURES.md onboarding gauntlet + PITFALLS.md phase tags. The dependencies are real, not stylistic — getting them wrong causes throwaway work.

### Phase 1 — "Hollow Bun" (the chassis, ~3 days)
**Goal:** `system/` + `db/` + `bus/` + minimal `gateway/`. Browser opens, sees SSE health-check ticks.
**Delivers:** Schema for 11 tables (`workspaces`, `conversations`, `messages`, `workers`, `pty_chunks`, `events`, `skills`, `templates`, `repos`, `services`, `learned_commands`), migrations runner, pino logging, EventBus → SQLite sink (event sourcing baseline for HR-13).
**Addresses:** INFRA-02, INFRA-04, INFRA-05, INFRA-06 (skeleton), DB-DURABILITY-01.
**Research flag:** Standard patterns — **skip research-phase**.

### Phase 2 — "First PTY" (prove the riskiest stack assumption, ~5 days)
**Goal:** Real `claude` running interactively in a browser-rendered xterm.js drawer via WebSocket. INFRA-03 replay works.
**Delivers:** `pty/` module wrapping `Bun.Terminal` + chunk batcher (ANSI-aware splitter, ~100KB/250ms windows) + process-group detach; `worker/` minimal (no-worktree mode, no deps, no skills); WS gateway with `idleTimeout: 0` + heartbeat; first xterm.js drawer.
**Addresses:** CORE-01 (Master shape proven), CORE-04 (Worker shape proven), CORE-05 kill semantics, KILL-01, GIT-01, SEC-01, ANSI-SPLITTER-01, WS-1011-01, INFRA-03, INFRA-07.
**Research flag:** **Phase 2 needs research-phase** — `Bun.Terminal` Windows behavior under load is undocumented in the field. Re-validate `bun-pty` fallback wiring at start.

### Phase 3 — "Smart Workspace" (the unique-value gate, ~5 days)
**Goal:** Drag two folders into UI → auto-detect + trial-start + green dots. The 5-minute onboarding gauntlet works to t+2:00. **This is the differentiator nobody else has — ship before any topology view.**
**Delivers:** `workspace/` detection pipeline (WS-02/03/04), `service/` supervisor with **HTTP 2xx readiness** + per-framework health-URL mapping + serialized port allocator, WS-05 trial-start, WS-06 failure-fallback diagnostic, WS-DETECT-01 workspace-aware root detection, UI-11 workspace bar + react-dropzone, SVC-04 status dots.
**Addresses:** WS-01..09, SVC-01..05, SVC-READY-01, WS-DETECT-01, MCP-02.
**Research flag:** **Phase 3 needs research-phase** — per-framework health-endpoint mapping needs ground-truth validation.

### Phase 4 — "Master + MCP" (the demo loop closes, ~7 days)
**Goal:** User types in chat, Master `claude` decides, calls MCP tool, Worker spawns and streams to browser. The "wow."
**Delivers:** `mcp/` server (stdio bridge subprocess pattern, with HTTP fallback design sketched), `mcp/` client (chrome-devtools-mcp built-in), `master/` controller, full action tool catalog (`spawn_worker`, `send_to_worker`, `kill_worker`, `start_service`, `stop_service`, `list_workers`, `list_services`, `wait_for_workers`, `read_worker_log`, `list_skills`, `inject_skill`, `update_learned_command`, `add_dep`), chat panel with assistant-ui + SSE streaming, UI-05 Master Thinking drawer, MASTER-RESUME-01 prompt recap, COST-02 session budget kill-switch wired to MCP.
**Addresses:** CORE-01, CORE-02, CORE-06, MCP-01..04, UI-05, MASTER-RESUME-01, MCP-PURITY-01.
**Research flag:** **Phase 4 needs research-phase** — Claude Code MCP plugin spawn config (`CLAUDE_MCP_CONFIG` vs `.claude.json`) discovery order per claude version.

### Phase 5 — "Topology + Dep Graph" (orchestration becomes visible, ~5 days)
**Goal:** End-to-end PROJECT.md demo: Worker-1 (backend, isolated worktree) → service auto-start → Worker-2 (frontend, isolated, depends on W-1) → both ready → Worker-3 (codex, no-worktree, chrome-devtools-mcp, depends on W-1+W-2 + needs both services running).
**Delivers:** Topology canvas (`@xyflow/react` + memoized `nodeTypes`, throttled re-render), dep graph reconciler as **separate bus subscriber**, all 4 environment modes (`isolated`, `inherit`, `merged`, `no-worktree`), DF-09 wait-edges, UI-02 node status + per-Worker cost, UI-07 global cost dashboard.
**Addresses:** CORE-03 fully, CORE-07, DF-04 service auto-start chain, UI-01, UI-02, DF-09, WORKTREE-CWD-01.
**Research flag:** Standard patterns — **skip research-phase**.

### Phase 6 — "Production Polish" (don't crash in front of users, ~7 days)
**Goal:** v1-shippable on macOS / Linux / Windows.
**Delivers:** COST-01 per-Worker budget + COST-02 hardening + HR-03 loop detection, KILL-01 doctor CLI + reap-on-boot, SEC-01 redactor + `scrub-secrets` CLI, HR-13 full crash-recovery resume modal, ASSET-01 4 built-in spell templates, ASSET-02 Skills auto-injection with chokidar + debounce, ASSET-04 `.agenstrix-pack`, SETUP-04 graceful exit protocol (11-step ordering), Windows-specific `GetShortPathNameW` shim, INFRA-01 i18n (zh-CN default + en), UI-06 destructive-action confirmation, UI-08 Cmd+K, UI-09 themes, UI-10 `@worker-N`, UI-04 keyboard injection. Tauri-prep design docs (entitlements + signing pipeline) so v2 isn't a surprise.
**Research flag:** **Phase 6 needs research-phase ONLY for Tauri 2 sidecar signing**.

### Phase Ordering Rationale (Why This Order)

- **DB+bus before PTY**: every PTY spawn writes chunks and emits events. Retrofitting persistence is expensive.
- **PTY before Workers**: PTY is the riskiest unverified part of the locked stack. Failing here forces a stack change.
- **Smart Workspace before Master+MCP**: (a) it's the unique-value gate; (b) testable without Master complexity; (c) Master+MCP is harder — debug each in isolation.
- **MCP server before topology UI**: topology shows what MCP-driven actions produced.
- **Dep graph after MCP**: deps are declared via MCP tool calls; the reconciler consumes bus events MCP handlers produce.
- **Polish at the end**, but with exceptions that CANNOT defer: SVC-READY-01 (Phase 3), GIT-01 (Phase 2), KILL-01 (Phase 2), MCP-PURITY-01 (Phase 4), MASTER-RESUME-01 (Phase 4), DB-DURABILITY-01 (Phase 1).

### Research Flags Summary

| Phase | Needs research-phase? | Why |
|---|---|---|
| Phase 1 | NO | Standard Drizzle + bun:sqlite + Hono patterns |
| Phase 2 | **YES** | Bun.Terminal Windows ConPTY is 4 days old; bun-pty fallback wiring re-validation |
| Phase 3 | **YES** | Per-framework health-URL ground truth + workspace-tool root detection edge cases |
| Phase 4 | **YES** | Claude Code MCP config discovery order + stdio-bridge-vs-HTTP transport drift |
| Phase 5 | NO | react-flow + bus projection well-trodden patterns |
| Phase 6 | **YES** (Tauri sidecar signing only) | macOS entitlements + notarization specifics drift |

---

## 5. Top 5 Risks That Could Sink v1

1. **Bun.Terminal Windows ConPTY is brand new (shipped 2026-05-13)** — research is 4 days later. Regression forces stack pivot to `bun-pty` mid-Phase-2. **Mitigation:** Phase 2 Windows CI matrix from day 1; `PtyHandle` interface wraps implementation; ANSI-aware splitter handles ConPTY re-encoding. **Probability:** MEDIUM. **Impact:** HIGH.

2. **Cost runaway burns $200 overnight (Pitfall 5)** — Master loops between Workers, each burning 50k tokens. Documented failure mode in 2026 ecosystem. **Mitigation:** COST-02 session kill-switch ($5 default), COST-01 per-Worker cap, MCP-level loop detection (hash `(repo, task_summary, envMode)`, reject 3rd identical spawn), idle-but-spending notification. **Probability:** HIGH without mitigation. **Impact:** PRODUCT-KILLING (one viral "$300 lost" tweet ends adoption).

3. **Orphan processes burn API credits silently after kill (Pitfall 1)** — `SIGTERM` to `claude` PTY doesn't propagate to its `node`/`rg`/Chromium children; orphan `claude` keeps polling Anthropic for hours. **Mitigation:** `detached: true` invariant + process-group kill (`process.kill(-pgid, sig)`) + chrome-devtools-mcp client close + `agenstrix doctor --reap` boot-time orphan scanner. **Probability:** HIGH without mitigation. **Impact:** HIGH.

4. **The "demo magic" requires four features that all must work simultaneously** — smart workspace detection (WS-02..06), real `claude` Master via MCP plugin (CORE-01/02), service auto-start chain (SVC-* + DF-04), built-in chrome-devtools-mcp (MCP-02). Any one breaking on day-1 demo collapses the competitive story. **Mitigation:** Phase ordering puts WS in Phase 3 *before* MCP/Master in Phase 4; end-to-end demo is Phase 5 exit criterion. **Probability:** MEDIUM. **Impact:** PRODUCT-KILLING.

5. **MCP stdio bridge fragile to upgrades and to accidental stdout pollution (Pitfall 2 + Pitfall 20)** — Single `console.log` in bridge corrupts JSON-RPC stream; Master silently loses all tools mid-session. Schema drift between versions breaks Master sessions. **Mitigation:** Biome lint rule banning `console.log` in `mcp/bridge/**`, startup unit test asserting 5s pure JSON, additive-only tool-schema policy, version handshake at MCP init, HTTP-transport fallback documented. **Probability:** MEDIUM. **Impact:** HIGH (silent black-box Master).

**Honorable mentions:** SQLite WAL unbounded growth (Pitfall 6), Drizzle migration cascade-drop (Pitfall 11), xterm.js perf 3+ drawers (Pitfall 8), MCP rate-limit (HR-09).

---

## 6. Key Open Questions — Research Could Not Resolve

| # | Question | Resolve During |
|---|---|---|
| Q1 | Does Claude Code reliably honor `CLAUDE_MCP_CONFIG` env var across versions vs requiring `.claude.json` in working directory? | Phase 4 — first spike |
| Q2 | Will `Bun.Terminal` on Windows 10 1809+ render `claude`'s ASCII logo + diff cards + permission prompts byte-perfectly? | Phase 2 Windows smoke test |
| Q3 | Does `simple-git` reliably support `git worktree add -b <branch>` under heavy parallel load with per-repo serialization? | Phase 2 + Phase 5 |
| Q4 | What is the realistic per-framework HTTP health-check endpoint that always works without false negatives? | Phase 3 — collect empirical data; persist `health_url` |
| Q5 | Does Claude Code's MCP tool-call event surface emit enough structured data for UI-05 Master Thinking drawer in real-time? | Phase 4 — first spike |
| Q6 | How aggressive should the per-session $5 default budget be? | Phase 4 ship at $5, refine via GitHub feedback |
| Q7 | Is embedded `chrome-devtools-mcp@^0.26.0` stable enough to ship built-in? | Phase 3 (early wiring) + Phase 4 (full integration) |
| Q8 | Will the "Worker = `claude` or `codex` with --mcp-config" injection scheme work for `codex` the same as `claude`? | Phase 4 — validate codex Worker MCP wiring |
| Q9 | Can `Bun.Terminal` constructor's `data` callback fire before `Bun.spawn` returns? Early bytes dropped? | Phase 2 — unit test for spawn-boundary race |
| Q10 | Where exactly does Claude Code persist its own session context (`~/.claude/`)? Affects whether Master restart amnesia (Pitfall 14) can be partially mitigated. | Phase 4 — research after first crash-recovery is built |

---

## 7. References — Quick Links to Underlying Research

| File | What's in it | When to consult |
|---|---|---|
| [`STACK.md`](./STACK.md) | Locked tech stack with exact versions, critical Bun.Terminal vs node-pty finding, installation commands, integration patterns, alternatives + what-not-to-use, version compatibility matrix, confidence per recommendation | Before any dependency add; when designing a module's external interface; before any Tauri v2 work |
| [`FEATURES.md`](./FEATURES.md) | Table-stakes / differentiators / anti-features / hidden requirements (HR-01..HR-20), 5-minute onboarding gauntlet, feature dependency graph, P1/P2/P3 prioritization matrix, competitor feature matrix | When prioritizing scope; when arguing whether a feature is in or out of v1; when comparing against competitor positioning |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | 8 backend modules + `gateway/` + `system/`; 3 frontend slices; 3 worked data flows; state ownership table; failure boundaries matrix + 11-step graceful-shutdown protocol; 7 cross-process communication boundaries; 8 anti-patterns | When designing any new module or interface; when a state-ownership question arises; when a failure mode needs handling |
| [`PITFALLS.md`](./PITFALLS.md) | 20 specific pitfalls with what-goes-wrong / why / warning signs / prevention / recovery / phase tag / cross-references; technical-debt patterns; integration gotchas; performance traps; security mistakes | Before starting each phase (filter by phase tag); when debugging any failure; in code review (cite Pitfall # when blocking a PR) |

---

## 8. Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | **HIGH** | Every version `npm view`-verified on 2026-05-17. MEDIUM items: Bun.Terminal Windows (4 days old), bun-pty (smaller user base), Windows path short-name FFI signature. |
| Features | **HIGH** | Cross-validated against 11 competitors + 10+ 2026 ecosystem critique posts. |
| Architecture | **HIGH** | Eight-module decomposition derived from locked stack; cross-validated against golutra / swarm-ide / Composio ao designs. One MEDIUM area: MCP stdio bridge subprocess pattern vs HTTP transport. |
| Pitfalls | **HIGH** for items cross-referenced to GitHub issues / official docs (1, 2, 3, 6, 7, 8, 10, 11, 12, 13, 15, 16, 18); **MEDIUM** for ecosystem-derived (4, 5, 9, 14, 17, 19, 20). |

**Overall confidence:** **HIGH** — research is grounded, stack is current, competitive analysis exhaustive, failure catalog operational.

### Gaps to Address During Planning

- The 10 open questions in §6 should become Phase-1..4 *spikes* tracked as roadmap items.
- The `learned_commands.health_url` schema (SVC-READY-01) needs ground-truth health-check data per framework — gather during Phase 3 build.
- The MCP tool catalog (Phase 4) should be a typed catalog (e.g., `tools/v1.ts`) under code review from first commit.
- Cross-platform validation (Windows specifically) is Phase 2 + Phase 6 dual concern — CI matrix runs Windows from Phase 2 day 1.

---

*Research synthesized: 2026-05-17*
*Ready for roadmap creation: yes*
*Primary downstream consumer: gsd-roadmapper agent → v1 phased roadmap*
