/**
 * Smoke test: WebSocket heartbeat keeps connections alive past 35s idle (WS-1011-01).
 *
 * Contract:
 *   - Open a WS to /ws/worker/:id
 *   - Do NOT send any messages
 *   - After 35s, ws.readyState === WebSocket.OPEN
 *   - At least one binary frame of byteLength === 0 was received (30s heartbeat)
 *
 * This verifies:
 *   - idleTimeout: 0 is set on Bun.serve (connection stays open indefinitely)
 *   - 30s server heartbeat sends an empty binary frame before the 35s mark
 *
 * Test timeout: 45s (35s wait + startup + buffer)
 */
import { afterAll, expect, test } from "bun:test";

let stopFn: (() => Promise<void>) | null = null;

const TEST_PORT = 13103;

test("ws-heartbeat: WS connection survives 35s idle + at least one empty binary heartbeat", async () => {
  const { startServer } = await import("../../src-bun/main");

  const { port, stop, skeletonWorkerId } = (await startServer({ port: TEST_PORT })) as {
    port: number;
    stop: () => Promise<void>;
    skeletonWorkerId: string;
  };
  stopFn = stop;

  const workerId = skeletonWorkerId;
  expect(typeof workerId).toBe("string");

  let heartbeatCount = 0;
  let finalReadyState = -1;

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/worker/${workerId}`);
    ws.binaryType = "arraybuffer";

    const timeout = setTimeout(() => {
      reject(new Error("WS connection timed out before opening"));
    }, 5_000);

    ws.onopen = () => {
      clearTimeout(timeout);

      // Schedule the 35s check
      setTimeout(() => {
        finalReadyState = ws.readyState;
        ws.close(1000);
        resolve();
      }, 35_000);
    };

    ws.onmessage = (evt) => {
      // Heartbeat = empty binary frame (byteLength === 0)
      if (evt.data instanceof ArrayBuffer && evt.data.byteLength === 0) {
        heartbeatCount++;
      }
    };

    ws.onerror = (err) => {
      reject(new Error(`WebSocket error: ${String(err)}`));
    };

    ws.onclose = (evt) => {
      // onclose fires after our deliberate ws.close(1000) — that's fine
      // But if it fires before resolve() due to server-side close, that's a failure
      if (finalReadyState === -1) {
        reject(new Error(`WebSocket closed unexpectedly with code ${evt.code}`));
      }
    };
  });

  // After 35s: connection must have still been OPEN when we checked
  expect(finalReadyState).toBe(WebSocket.OPEN); // 1

  // Must have received at least one heartbeat (30s cadence, so ≥1 in 35s)
  expect(heartbeatCount).toBeGreaterThanOrEqual(1);
}, 45_000);

afterAll(async () => {
  if (stopFn) await stopFn();
});
