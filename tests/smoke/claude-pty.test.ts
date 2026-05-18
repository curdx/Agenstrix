/**
 * Smoke test: Real `claude` PTY spawned and produces ANSI output (CORE-01).
 *
 * Contract:
 *   - If `claude` is not in PATH, test skips gracefully (D-01: only spawn if self-test passes)
 *   - Worker row in SQLite with cli = "claude"
 *   - Within 5s, pty_chunks contains at least one row with an ESC byte (0x1B)
 *     — proxy for "claude rendered ANSI output (ASCII logo / colors)"
 *   - Sending 0x04 (Ctrl+D) causes worker to exit; events table has worker.exited row
 *
 * Note: claude startup may be slow on first run (auth check, ASCII logo render).
 * Test timeout is 30s to accommodate slow startup.
 */
import { afterAll, expect, test } from "bun:test";
import { which } from "bun";

let stopFn: (() => Promise<void>) | null = null;

const TEST_PORT = 13102;

test(
  "claude-pty: real claude spawned → ANSI output persisted → Ctrl+D exits",
  async () => {
    const claudeBin = which("claude");
    if (!claudeBin) {
      console.log(
        "[SKIP] claude not in PATH — skipping claude-pty smoke test (D-01: no spawn when self-test fails)"
      );
      // Not a test failure — degraded-start mode is expected behavior
      return;
    }

    const { startServer } = await import("../../src-bun/main");
    const { ptyChunksRepo } = await import("../../src-bun/db/repos/ptyChunksRepo");
    const { eventsRepo } = await import("../../src-bun/db/repos/eventsRepo");
    const { sendToWorker } = await import("../../src-bun/worker/index");

    const { port, stop, skeletonWorkerId } = (await startServer({ port: TEST_PORT })) as {
      port: number;
      stop: () => Promise<void>;
      skeletonWorkerId: string;
    };
    stopFn = stop;

    // The server auto-spawned claude (D-01); skeletonWorkerId is now the master-claude workerId
    const workerId = skeletonWorkerId;
    expect(typeof workerId).toBe("string");
    expect(workerId.length).toBeGreaterThan(0);

    // Verify the worker row has cli = "claude"
    const resp = await fetch(`http://localhost:${port}/api/workers`);
    expect(resp.status).toBe(200);
    const workers = (await resp.json()) as Array<{
      id: string;
      cli: string;
      state: string;
    }>;
    const claudeWorker = workers.find((w) => w.id === workerId);
    expect(claudeWorker).toBeDefined();
    expect(claudeWorker?.cli).toBe("claude");

    // Wait up to 5s for at least one ESC-containing chunk (ANSI output from claude)
    const deadline = Date.now() + 5_000;
    let hasAnsi = false;
    while (Date.now() < deadline && !hasAnsi) {
      const chunks = await ptyChunksRepo.listByWorker(workerId);
      for (const chunk of chunks) {
        const bytes = Buffer.from(chunk.bytes);
        if (bytes.includes(0x1b)) {
          hasAnsi = true;
          break;
        }
      }
      if (!hasAnsi) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    expect(hasAnsi).toBe(true);

    // Send Ctrl+D to cause claude to exit
    // Send twice to be safe (some TUI apps need 2x Ctrl+D to confirm exit)
    sendToWorker(workerId, "\x04");
    await new Promise((r) => setTimeout(r, 500));
    sendToWorker(workerId, "\x04");

    // Wait up to 15s for worker.exited event in events table
    // claude may take several seconds to process Ctrl+D and exit cleanly
    const exitDeadline = Date.now() + 15_000;
    let exitedEventFound = false;
    while (Date.now() < exitDeadline && !exitedEventFound) {
      const events = await eventsRepo.listByWorker(workerId);
      exitedEventFound = events.some((e) => e.type === "worker.exited");
      if (!exitedEventFound) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    expect(exitedEventFound).toBe(true);
  },
  45_000
);

afterAll(async () => {
  if (stopFn) await stopFn();
});
