/**
 * Unit test: initDb() creates DB, sets WAL, sets PRAGMAs, creates all 11 tables, makes backup.
 * RED: Expected to FAIL initially — no src-bun/db/index.ts exists yet.
 */
import { test, expect, afterAll } from "bun:test";
import os from "node:os";
import path from "node:path";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { Database } from "bun:sqlite";

const HOME = os.homedir();
const AGENSTRIX_HOME = path.join(HOME, ".agenstrix");
const DB_PATH = path.join(AGENSTRIX_HOME, "store.db");
const BACKUP_DIR = path.join(AGENSTRIX_HOME, "backups");

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
  const journalSizeLimit = (
    sqlite.query("PRAGMA journal_size_limit").get() as Record<string, number>
  ).journal_size_limit;
  expect(journalSizeLimit).toBe(67108864);

  // (d) foreign_keys = ON
  const fkOn = (sqlite.query("PRAGMA foreign_keys").get() as Record<string, number>).foreign_keys;
  expect(fkOn).toBe(1);

  // (e) all 11 tables exist in sqlite_master
  const rows = sqlite
    .query("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as Array<{ name: string }>;
  const tableNames = rows.map((r) => r.name);

  for (const tableName of EXPECTED_TABLES) {
    expect(tableNames).toContain(tableName);
  }

  sqlite.close();

  // (f) backup created in ~/.agenstrix/backups/ if store.db previously existed
  if (dbExistedBefore) {
    expect(existsSync(BACKUP_DIR)).toBe(true);
    const backups = require("node:fs").readdirSync(BACKUP_DIR).filter(
      (f: string) => f.startsWith("store-") && f.endsWith(".db")
    );
    expect(backups.length).toBeGreaterThan(0);
  }

  await shutdownDb();
}, 15000);

afterAll(async () => {
  // Cleanup: we don't delete the DB here as it's in the real home dir
  // Just ensure any handles are closed
});
