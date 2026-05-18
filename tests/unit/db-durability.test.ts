/**
 * Unit tests for DB-DURABILITY-01 invariants.
 *
 * Tests:
 * 1. WAL pragma enabled
 * 2. journal_size_limit = 67108864
 * 3. foreign_keys = ON
 * 4. synchronous = NORMAL (1)
 * 5. FK enforcement at runtime (insert pty_chunk with nonexistent worker_id)
 * 6. checkpoint mode is PASSIVE (periodic scheduler)
 * 7. shutdownDb uses TRUNCATE checkpoint
 */
import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import os from "node:os";
import path from "node:path";
import { rmSync, mkdirSync } from "node:fs";
import { nanoid } from "nanoid";

// We manipulate HOME to isolate tests from real ~/.agenstrix
let testHome: string;
let originalHome: string | undefined;

function setupTestHome() {
  testHome = path.join(os.tmpdir(), `agenstrix-test-${nanoid()}`);
  mkdirSync(testHome, { recursive: true });
  originalHome = process.env.HOME;
  process.env.HOME = testHome;
}

function teardownTestHome() {
  process.env.HOME = originalHome;
  try {
    rmSync(testHome, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

describe("DB-DURABILITY-01: WAL and PRAGMA invariants", () => {
  beforeEach(setupTestHome);
  afterEach(teardownTestHome);

  test("Test 1 (WAL pragma): journal_mode === 'wal' after initDb()", async () => {
    // Force fresh module load by clearing cached modules
    const { initDb, shutdownDb, getSqlite } = await import("../../src-bun/db/index");
    try {
      await initDb();
      const sqlite = getSqlite();
      const row = sqlite.query("PRAGMA journal_mode").get() as Record<string, string>;
      expect(row.journal_mode).toBe("wal");
    } finally {
      await shutdownDb();
    }
  });

  test("Test 2 (journal_size_limit): = 67108864 on connection", async () => {
    const { initDb, shutdownDb, getSqlite } = await import("../../src-bun/db/index");
    try {
      await initDb();
      const sqlite = getSqlite();
      const row = sqlite.query("PRAGMA journal_size_limit").get() as Record<string, number>;
      expect(row.journal_size_limit).toBe(67108864);
    } finally {
      await shutdownDb();
    }
  });

  test("Test 3 (foreign_keys): = 1 on connection", async () => {
    const { initDb, shutdownDb, getSqlite } = await import("../../src-bun/db/index");
    try {
      await initDb();
      const sqlite = getSqlite();
      const row = sqlite.query("PRAGMA foreign_keys").get() as Record<string, number>;
      expect(row.foreign_keys).toBe(1);
    } finally {
      await shutdownDb();
    }
  });

  test("Test 4 (synchronous=NORMAL): synchronous = 1 (NORMAL)", async () => {
    const { initDb, shutdownDb, getSqlite } = await import("../../src-bun/db/index");
    try {
      await initDb();
      const sqlite = getSqlite();
      const row = sqlite.query("PRAGMA synchronous").get() as Record<string, number>;
      expect(row.synchronous).toBe(1);
    } finally {
      await shutdownDb();
    }
  });

  test("Test 5 (FK enforcement): inserting pty_chunk with nonexistent worker_id throws FK error", async () => {
    const { initDb, shutdownDb, getSqlite } = await import("../../src-bun/db/index");
    try {
      await initDb();
      const sqlite = getSqlite();
      // Direct SQLite insert to bypass Drizzle's type layer
      expect(() => {
        sqlite.exec(
          `INSERT INTO pty_chunks (id, worker_id, ts, seq, bytes) VALUES ('test-id', 'nonexistent', 0, 1, x'');`
        );
      }).toThrow(/FOREIGN KEY constraint failed/i);
    } finally {
      await shutdownDb();
    }
  });

  test("Test 6 (checkpoint mode is PASSIVE): scheduleWalCheckpoint calls PASSIVE not TRUNCATE", async () => {
    const { scheduleWalCheckpoint, getSqlite, initDb, shutdownDb } = await import(
      "../../src-bun/db/index"
    );

    try {
      await initDb();
      const sqlite = getSqlite();

      // Capture exec calls
      const capturedSql: string[] = [];
      const originalExec = sqlite.exec.bind(sqlite);
      sqlite.exec = (sql: string) => {
        capturedSql.push(sql);
        return originalExec(sql);
      };

      // Schedule a checkpoint and trigger it immediately
      const { cancel } = scheduleWalCheckpoint(sqlite, 1); // 1ms interval for testing
      // Wait long enough for the interval to fire
      await new Promise((resolve) => setTimeout(resolve, 50));
      cancel();

      // Restore original exec
      sqlite.exec = originalExec;

      const checkpointCalls = capturedSql.filter((s) => s.includes("wal_checkpoint"));
      expect(checkpointCalls.length).toBeGreaterThan(0);
      expect(checkpointCalls.some((s) => s.includes("PASSIVE"))).toBe(true);
      expect(checkpointCalls.every((s) => !s.includes("TRUNCATE"))).toBe(true);
    } finally {
      await shutdownDb();
    }
  });

  test("Test 7 (shutdown uses TRUNCATE): shutdownDb calls wal_checkpoint(TRUNCATE)", async () => {
    const { initDb, shutdownDb, getSqlite } = await import("../../src-bun/db/index");

    await initDb();
    const sqlite = getSqlite();

    // Capture exec calls
    const capturedSql: string[] = [];
    const originalExec = sqlite.exec.bind(sqlite);
    sqlite.exec = (sql: string) => {
      capturedSql.push(sql);
      return originalExec(sql);
    };

    await shutdownDb();

    // Check TRUNCATE was in the captured calls during shutdown
    const checkpointCalls = capturedSql.filter((s) => s.includes("wal_checkpoint"));
    expect(checkpointCalls.length).toBeGreaterThan(0);
    expect(checkpointCalls.some((s) => s.includes("TRUNCATE"))).toBe(true);
  });
});
