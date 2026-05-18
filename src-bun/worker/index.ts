/**
 * WorkerSupervisor — Phase 1 minimal implementation.
 * Supports: cli="echo-skeleton" only (Plan 02 adds real `claude`).
 * Mode: no-worktree (direct cwd passthrough).
 * Phase 3+ adds: worktree create/merge/inherit, MCP injection, multi-worker.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { bus } from "../bus/index";
import { eventsRepo } from "../db/repos/eventsRepo";
import { ptyChunksRepo } from "../db/repos/ptyChunksRepo";
import { workersRepo } from "../db/repos/workersRepo";
import { AnsiChunkBatcher } from "../pty/batcher";
import type { PtyHandle } from "../pty/handle";
import { createPty } from "../pty/handle";
import { redactChunk } from "../pty/redactor";
import { resolveCwd } from "./cwd";
import { buildSpawnEnv } from "./spawn-env";

export interface WorkerSpec {
  id?: string; // auto-generated if not provided
  cli: "claude" | "codex" | "echo-skeleton";
  cwd?: string; // defaults to process.cwd()
  envAllowlist?: string[];
  envMode?: "no-worktree";
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
  seqCounter: number;
}

// In-memory worker registry
const workerRegistry = new Map<string, WorkerEntry>();

// running.json path for doctor --reap
const RUNNING_FILE = join(os.homedir(), ".agenstrix", "running.json");

function readRunningFile(): Record<string, { pid: number; pgid: number; startedAt: number }> {
  try {
    if (existsSync(RUNNING_FILE)) {
      return JSON.parse(readFileSync(RUNNING_FILE, "utf8")) as Record<
        string,
        { pid: number; pgid: number; startedAt: number }
      >;
    }
  } catch {
    // Ignore
  }
  return {};
}

function writeRunningFile(
  data: Record<string, { pid: number; pgid: number; startedAt: number }>
): void {
  try {
    mkdirSync(join(os.homedir(), ".agenstrix"), { recursive: true });
    writeFileSync(RUNNING_FILE, JSON.stringify(data, null, 2));
  } catch {
    // Best effort
  }
}

function recordPid(workerId: string, pid: number, pgid: number): void {
  const existing = readRunningFile();
  existing[workerId] = { pid, pgid, startedAt: Date.now() };
  writeRunningFile(existing);
}

function clearPid(workerId: string): void {
  const existing = readRunningFile();
  delete existing[workerId];
  writeRunningFile(existing);
}

/**
 * Build argv for the skeleton echo PTY (placeholder for real claude in Plan 02).
 */
function buildArgv(cli: WorkerSpec["cli"]): string[] {
  if (cli === "echo-skeleton") {
    if (process.platform === "win32") {
      return ["cmd.exe", "/c", "echo Hello from Agenstrix skeleton & timeout /t 86400"];
    }
    return ["sh", "-c", "echo 'Hello from Agenstrix skeleton'; sleep 86400"];
  }
  if (cli === "claude") {
    return ["claude"]; // Plan 02 uses this
  }
  if (cli === "codex") {
    return ["codex"]; // v2
  }
  throw new Error(`Unknown CLI: ${cli}`);
}

export async function spawnWorker(spec: WorkerSpec): Promise<{ workerId: string; pid: number }> {
  const workerId = spec.id ?? nanoid();
  const cwd = await resolveCwd({ requestedPath: spec.cwd });
  const env = buildSpawnEnv(spec.envAllowlist ?? []);
  const argv = buildArgv(spec.cli);
  const envMode = spec.envMode ?? "no-worktree";
  const startedAt = Date.now();

  // Register worker in DB before spawning
  let seqCounter = 0;

  const batcher = new AnsiChunkBatcher({
    onFlush: async (chunk: Uint8Array) => {
      // Persist to SQLite
      try {
        const seq = seqCounter++;
        await ptyChunksRepo.append({
          workerId,
          seq,
          ts: Date.now(),
          bytes: Buffer.from(chunk),
        });
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
    seqCounter,
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

  recordPid(workerId, pty.pid, pty.pgid);

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
