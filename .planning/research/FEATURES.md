# Feature Research

**Domain:** Multi-Agent CLI Orchestrator (autonomous Master + real-CLI Workers + smart workspace)
**Researched:** 2026-05-17
**Confidence:** HIGH (cross-validated against golutra, swarm-ide, Composio ao, ruflo, AWS CAO, vibe-kanban, claude-squad, conductor, claude-flow, Copilot CLI /fleet, Claude Code Agent Teams, plus 2026 ecosystem critiques)

---

## Feature Landscape

### Table Stakes (Users Expect These)

If Agenstrix ships without any of these, users from competing tools (golutra / vibe-kanban / claude-squad / Copilot CLI fleet / Claude Code Agent Teams) will bounce within 5 minutes. None are differentiators — they are the price of entry in May 2026.

| # | Feature | Why Expected | Complexity | Notes |
|---|---------|--------------|------------|-------|
| TS-01 | **Parallel agents running concurrently** | The whole point of "orchestrator" vs "single Claude session"; every competitor does it | MEDIUM | Already mapped to CORE-01/04. PTY per Worker; cap parallelism by CPU/RAM. |
| TS-02 | **Per-Worker terminal view (real PTY output)** | Set by golutra as the bar; swarm-ide's lack of real CLI is its #1 critique | HIGH | UI-03 + UI-04. xterm.js + ANSI passthrough; must render Claude Code's ASCII logo, permission prompts, diff cards intact. |
| TS-03 | **Chat with the Master ("dispatcher" surface)** | All tools have it (Claude Code, Copilot /fleet, vibe-kanban, swarm-ide); humans want one conversational mouth | MEDIUM | UI-01 chat side. Streaming markdown, code blocks, diff blocks. |
| TS-04 | **Per-session / per-Worker token + cost meter** | Claude Code Agent Teams ships token budget; users panicked by "9.82 GB / runaway token" stories | LOW | UI-07 global + UI-02 per node. Read from PTY stderr / `/cost` polling. |
| TS-05 | **Git worktree per Worker for parallel coding** | "Single biggest unlock" — Trigger.dev, Shipyard, Claude Code docs all converge on this | MEDIUM | CORE-03 isolated mode. Reuse `git worktree add` + auto-branch naming. |
| TS-06 | **Per-Worker status (idle / running / waiting / done / error)** | golutra / Copilot fleet / vibe-kanban all show this; users need at-a-glance pulse | LOW | UI-02 node colors. Drive from PTY exit + heartbeat. |
| TS-07 | **Kill / abort a runaway Worker** | Users will not adopt anything where they can't stop a hallucinating agent | LOW | CORE-05. SIGTERM→5s→SIGKILL with environment cleanup. |
| TS-08 | **Resume / reconnect after closing UI tab** | Web app expectation; Worker shouldn't die because you closed the browser | MEDIUM | INFRA-03 pty_chunks replay; WebSocket reconnect. |
| TS-09 | **Persistent conversation history** | Every chat tool has this; expected since ChatGPT | LOW | INFRA-02 conversations + messages tables. |
| TS-10 | **Cross-platform (mac / linux / windows)** | golutra proved Windows matters; alpha-only-Mac = lose half the audience | HIGH | INFRA-07. ConPTY + path short-name; node-pty handles most. |
| TS-11 | **"Show me what the agent is doing"** (file / command / current step) | Cited as the #1 trust-builder in every 2026 multi-agent UX review | MEDIUM | UI-05 Thinking drawer covers Master; per-Worker terminal covers Workers. |
| TS-12 | **No extra API key / signup** | Set by Claude Code itself; users won't re-pay; ruflo's "self-hosted" framing assumes this | LOW | Use user's existing `claude` / `codex` login. CONSTRAINT-level guarantee. |
| TS-13 | **MIT / permissive open source** | golutra (BSL) gets criticized; ruflo's MIT cited as adoption driver | LOW | License decision already made. |

### Differentiators (Competitive Advantage)

Where Agenstrix wins or loses against the field. Must be visibly better than the closest competitor on each axis or it's not a differentiator.

| # | Feature | Value Proposition | Complexity | Notes |
|---|---------|-------------------|------------|-------|
| DF-01 | **Autonomous Master is a real `claude` CLI in PTY** | Unique combination — swarm-ide has autonomous Master but fake CLI; golutra has real CLI but no autonomous Master; nobody else has both | HIGH | CORE-01 + CORE-02. Plugin injection via MCP. The #1 differentiator; if this doesn't work, project has no story. |
| DF-02 | **Zero-config smart workspace (drag a folder, it just works)** | No competitor does this — all ask "what's your start command? what port? what's the test command?" | HIGH | WS-01 to WS-09. The "wow" moment. Must work on 90%+ of common stacks (Next.js / Vite / FastAPI / Django / Express / Go) on first try. |
| DF-03 | **Worker dependency graph with auto-merge / service start** | Composio ao has worktree but no dep graph; Copilot fleet is flat parallel; golutra is user-as-orchestrator | HIGH | CORE-07. Master declares deps; runtime waits + auto-actions. Visualized in topology (UI-01). |
| DF-04 | **Service-as-first-class** (dev servers auto-started/stopped between Workers) | Multi-repo coordination via running services is the demo unlock; nobody else makes this an orchestrator primitive | MEDIUM | SVC-01 to SVC-05. Master tool: `start_service` / `stop_service`. |
| DF-05 | **Built-in chrome-devtools-mcp for E2E test Workers** | vibe-kanban, conductor, claude-squad all assume "you bring your own MCP"; Agenstrix preloads the high-value one | LOW | MCP-02 + MCP-04. Ship the npm package as a default; surface `no-worktree` mode for test Worker. |
| DF-06 | **Dual view: chat side ↔ topology side, single key toggle** | swarm-ide has Agent-Graph but no real terminal underneath; golutra has terminals but no graph | MEDIUM | UI-01. react-flow + view-state in URL hash for shareable links. |
| DF-07 | **In-chat workspace correction ("change the start command to X")** | Competitors send you to a settings panel or yaml; Agenstrix learns from the same chat surface | MEDIUM | WS-09 + WS-06 failure-fallback dialog. Master tool: `update_learned_command`. |
| DF-08 | **Multi-CLI from day one (Claude Code AND Codex in same workflow)** | claude-squad is Claude-only; vibe-kanban supports both but doesn't mix in one task graph | MEDIUM | CORE-06. Worker type field; per-CLI prompt adapter. |
| DF-09 | **Topology view shows dependency wait-lines (not just edges)** | A wait edge ("W2 blocked on W1") is the missing piece in every existing graph visualization | LOW | UI-02. Different stroke style + animated dash for waiting edges. |
| DF-10 | **PTY byte stream fully persisted + replayable** | Time-travel debugging of agent decisions; only Copilot fleet hints at this and it's session-scoped | MEDIUM | INFRA-03. Chunked storage; xterm.js replay mode. |
| DF-11 | **One binary install via Bun `--compile`** | Tauri sidecar v2; competitors require Node + dependencies dance | MEDIUM | Bun-side build pipeline. Distinguishes vs ruflo's "alpha, run from source." |

### Anti-Features (Commonly Requested, Often Problematic)

Features that look like wins but actively damage Agenstrix's positioning. Most have a doc-trail of failed competitors.

| # | Feature | Why Requested | Why Problematic | Alternative |
|---|---------|---------------|-----------------|-------------|
| AF-01 | **YAML / JSON workspace config files** | "Configurability! reproducibility! GitOps!" — appeals to ops mindset | Direct violation of core promise. Once you add `agenstrix.yaml`, the "drag folder" magic dies and you compete with Composio ao on its turf | SQLite-backed config (WS-07); chat / UI edits; export to portable `.agenstrix-pack` only |
| AF-02 | **User auth / multi-tenant accounts** | "We want to share with my team," "let me invite a friend" (golutra has it) | Forces you to be a SaaS, not a tool. Adds DB schema bloat, password reset flows, billing surface. golutra's "Friend Invite" is dead weight without Auth | self-host model assumes trusted single user / team; share by sharing the repo + pack file |
| AF-03 | **Cloud-hosted SaaS edition** | Recurring-revenue temptation; vibe-kanban's Bloop tried this and shut down 2026 | Conflicts with "use your own Claude subscription"; legal exposure for shipping `claude` CLI server-side; orthogonal to local-first promise | MIT + self-host; if hosting matters, contributors can fork (license permits) |
| AF-04 | **Telemetry / "anonymous" usage stats** | "We need data to improve!" | Erodes the open-source privacy contract; users in the target persona are hostile to it | Optional local-only event log (INFRA-04) that user can inspect; opt-in bug report bundles only |
| AF-05 | **Auto-merge Worker branches into main** | "Save me the merge step!" — promised by Claude Code Agent Teams | High-blast-radius mistake. Users want to review; auto-merge across multi-repo with services is begging for production-bricking | Auto-commit + auto-`worktree remove`, surface branches in topology, user merges in their normal git tool |
| AF-06 | **Self-modifying agents / auto-skill-sinkhole / auto-reflection loop** | ruflo's "self-learning" marketing; research-cool | Research problem with no shipped solution at scale; introduces non-determinism that breaks the "explainable Master" trust model | Manual Skills (ASSET-02) for v1; revisit as v3 if ecosystem solves it |
| AF-07 | **Built-in code editor / Monaco panel** | "Don't make me switch to VS Code" | Massive scope creep into IDE territory; loses focus; can never match Cursor/VS Code; users already have their editor open | Stay tool-side; open files in user's `$EDITOR` if asked; render diffs read-only |
| AF-08 | **Agent marketplace / plugin store with one-click install** | "Like VS Code extensions!" | Brings supply-chain risk + moderation burden; v3-level scope; Skills (ASSET-02) already cover the manual case | `.agenstrix-pack` portable archive (ASSET-04); GitHub-hosted curated list, no in-product store |
| AF-09 | **LLM-provider abstraction layer (OpenRouter / DeepSeek / GLM swap)** | "Cheaper inference!" — swarm-ide does this | Loses the "real Claude Code UX" guarantee; Claude Code's interactive UX is part of the product; abstraction breaks plugin/MCP integration | Stay on real `claude` / `codex` CLIs for v1; revisit post-v2 |
| AF-10 | **Voice / "talk to your agents"** | Demo-shiny | Wrong modality for code; adds STT/TTS infra; the target persona prefers keyboard | Hotkey ergonomics (Cmd+K UI-08, `@worker-N` UI-10) |
| AF-11 | **Mandatory Docker / container isolation for every Worker** | "Safer! reproducible!" | Adds 200MB+ runtime, breaks Windows DX, blocks the "uses your existing project" promise | git worktree isolation (CORE-03 isolated); container option deferred to v3 |
| AF-12 | **"Agent autonomy slider" / fully unattended runs** | "Let it work overnight" | High runaway cost risk; permission UX is where Claude Code shines and we want to preserve it | Surface Claude Code's native permission prompts via UI-03 PTY passthrough; keep human in loop |
| AF-13 | **Custom DSL for declaring workflows** | "Like GitHub Actions but for agents!" | Reintroduces yaml-by-another-name; counter to autonomous Master design | Master declares deps in tool calls (CORE-07); 4 built-in spell templates (ASSET-01) as starting patterns |

### Hidden Requirements (Silently Critical)

Features users never list in feature requests but will rage-quit if missing. Each is a known failure mode from the 2026 ecosystem research. **None of these duplicate PROJECT.md sections** — they are gaps PROJECT.md doesn't yet enumerate.

| # | Hidden Requirement | What Breaks Without It | Complexity | Notes |
|---|--------------------|------------------------|------------|-------|
| HR-01 | **Per-Worker token budget cap with auto-pause at 85%** | One Worker burns $40 in a loop; users blame Agenstrix and uninstall. Claude Code Agent Teams docs already prescribe this | LOW | Inject "stay under N tokens, pause-and-report at 85%" into Worker system prompt; enforce via `/cost` poll. **Add as new CORE requirement.** |
| HR-02 | **Master-level total budget kill-switch** | Master itself loops between Workers, consumes $200 unattended | LOW | Global session token cap + hard-stop with surfaced summary. **Add to UI-07 cost dashboard.** |
| HR-03 | **Worker reasoning-loop detection (same tool, same args, N times)** | "Why agents fail #1" — agent calls grep with identical args 50x, burns budget, no progress | MEDIUM | Hash tool calls per Worker; warn at 5 dupes; offer "interrupt and ask" |
| HR-04 | **Worker stdout backpressure / disk-full protection** | PTY chunks logged at 100KB/s × 8 Workers fills disk; Agenstrix crashes silently | LOW | Ring-buffer fallback if pty_chunks > N MB/session; alert user |
| HR-05 | **Cascading kill: killing Master kills all Workers and stops all services** | Orphaned `claude` processes after force-quit consume API credits for hours (cited failure mode) | MEDIUM | Child process group tracking; SETUP-04 enforces; honor SIGINT/SIGTERM/window close |
| HR-06 | **Port conflict resolution that asks before killing user's other dev server** | User has VS Code running their app on :3000; Agenstrix kills it silently; user loses unsaved state | LOW | SVC-05 partially covers; explicit confirmation needed; offer "use next free port" as default |
| HR-07 | **`.gitignore`-aware worktree** (don't read `.env` from main worktree into Worker context) | Secrets leak into Worker prompts → LLM logs → potential exposure | LOW | Worker spawn copies/symlinks only tracked files; explicit allowlist for `.env.local` |
| HR-08 | **Worker output truncation guard for tool returns** | "Context window overflow #1 fail mode" — `npm install` output blows context, Worker silently degrades | MEDIUM | Wrap tool outputs > N chars; offer Worker a "summarize or sample" choice |
| HR-09 | **MCP server connection pooling / rate-limiting** | "Seven sub-agents × five MCP calls in 2s = 35 requests = pool exhaustion" — documented failure | MEDIUM | MCP-01 server-side: per-server concurrency limit + queue |
| HR-10 | **First-run health check (CLI present, version OK, git OK)** | User installs Agenstrix without `claude` on PATH; gets cryptic PTY spawn error | LOW | INFRA-06 already mapped. Must give exact fix command per OS |
| HR-11 | **Worker spawn ≤ 3 seconds** | Latency is the killer of "feels real-time"; >5s and the topology view feels broken | MEDIUM | Pre-warm node-pty? At minimum, lazy-load Skills and stream "spawning" state |
| HR-12 | **Diff before destructive Master action** | Master decides to delete a workspace / Skill / Worker; user wasn't watching | LOW | UI-06 covers basics; expand to show "Master is about to: …" with 5s undo |
| HR-13 | **Crash recovery — reopen and see exact state from 30s ago** | App crash mid-run; user re-opens to empty UI; loses confidence | MEDIUM | INFRA-04 event sourcing makes this possible; needs `restore_session` on startup |
| HR-14 | **"What is this Worker doing right now?" — last 3 actions surfaced on hover** | Topology graph hover should not require clicking into PTY drawer to know status | LOW | Cache last 3 tool calls per Worker; show in node tooltip |
| HR-15 | **Worktree cleanup on Worker crash (not just on graceful exit)** | Disk fills with abandoned worktrees after a week; "9.82 GB" anecdote | LOW | Crash-time hook; also a startup-time garbage collector for `<repo>/.git/worktrees` |
| HR-16 | **Concurrent Worker write to same file** (Workers on different worktrees for same repo) | Two Workers edit same file; both auto-commit; merge conflict surprises user | LOW | Worker brief includes "your file scope"; topology shows file overlap warnings |
| HR-17 | **Service "ready" detection** (port open ≠ app accepting requests) | Master spawns test Worker too early; Worker hits 502; reports test failure that's really a race | LOW | SVC-03 health check needs HTTP 2xx, not just port-open |
| HR-18 | **Per-Worker working-directory cwd is the worktree, not project root** | Worker runs `pnpm install` in main repo, races with user | LOW | Spawn env enforcement; integration test |
| HR-19 | **Master can read its own Worker logs after Worker exits** | Master decides next step based on what W1 did; needs accessible log artifact, not just "exit code 0" | LOW | After Worker exit, dump summary (last 50 PTY lines + final commit msg) into a tool the Master can call |
| HR-20 | **Web app handles 8+ concurrent xterm.js viewports without melting browser** | Tab with 8 terminals + topology + chat = 100% CPU on mid laptops | MEDIUM | xterm.js with WebGL renderer; lazy-mount inactive terminals |

---

## Onboarding Moment ("Magic in 5 Minutes")

This is the single most important feature gauntlet. If any of these breaks, the user does not become a return user.

### The 5-Minute Gauntlet (in order)

| t+ | Event | Required Features | "Wow" Tax If Missing |
|----|-------|-------------------|----------------------|
| 0:00 | User runs `bunx agenstrix` or opens single binary | SETUP-01 health check, TS-12 no signup | If asked for an account → close. Lose user. |
| 0:30 | UI loads; sees drop-zone for folder | UI-11 workspace bar with drag heat-zone | If sees a yaml editor or "create project" wizard → close. Lose user. |
| 1:00 | User drags `myapp-frontend/` (Next.js) | WS-01 drag, WS-02 identify, WS-03 start cmd, WS-04 port | If asked "what's your start command?" → close. Lose. |
| 1:30 | Agenstrix shows "Detected: Next.js + pnpm + port 3000. Trying to start dev server…" | SVC-01 + WS-05 trial start | This text alone is the wow. Quote it. Print it. |
| 2:00 | Green dot appears next to repo: service is up | SVC-04 status display | If red dot with no suggestion → losing user. **HR-17 ready check matters.** |
| 2:15 | User drags `myapp-backend/` (FastAPI) | Same WS-* | Multi-repo handled = "this is different." |
| 2:45 | User types: "add a user-registration feature, frontend form + backend API + e2e test" | TS-03 chat | Standard. |
| 3:00 | Master starts thinking; UI shows "Master is planning…" with streamed reasoning | UI-05 Thinking drawer | This is the swarm-ide "not a black box" lift. **Critical.** |
| 3:15 | Topology view auto-opens (or "Switch to topology" prompt) with 3 Worker placeholders + dependency arrows | UI-01 topology, UI-02 nodes, DF-09 wait-edges | The "we're really doing it" moment. The single screenshot that sells the product. |
| 3:45 | Worker-1 (backend) spawns, node turns blue, user clicks node | TS-02 PTY drawer, HR-11 fast spawn | Real `claude` ASCII logo + diff cards = "this is real claude code." |
| 4:30 | Worker-1 finishes; Master auto-starts backend dev server (green dot blinks); Worker-2 (frontend) spawns | DF-03 dep graph, DF-04 service auto-start | This is the demo. Nobody else does this end-to-end. |
| 5:00 | Cost meter shows $0.18 spent; both Workers running | TS-04 cost meter | Reassurance moment — "this is not going to bankrupt me." |

### Onboarding-Critical Feature Cluster

These features MUST work on day 1 of v1 (cannot defer):

1. **TS-12 no signup** (gate 0)
2. **WS-01 drag-drop** (gate 1)
3. **WS-02 + WS-03 + WS-04 smart detect** for at least Next.js + FastAPI + Express + Vite (gate 1.5) — the demo stack
4. **WS-05 trial start + WS-06 failure fallback** (gate 2 — failure here without good fallback = lose)
5. **CORE-01 real `claude` Master** (gate 3 — the whole story collapses if this isn't real)
6. **UI-05 Master Thinking drawer** (gate 3 — black-box Master loses trust immediately)
7. **UI-01 topology + UI-02 nodes + DF-09 wait edges** (gate 3.15 — the screenshot moment)
8. **CORE-04 real Worker PTY + UI-03 drawer** (gate 3.45 — proves the "real CLI" claim)
9. **DF-03 dep graph runtime + DF-04 service auto-start** (gate 4.30 — proves orchestration > just-parallel-agents)
10. **TS-04 cost meter** (gate 5 — bankruptcy fear management)

If any of these 10 ship broken, the onboarding fails. Roadmap must front-load all 10 into the same milestone (call it "Demo-able Loop").

### Onboarding Anti-Pattern to Avoid

- **Tutorial overlays / coachmarks** — the target persona (CLI users) skips them. The product should be self-explanatory through smart defaults.
- **Sample project / "try with demo repo"** — feels like training wheels; users want to point at their real repos.
- **Settings panel before first run** — settings should be discoverable later via Cmd+K, never blocking.

---

## Feature Dependencies

```
[CORE-01 real claude Master in PTY]
    └──requires──> [INFRA-07 cross-platform PTY (ConPTY on Windows)]
    └──requires──> [SETUP-01 CLI detection]

[CORE-02 MCP plugin injection]
    └──requires──> [CORE-01]
    └──requires──> [MCP-01 Agenstrix as MCP server]

[CORE-07 dependency graph runtime]
    └──requires──> [CORE-03 worker environment modes]
    └──requires──> [SVC-02 master service control]
    └──enhanced-by──> [UI-01 topology view] [DF-09 wait-edges]

[WS-05 trial-start + auto-learn]
    └──requires──> [WS-02 identify] [WS-03 start cmd] [WS-04 port]
    └──requires──> [SVC-01 service abstraction]
    └──requires──> [WS-07 SQLite persistence]
    └──enhanced-by──> [WS-06 failure-fallback chat]

[UI-03 Worker PTY drawer]
    └──requires──> [CORE-04 worker real CLI in PTY]
    └──requires──> [INFRA-03 pty_chunks persistence] (for replay)
    └──enhances──> [HR-13 crash recovery]

[UI-02 node status badges]
    └──requires──> [CORE-04 worker lifecycle events]
    └──enhanced-by──> [HR-14 last-3-actions hover]

[HR-01 per-worker token cap]
    └──requires──> [CORE-04 worker spawn with prompt injection]
    └──enhances──> [UI-07 cost dashboard]

[HR-05 cascading kill]
    └──requires──> [CORE-05 kill semantics]
    └──requires──> [SETUP-04 graceful exit]
    └──conflicts-with──> [HR-15 worktree cleanup on crash]
        (must be coordinated — both run on exit/crash, ordering matters)

[DF-04 service auto-start between Workers]
    └──requires──> [SVC-01] [SVC-02] [SVC-03] [CORE-07]
    └──requires──> [HR-17 ready detection (not just port open)]

[ASSET-02 Skill auto-injection]
    └──requires──> [CORE-04 worker spawn]
    └──no-conflict──> [ASSET-01 spell templates]

[MCP-02 chrome-devtools-mcp]
    └──requires──> [MCP-01 mcp client mode in Agenstrix]
    └──enables──> [MCP-04 test worker scenario]
    └──requires──> [CORE-03 no-worktree mode]
```

### Dependency Notes

- **CORE-01 (real Master) is the trunk of everything.** If PTY-wrapped real `claude` doesn't work, Agenstrix has no story. Roadmap Phase 1.
- **WS-05 trial-start is the "smart" claim's load-bearing wall.** All WS-0X feed into it; without it the auto-magic is wishful thinking.
- **DF-04 service auto-start is the integration test for orchestration.** Requires service, dependency graph, and the ready-check to all line up. This is the demo's high-wire act.
- **HR-05 (cascading kill) and HR-15 (worktree cleanup) interact on exit.** Order must be: stop accepting new spawn → kill Workers → wait commits → remove worktrees → stop services → save state. Get this wrong and you orphan processes or lose work.
- **UI-03 PTY drawer depends on real PTY (CORE-04).** Cannot start UI-03 implementation until CORE-04 is byte-stream-clean.

---

## Feature Prioritization Matrix

### P1 — Must have for v1 launch (the "Demo-able Loop")

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| CORE-01 real claude Master in PTY | HIGH | HIGH | **P1** |
| CORE-02 MCP plugin tool injection | HIGH | MEDIUM | **P1** |
| CORE-03 worker environment modes (isolated + no-worktree at minimum) | HIGH | HIGH | **P1** |
| CORE-04 real Worker PTY (claude + codex) | HIGH | HIGH | **P1** |
| CORE-05 SIGTERM→SIGKILL kill | HIGH | LOW | **P1** |
| CORE-07 dependency graph runtime | HIGH | HIGH | **P1** |
| WS-01..09 smart workspace stack (full) | HIGH | HIGH | **P1** |
| SVC-01..05 service primitives (full) | HIGH | MEDIUM | **P1** |
| UI-01 dual-view (chat + topology) | HIGH | MEDIUM | **P1** |
| UI-02 node status + cost on node | HIGH | LOW | **P1** |
| UI-03 worker PTY drawer | HIGH | HIGH | **P1** |
| UI-05 Master thinking drawer | HIGH | MEDIUM | **P1** |
| UI-07 global cost meter | HIGH | LOW | **P1** |
| UI-11 workspace bar + dropzone | HIGH | LOW | **P1** |
| MCP-01 Agenstrix as MCP server | HIGH | MEDIUM | **P1** |
| MCP-02 built-in chrome-devtools-mcp | HIGH | LOW | **P1** |
| INFRA-02 SQLite + Drizzle full schema | HIGH | MEDIUM | **P1** |
| INFRA-03 PTY persistence | MEDIUM | MEDIUM | **P1** |
| INFRA-06 startup health check | HIGH | LOW | **P1** |
| INFRA-07 cross-platform (mac/linux/win) | HIGH | HIGH | **P1** |
| SETUP-01 CLI detection wizard | HIGH | LOW | **P1** |
| SETUP-04 graceful exit | HIGH | MEDIUM | **P1** |
| **HR-01 per-worker token cap** | HIGH | LOW | **P1** (new) |
| **HR-02 master budget kill-switch** | HIGH | LOW | **P1** (new) |
| **HR-05 cascading kill** | HIGH | MEDIUM | **P1** (new) |
| **HR-07 .gitignore-aware worktree** | HIGH | LOW | **P1** (new) |
| **HR-10 first-run health check messaging** | HIGH | LOW | **P1** (new — strengthens INFRA-06) |
| **HR-11 worker spawn ≤ 3s** | MEDIUM | MEDIUM | **P1** (perf budget) |
| **HR-15 worktree cleanup on crash** | MEDIUM | LOW | **P1** (new) |
| **HR-17 service ready detection (HTTP 2xx)** | HIGH | LOW | **P1** (new — strengthens SVC-03) |
| **HR-18 worker cwd enforcement** | MEDIUM | LOW | **P1** (new) |
| **HR-19 worker exit summary tool** | MEDIUM | LOW | **P1** (new) |

### P2 — Should have, add when possible (v1.1 – v1.3)

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| UI-04 keyboard injection into worker stdin | MEDIUM | LOW | P2 |
| UI-06 confirm destructive actions | MEDIUM | LOW | P2 (security-critical bumpable to P1) |
| UI-08 Cmd+K global search | MEDIUM | MEDIUM | P2 |
| UI-09 dark/light theme | MEDIUM | LOW | P2 |
| UI-10 `@worker-N` mention syntax | MEDIUM | LOW | P2 |
| ASSET-01 4 built-in spell templates | MEDIUM | LOW | P2 |
| ASSET-02 Skill auto-injection | MEDIUM | MEDIUM | P2 |
| ASSET-03 custom templates | MEDIUM | LOW | P2 |
| ASSET-04 .agenstrix-pack import/export | MEDIUM | MEDIUM | P2 |
| MCP-03 custom MCP server config | MEDIUM | LOW | P2 |
| MCP-04 explicit test-worker pattern | MEDIUM | MEDIUM | P2 |
| INFRA-01 i18n (zh-CN + en) | MEDIUM | MEDIUM | P2 |
| INFRA-04 event sourcing | MEDIUM | MEDIUM | P2 |
| INFRA-05 pino logs | MEDIUM | LOW | P2 |
| SETUP-03 settings panel | MEDIUM | LOW | P2 |
| SETUP-02 workspace add via button/CLI flag | LOW | LOW | P2 |
| HR-03 reasoning-loop detection | HIGH | MEDIUM | P2 |
| HR-04 PTY backpressure | MEDIUM | LOW | P2 |
| HR-06 port conflict UX (confirm before kill) | HIGH | LOW | P2 |
| HR-08 tool output truncation guard | MEDIUM | MEDIUM | P2 |
| HR-09 MCP rate limiting | MEDIUM | MEDIUM | P2 |
| HR-12 Master destructive action diff | MEDIUM | LOW | P2 |
| HR-13 crash recovery | HIGH | MEDIUM | P2 |
| HR-14 worker hover tooltip with last 3 actions | MEDIUM | LOW | P2 |
| HR-16 file-overlap warnings | MEDIUM | LOW | P2 |
| HR-20 8+ concurrent xterm.js performance | MEDIUM | MEDIUM | P2 |

### P3 — Future (v2+)

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Tauri desktop packaging | HIGH | MEDIUM | P3 (v2) |
| Gemini CLI / OpenCode support | MEDIUM | MEDIUM | P3 (v2) |
| Multi-workspace switching | MEDIUM | MEDIUM | P3 (v2) |
| Worker hang auto-restart | MEDIUM | MEDIUM | P3 (v2) |
| Dry-run mode | LOW | MEDIUM | P3 (v2) |
| Time-travel debugging UI | MEDIUM | HIGH | P3 (v2) |
| Group-chat mode (multiple workers + human in one channel) | MEDIUM | HIGH | P3 (v2/v3) |
| Auto-reflection / Skill auto-distillation | HIGH | HIGH | P3 (v3, research) |
| Topology self-adaptation | MEDIUM | HIGH | P3 (v3) |
| Long-running "AI company" mode | LOW | HIGH | P3 (v3) |
| Container-isolated Workers | MEDIUM | MEDIUM | P3 (v3) |
| Mobile PWA monitoring | LOW | MEDIUM | P3 (v3) |
| MCP plugin marketplace | LOW | HIGH | P3 (v3) |
| LLM-provider abstraction | LOW | MEDIUM | P3 (v3+) — likely never |

---

## Competitor Feature Analysis

| Feature / Capability | golutra | swarm-ide | Composio ao | ruflo | AWS CAO | claude-squad | vibe-kanban | Copilot CLI /fleet | Claude Code Agent Teams | **Agenstrix** |
|---|---|---|---|---|---|---|---|---|---|---|
| Real interactive CLI in PTY | YES | NO (LLM API) | YES | YES | YES (tmux) | YES | YES | YES | YES | **YES** (CORE-01/04) |
| Autonomous Master agent | NO (user-as-orch) | YES | NO | NO | NO | NO | NO | NO | YES | **YES** (CORE-01) |
| Real-CLI Master AND autonomous | NO | NO | NO | NO | NO | NO | NO | NO | partial | **YES — only one** |
| Multi-CLI mix in one workflow | YES | n/a | YES | YES | YES | NO (Claude only) | YES | NO (Copilot only) | NO (Claude only) | **YES** (CORE-06) |
| Worker dependency graph | NO | partial | NO | NO | NO | NO | NO | NO | partial (task list) | **YES** (CORE-07) |
| Topology / graph view | NO | YES | YES (dashboard) | NO | NO | NO | partial (kanban) | NO | NO | **YES** (UI-01) |
| Real per-worker PTY drawer | YES | NO | partial | YES | tmux attach | YES | YES | partial | terminal-only | **YES** (UI-03) |
| Smart project type detection | NO | NO | NO | NO | NO | NO | NO | NO | NO | **YES** (WS-02) |
| Auto-detect start command + port | NO | NO | NO | NO | NO | NO | NO | NO | NO | **YES** (WS-03/04) |
| Trial-start with fallback dialog | NO | NO | NO | NO | NO | NO | NO | NO | NO | **YES** (WS-05/06) |
| Zero yaml/JSON config promise | NO | YES | NO | NO | YES (config) | YES | partial | YES | YES | **YES (enforced)** |
| Service as first-class | NO | NO | NO | NO | NO | NO | NO | NO | NO | **YES** (SVC-*) |
| Multi-repo workspace | partial | NO | YES | YES | YES | NO | NO | NO | NO | **YES** (WS-08) |
| Built-in browser MCP for test | NO | NO | NO | NO | NO | NO | NO | NO | NO | **YES** (MCP-02) |
| Per-worker cost meter | partial | YES | YES | NO | NO | YES | YES | YES | YES | **YES** (UI-02) |
| Per-worker token budget cap | NO | NO | NO | NO | NO | NO | NO | NO | YES | **YES** (HR-01) |
| Cascading kill | partial | partial | YES | partial | partial | partial | YES | YES | YES | **YES** (HR-05) |
| Cross-platform incl. Windows | YES | YES (web) | YES | partial | NO | partial | partial | YES | YES | **YES** (INFRA-07) |
| Open source | YES (BSL) | YES (no license) | YES (MIT) | YES (MIT) | YES (Apache) | YES | YES (community) | partial | NO | **YES (MIT)** |
| Self-host without account | YES | YES | YES | YES | YES | YES | YES | partial | NO | **YES** |

**Reading the matrix:** the four cells where Agenstrix is the ONLY checkmark are the moat:
1. Smart workspace detection (WS-02..06)
2. Real-CLI Master + Autonomous (CORE-01 + CORE-02)
3. Service-as-first-class with auto-start (SVC + DF-04)
4. Built-in browser MCP for test Workers (MCP-02)

Roadmap should treat these as the "if these slip, ship date slips" features.

---

## Recommended Roadmap Implications

Synthesizing for the roadmapper:

### Phase A (foundation — ~30% of v1 effort)
Cross-platform PTY (INFRA-07), SQLite schema (INFRA-02), real `claude` in PTY (CORE-01), real Worker spawn (CORE-04 minimal), kill semantics (CORE-05), MCP server skeleton (MCP-01), CLI detection (SETUP-01), graceful exit foundation (SETUP-04 + HR-05). **No UI yet beyond a working backend smoke test.**

### Phase B (smart workspace — ~25% of v1 effort)
WS-01..09 in full + SVC-01..05 + HR-17. This is the differentiator nobody else has and the onboarding moment. **Ship this before any topology view work.**

### Phase C (dual-view UI — ~25% of v1 effort)
UI-01 + UI-02 + UI-03 + UI-05 + UI-07 + UI-11. The visible product. Built on top of working A + B.

### Phase D (orchestration — ~15% of v1 effort)
CORE-02 plugin tools + CORE-03 four modes + CORE-07 dep graph + DF-04 service auto-start + MCP-02 chrome-devtools. The "demo works end-to-end" phase.

### Phase E (production polish — ~5% of v1 effort)
Remaining P1 hidden requirements (HR-01/02/07/10/11/15/18/19) + INFRA-06 startup health + cross-platform validation.

**Phase ordering rationale:** A enables everything; B is the unique-value gate (delay loses the story); C is the visible product; D is what makes the demo work; E is what stops it crashing in front of users.

---

## Sources

Competitor / ecosystem references (cross-validated):

- [AWS CLI Agent Orchestrator](https://github.com/awslabs/cli-agent-orchestrator) — tmux-based CLI orchestration paradigm
- [Composio agent-orchestrator](https://github.com/ComposioHQ/agent-orchestrator) — multi-CLI + worktree + dashboard, no autonomous Master
- [ruvnet/ruflo](https://github.com/ruvnet/ruflo) — multi-CLI + RAG (not real self-learning)
- [golutra/golutra](https://github.com/golutra/golutra) — Tauri PTY-based, user-as-orchestrator
- [chmod777john/swarm-ide](https://github.com/chmod777john/swarm-ide) — autonomous Master, fake CLI (LLM API direct)
- [Claude Code Agent Teams docs](https://code.claude.com/docs/en/agent-teams) — token budgets, coordination patterns, "stay under N tokens" prompt convention
- [GitHub Copilot /fleet](https://github.blog/ai-and-ml/github-copilot/run-multiple-agents-at-once-with-fleet-in-copilot-cli/) — teammate cycling UX, expandable per-agent panels
- [BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban) — kanban dispatcher, "doomscrolling gap" insight (Bloop shut down 2026, project continues)
- [affaan-m/claude-swarm](https://github.com/affaan-m/claude-swarm) — terminal-UI multi-agent
- [Claude Code Worktrees Guide 2026](https://www.claudedirectory.org/blog/claude-code-worktrees-guide) — worktree disk usage anecdotes ("9.82 GB")
- [Trigger.dev: We ditched worktrees for Claude Code](https://trigger.dev/blog/parallel-agents-gitbutler) — worktree pain points
- [Shipyard: Multi-agent orchestration for Claude Code in 2026](https://shipyard.build/blog/claude-code-multi-agent/) — orchestration patterns and tradeoffs
- [MindStudio: Claude Code Agent View](https://www.mindstudio.ai/blog/what-is-claude-code-agent-view) — per-agent visibility expectations
- [AddyOsmani: The Code Agent Orchestra](https://addyosmani.com/blog/code-agent-orchestra/) — what makes multi-agent coding work
- [htdocs.dev: Conductor to Orchestrator 2026](https://htdocs.dev/posts/from-conductor-to-orchestrator-a-practical-guide-to-multi-agent-coding-in-2026/) — conductor vs orchestrator model
- [Nimbalyst: Best Multi-Agent Coding Tools 2026](https://nimbalyst.com/blog/best-multi-agent-coding-tools-2026/) — feature comparison across the field
- [Nimbalyst: Vibe Kanban Alternatives 2026](https://nimbalyst.com/blog/best-vibe-kanban-alternatives-2026/) — Bloop shutdown and SaaS-orchestrator failure
- [Qubytes: Fan-Out Agent Pipeline Failure Modes](https://qubytes.substack.com/p/fan-out-agent-pipeline-production-failure-modes) — MCP rate-limiting failure pattern
- [Dev.to: Why AI Agents Fail — 3 Failure Modes](https://dev.to/aws/why-ai-agents-fail-3-failure-modes-that-cost-you-tokens-and-time-1flb) — reasoning loops, context overflow, orphan agents
- [arXiv: Failures in Platform-Orchestrated Agentic Workflows](https://arxiv.org/html/2509.23735v2) — cancellation propagation failures
- [MindStudio: Vibe Kanban vs Paperclip vs Dispatch](https://www.mindstudio.ai/blog/vibe-kanban-vs-paperclip-vs-claude-code-dispatch-comparison) — three orchestration philosophies

---
*Feature research for: multi-agent CLI orchestrator with smart workspace (Agenstrix v1)*
*Researched: 2026-05-17*
