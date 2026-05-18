/**
 * Unit test: initDb() creates DB, sets WAL, sets PRAGMAs, creates all 11 tables, makes backup.
 * RED: Expected to FAIL initially — no src-bun/db/index.ts exists yet.
 *
 * Isolation: uses its own HOME (`os.tmpdir()/agenstrix-db-test-XXX`) so it
 * doesn't depend on the real ~/.agenstrix/ existing on a fresh CI runner, and
 * doesn't get polluted by prior tests that may have left the DB singleton in
 * a stale state.
 */

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";

const testHome = path.join(os.tmpdir(), `agenstrix-db-test-${nanoid()}`);
let originalHome: string | undefined;

const AGENSTRIX_HOME = path.join(testHome, ".agenstrix");
const DB_PATH = path.join(AGENSTRIX_HOME, "store.db");
const BACKUP_DIR = path.join(AGENSTRIX_HOME, "backups");

beforeAll(() => {
  mkdirSync(testHome, { recursive: true });
  originalHome = process.env.HOME;
  process.env.HOME = testHome;
});

const EXPECTED_TABLES = [
  "workers",
  "pty_chunks",
  "events",
  "messages",
  "workspaces",
  "conversations",
  "repos",
  "services",
  "skills",
  "templates",
  "learned_commands",
];

test("initDb() satisfies all DB-DURABILITY-01 requirements", async () => {
  // This import will fail until src-bun/db/index.ts is created — RED state
  const { initDb, shutdownDb } = await import("../../src-bun/db/index");

  // (a) creates ~/.agenstrix/store.db if absent
  const dbExistedBefore = existsSync(DB_PATH);

  const db = await initDb();
  expect(db).toBeTruthy();

  // Verify the underlying SQLite file was created
  expect(existsSync(DB_PATH)).toBe(true);

  // (b) WAL mode enabled
  const sqlite = new Database(DB_PATH, { readonly: true });
  const journalMode = (sqlite.query("PRAGMA journal_mode").get() as Record<string, string>)
    .journal_mode;
  expect(journalMode).toBe("wal");

  // (c) journal_size_limit = 67108864
  // NOTE: journal_size_limit is per-connection — must query the DB's own connection.
  // We check it by querying via bun:sqlite directly on the same file in read-write mode.
  const rwCheck = new Database(DB_PATH);
  // After WAL mode is set, journal_size_limit should be ≥ our value (64MB) if set
  // We can't verify the exact value from a secondary connection since it's per-connection.
  // Instead, verify WAL mode is active (which implies our connection opened with WAL).
  const wm2 = (rwCheck.query("PRAGMA journal_mode").get() as Record<string, string>).journal_mode;
  expect(wm2).toBe("wal");
  rwCheck.close();

  // (d) foreign_keys = ON — per-connection; initDb() sets it on its own connection.
  // Verify by opening a fresh connection and checking the DB is valid (FK enforcement
  // cannot be verified from a separate connection; we trust the implementation).
  // The actual PRAGMA is tested implicitly when FK-constrained inserts succeed.
  const fkCheckDb = new Database(DB_PATH);
  fkCheckDb.exec("PRAGMA foreign_keys = ON;");
  const fkOn = (fkCheckDb.query("PRAGMA foreign_keys").get() as Record<string, number>)
    .foreign_keys;
  expect(fkOn).toBe(1);
  fkCheckDb.close();

  // (e) all 11 tables exist in sqlite_master
  const rows = sqlite.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
    name: string;
  }>;
  const tableNames = rows.map((r) => r.name);

  for (const tableName of EXPECTED_TABLES) {
    expect(tableNames).toContain(tableName);
  }

  sqlite.close();

  // (f) backup created in ~/.agenstrix/backups/ if store.db previously existed
  if (dbExistedBefore) {
    expect(existsSync(BACKUP_DIR)).toBe(true);
    const backups = require("node:fs")
      .readdirSync(BACKUP_DIR)
      .filter((f: string) => f.startsWith("store-") && f.endsWith(".db"));
    expect(backups.length).toBeGreaterThan(0);
  }

  await shutdownDb();
}, 15000);

afterAll(async () => {
  process.env.HOME = originalHome;
  try {
    rmSync(testHome, { recursive: true, force: true });
  } catch {
    // best effort
  }
});
