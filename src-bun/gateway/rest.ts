/**
 * REST routes for Agenstrix.
 * - GET /healthz
 * - GET /api/workers
 * - GET /api/workers/:id/chunks
 * - POST /api/workers/:id/input
 * - POST /api/selftest/recheck (INFRA-06: re-check button in SelfTestDialog)
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { eventsRepo } from "../db/repos/eventsRepo";
import { ptyChunksRepo } from "../db/repos/ptyChunksRepo";
import { workersRepo } from "../db/repos/workersRepo";
import { runSelfTest, type SelfTestWarning } from "../system/selftest";
import { sendToWorker } from "../worker/index";
import { publishSseEvent } from "./sse";

// Store startup info for /healthz
let _startupInfo: {
  skeletonWorkerId: string | null;
  cwd: string;
  selfTestWarnings: SelfTestWarning[];
} = {
  skeletonWorkerId: null,
  cwd: process.cwd(),
  selfTestWarnings: [],
};

export function setStartupInfo(info: typeof _startupInfo): void {
  _startupInfo = info;
}

const app = new Hono();

// GET /healthz — liveness + startup info for UI bootstrap
app.get("/healthz", (c) => {
  return c.json({
    ok: true,
    bunVersion: Bun.version,
    skeletonWorkerId: _startupInfo.skeletonWorkerId,
    cwd: _startupInfo.cwd,
    selfTestWarnings: _startupInfo.selfTestWarnings,
  });
});

// GET /api/workers — list all workers
app.get("/api/workers", async (c) => {
  const workers = await workersRepo.list();
  return c.json(workers);
});

// GET /api/workers/:id/chunks — replay history (D-07: WeChat-style)
app.get("/api/workers/:id/chunks", async (c) => {
  const workerId = c.req.param("id");
  const chunks = await ptyChunksRepo.listByWorker(workerId);

  // Return as base64-encoded bytes (per RESEARCH.md §Pattern 4 client replay)
  return c.json(
    chunks.map((chunk) => ({
      seq: chunk.seq,
      ts: chunk.ts,
      bytes: Buffer.from(chunk.bytes).toString("base64"),
    }))
  );
});

// POST /api/workers/:id/input — inject stdin to PTY
app.post(
  "/api/workers/:id/input",
  zValidator("json", z.object({ data: z.string() })),
  async (c) => {
    const workerId = c.req.param("id");
    const { data } = c.req.valid("json");
    sendToWorker(workerId, data);
    return c.json({ ok: true });
  }
);

// POST /api/selftest/recheck — re-run self-test and broadcast result (INFRA-06)
// Wires the "Re-check" button in SelfTestDialog (Plan 01-01 Task 3 Step 12)
app.post("/api/selftest/recheck", async (c) => {
  // Use port from startup info (store on setStartupInfo or use a sentinel port)
  const result = await runSelfTest(0); // port=0: skip port check (already serving)
  const event = {
    type: "selftest.recompleted",
    payload: {
      claudeFound: result.claudeFound,
      gitFound: result.gitFound,
      sqliteWritable: result.sqliteWritable,
      bunOk: result.bunOk,
      warnings: result.warnings,
    },
  };
  // Broadcast via SSE so UI can update banner
  publishSseEvent(event);
  // Persist to events table (INFRA-06)
  await eventsRepo.append({ type: "selftest.recompleted", payload: event.payload });
  return c.json({ ok: true, ...event.payload });
});

export { app as restApp };
