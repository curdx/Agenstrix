/**
 * CWD resolver helper (WORKTREE-CWD-01).
 * Phase 1: always uses process.cwd(). Phase 2+ will use workspace-selected path.
 */
import { realpath } from "node:fs/promises";
import { getWindowsShortPath } from "../system/win-short-path";

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
  // getWindowsShortPath is a no-op on POSIX and a no-op for ASCII-only paths.
  if (process.platform === "win32") {
    return getWindowsShortPath(resolved);
  }

  return resolved;
}
