/**
 * Self-test module (SETUP-01 + INFRA-06 + D-10/11/12).
 *
 * Checks:
 * - Bun version >= 1.3.14
 * - claude CLI in PATH
 * - git CLI in PATH
 * - SQLite writable at ~/.agenstrix/
 * - Port available
 */
import { which } from "bun";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { mkdirSync, unlinkSync } from "node:fs";
import os from "node:os";

export interface SelfTestWarning {
  item: "claude" | "git" | "sqlite" | "port" | "bun-version";
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
}

const MIN_BUN = [1, 3, 14];

function checkBunVersion(): boolean {
  const parts = Bun.version.split(".").map(Number);
  const [major, minor, patch] = parts;
  return (
    major! > MIN_BUN[0]! ||
    (major === MIN_BUN[0] && minor! > MIN_BUN[1]!) ||
    (major === MIN_BUN[0] && minor === MIN_BUN[1] && patch! >= MIN_BUN[2]!)
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

  return {
    claudeFound,
    gitFound,
    sqliteWritable,
    portAvailable,
    bunOk,
    criticalFailure: !sqliteWritable, // D-12: SQLite unwritable → strict mode hard exit
    warnings,
  };
}
