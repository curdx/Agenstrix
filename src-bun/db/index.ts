/**
 * DB singleton + boot sequence (DB-DURABILITY-01).
 *
 * Key invariants:
 * - WAL mode enabled (journal_mode = WAL)
 * - journal_size_limit = 67108864 (64MB cap)
 * - foreign_keys = ON
 * - Pre-migrate backup to ~/.agenstrix/backups/ (keep 10)
 * - Periodic wal_checkpoint(PASSIVE) every 5 min (Pitfall 7: NOT TRUNCATE for periodic)
 * - Shutdown: wal_checkpoint(TRUNCATE) once, then close
 */
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import * as schema from "./schema";

export const AGENSTRIX_HOME = join(os.homedir(), ".agenstrix");
const DB_PATH = join(AGENSTRIX_HOME, "store.db");
const BACKUP_DIR = join(AGENSTRIX_HOME, "backups");
const BACKUP_KEEP = 10;

let _db: ReturnType<typeof drizzle> | null = null;
let _sqlite: Database | null = null;
let _checkpointTimer: ReturnType<typeof setInterval> | null = null;

function backupBeforeMigrate(): void {
  mkdirSync(BACKUP_DIR, { recursive: true });
  if (!existsSync(DB_PATH)) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(BACKUP_DIR, `store-${stamp}.db`);
  copyFileSync(DB_PATH, dest);

  // Rotate: keep only last BACKUP_KEEP files
  const backups = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("store-") && f.endsWith(".db"))
    .sort();
  while (backups.length > BACKUP_KEEP) {
    unlinkSync(join(BACKUP_DIR, backups.shift()!));
  }
}

export async function initDb(): Promise<ReturnType<typeof drizzle>> {
  if (_db) return _db;

  // Ensure home dir exists
  mkdirSync(AGENSTRIX_HOME, { recursive: true });

  // Backup before migrate (DB-DURABILITY-01)
  backupBeforeMigrate();

  // Open SQLite database
  const sqlite = new Database(DB_PATH, { create: true });

  // Critical PRAGMAs
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA synchronous = NORMAL;"); // Safe with WAL, much faster than FULL
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA journal_size_limit = 67108864;"); // 64MB WAL cap

  const db = drizzle(sqlite, { schema });

  // Run migrations (await even though bun:sqlite is sync — Pitfall 5)
  // NEVER use drizzle-kit push in production
  await migrate(db, { migrationsFolder: "./drizzle" });

  // WAL checkpoint ticker every 5 minutes
  // IMPORTANT: Use PASSIVE not TRUNCATE — TRUNCATE blocks active readers (Pitfall 7)
  _checkpointTimer = setInterval(() => {
    try {
      sqlite.exec("PRAGMA wal_checkpoint(PASSIVE);");
    } catch {
      // Best effort
    }
  }, 5 * 60 * 1000);

  // Keep interval from blocking process exit
  if (_checkpointTimer.unref) {
    _checkpointTimer.unref();
  }

  _sqlite = sqlite;
  _db = db;
  return db;
}

export function getDb(): ReturnType<typeof drizzle> {
  if (!_db) throw new Error("DB not initialized — call initDb() first");
  return _db;
}

export async function shutdownDb(): Promise<void> {
  if (_checkpointTimer) {
    clearInterval(_checkpointTimer);
    _checkpointTimer = null;
  }
  if (_sqlite) {
    // Final TRUNCATE checkpoint is safe at shutdown (no active readers)
    try {
      _sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch {
      // Best effort
    }
    _sqlite.close();
    _sqlite = null;
  }
  _db = null;
}
