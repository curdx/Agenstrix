/**
 * Unit tests for src-bun/system/git-lock-scanner.ts
 * Tests: scanGitLocks (stale vs fresh), removeLock (safety + unlink)
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { removeLock, STALE_AGE_MS, scanGitLocks } from "../../src-bun/system/git-lock-scanner";

let testRoot: string;

describe("git-lock-scanner", () => {
  beforeEach(() => {
    testRoot = join(tmpdir(), `git-lock-test-${nanoid()}`);
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  test("Test 1 (no locks): scanGitLocks returns [] when no .git/index.lock exists", async () => {
    const repo1 = join(testRoot, "repo1");
    const repo2 = join(testRoot, "repo2");
    mkdirSync(join(repo1, ".git"), { recursive: true });
    mkdirSync(join(repo2, ".git"), { recursive: true });
    const result = await scanGitLocks([repo1, repo2]);
    expect(result).toEqual([]);
  });

  test("Test 2 (fresh lock skipped): scanGitLocks ignores recently modified lock files", async () => {
    const repo1 = join(testRoot, "repo1");
    mkdirSync(join(repo1, ".git"), { recursive: true });
    const lockPath = join(repo1, ".git", "index.lock");
    writeFileSync(lockPath, "LOCK");
    // mtime = now (fresh — should NOT be flagged as stale)
    const nowMs = Date.now();
    utimesSync(lockPath, nowMs / 1000, nowMs / 1000);
    const result = await scanGitLocks([repo1]);
    expect(result).toEqual([]);
  });

  test("Test 3 (stale lock detected): lock older than 5 min is returned", async () => {
    const repo1 = join(testRoot, "repo1");
    mkdirSync(join(repo1, ".git"), { recursive: true });
    const lockPath = join(repo1, ".git", "index.lock");
    writeFileSync(lockPath, "LOCK");
    // Set mtime to 10 minutes ago (well past the 5-min threshold)
    const tenMinAgoSec = (Date.now() - 10 * 60 * 1000) / 1000;
    utimesSync(lockPath, tenMinAgoSec, tenMinAgoSec);

    const result = await scanGitLocks([repo1]);
    expect(result.length).toBe(1);
    expect(result[0].path).toBe(lockPath);
    expect(result[0].repoPath).toBe(repo1);
    expect(result[0].ageMs).toBeGreaterThanOrEqual(STALE_AGE_MS);
  });

  test("Test 4 (removeLock safety + unlink): removes valid lock; rejects arbitrary paths", () => {
    const repo1 = join(testRoot, "repo1");
    mkdirSync(join(repo1, ".git"), { recursive: true });
    const lockPath = join(repo1, ".git", "index.lock");
    writeFileSync(lockPath, "LOCK");

    // Should succeed and unlink the file
    removeLock(lockPath);
    expect(existsSync(lockPath)).toBe(false);

    // Should throw for paths that don't end in /.git/index.lock
    expect(() => removeLock("/etc/passwd")).toThrow();
    expect(() => removeLock("/some/path/.git/index.lock.bak")).toThrow();
    expect(() => removeLock("/some/path/index.lock")).toThrow();
  });

  test("Test 5 (missing .git dir): scanGitLocks([nonExistent]) returns [], no throw", async () => {
    const nonExistent = join(testRoot, "does-not-exist");
    let result: Awaited<ReturnType<typeof scanGitLocks>>;
    let threw = false;
    try {
      result = await scanGitLocks([nonExistent]);
    } catch {
      threw = true;
      result = [];
    }
    expect(threw).toBe(false);
    expect(result).toEqual([]);
  });
});
