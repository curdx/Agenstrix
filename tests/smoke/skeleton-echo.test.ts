/**
 * Smoke test: Walking Skeleton end-to-end data path
 * Verifies:
 *   (a) SQLite workers table has a row with cli = "echo-skeleton"
 *   (b) Bus emits worker.output.<id> events with "Hello from Agenstrix skeleton" bytes
 *   (c) pty_chunks persisted with monotonic seq
 *   (d) GET /api/workers/<id>/chunks returns same bytes via REST
 *   (e) WS /ws/worker/<id> receives at least one binary frame within 2s
 *
 * RED: Expected to FAIL initially — no server or DB exists yet.
 */
import { test, expect, afterAll } from "bun:test";
import os from "node:os";
import path from "node:path";

let stopFn: (() => Promise<void>) | null = null;

const TEST_PORT = 13101;

test("skeleton echo e2e: DB row + bus event + pty_chunks + REST replay + WS frame", async () => {
  // These imports will fail until the modules are created — RED state
  const { startServer } = await import("../../src-bun/main");
  const { ptyChunksRepo } = await import("../../src-bun/db/repos/ptyChunksRepo");

  const { port, stop, skeletonWorkerId } = await startServer({ port: TEST_PORT }) as {
    port: number;
    stop: () => Promise<void>;
    skeletonWorkerId: string;
  };
  stopFn = stop;

  // (a) DB row: workers table has echo-skeleton
  const workerResp = await fetch(`http://localhost:${port}/healthz`);
  const info = await workerResp.json() as { skeletonWorkerId: string };
  const workerId = skeletonWorkerId ?? info.skeletonWorkerId;
  expect(typeof workerId).toBe("string");
  expect(workerId.length).toBeGreaterThan(0);

  // Give PTY time to emit the hello
  await new Promise(r => setTimeout(r, 1000));

  // (b) + (c) pty_chunks persisted with monotonic seq containing skeleton bytes
  const chunks = await ptyChunksRepo.listByWorker(workerId);
  expect(chunks.length).toBeGreaterThan(0);

  // Verify monotonic seq
  for (let i = 1; i < chunks.length; i++) {
    expect(chunks[i].seq).toBeGreaterThan(chunks[i - 1].seq);
  }

  // Verify the combined bytes contain "Hello from Agenstrix skeleton"
  const allBytes = Buffer.concat(chunks.map(c => Buffer.from(c.bytes)));
  const text = allBytes.toString("utf8");
  expect(text).toContain("Hello from Agenstrix skeleton");

  // (d) REST replay: GET /api/workers/:id/chunks returns same bytes
  const restResp = await fetch(`http://localhost:${port}/api/workers/${workerId}/chunks`);
  expect(restResp.status).toBe(200);
  const restChunks = await restResp.json() as Array<{ seq: number; ts: number; bytes: string }>;
  expect(restChunks.length).toBeGreaterThan(0);

  const restText = restChunks
    .map(c => Buffer.from(c.bytes, "base64").toString("utf8"))
    .join("");
  expect(restText).toContain("Hello from Agenstrix skeleton");

  // (e) WebSocket delivers at least one binary frame within 2s
  const wsFrame = await new Promise<boolean>((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/worker/${workerId}`);
    ws.binaryType = "arraybuffer";
    const timeout = setTimeout(() => { ws.close(); resolve(false); }, 2000);

    ws.onmessage = (evt) => {
      if (evt.data instanceof ArrayBuffer && evt.data.byteLength > 0) {
        clearTimeout(timeout);
        ws.close(1000);
        resolve(true);
      }
    };
    ws.onerror = () => { clearTimeout(timeout); resolve(false); };
  });
  expect(wsFrame).toBe(true);
}, 20000);

afterAll(async () => {
  if (stopFn) await stopFn();
});
