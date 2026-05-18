/**
 * Smoke test: POST /api/workers/:id/input — wire contract
 *
 * Regression coverage for CR-01: the chat input frontend was POSTing `{ text }`
 * while the server validates `{ data: string }`, so every chat message returned
 * HTTP 400 with no observable error in the UI.
 *
 * This test asserts the server contract directly so any future drift
 * (frontend OR backend) trips here loudly instead of going silent again.
 */
import { afterAll, expect, test } from "bun:test";

let stopFn: (() => Promise<void>) | null = null;

const TEST_PORT = 13105;

test("POST /api/workers/:id/input accepts { data } and rejects { text }", async () => {
  const { startServer } = await import("../../src-bun/main");
  const { spawnWorker } = await import("../../src-bun/worker/index");

  const { port, stop } = (await startServer({ port: TEST_PORT })) as {
    port: number;
    stop: () => Promise<void>;
    skeletonWorkerId: string;
  };
  stopFn = stop;

  const { workerId } = await spawnWorker({
    cli: "echo-skeleton",
    cwd: process.cwd(),
    envMode: "no-worktree",
  });

  // 1. Canonical contract: { data: string } returns 200
  const okResp = await fetch(`http://localhost:${port}/api/workers/${workerId}/input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: "echo hello\n" }),
  });
  expect(okResp.status).toBe(200);
  const okBody = (await okResp.json()) as { ok?: boolean };
  expect(okBody.ok).toBe(true);

  // 2. Old broken shape: { text: string } must NOT silently succeed —
  //    this is what shipped to the UI in Plan 01-01 and got CR-01-blocked.
  const badResp = await fetch(`http://localhost:${port}/api/workers/${workerId}/input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "echo bad\n" }),
  });
  expect(badResp.status).toBe(400);
}, 20000);

afterAll(async () => {
  if (stopFn) await stopFn();
});
