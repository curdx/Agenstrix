/**
 * Cross-platform PTY echo smoke test.
 *
 * Validates that Bun.Terminal spawns a process, emits bytes through the
 * bus pipeline, and that the kill path terminates the process on all platforms.
 *
 * Platform branching:
 * - POSIX: uses sh -c "echo hello; sleep 5"
 * - Windows: uses cmd.exe /c "echo hello & timeout /t 5 /nobreak >NUL"
 *
 * Kill-group POSIX tests are in tests/smoke/kill-group.test.ts.
 * Windows ConPTY-specific byte assertions are in tests/smoke/pty-echo-win.test.ts.
 */
import { test, expect, afterAll } from "bun:test";
import { startServer } from "../../src-bun/main";
import { spawnWorker, killWorker } from "../../src-bun/worker/index";
import { isProcessAlive } from "../../src-bun/system/running-file";

const TEST_PORT = 13106;

let stopFn: (() => Promise<void>) | null = null;

afterAll(async () => {
  if (stopFn) await stopFn();
});

test(
  "cross-platform PTY echo: bus receives bytes containing 'hello' within 3s",
  async () => {
    const { stop } = (await startServer({ port: TEST_PORT })) as {
      port: number;
      stop: () => Promise<void>;
    };
    stopFn = stop;

    // Platform-specific argv that echos "hello" then stays alive briefly
    const argv =
      process.platform === "win32"
        ? ["cmd.exe", "/c", "echo hello & timeout /t 5 /nobreak >NUL"]
        : ["sh", "-c", "echo hello; sleep 5"];

    const collected: Uint8Array[] = [];

    // Subscribe to bus before spawning
    const { bus } = await import("../../src-bun/bus/index");

    const { workerId, pid } = await spawnWorker({
      cli: "echo-skeleton",
      _testArgvOverride: argv,
    });

    // Collect bus events for worker output
    const unsubscribe = bus.subscribe(`worker.output.${workerId}`, (chunk: unknown) => {
      if (chunk instanceof Uint8Array) {
        collected.push(chunk);
      } else if (chunk instanceof Buffer) {
        collected.push(new Uint8Array(chunk));
      }
    });

    // Wait up to 3 seconds for output
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const combined = Buffer.concat(collected.map((c) => Buffer.from(c))).toString("utf8");
      if (combined.toLowerCase().includes("hello")) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    unsubscribe();

    const combined = Buffer.concat(collected.map((c) => Buffer.from(c))).toString("utf8");
    expect(combined.toLowerCase()).toContain("hello");

    // On Windows: verify the platform-branched kill() works
    if (process.platform === "win32") {
      await killWorker(workerId, false); // force kill
      // Wait up to 2s for process to die
      let dead = false;
      const killDeadline = Date.now() + 2_000;
      while (Date.now() < killDeadline) {
        if (!isProcessAlive(pid)) {
          dead = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(dead).toBe(true);
    } else {
      // POSIX: just kill the worker to clean up (kill-group cascade tested elsewhere)
      await killWorker(workerId, false);
    }
  },
  15_000
);
