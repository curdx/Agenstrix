/**
 * PID tracking module for orphan detection (CORE-05 / KILL-01).
 *
 * Writes ~/.agenstrix/running.json when a worker spawns and removes the entry
 * when the worker exits. `agenstrix doctor --reap` reads this file to find
 * orphaned processes from a previous crashed backend session.
 *
 * Thread safety: writes are atomic via rename (write to .tmp, then rename to real).
 * Two concurrent backends writing simultaneously are undefined behavior in Phase 1
 * (one backend at a time is the supported topology) — T-01-04-04.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { diagnosticsLogger } from "./logger";

export interface RunningEntry {
  pid: number;
  pgid: number;
  startedAt: number;
  cli: string;
  cwd: string;
}

/**
 * Lazy path getter — resolves at call time so tests can override HOME.
 */
export const RUNNING_FILE_PATH = (): string => {
  const home = process.env.HOME ?? os.homedir();
  return join(home, ".agenstrix", "running.json");
};

/**
 * Read the running.json file.
 * Returns {} if the file doesn't exist or is corrupt.
 */
export function readRunning(): Record<string, RunningEntry> {
  const path = RUNNING_FILE_PATH();
  if (!existsSync(path)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, RunningEntry>;
  } catch (err) {
    diagnosticsLogger.warn({ err }, "running.json is malformed — returning empty state");
    return {};
  }
}

/**
 * Write the running.json file atomically.
 * Writes to .tmp first, then renames to the real path (T-01-04-04).
 */
export function writeRunning(state: Record<string, RunningEntry>): void {
  const path = RUNNING_FILE_PATH();
  const tmpPath = `${path}.tmp`;

  // Ensure ~/.agenstrix/ exists
  const dir = join(process.env.HOME ?? os.homedir(), ".agenstrix");
  mkdirSync(dir, { recursive: true });

  writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmpPath, path);
}

/**
 * Record a spawned worker PID into running.json.
 */
export function recordPid(workerId: string, entry: RunningEntry): void {
  const current = readRunning();
  current[workerId] = entry;
  writeRunning(current);
}

/**
 * Remove a worker's PID entry from running.json.
 */
export function clearPid(workerId: string): void {
  const current = readRunning();
  delete current[workerId];
  writeRunning(current);
}

/**
 * Check if a process is alive using the POSIX signal-0 trick.
 * Works on all platforms: on Windows, process.kill(pid, 0) throws ESRCH if dead.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
