/**
 * Spawn environment builder (SEC-01 + WORKTREE-CWD-01).
 * Only passes a minimal allowlist of env vars to PTY children.
 */

const ALLOWED_ENV_KEYS = ["PATH", "HOME", "USER", "LANG", "SHELL", "TERM"];

/**
 * Build a clean env for spawning PTY children.
 * Only allowed keys pass through; git env vars are explicitly deleted.
 */
export function buildSpawnEnv(allowlist: string[] = []): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of [...ALLOWED_ENV_KEYS, ...allowlist]) {
    const val = process.env[key];
    if (val !== undefined) {
      env[key] = val;
    }
  }

  // GIT isolation (WORKTREE-CWD-01): prevent git env vars from leaking into PTY child
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;

  return env;
}
