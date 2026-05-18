/**
 * Spawn environment builder (SEC-01 + WORKTREE-CWD-01).
 *
 * Security model:
 *   1. Allowlist: only ALLOWED_ENV_KEYS pass through by default.
 *   2. User extension: caller can pass additional keys via allowlist param.
 *   3. HARD_DENYLIST: specific known-secret vars always stripped, even if in user allowlist.
 *   4. HARD_DENYLIST_PREFIXES: key prefixes (ANTHROPIC_, OPENAI_, etc.) always stripped.
 *   5. GIT isolation (WORKTREE-CWD-01): GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE explicitly deleted.
 *
 * Precedence: denylist WINS over allowlist (defense in depth — user cannot accidentally leak secrets).
 */

/** The minimal set of env vars that PTY children always receive.
 *
 * POSIX side: PATH, HOME, USER, LANG, SHELL, TERM is enough for `claude` / `codex` / shells.
 *
 * Windows side: cmd.exe / pwsh / claude.exe need additional fundamentals to even start.
 * Without `SystemRoot`, cmd.exe cannot load DLLs from C:\Windows\System32 and produces
 * zero output (silent failure). `COMSPEC` points to cmd.exe, `PATHEXT` is how Windows
 * knows .exe/.cmd/.bat are executable, `TEMP`/`TMP` are required by many CLIs,
 * `USERPROFILE` is the Windows equivalent of `HOME` (some tools probe both).
 */
const POSIX_ENV_KEYS = ["PATH", "HOME", "USER", "LANG", "SHELL", "TERM"];
const WINDOWS_ENV_KEYS = [
  "SystemRoot", // canonical Windows casing (used by cmd.exe / pwsh / claude.exe)
  "SYSTEMROOT", // some runners normalize to uppercase
  "COMSPEC",
  "PATHEXT",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "USERNAME",
  "WINDIR",
  "PROCESSOR_ARCHITECTURE",
  "NUMBER_OF_PROCESSORS",
];
export const ALLOWED_ENV_KEYS: string[] =
  process.platform === "win32" ? [...POSIX_ENV_KEYS, ...WINDOWS_ENV_KEYS] : POSIX_ENV_KEYS;

/**
 * Hard-coded set of specific key names that are NEVER forwarded to PTY children,
 * regardless of whether the caller adds them to the allowlist.
 */
export const HARD_DENYLIST = new Set<string>([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "OPENAI_API_KEY",
  "OPENAI_ORGANIZATION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GITLAB_TOKEN",
  "NPM_TOKEN",
  "HF_TOKEN",
  "STRIPE_SECRET_KEY",
  "TWILIO_AUTH_TOKEN",
  "DATABASE_URL", // may contain embedded credentials
]);

/**
 * Key name prefixes that are NEVER forwarded.
 * Applied after the per-key HARD_DENYLIST check — catches env vars like
 * ANTHROPIC_NEW_FEATURE_KEY that don't appear in HARD_DENYLIST yet.
 */
export const HARD_DENYLIST_PREFIXES: string[] = [
  "ANTHROPIC_",
  "OPENAI_",
  "AWS_",
  "STRIPE_",
  "TWILIO_",
];

/**
 * Build a clean env for spawning PTY children.
 *
 * @param allowlist - Additional env var names to include beyond ALLOWED_ENV_KEYS.
 *                    Keys in HARD_DENYLIST or matching HARD_DENYLIST_PREFIXES are
 *                    always excluded even if listed here.
 * @returns A plain object with only the allowed, non-denied, defined env vars.
 */
export function buildSpawnEnv(allowlist: string[] = []): Record<string, string> {
  const env: Record<string, string> = {};

  // Union of default + user-provided keys (deduped via Set)
  const candidates = new Set<string>([...ALLOWED_ENV_KEYS, ...allowlist]);

  for (const key of candidates) {
    // Skip if in hard denylist (specific key name)
    if (HARD_DENYLIST.has(key)) continue;

    // Skip if key matches a hard-denied prefix
    if (HARD_DENYLIST_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;

    // Only include if the value is actually defined (no undefined keys in result)
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  // WORKTREE-CWD-01: explicit scrub of git environment vars.
  // These are deleted even if somehow they slipped past the allowlist
  // (e.g., if a future change adds GIT_* to ALLOWED_ENV_KEYS by mistake).
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;

  return env;
}
