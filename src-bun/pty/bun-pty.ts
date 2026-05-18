/**
 * bun-pty FFI fallback implementation.
 * STATIC import required — bun --compile cannot dynamic-require (Landmine #10).
 *
 * This fallback is DORMANT in Phase 1 (walking skeleton uses Bun.Terminal).
 * Activated by: AGENSTRIX_PTY_BACKEND=bun-pty
 *
 * bun-pty API (from README): spawn(argv, { cols, rows, cwd, env })
 * Returns: { pid, write, resize, kill, on("data", cb), on("exit", cb) }
 * [ASSUMED — verify exact API signature before wiring in Plan 02+]
 */
// STATIC import required — bun --compile cannot dynamic-require .node/.so files
import { spawn as bunPtySpawn } from "bun-pty";
import type { PtyHandle, PtySpawnOpts } from "./handle";

export function createBunPtyFallback(_opts: PtySpawnOpts): PtyHandle {
  // SKELETON STUB — bun-pty API signature needs verification before wiring (Plan 02)
  // The spawn API is [ASSUMED] based on bun-pty README at time of research.
  // TODO (Plan 02): wire actual bun-pty API after verifying against installed package.
  void bunPtySpawn; // reference to ensure static import is retained by bundler

  throw new Error(
    "bun-pty fallback not yet wired — implementation deferred to Plan 02. " +
      "Set AGENSTRIX_PTY_BACKEND=bun-terminal (default) to use Bun.Terminal backend."
  );
}
