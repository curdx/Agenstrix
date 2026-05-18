/**
 * Bun.Terminal-backed PtyHandle implementation.
 * Uses Bun.Terminal (POSIX + Windows ConPTY in Bun 1.3.14+).
 *
 * Critical patterns (from RESEARCH.md §Pattern 1):
 * - Wire onData in the Bun.Terminal constructor (NOT after spawn — Pitfall 1)
 * - Do NOT set stdin/stdout/stderr with terminal: option (Pitfall 2)
 * - Use detached: true for POSIX group kill; pgid = proc.pid after setsid()
 */
import type { PtyHandle, PtySpawnOpts } from "./handle";

export function createBunTerminalPty(opts: PtySpawnOpts): PtyHandle {
  const terminal = new Bun.Terminal({
    cols: opts.cols,
    rows: opts.rows,
    // Wire onData here in the constructor (Pitfall 1: data can arrive before spawn returns)
    data(_term: Bun.Terminal, chunk: Uint8Array) {
      opts.onData(chunk);
    },
  });

  const proc = Bun.spawn(opts.argv, {
    cwd: opts.cwd,
    env: opts.env,
    terminal, // PTY attach; makes isTTY=true for claude
    // DO NOT set stdin/stdout/stderr with terminal: option (Pitfall 2)
    detached: true, // POSIX: calls setsid() → new session + pgid = pid
  });

  // POSIX: proc.pid IS the new pgid because detached: true calls setsid()
  const pgid = proc.pid;

  void proc.exited.then((code) => opts.onExit(code ?? 0));

  return {
    pid: proc.pid,
    pgid,

    write(data: string): void {
      terminal.write(data);
    },

    resize(cols: number, rows: number): void {
      terminal.resize(cols, rows);
    },

    kill(sig: "SIGTERM" | "SIGKILL"): void {
      if (process.platform === "win32") {
        // Windows: ConPTY cascades kill to PTY children automatically
        // Negative-PID group-kill syntax is not supported on Windows (Pitfall 6)
        try {
          process.kill(proc.pid);
        } catch {
          // Already dead
        }
      } else {
        // POSIX: kill the entire process GROUP (not just the pid)
        try {
          process.kill(-pgid, sig === "SIGKILL" ? 9 : 15);
        } catch {
          // Process already dead — ignore ESRCH
        }
      }
    },

    exited: proc.exited,
  };
}
