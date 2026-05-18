/**
 * REST routes for Agenstrix.
 * - GET /healthz
 * - GET /api/workers/:id/chunks
 * - POST /api/workers/:id/input
 * - GET /api/workers
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { ptyChunksRepo } from "../db/repos/ptyChunksRepo";
import { workersRepo } from "../db/repos/workersRepo";
import { sendToWorker } from "../worker/index";
import type { SelfTestWarning } from "../system/selftest";

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

// POST /api/selftest/recheck — placeholder (Plan 02 wires)
app.post("/api/selftest/recheck", (c) => {
  return c.json({ ok: true, message: "Re-check not yet implemented — see Plan 02" }, 501);
});

export { app as restApp };
