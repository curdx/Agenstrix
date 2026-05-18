/**
 * Unit tests for src-bun/system/running-file.ts
 * Tests: recordPid, clearPid, readRunning, writeRunning, isProcessAlive, atomic write behavior
 * Also covers WORKTREE-CWD-01: env-scrub + realpath for spawn-env and cwd modules.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nanoid } from "nanoid";

// Import modules under test (static imports — no query params needed)
import {
  clearPid,
  isProcessAlive,
  RUNNING_FILE_PATH,
  readRunning,
  recordPid,
  writeRunning,
} from "../../src-bun/system/running-file";
import { resolveCwd } from "../../src-bun/worker/cwd";
import { buildSpawnEnv } from "../../src-bun/worker/spawn-env";

// ── test isolation helper ─────────────────────────────────────────────────────
// We override process.env.HOME before each test so running-file's lazy
// RUNNING_FILE_PATH() resolves to an isolated tmpdir.
function makeTmpHome(): string {
  const dir = join(tmpdir(), `agenstrix-test-${nanoid()}`);
  mkdirSync(join(dir, ".agenstrix"), { recursive: true });
  process.env.HOME = dir;
  return dir;
}

describe("running-file", () => {
  let _testHome: string;

  beforeEach(() => {
    _testHome = makeTmpHome();
  });

  test("Test 1: recordPid then readRunning returns the entry", () => {
    const t = Date.now();
    recordPid("w1", { pid: 1234, pgid: 1234, startedAt: t, cli: "claude", cwd: "/tmp" });
    const result = readRunning();
    expect(result.w1).toBeDefined();
    expect(result.w1.pid).toBe(1234);
    expect(result.w1.pgid).toBe(1234);
    expect(result.w1.startedAt).toBe(t);
    expect(result.w1.cli).toBe("claude");
    expect(result.w1.cwd).toBe("/tmp");
  });

  test("Test 2: clearPid removes the entry", () => {
    recordPid("w2", { pid: 5678, pgid: 5678, startedAt: Date.now(), cli: "claude", cwd: "/tmp" });
    clearPid("w2");
    const result = readRunning();
    expect(result.w2).toBeUndefined();
  });

  test("Test 3: readRunning on missing file returns empty object (no throw)", () => {
    const runningPath = RUNNING_FILE_PATH();
    if (existsSync(runningPath)) {
      rmSync(runningPath);
    }
    const result = readRunning();
    expect(result).toEqual({});
  });

  test("Test 4: isProcessAlive(process.pid) is true; isProcessAlive(999999) is false", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(999999)).toBe(false);
  });

  test("Test 5: malformed JSON in running.json recovers gracefully (returns {})", () => {
    const runningPath = RUNNING_FILE_PATH();
    writeFileSync(runningPath, "{ this is not valid JSON !!");
    const result = readRunning();
    expect(result).toEqual({});
  });

  test("Test 6: writeRunning writes valid JSON atomically (no .tmp file left)", () => {
    const state = {
      w6: { pid: 9999, pgid: 9999, startedAt: 1000, cli: "claude", cwd: "/tmp" },
    };
    writeRunning(state);
    const runningPath = RUNNING_FILE_PATH();
    const tmpPath = `${runningPath}.tmp`;
    // Final file exists
    expect(existsSync(runningPath)).toBe(true);
    // .tmp file was cleaned up by rename
    expect(existsSync(tmpPath)).toBe(false);
    // Content is valid JSON
    const result = readRunning();
    expect(result.w6).toBeDefined();
    expect(result.w6.pid).toBe(9999);
  });

  // ─── WORKTREE-CWD-01 Tests ─────────────────────────────────────────────────

  test("Test 7 (WORKTREE-CWD-01 env-scrub): buildSpawnEnv has no GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE", () => {
    // Temporarily inject git env vars into the current process env
    const prev: Record<string, string | undefined> = {
      GIT_DIR: process.env.GIT_DIR,
      GIT_WORK_TREE: process.env.GIT_WORK_TREE,
      GIT_INDEX_FILE: process.env.GIT_INDEX_FILE,
    };
    process.env.GIT_DIR = "/tmp/sneaky-git-dir";
    process.env.GIT_WORK_TREE = "/tmp/sneaky-work-tree";
    process.env.GIT_INDEX_FILE = "/tmp/sneaky-index";

    const env = buildSpawnEnv([]);

    // Restore env
    if (prev.GIT_DIR === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = prev.GIT_DIR;
    if (prev.GIT_WORK_TREE === undefined) delete process.env.GIT_WORK_TREE;
    else process.env.GIT_WORK_TREE = prev.GIT_WORK_TREE;
    if (prev.GIT_INDEX_FILE === undefined) delete process.env.GIT_INDEX_FILE;
    else process.env.GIT_INDEX_FILE = prev.GIT_INDEX_FILE;

    expect(env.GIT_DIR).toBeUndefined();
    expect(env.GIT_WORK_TREE).toBeUndefined();
    expect(env.GIT_INDEX_FILE).toBeUndefined();
  });

  test("Test 8 (WORKTREE-CWD-01 realpath): resolveCwd resolves symlinks to real path", async () => {
    if (process.platform === "win32") {
      // Symlinks need admin rights on Windows; skip
      return;
    }

    const realDir = join(tmpdir(), `real-dir-${nanoid()}`);
    const symlinkPath = join(tmpdir(), `symlink-${nanoid()}`);
    mkdirSync(realDir, { recursive: true });
    execSync(`ln -sf ${realDir} ${symlinkPath}`);

    try {
      const resolved = await resolveCwd({ requestedPath: symlinkPath });
      // Normalize both sides with realpathSync to handle macOS /var → /private/var symlinks
      const expectedReal = realpathSync(realDir);
      expect(resolved).toBe(expectedReal);
    } finally {
      try {
        rmSync(symlinkPath);
      } catch {
        /* ignore */
      }
      try {
        rmSync(realDir, { recursive: true });
      } catch {
        /* ignore */
      }
    }
  });
});
