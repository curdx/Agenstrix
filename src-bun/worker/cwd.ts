/**
 * CWD resolver helper (WORKTREE-CWD-01).
 * Phase 1: always uses process.cwd(). Phase 2+ will use workspace-selected path.
 */
import { realpath } from "node:fs/promises";
import { execSync } from "node:child_process";

export interface CwdOptions {
  requestedPath?: string; // Phase 2+: workspace-selected path
  workerId?: string; // Phase 2+: resolves to worktree path
}

export async function resolveCwd(opts: CwdOptions = {}): Promise<string> {
  // Phase 1: always use startup cwd (D-02: cwd = process.cwd())
  const raw = opts.requestedPath ?? process.cwd();

  // Resolve symlinks — critical for git worktree CWD verification
  const resolved = await realpath(raw);

  // Windows: convert to short path name for non-ASCII paths
  // (avoids MAX_PATH issues in ConPTY + old CMD)
  if (process.platform === "win32" && /[^\x00-\x7F]/.test(resolved)) {
    return getWindowsShortPath(resolved);
  }

  return resolved;
}

/**
 * Windows short path conversion via cmd.exe.
 * ASSUMED: exact kernel32.dll FFI signature needs verification during Windows CI (Plan 04).
 */
function getWindowsShortPath(longPath: string): string {
  try {
    // Fallback: use cmd /c "for %i in (path) do echo %~si"
    const result = execSync(`cmd /c for %i in ("${longPath}") do echo %~si`, {
      encoding: "utf8",
    }).trim();
    return result || longPath;
  } catch {
    return longPath; // Best-effort; log warning
  }
}
