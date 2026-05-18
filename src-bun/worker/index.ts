/**
 * WorkerSupervisor — Phase 1 + Plan 02 + Plan 04 implementation.
 * Supports: cli="echo-skeleton" | "claude" | "codex".
 * Mode: no-worktree (direct cwd passthrough).
 * Phase 3+ adds: worktree create/merge/inherit, MCP injection, multi-worker.
 */

import { which } from "bun";
import { nanoid } from "nanoid";
import { bus } from "../bus/index";
import { eventsRepo } from "../db/repos/eventsRepo";
import { ptyChunksRepo } from "../db/repos/ptyChunksRepo";
import { workersRepo } from "../db/repos/workersRepo";
import { AnsiChunkBatcher } from "../pty/batcher";
import type { PtyHandle } from "../pty/handle";
import { createPty } from "../pty/handle";
import { redactChunk } from "../pty/redactor";
import { clearPid, recordPid } from "../system/running-file";
import { resolveCwd } from "./cwd";
import { buildSpawnEnv } from "./spawn-env";

export interface WorkerSpec {
  id?: string; // auto-generated if not provided
  cli: "claude" | "codex" | "echo-skeleton";
  cwd?: string; // defaults to process.cwd()
  envAllowlist?: string[];
  envMode?: "no-worktree";
  /**
   * TEST-ONLY: Override the resolved argv directly.
   * The underscore prefix signals "not for production callers".
   * Used by kill-group smoke test and Plan 05 redactor pipeline tests.
   * Also honored if AGENSTRIX_ARGV_OVERRIDE env var is set (JSON-encoded string[]).
   */
  _testArgvOverride?: string[];
}

interface WorkerEntry {
  id: string;
  pid: number;
  pgid: number;
  pty: PtyHandle;
  state: "running" | "exited" | "killed";
  cli: string;
  cwd: string;
  startedAt: number;
  batcher: AnsiChunkBatcher;
}

// In-memory worker registry
const workerRegistry = new Map<string, WorkerEntry>();

/**
 * Resolve argv for a worker CLI.
 * Priority:
 * 1. spec._testArgvOverride (TEST-ONLY)
 * 2. AGENSTRIX_ARGV_OVERRIDE env var (JSON-encoded string[]) — env-driven CI scenarios
 * 3. cli-based resolution
 */
function resolveArgv(spec: WorkerSpec): string[] {
  // TEST-ONLY override hook
  if (spec._testArgvOverride) {
    return spec._testArgvOverride;
  }
  // Env-driven override for CI scenarios
  const envOverride = process.env.AGENSTRIX_ARGV_OVERRIDE;
  if (envOverride) {
    try {
      const parsed = JSON.parse(envOverride) as string[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch {
      // ignore malformed env override
    }
  }
  return buildArgv(spec.cli);
}

/**
 * Resolve argv for a known CLI type.
 * - "claude": resolves full path via which(); throws if not found (caller must guard with self-test)
 * - "codex": resolves full path via which(); throws if not found
 * - "echo-skeleton": bare shell echo + long sleep (D-04 placeholder for test/degraded mode)
 */
function buildArgv(cli: WorkerSpec["cli"]): string[] {
  if (cli === "echo-skeleton") {
    if (process.platform === "win32") {
      return ["cmd.exe", "/c", "echo Hello from Agenstrix skeleton & timeout /t 86400"];
    }
    return ["sh", "-c", "echo 'Hello from Agenstrix skeleton'; sleep 86400"];
  }
  if (cli === "claude") {
    // D-03: bare claude argv — no --print, no --mcp-config, no initial prompt
    const claudeBin = which("claude");
    if (!claudeBin) {
      throw new Error(
        "claude not found in PATH — spawnWorker(cli:'claude') called without self-test guard"
      );
    }
    return [claudeBin]; // fully-resolved path; no flags (D-03)
  }
  if (cli === "codex") {
    const codexBin = which("codex");
    if (!codexBin) {
      throw new Error("codex not found in PATH");
    }
    return [codexBin]; // v2
  }
  throw new Error(`Unknown CLI: ${cli}`);
}

export async function spawnWorker(spec: WorkerSpec): Promise<{ workerId: string; pid: number }> {
  const workerId = spec.id ?? nanoid();
  const cwd = await resolveCwd({ requestedPath: spec.cwd });
  const env = buildSpawnEnv(spec.envAllowlist ?? []);
  const argv = resolveArgv(spec);
  const envMode = spec.envMode ?? "no-worktree";
  const startedAt = Date.now();

  const batcher = new AnsiChunkBatcher({
    onFlush: async (chunk: Uint8Array) => {
      // Persist to SQLite using appendAtomic for monotonic seq guarantees (Plan 03 carry-over)
      try {
        await ptyChunksRepo.appendAtomic(workerId, Date.now(), Buffer.from(chunk));
      } catch {
        // Best effort — don't crash the PTY on DB write error
      }
    },
  });

  const pty = createPty({
    argv,
    cwd,
    env,
    cols: 220,
    rows: 50,
    onData: (rawChunk: Uint8Array) => {
      // Redact before persistence AND before WS forward (SEC-01, single pass)
      const chunk = redactChunk(rawChunk);

      // Forward to WS immediately (before batcher, so live stream is instant)
      bus.publish(`worker.output.${workerId}`, chunk);

      // Persist via batcher (ANSI-safe chunking for SQLite)
      batcher.ingest(chunk);
    },
    onExit: async (code: number) => {
      const entry = workerRegistry.get(workerId);
      if (entry) {
        entry.state = "exited";
        batcher.flushNow();
      }
      try {
        await workersRepo.updateState(workerId, "exited", Date.now(), code);
        await eventsRepo.append({
          workerId,
          type: "worker.exited",
          payload: { exitCode: code },
        });
        // Broadcast via SSE so UI MessageCard can update status dot (Plan 02 — D-01)
        bus.publish("sse.event", { type: "worker.exited", workerId, payload: { exitCode: code } });
      } catch {
        // Best effort
      }
      clearPid(workerId);
      workerRegistry.delete(workerId);
    },
  });

  // Register in memory
  const entry: WorkerEntry = {
    id: workerId,
    pid: pty.pid,
    pgid: pty.pgid,
    pty,
    state: "running",
    cli: spec.cli,
    cwd,
    startedAt,
    batcher,
  };
  workerRegistry.set(workerId, entry);

  // Persist to DB
  await workersRepo.insert({
    id: workerId,
    cli: spec.cli,
    cwd,
    pid: pty.pid,
    pgid: pty.pgid,
    envMode,
    createdAt: startedAt,
  });

  await eventsRepo.append({
    workerId,
    type: "worker.spawned",
    payload: { cli: spec.cli, cwd, pid: pty.pid, pgid: pty.pgid },
  });

  // Record PID into running.json for orphan detection (KILL-01 / CORE-05)
  recordPid(workerId, {
    pid: pty.pid,
    pgid: pty.pgid,
    startedAt,
    cli: spec.cli,
    cwd,
  });

  return { workerId, pid: pty.pid };
}

export async function killWorker(id: string, graceful = true): Promise<void> {
  const entry = workerRegistry.get(id);
  if (!entry) return;

  entry.batcher.flushNow();

  if (graceful) {
    entry.pty.kill("SIGTERM");
    const timeoutHandle = setTimeout(() => {
      entry.pty.kill("SIGKILL");
    }, 5_000);

    try {
      await entry.pty.exited;
      clearTimeout(timeoutHandle);
    } catch {
      clearTimeout(timeoutHandle);
      entry.pty.kill("SIGKILL");
    }
  } else {
    entry.pty.kill("SIGKILL");
    await entry.pty.exited;
  }

  entry.state = "killed";
  try {
    await workersRepo.updateState(id, "killed", Date.now());
    await eventsRepo.append({ workerId: id, type: "worker.killed" });
  } catch {
    // Best effort
  }
  clearPid(id);
  workerRegistry.delete(id);
}

export function sendToWorker(id: string, data: string): void {
  const entry = workerRegistry.get(id);
  if (entry && entry.state === "running") {
    entry.pty.write(data);
  }
}

export function resizeWorker(id: string, cols: number, rows: number): void {
  const entry = workerRegistry.get(id);
  if (entry && entry.state === "running") {
    entry.pty.resize(cols, rows);
  }
}

export function listWorkers(): Array<{
  id: string;
  pid: number;
  state: string;
  cli: string;
  cwd: string;
  startedAt: number;
}> {
  return Array.from(workerRegistry.values()).map((w) => ({
    id: w.id,
    pid: w.pid,
    state: w.state,
    cli: w.cli,
    cwd: w.cwd,
    startedAt: w.startedAt,
  }));
}

export function getWorkerPid(id: string): number | null {
  return workerRegistry.get(id)?.pid ?? null;
}
