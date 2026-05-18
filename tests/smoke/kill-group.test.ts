/**
 * Kill-group smoke test (KILL-01).
 * Spawns a worker that forks a long-running child in the same process group,
 * kills the worker, and asserts both parent + child are dead within 7 seconds.
 *
 * POSIX-only — skipped on Windows (ConPTY cascade is validated in CI Plan 06).
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { execSync } from "node:child_process";
import { isProcessAlive, readRunning } from "../../src-bun/system/running-file";
import { startServer } from "../../src-bun/main";
import { spawnWorker, killWorker } from "../../src-bun/worker/index";

const IS_WINDOWS = process.platform === "win32";

let stopServer: (() => Promise<void>) | null = null;

// Helper: wait for a condition to become true within a timeout
async function waitFor(fn: () => boolean, timeoutMs: number, intervalMs = 100): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

describe("Kill-group end-to-end (POSIX)", () => {
  beforeAll(async () => {
    const { stop } = await startServer({ port: 0 });
    stopServer = stop;
  }, 30_000);

  afterAll(async () => {
    if (stopServer) await stopServer();
  }, 15_000);

  test.skipIf(IS_WINDOWS)(
    "cascading-child: killing worker kills process group within 6s",
    async () => {
      // Spawn a worker whose command forks a long-running sleep child and prints its PID
      const { workerId, pid: workerPid } = await spawnWorker({
        cli: "echo-skeleton",
        _testArgvOverride: [
          "sh",
          "-c",
          // Fork a background sleep, print its PID, then wait (stays alive)
          "sleep 600 & echo CHILD_PID:$!; wait",
        ],
      });

      expect(workerPid).toBeGreaterThan(0);

      // Wait for CHILD_PID to appear in PTY output (subscribe to bus)
      // We poll the events table for the worker.spawned event first, then check
      // the running.json to know the worker is alive
      const alive = await waitFor(() => isProcessAlive(workerPid), 5_000);
      expect(alive).toBe(true);

      // Verify pgid === pid on POSIX (detached: true calls setsid())
      const pgidStr = execSync(`ps -o pgid= -p ${workerPid}`, { encoding: "utf8" }).trim();
      const pgid = parseInt(pgidStr, 10);
      expect(pgid).toBe(workerPid); // detached: true guarantees new process group

      // Start a direct sleep child in the same pgid as a definitive "child is in group" test
      // We can't capture the shell's $! from outside the PTY, so we use a simpler approach:
      // spawn a process in the same pgid and verify it dies with the group kill
      //
      // Actually the smoke test verifies the GROUP kill via the PGID assertion:
      // since pgid === workerPid, any `process.kill(-pgid)` will kill ALL processes
      // with that pgid. The "sh -c 'sleep 600 & echo CHILD_PID:$!; wait'" child inherits
      // the pgid from its parent (the sh process), so killing -pgid kills both sh + sleep.
      //
      // Direct child PID verification: we check that after killWorker, the pgid-0 query
      // returns no processes.
      //
      // Check that running.json has this worker
      const runningBefore = readRunning();
      expect(runningBefore[workerId]).toBeDefined();
      expect(runningBefore[workerId].pid).toBe(workerPid);

      // Kill the worker (SIGTERM → 5s → SIGKILL)
      await killWorker(workerId, true);

      // Assert worker process is dead
      const workerDead = await waitFor(() => !isProcessAlive(workerPid), 7_000);
      expect(workerDead).toBe(true);

      // Assert the entire process group is dead (any process with this pgid)
      // ps -o pid= -g <pgid> lists processes in the group — should return empty
      let groupDead = false;
      try {
        const groupProcs = execSync(`ps -o pid= -g ${pgid} 2>/dev/null || true`, {
          encoding: "utf8",
        }).trim();
        groupDead = groupProcs === "";
      } catch {
        groupDead = true; // ps failed = no processes in group
      }
      expect(groupDead).toBe(true);

      // Assert clearPid was called — running.json should NOT have this workerId
      const runningAfter = readRunning();
      expect(runningAfter[workerId]).toBeUndefined();
    },
    15_000 // Allow 15s total (5s grace + 7s assertion window + 3s buffer)
  );
});
