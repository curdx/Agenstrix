/**
 * Self-test module (SETUP-01 + INFRA-06 + D-10/11/12).
 *
 * Checks:
 * - Bun version >= 1.3.14
 * - claude CLI in PATH
 * - git CLI in PATH
 * - SQLite writable at ~/.agenstrix/
 * - Port available
 * - Stale git locks (GIT-01 foundation)
 * - Orphan worker processes (KILL-01 / SETUP-01)
 */
import { Database } from "bun:sqlite";
import { mkdirSync, unlinkSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { which } from "bun";
import type { StaleLock } from "./git-lock-scanner";
import { scanGitLocks } from "./git-lock-scanner";
import { isProcessAlive, readRunning } from "./running-file";

export interface SelfTestWarning {
  item: "claude" | "git" | "sqlite" | "port" | "bun-version" | "git-lock" | "orphan-worker";
  message: string;
  fixMac: string;
  fixLinux: string;
  fixWindows: string;
}

export interface SelfTestResult {
  claudeFound: boolean;
  gitFound: boolean;
  sqliteWritable: boolean;
  portAvailable: boolean;
  bunOk: boolean;
  criticalFailure: boolean; // true → backend exits before serving (D-12: SQLite not writable)
  warnings: SelfTestWarning[];
  /** GIT-01 foundation: stale .git/index.lock files found at boot time */
  staleGitLocks: StaleLock[];
  /** Count of orphan worker processes detected from running.json */
  orphanWorkers: number;
}

const MIN_BUN = [1, 3, 14];

function checkBunVersion(): boolean {
  const parts = Bun.version.split(".").map(Number);
  const [major = 0, minor = 0, patch = 0] = parts;
  const [minMajor = 0, minMinor = 0, minPatch = 0] = MIN_BUN;
  return (
    major > minMajor ||
    (major === minMajor && minor > minMinor) ||
    (major === minMajor && minor === minMinor && patch >= minPatch)
  );
}

export async function runSelfTest(port: number): Promise<SelfTestResult> {
  const warnings: SelfTestWarning[] = [];

  // Check Bun version
  const bunOk = checkBunVersion();
  if (!bunOk) {
    warnings.push({
      item: "bun-version",
      message: `Bun >= 1.3.14 required (Bun.Terminal Windows ConPTY). Current: ${Bun.version}`,
      fixMac: "curl -fsSL https://bun.sh/install | bash -s bun-v1.3.14",
      fixLinux: "curl -fsSL https://bun.sh/install | bash -s bun-v1.3.14",
      fixWindows: "powershell -c 'irm bun.sh/install.ps1 | iex'",
    });
  }

  // Check claude
  const claudeBin = which("claude");
  const claudeFound = claudeBin !== null;
  if (!claudeFound) {
    warnings.push({
      item: "claude",
      message: "claude CLI not found in PATH",
      fixMac: "npm install -g @anthropic-ai/claude-code",
      fixLinux: "npm install -g @anthropic-ai/claude-code",
      fixWindows: "npm install -g @anthropic-ai/claude-code",
    });
  }

  // Check git
  const gitBin = which("git");
  const gitFound = gitBin !== null;
  if (!gitFound) {
    warnings.push({
      item: "git",
      message: "git not found in PATH",
      fixMac: "brew install git",
      fixLinux: "sudo apt-get install git",
      fixWindows: "winget install Git.Git",
    });
  }

  // Check SQLite writable (critical — D-12)
  const testPath = join(os.homedir(), ".agenstrix", "__selftest.db");
  let sqliteWritable = false;
  try {
    mkdirSync(join(os.homedir(), ".agenstrix"), { recursive: true });
    const db = new Database(testPath, { create: true });
    db.exec("CREATE TABLE IF NOT EXISTS _t (v TEXT)");
    db.exec("INSERT INTO _t VALUES ('ok')");
    db.close();
    try {
      unlinkSync(testPath);
    } catch {
      // Ignore cleanup failure
    }
    sqliteWritable = true;
  } catch {
    // Critical — cannot store pty_chunks
  }

  // Check port availability
  let portAvailable = false;
  try {
    const server = Bun.serve({ port, fetch: () => new Response("ok") });
    await server.stop();
    portAvailable = true;
  } catch {
    portAvailable = false;
    // Port-occupied is handled in main.ts (D-14: hard exit with --port hint)
    // Don't push a warning here — main.ts will handle the exit logic
  }

  // GIT-01 foundation: scan process.cwd() for stale .git/index.lock files
  // Phase 2+ will expand to all registered repos
  let staleGitLocks: StaleLock[] = [];
  try {
    staleGitLocks = await scanGitLocks([process.cwd()]);
    for (const lock of staleGitLocks) {
      warnings.push({
        item: "git-lock",
        message: `Stale .git/index.lock found at ${lock.path} (${Math.round(lock.ageMs / 60_000)} min old)`,
        fixMac: `rm ${lock.path}`,
        fixLinux: `rm ${lock.path}`,
        fixWindows: `del "${lock.path}"`,
      });
    }
  } catch {
    // Non-critical — continue boot even if git lock scan fails
  }

  // KILL-01 / SETUP-01: detect orphan workers from a previous crashed backend
  // An "orphan" at boot time = a PID in running.json that is alive AND whose
  // startedAt is before the current process start (i.e. belongs to a prior backend).
  const currentProcessStart = Date.now();
  let orphanWorkers = 0;
  try {
    const running = readRunning();
    for (const entry of Object.values(running)) {
      // PID is alive and the startedAt timestamp predates our boot (prior session)
      if (isProcessAlive(entry.pid) && entry.startedAt < currentProcessStart) {
        orphanWorkers++;
      }
    }
    if (orphanWorkers > 0) {
      warnings.push({
        item: "orphan-worker",
        message: `${orphanWorkers} orphan worker process(es) detected from a previous session`,
        fixMac: "bunx agenstrix doctor --reap",
        fixLinux: "bunx agenstrix doctor --reap",
        fixWindows: "bunx agenstrix doctor --reap",
      });
    }
  } catch {
    // Non-critical — continue boot even if orphan check fails
  }

  return {
    claudeFound,
    gitFound,
    sqliteWritable,
    portAvailable,
    bunOk,
    criticalFailure: !sqliteWritable, // D-12: SQLite unwritable → strict mode hard exit
    warnings,
    staleGitLocks,
    orphanWorkers,
  };
}
