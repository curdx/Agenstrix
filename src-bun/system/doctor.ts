/**
 * Doctor — orphan process reaper (KILL-01 / SETUP-01).
 * Full implementation replacing the Plan 01 stub.
 *
 * Reads ~/.agenstrix/running.json, cross-references each entry against
 * isProcessAlive(pid), clears dead entries automatically, and for live
 * (orphan) entries either kills them non-interactively (--yes) or prompts
 * the user per orphan (interactive mode).
 *
 * Threat: T-01-04-05 — process.kill requires same UID; non-owned PIDs throw
 * EPERM which is caught and logged.
 */
import { clearPid, isProcessAlive, readRunning } from "./running-file";

export interface ReapOptions {
  /** Non-interactive mode: kill all orphans without prompting (useful for CI / --yes flag). */
  yes?: boolean;
}

export interface ReapResult {
  found: number;
  killed: number;
  cleared: number;
}

/**
 * Reap orphan workers from running.json.
 *
 * Algorithm:
 * 1. Read running.json.
 * 2. For each entry:
 *    - If PID is dead: clear entry (hygiene cleanup) and increment `cleared`.
 *    - If PID is alive (orphan from crashed backend):
 *        - In --yes mode: kill the process group (POSIX) or pid (Windows),
 *          then clearPid, increment `killed`.
 *        - In interactive mode: prompt user (k=kill / s=skip / c=clear-from-file).
 * 3. Return summary { found, killed, cleared }.
 */
export async function reap(opts?: ReapOptions): Promise<ReapResult> {
  const running = readRunning();
  const entries = Object.entries(running);

  let found = 0;
  let killed = 0;
  let cleared = 0;

  for (const [workerId, entry] of entries) {
    const { pid, pgid } = entry;

    if (!isProcessAlive(pid)) {
      // Dead PID — just clean up the stale entry
      clearPid(workerId);
      cleared++;
      continue;
    }

    // Live PID — this is an orphan from a previous crashed backend session
    found++;

    if (opts?.yes) {
      await killOrphan(workerId, pid, pgid);
      killed++;
    } else {
      // Interactive mode: prompt user
      process.stdout.write(
        `\nOrphan worker: ${workerId} | PID: ${pid} | CLI: ${entry.cli} | CWD: ${entry.cwd}\n` +
          `  Started: ${new Date(entry.startedAt).toISOString()}\n` +
          `  [k]ill / [s]kip / [c]lear-from-file (remove entry without killing): `
      );

      const choice = await readLine();
      if (choice === "k" || choice === "kill") {
        await killOrphan(workerId, pid, pgid);
        killed++;
        console.log(`  Killed PID ${pid}.`);
      } else if (choice === "c" || choice === "clear") {
        clearPid(workerId);
        cleared++;
        console.log(`  Removed ${workerId} from running.json (process left running).`);
      } else {
        console.log(`  Skipped ${workerId}.`);
      }
    }
  }

  return { found, killed, cleared };
}

/**
 * Kill an orphan process and remove it from running.json.
 * POSIX: kill(-pgid) to terminate the whole process group.
 * Windows: kill(pid) — ConPTY cascades to children automatically.
 */
async function killOrphan(workerId: string, pid: number, pgid: number): Promise<void> {
  try {
    if (process.platform === "win32") {
      process.kill(pid);
    } else {
      // POSIX: kill entire process group (SIGKILL — orphan recovery is forceful)
      process.kill(-pgid, 9);
    }
  } catch (err: unknown) {
    // EPERM = we don't own the PID; ESRCH = already dead — both are acceptable
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "ESRCH") {
      // Unexpected error — log but continue
      process.stderr.write(
        `doctor: unexpected error killing PID ${pid}: ${String(err)}\n`
      );
    }
  }
  clearPid(workerId);
}

/**
 * Read a single line from stdin (for interactive prompts).
 */
async function readLine(): Promise<string> {
  return new Promise((resolve) => {
    // In non-TTY environments (e.g. piped stdin), default to "s" (skip)
    if (!process.stdin.isTTY) {
      resolve("s");
      return;
    }

    let line = "";
    const onData = (data: Buffer) => {
      const chunk = data.toString("utf8");
      for (const char of chunk) {
        if (char === "\n" || char === "\r") {
          process.stdin.removeListener("data", onData);
          process.stdin.pause();
          resolve(line.trim().toLowerCase());
          return;
        }
        line += char;
      }
    };

    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

/**
 * Prompt user to kill an orphan (preserved for API compatibility).
 * @deprecated Use reap() with interactive mode instead.
 */
export async function promptUserKill(
  workerId: string,
  pid: number,
  pgid: number
): Promise<boolean> {
  process.stdout.write(`Kill orphan ${workerId} (PID ${pid})? [y/N]: `);
  const choice = await readLine();
  if (choice === "y" || choice === "yes") {
    await killOrphan(workerId, pid, pgid);
    return true;
  }
  return false;
}
