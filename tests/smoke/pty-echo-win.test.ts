/**
 * Windows-only ConPTY validation smoke test.
 *
 * Validates:
 * - Bun.Terminal ConPTY spawns cmd.exe and captures bytes containing "hello\r\n"
 *   (Windows CRLF — asserts real ConPTY behavior, not a Bun normalization artifact)
 * - Bytes from `cmd /c ver` are received without exception
 * - Platform-branched kill() (process.kill(pid)) terminates the process
 *
 * NOTE on ConPTY byte re-encoding (RESEARCH.md Pitfall #8):
 * ConPTY re-encodes PTY output — escape sequences in the data callback are semantically
 * equivalent but NOT byte-identical to what cmd.exe emitted. We assert semantic content
 * ("hello" string present) rather than exact bytes. Do NOT assert POSIX-style LF-only output.
 *
 * This test CANNOT be validated locally on macOS — it will be (skipped) here
 * and exercised by the CI windows-latest runner.
 */
import { test, expect, afterAll } from "bun:test";
import { startServer } from "../../src-bun/main";
import { spawnWorker, killWorker } from "../../src-bun/worker/index";
import { isProcessAlive } from "../../src-bun/system/running-file";

const IS_WINDOWS = process.platform === "win32";

const TEST_PORT = 13107;

let stopFn: (() => Promise<void>) | null = null;

afterAll(async () => {
  if (stopFn) await stopFn();
});

test.skipIf(!IS_WINDOWS)(
  "Windows ConPTY: cmd.exe echo hello produces CRLF bytes within 5s",
  async () => {
    const { stop } = (await startServer({ port: TEST_PORT })) as {
      port: number;
      stop: () => Promise<void>;
    };
    stopFn = stop;

    const { bus } = await import("../../src-bun/bus/index");

    const collected: Uint8Array[] = [];

    const { workerId, pid } = await spawnWorker({
      cli: "echo-skeleton",
      _testArgvOverride: ["cmd.exe", "/c", "echo hello & timeout /t 10 /nobreak >NUL"],
    });

    const unsubscribe = bus.subscribe(`worker.output.${workerId}`, (chunk: unknown) => {
      if (chunk instanceof Uint8Array) {
        collected.push(chunk);
      } else if (chunk instanceof Buffer) {
        collected.push(new Uint8Array(chunk));
      }
    });

    // Wait up to 5 seconds for ConPTY output
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const combined = Buffer.concat(collected.map((c) => Buffer.from(c))).toString("utf8");
      // ConPTY Pitfall #8: assert semantic content only, not exact byte sequences
      if (combined.toLowerCase().includes("hello")) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    unsubscribe();

    const combined = Buffer.concat(collected.map((c) => Buffer.from(c)));
    const text = combined.toString("utf8");

    // Semantic assertion: "hello" is present
    expect(text.toLowerCase()).toContain("hello");

    // CRLF assertion: Windows ConPTY emits \r\n (not POSIX \n).
    // Combined output should contain a carriage-return byte somewhere
    // (ConPTY may inject CRLF even if cmd.exe didn't — this is the re-encoding in Pitfall #8)
    expect(combined.includes(0x0d /* \r */)).toBe(true);

    // Verify Windows platform-branched kill works (uses process.kill(pid), not -pgid)
    await killWorker(workerId, false); // SIGKILL branch

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
  },
  20_000
);

test.skipIf(!IS_WINDOWS)(
  "Windows ConPTY: cmd /c ver produces bytes without exception",
  async () => {
    const { bus } = await import("../../src-bun/bus/index");

    const collected: Uint8Array[] = [];
    let error: Error | null = null;

    let workerId: string;
    let pid: number;

    try {
      ({ workerId, pid } = await spawnWorker({
        cli: "echo-skeleton",
        _testArgvOverride: ["cmd.exe", "/c", "ver & timeout /t 5 /nobreak >NUL"],
      }));
    } catch (e) {
      error = e as Error;
    }

    // No exception during spawn
    expect(error).toBeNull();

    const unsubscribe = bus.subscribe(`worker.output.${workerId!}`, (chunk: unknown) => {
      if (chunk instanceof Uint8Array) {
        collected.push(chunk);
      } else if (chunk instanceof Buffer) {
        collected.push(new Uint8Array(chunk));
      }
    });

    // Wait up to 5s for any bytes (ver output)
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (collected.length > 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    unsubscribe();

    // We received at least some bytes (version string)
    expect(collected.length).toBeGreaterThan(0);
    const text = Buffer.concat(collected.map((c) => Buffer.from(c))).toString("utf8");
    // "ver" outputs something like "Microsoft Windows [Version 10.0.xxxxx]"
    expect(text.toLowerCase()).toContain("microsoft");

    await killWorker(workerId!, false);
  },
  20_000
);
