/**
 * PtyHandle interface — abstraction over Bun.Terminal (primary) and bun-pty (fallback).
 * The factory function createPty() selects the backend via AGENSTRIX_PTY_BACKEND env var.
 */
import { createBunTerminalPty } from "./bun-terminal";
import { createBunPtyFallback } from "./bun-pty";

export interface PtyHandle {
  pid: number;
  pgid: number; // POSIX: process group ID; Windows: same as pid (ConPTY manages group)
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
  exited: Promise<number | null>;
}

export interface PtySpawnOpts {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  onData: (chunk: Uint8Array) => void;
  onExit: (code: number) => void;
}

/**
 * Factory: select PTY backend.
 * Default: Bun.Terminal (primary, POSIX + Windows ConPTY in Bun 1.3.14+)
 * Fallback: bun-pty (FFI, set AGENSTRIX_PTY_BACKEND=bun-pty to activate)
 */
export function createPty(opts: PtySpawnOpts): PtyHandle {
  const useFallback =
    process.env.AGENSTRIX_PTY_BACKEND === "bun-pty";
  return useFallback ? createBunPtyFallback(opts) : createBunTerminalPty(opts);
}
