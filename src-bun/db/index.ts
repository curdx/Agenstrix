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
import { mkdirSync } from "node:fs";
import * as schema from "./schema";
import { backupBeforeMigrate, getAgenstrixHome, getDbPath } from "./backups";

// Re-export for backward compat (main.ts uses AGENSTRIX_HOME constant).
// Note: since getAgenstrixHome() is lazy, this getter-based constant respects
// process.env.HOME overrides used in tests.
export const AGENSTRIX_HOME = getAgenstrixHome();

let _db: ReturnType<typeof drizzle> | null = null;
let _sqlite: Database | null = null;
let _checkpointCancel: (() => void) | null = null;

/**
 * Schedule WAL PASSIVE checkpoints at the given interval.
 * Returns a cancel function so it can be stopped on shutdown.
 *
 * Exported for testability (tests can call this directly with a short interval
 * rather than waiting 5 minutes).
 *
 * @param sqlite The open Database connection.
 * @param intervalMs Interval in milliseconds (default: 5 minutes).
 */
export function scheduleWalCheckpoint(
  sqlite: Database,
  intervalMs = 5 * 60 * 1000
): { cancel: () => void } {
  const timer = setInterval(() => {
    try {
      sqlite.exec("PRAGMA wal_checkpoint(PASSIVE);");
    } catch {
      // Best effort — don't crash if DB is being closed
    }
  }, intervalMs);

  // Prevent interval from blocking process exit in normal operation
  if (timer.unref) {
    timer.unref();
  }

  return {
    cancel: () => clearInterval(timer),
  };
}

/**
 * Returns the raw bun:sqlite Database instance.
 * Exported for testing PRAGMA values on the actual connection.
 * Throws if initDb() has not been called.
 */
export function getSqlite(): Database {
  if (!_sqlite) throw new Error("DB not initialized — call initDb() first");
  return _sqlite;
}

export async function initDb(): Promise<ReturnType<typeof drizzle>> {
  if (_db) return _db;

  // Ensure home dir exists
  mkdirSync(getAgenstrixHome(), { recursive: true });

  // Backup before migrate (DB-DURABILITY-01, T-01-03-01)
  backupBeforeMigrate();

  // Open SQLite database
  const sqlite = new Database(getDbPath(), { create: true });

  // Critical PRAGMAs
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA synchronous = NORMAL;"); // Safe with WAL, much faster than FULL
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA journal_size_limit = 67108864;"); // 64MB WAL cap (T-01-03-02)

  const db = drizzle(sqlite, { schema });

  // Run migrations (await even though bun:sqlite is sync — Pitfall 5)
  // NEVER use drizzle-kit push in production
  await migrate(db, { migrationsFolder: "./drizzle" });

  // WAL checkpoint ticker every 5 minutes.
  // IMPORTANT: Use PASSIVE not TRUNCATE — TRUNCATE blocks active readers (Pitfall 7).
  const { cancel } = scheduleWalCheckpoint(sqlite);
  _checkpointCancel = cancel;

  _sqlite = sqlite;
  _db = db;
  return db;
}

export function getDb(): ReturnType<typeof drizzle> {
  if (!_db) throw new Error("DB not initialized — call initDb() first");
  return _db;
}

export async function shutdownDb(): Promise<void> {
  if (_checkpointCancel) {
    _checkpointCancel();
    _checkpointCancel = null;
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
