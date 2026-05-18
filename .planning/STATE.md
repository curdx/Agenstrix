---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
last_updated: "2026-05-18T03:22:42.219Z"
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 6
  completed_plans: 0
  percent: 0
---

# Project State: Agenstrix

**Last updated:** 2026-05-17

This file is the **project memory**: a single-source-of-truth pointer to the current position in the roadmap, accumulated context, and session continuity. It evolves at every phase transition, plan start/finish, and milestone boundary.

---

## Project Reference

- **Project:** Agenstrix — multi-agent CLI orchestrator (autonomous real-`claude` Master + real-CLI Workers + smart workspace)
- **Core Value:** 一个人坐在 Agenstrix 前对话，背后是一个自主调度多个真实 `claude` / `codex` 终端并行干活的 AI 团队 —— 用户的 CLI 订阅天然就能用，配置全部自动推断，零额外计费门槛、零 yaml。
- **Project doc:** `.planning/PROJECT.md`
- **Requirements doc:** `.planning/REQUIREMENTS.md` (65 v1 requirements, 100% mapped to phases)
- **Roadmap doc:** `.planning/ROADMAP.md` (5 phases, vertical MVP)
- **Research:** `.planning/research/SUMMARY.md` + `STACK.md` + `FEATURES.md` + `ARCHITECTURE.md` + `PITFALLS.md`
- **Current focus:** Phase 01 — first-pty-demo

---

## Current Position

Phase: 01 (first-pty-demo) — EXECUTING
Plan: 1 of 6

- **Active phase:** Phase 1 — First PTY Demo (context gathered)
- **Active plan:** None
- **Status:** Executing Phase 01
- **Resume file:** `.planning/phases/01-first-pty-demo/01-CONTEXT.md`
- **Progress:** ▱▱▱▱▱ 0 / 5 phases complete

| Phase | Status |
|-------|--------|
| 1. First PTY Demo | Context gathered |
| 2. Smart Workspace Demo | Not started |
| 3. Master + Worker Demo | Not started |
| 4. Topology + Multi-Worker Demo | Not started |
| 5. Production Polish | Not started |

---

## Performance Metrics

(Populated as phases ship)

- **Plans completed:** 0
- **Requirements satisfied:** 0 / 65
- **Phases shipped:** 0 / 5
- **Code review pass rate:** n/a
- **Average plan duration:** n/a

---

## Accumulated Context

### Key Decisions Already Made (frozen by PROJECT.md + research)

- **PTY library:** `Bun.Terminal` (default, Bun 1.3.14+) + `bun-pty` (FFI fallback behind `PtyHandle` interface). **Never** `node-pty`.
- **DB:** Drizzle ORM `^0.45.2` (stable) + `drizzle-kit@^0.31.10` + `bun:sqlite` + WAL + foreign_keys ON.
- **Frontend:** React 19 + Vite 8 + Tailwind v4 CSS-first (`@theme` + `@tailwindcss/vite`) + shadcn/ui v4 + `tw-animate-css` (not `tailwindcss-animate`) + `@xterm/xterm@^6` (scoped) + `@xyflow/react@^12`.
- **MCP:** stdio bridge subprocess pattern; HTTP transport as fallback design only.
- **Zero-config principle:** all workspace / service / learned commands / start commands live in SQLite — no yaml / no JSON user config files.
- **Worker environment modes:** `isolated` / `inherit:<id>` / `merged:[ids]` / `no-worktree` — Master decides internally; user never sees the choice.

### Open Questions to Resolve During Build

- Q1 (Phase 3): Claude Code MCP config discovery order — `CLAUDE_MCP_CONFIG` env var vs `.claude.json`
- Q2 (Phase 1): `Bun.Terminal` Windows 10 1809+ ASCII logo / diff card / permission prompt byte-perfect rendering
- Q3 (Phases 1 + 4): `simple-git` reliability under heavy parallel `git worktree add` with per-repo serialization
- Q4 (Phase 2): per-framework HTTP health-check endpoint ground truth (Vite / Next / Express / FastAPI / Django)
- Q5 (Phase 3): Claude Code MCP tool-call event surface — enough structured data for UI-05 real-time?
- Q6 (Phase 3 ship): $5 default session budget — refine via GitHub feedback
- Q7 (Phases 2 + 3): `chrome-devtools-mcp@^0.26.0` stability as built-in
- Q8 (Phase 3): `codex` Worker MCP wiring — does `--mcp-config` work identically to `claude`?
- Q9 (Phase 1): `Bun.Terminal` `data` callback firing before `Bun.spawn` returns (early-byte race)
- Q10 (Phase 3): Claude Code's own session context location (`~/.claude/`) — affects Master-resume amnesia mitigation

### Todos / Carry-overs

- Update PROJECT.md `Constraints` and `Key Decisions` to reflect the 7 stack corrections from SUMMARY.md §2 (PTY library / Drizzle pin / xterm scoped / Tailwind v4 CSS-first / Tauri sidecar recipe / Windows 10 1809+ floor / Biome 2.x). Should happen in same PR as Phase 1 kickoff.
- REQUIREMENTS.md `## Coverage` block says "v1 requirements: 64 total" but the traceability table lists 65 IDs — flag for next REQUIREMENTS update; possibly miscounted line.

### Blockers

None.

---

## Session Continuity

### What was done in the last session

- Created `.planning/ROADMAP.md` with 5 vertical-MVP phases.
- Created `.planning/STATE.md` (this file).
- Backfilled `.planning/REQUIREMENTS.md` Traceability table — all 65 v1 requirement IDs now mapped to exactly one phase.

### What should happen next

1. User reviews `.planning/ROADMAP.md` and signs off on phase structure / success criteria.
2. Run `/gsd:plan-phase 1` to decompose Phase 1 ("First PTY Demo") into 1-3 plans.
3. Phase 1 needs `research-phase` flag honored: run research subagent on Bun.Terminal Windows ConPTY behavior + `bun-pty` fallback wiring + ANSI splitter edge cases **before** plan-check.

### Files I should remember

- `.planning/PROJECT.md` — core value + 32 key decisions + multi-repo demo scenario
- `.planning/REQUIREMENTS.md` — 65 v1 reqs with acceptance criteria + source citations + filled traceability
- `.planning/ROADMAP.md` — 5 phases with goal-backward success criteria + risk-defense distribution
- `.planning/research/SUMMARY.md` — TL;DR + 6-phase tech-layer ordering + top-5 risks + 10 open questions
- `.planning/research/STACK.md` — locked stack + critical Bun.Terminal vs node-pty finding + Tauri sidecar recipe
- `.planning/research/FEATURES.md` — table stakes / differentiators / anti-features / HR-01..HR-20 hidden requirements / 5-minute onboarding gauntlet
- `.planning/research/ARCHITECTURE.md` — 8 modules + 3 worked data flows + 11-step graceful shutdown
- `.planning/research/PITFALLS.md` — 20 pitfalls + Top-5 + per-pitfall phase tags

---

*State file initialized at roadmap creation. Update at every phase transition.*
