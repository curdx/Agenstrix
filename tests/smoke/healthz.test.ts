/**
 * Smoke test: GET /healthz returns 200 with { ok: true, bunVersion: string }
 * RED: Expected to FAIL initially — no server exists yet.
 */
import { test, expect, afterAll } from "bun:test";

// Dynamic import so the test file loads even before the module exists
let startServer: (opts: { port?: number }) => Promise<{ port: number; stop: () => Promise<void> }>;
let stopFn: (() => Promise<void>) | null = null;

const TEST_PORT = 13100;

test("GET /healthz returns 200 with ok + bunVersion", async () => {
  // This import will fail until src-bun/main.ts is created — that's the RED state
  const mod = await import("../../src-bun/main");
  startServer = mod.startServer;

  const { port, stop } = await startServer({ port: TEST_PORT });
  stopFn = stop;

  const resp = await fetch(`http://localhost:${port}/healthz`);
  expect(resp.status).toBe(200);

  const body = await resp.json() as Record<string, unknown>;
  expect(body.ok).toBe(true);
  expect(typeof body.bunVersion).toBe("string");
  expect(body.bunVersion).toBeTruthy();
}, 15000);

afterAll(async () => {
  if (stopFn) await stopFn();
});
