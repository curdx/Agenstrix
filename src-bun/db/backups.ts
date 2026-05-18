/**
 * DB backup utilities for ~/.agenstrix/store.db.
 *
 * Security: restoreBackup validates the filename against a strict regex AND
 * asserts the resolved path is inside BACKUP_DIR to prevent path traversal
 * (Threat T-01-03-03).
 *
 * Note: All path-resolution functions are lazy (called at runtime, not module
 * load time) so that tests can override process.env.HOME before calling them.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const BACKUP_KEEP = 10;

/**
 * Resolve ~/.agenstrix at call time.
 * Uses process.env.HOME when set (enables test isolation by overriding HOME),
 * falling back to os.homedir() for normal operation.
 */
export function getAgenstrixHome(): string {
  const home = process.env.HOME ?? homedir();
  return join(home, ".agenstrix");
}

/** Resolve ~/.agenstrix/store.db at call time. */
export function getDbPath(): string {
  return join(getAgenstrixHome(), "store.db");
}

/** Resolve ~/.agenstrix/backups at call time. */
export function getBackupDir(): string {
  return join(getAgenstrixHome(), "backups");
}

/**
 * Create a timestamped copy of store.db before a migration runs.
 * - No-op if store.db does not yet exist (first-run scenario).
 * - After copying, rotates to keep only the last BACKUP_KEEP backups.
 */
export function backupBeforeMigrate(): void {
  const dbPath = getDbPath();
  const backupDir = getBackupDir();
  mkdirSync(backupDir, { recursive: true });

  if (!existsSync(dbPath)) return;

  // Timestamp in ISO format, colon/dot replaced to be filesystem-safe
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(backupDir, `store-${stamp}.db`);
  copyFileSync(dbPath, dest);

  rotateBackups(BACKUP_KEEP);
}

/**
 * List all backup files sorted by mtime descending (newest first).
 * Filenames follow the pattern `store-<ISO-stamp>.db`.
 */
export function listBackups(): Array<{ filename: string; sizeBytes: number; mtimeMs: number }> {
  const backupDir = getBackupDir();
  if (!existsSync(backupDir)) return [];

  return readdirSync(backupDir)
    .filter((f) => /^store-.*\.db$/.test(f))
    .map((f) => {
      const st = statSync(join(backupDir, f));
      return { filename: f, sizeBytes: st.size, mtimeMs: st.mtimeMs };
    })
    .sort((a, b) => {
      // Primary: mtime desc; secondary: filename desc (deterministic for same mtime)
      if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
      return b.filename.localeCompare(a.filename);
    });
}

/**
 * Delete the oldest backups until at most `keep` remain.
 * "Oldest" is determined by mtime ascending (smallest mtime = oldest).
 * When mtimes tie, the lexicographically smallest filename is treated as oldest.
 *
 * @param keep Maximum number of backups to retain (default: BACKUP_KEEP = 10).
 */
export function rotateBackups(keep: number = BACKUP_KEEP): void {
  const backupDir = getBackupDir();
  if (!existsSync(backupDir)) return;

  // Sort oldest-first (ascending mtime)
  const files = readdirSync(backupDir)
    .filter((f) => /^store-.*\.db$/.test(f))
    .map((f) => {
      const st = statSync(join(backupDir, f));
      return { filename: f, mtimeMs: st.mtimeMs };
    })
    .sort((a, b) => {
      if (a.mtimeMs !== b.mtimeMs) return a.mtimeMs - b.mtimeMs;
      return a.filename.localeCompare(b.filename);
    });

  // Remove oldest until we are at or under the keep limit
  while (files.length > keep) {
    const oldest = files.shift();
    if (!oldest) break;
    unlinkSync(join(backupDir, oldest.filename));
  }
}

/**
 * Restore a backup to store.db.
 *
 * Security:
 * - filename must match `^store-.*\.db$` (rejects path separators and "..")
 * - resolved destination must be inside BACKUP_DIR (defense-in-depth against
 *   exotic Unicode path traversal)
 *
 * @param filename Bare filename (no directory component), e.g. "store-2026-01-01T000000Z.db"
 */
export function restoreBackup(filename: string): void {
  if (!/^store-[^/\\]+\.db$/.test(filename)) {
    throw new Error(`Invalid backup filename: ${JSON.stringify(filename)}`);
  }

  const backupDir = getBackupDir();
  const backupPath = resolve(backupDir, filename);

  // Ensure the resolved path is strictly inside BACKUP_DIR (path-traversal guard)
  const canonicalDir = resolve(backupDir);
  if (!backupPath.startsWith(`${canonicalDir}/`) && backupPath !== canonicalDir) {
    throw new Error(`Path traversal detected: ${JSON.stringify(filename)}`);
  }

  if (!existsSync(backupPath)) {
    throw new Error(`Backup not found: ${filename}`);
  }

  copyFileSync(backupPath, getDbPath());
}
