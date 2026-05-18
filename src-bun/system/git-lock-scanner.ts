/**
 * Git lock scanner — GIT-01 foundation.
 *
 * Scans repo paths for stale `.git/index.lock` files older than 5 minutes.
 * Phase 1: scans process.cwd() only. Phase 2+ extends to all registered repos.
 *
 * Security note (T-01-04-01): removeLock validates the path ends with
 * `/.git/index.lock` (POSIX) or `\.git\index.lock` (Windows) before unlinking.
 * This prevents accidental deletion of arbitrary files.
 *
 * NOTE on Phase 1 lock removal: only warn + provide manual `rm` command.
 * Phase 2 will inspect the lock file contents to verify the holder PID is dead
 * before auto-removing, providing a stronger safety guarantee.
 */
import { existsSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";

export interface StaleLock {
  path: string;
  ageMs: number;
  repoPath: string;
}

/**
 * Staleness threshold: 5 minutes in milliseconds.
 */
export const STALE_AGE_MS = 300_000;

/**
 * Scan one or more repository paths for stale `.git/index.lock` files.
 * A lock is considered stale if its mtime is more than STALE_AGE_MS (5 min) old.
 *
 * @param repoPaths - Array of repository root paths to scan.
 * @returns Array of stale lock entries (empty if none found).
 */
export async function scanGitLocks(repoPaths: string[]): Promise<StaleLock[]> {
  const results: StaleLock[] = [];

  for (const repoPath of repoPaths) {
    const lockPath = join(repoPath, ".git", "index.lock");
    try {
      if (!existsSync(lockPath)) {
        continue;
      }
      const stat = statSync(lockPath);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs > STALE_AGE_MS) {
        results.push({ path: lockPath, ageMs, repoPath });
      }
    } catch {
      // Missing .git dir, permission error, etc. — skip silently
      continue;
    }
  }

  return results;
}

/**
 * Remove a stale `.git/index.lock` file.
 *
 * Security guard (T-01-04-01): only paths ending with `/.git/index.lock` (POSIX)
 * or `\.git\index.lock` (Windows) are permitted. Throws for any other path.
 *
 * @param lockPath - Absolute path to the lock file.
 */
export function removeLock(lockPath: string): void {
  const normalised = resolve(lockPath);
  const isValidPosix = normalised.endsWith("/.git/index.lock");
  const isValidWindows = normalised.endsWith("\\.git\\index.lock");
  if (!isValidPosix && !isValidWindows) {
    throw new Error(
      `removeLock: path must end with /.git/index.lock — refusing to remove '${lockPath}'`
    );
  }
  unlinkSync(normalised);
}
