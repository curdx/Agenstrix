# Agenstrix

多智能体 CLI 编排应用 — 自主 Master + 真 PTY 多 CLI Worker + 智能 workspace

> _Phase 1 work-in-progress: Walking Skeleton + real `claude` PTY in the browser._

![CI](https://github.com/wdx/Agenstrix/actions/workflows/ci.yml/badge.svg)

## What is this?

Agenstrix runs a real interactive `claude` CLI on your machine as the "Master" and lets it autonomously
spawn more `claude` / `codex` workers in independent git worktrees. You drag a few project folders into
Agenstrix and it auto-detects everything — no config files.

See [.planning/PROJECT.md](./.planning/PROJECT.md) for the full vision.

## Quickstart (Phase 1)

Prereqs:

- **Bun** >= 1.3.14 — `curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14"`
- **Node** >= 20 (for Vite tooling)
- **git** on PATH
- **claude** CLI on PATH — `npm install -g @anthropic-ai/claude-code`
- **Platforms:** macOS, Linux, Windows 10 1809+ (Windows requires Bun.Terminal ConPTY, shipped 2026-05-13 in Bun 1.3.14)

Install + run:

    git clone <repo>
    cd Agenstrix
    bun install
    bun run dev

Visit http://localhost:5173. You should see the chat shell with a live `claude` PTY in the browser.

## Subcommands

- `bunx agenstrix` (or `bunx agenstrix start`) — Start the backend + open the browser.
- `bunx agenstrix --port 4001` — Override the default port (3000).
- `bunx agenstrix doctor --reap` — Scan `~/.agenstrix/running.json` for orphan PTY processes from previous crashed runs, prompt to kill.
- `bunx agenstrix doctor --reap --yes` — Non-interactive (CI).

## Data location

Everything Agenstrix learns lives in `~/.agenstrix/`:

- `store.db` — SQLite (Drizzle ORM), WAL mode
- `backups/` — pre-migration DB backups (keeps last 10)
- `logs/agenstrix-YYYY-MM-DD.log` — user-facing log
- `logs/diagnostics-YYYY-MM-DD.log` — internal trace log
- `running.json` — live PID tracker for doctor --reap

**No yaml. No JSON config files. Ever.**

## Development

    bun install
    bun run dev          # backend + frontend in parallel (port 3000 + 5173)

    bun test             # full test suite (unit + smoke)
    bunx tsc --noEmit    # type check
    bunx @biomejs/biome check .   # lint
    bun run db:generate  # regenerate Drizzle SQL after schema changes

## CI

Three-OS matrix: macOS, Linux, Windows 10 1809+. All three runners must pass before merging to main.

- Bun is pinned to `1.3.14` (first release with cross-platform ConPTY support).
- Windows smoke tests validate `Bun.Terminal` ConPTY spawn, byte pipeline, and process kill.
- POSIX-only tests (kill-group, redactor pipeline with `sh -c`) are skipped on Windows via `test.skipIf`.

## Supported Platforms

| Platform | Status | Notes |
|----------|--------|-------|
| macOS (arm64 / x64) | Supported | Primary dev platform |
| Linux (x64 / arm64) | Supported | CI-validated |
| Windows 10 1809+ | Supported | Requires Bun >= 1.3.14 for ConPTY; minimum Windows 10 October 2018 Update (build 17763) |
| Windows < 1809 | Not supported | ConPTY API unavailable on pre-1809 builds |

## License

MIT — see [LICENSE](./LICENSE).
