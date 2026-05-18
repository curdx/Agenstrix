/**
 * Unit tests for src-bun/db/backups.ts
 *
 * Tests:
 * 1. No-op when store.db does not exist
 * 2. Creates timestamped backup when store.db exists
 * 3. Rotates at 10 — removes 2 oldest from 12-file seed
 * 4. Rotation invariant: keeps 10 even when all share same mtime (by name-sort)
 * 5. restoreBackup writes backup back to store.db
 */
import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import os from "node:os";
import path from "node:path";
import { rmSync, mkdirSync, writeFileSync, utimesSync, existsSync, readFileSync } from "node:fs";
import { nanoid } from "nanoid";

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

describe("backups module", () => {
  beforeEach(setupTestHome);
  afterEach(teardownTestHome);

  test("Test 1 (no-op when no DB exists): backupBeforeMigrate() does not throw when store.db absent", async () => {
    const { backupBeforeMigrate, listBackups } = await import("../../src-bun/db/backups");

    // store.db doesn't exist in our fresh testHome
    expect(() => backupBeforeMigrate()).not.toThrow();
    expect(listBackups().length).toBe(0);
  });

  test("Test 2 (creates timestamped backup): backup created with correct name pattern", async () => {
    const { backupBeforeMigrate, listBackups, getDbPath, getBackupDir } = await import(
      "../../src-bun/db/backups"
    );

    // Create a fake store.db
    const agenstrixDir = path.join(testHome, ".agenstrix");
    mkdirSync(agenstrixDir, { recursive: true });
    const dbPath = getDbPath();
    writeFileSync(dbPath, "fake-db-content");

    backupBeforeMigrate();

    const backups = listBackups();
    expect(backups.length).toBe(1);
    expect(backups[0].filename).toMatch(/^store-\d{4}-\d{2}-\d{2}T.*\.db$/);
    expect(backups[0].sizeBytes).toBeGreaterThan(0);
    expect(typeof backups[0].mtimeMs).toBe("number");
  });

  test("Test 3 (rotates at 10): seed 12 files → rotateBackups(10) → 10 remain, oldest 2 deleted", async () => {
    const { rotateBackups, listBackups, getBackupDir } = await import("../../src-bun/db/backups");

    const backupDir = getBackupDir();
    mkdirSync(backupDir, { recursive: true });

    // Create 12 backup files with monotonic mtimes
    const now = Date.now();
    const filenames: string[] = [];
    for (let i = 0; i < 12; i++) {
      const dt = new Date(now + i * 1000).toISOString().replace(/[:.]/g, "-");
      const filename = `store-${dt}.db`;
      filenames.push(filename);
      writeFileSync(path.join(backupDir, filename), `content-${i}`);
      // Set mtime to ensure monotonic ordering
      const mtime = new Date(now + i * 1000);
      utimesSync(path.join(backupDir, filename), mtime, mtime);
    }

    rotateBackups(10);

    const remaining = listBackups();
    expect(remaining.length).toBe(10);

    // The 2 oldest (filenames[0], filenames[1]) should be deleted
    expect(existsSync(path.join(backupDir, filenames[0]))).toBe(false);
    expect(existsSync(path.join(backupDir, filenames[1]))).toBe(false);

    // The 10 newest should remain
    for (let i = 2; i < 12; i++) {
      expect(existsSync(path.join(backupDir, filenames[i]))).toBe(true);
    }
  });

  test("Test 4 (rotation invariant: keeps 10 by name-sort with same mtime)", async () => {
    const { rotateBackups, listBackups, getBackupDir } = await import("../../src-bun/db/backups");

    const backupDir = getBackupDir();
    mkdirSync(backupDir, { recursive: true });

    // Create 12 files all sharing the same mtime — rotation falls back to name-sort
    const baseTime = new Date("2026-01-01T00:00:00.000Z");
    const filenames: string[] = [];
    for (let i = 0; i < 12; i++) {
      // Filenames are timestamp-prefixed with i embedded, so name-sort is predictable
      const filename = `store-2026-01-01T000000${String(i).padStart(3, "0")}Z.db`;
      filenames.push(filename);
      writeFileSync(path.join(backupDir, filename), `content-${i}`);
      utimesSync(path.join(backupDir, filename), baseTime, baseTime); // same mtime
    }

    rotateBackups(10);

    const remaining = listBackups();
    expect(remaining.length).toBe(10);
  });

  test("Test 5 (restoreBackup): copies backup bytes back to store.db", async () => {
    const { backupBeforeMigrate, listBackups, restoreBackup, getDbPath } = await import(
      "../../src-bun/db/backups"
    );

    const agenstrixDir = path.join(testHome, ".agenstrix");
    mkdirSync(agenstrixDir, { recursive: true });

    const originalContent = "original-db-content-12345";
    const dbPath = getDbPath();
    writeFileSync(dbPath, originalContent);

    // Create a backup
    backupBeforeMigrate();
    const backups = listBackups();
    expect(backups.length).toBe(1);
    const backupFilename = backups[0].filename;

    // Overwrite store.db with different content
    writeFileSync(dbPath, "modified-content-xyz");

    // Restore from backup
    restoreBackup(backupFilename);

    // Assert store.db now matches original content
    const restored = readFileSync(dbPath, "utf-8");
    expect(restored).toBe(originalContent);
  });
});
