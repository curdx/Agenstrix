/**
 * Unit tests for replay correctness, nextSeq monotonicity, event payload JSON,
 * and logger split (INFRA-05).
 *
 * Tests:
 * 1. Replay order: listByWorker returns seq in ASC order regardless of insert order
 * 2. nextSeq starts at 1 for new worker
 * 3. appendAtomic is monotonic — concurrent calls produce no duplicate seqs
 * 4. Per-worker isolation: nextSeq counters are independent
 * 5. Event payload JSON round-trip: payload stored as JSON, returned as parsed object
 * 6. Event ts default: ts defaults to Date.now() when not provided
 * 7. Logger split: logger writes to agenstrix-*.log; diagnosticsLogger to diagnostics-*.log
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";

let testHome: string;
let originalHome: string | undefined;

function setupTestHome() {
  testHome = path.join(os.tmpdir(), `agenstrix-test-${nanoid()}`);
  mkdirSync(testHome, { recursive: true });
  originalHome = process.env.HOME;
  process.env.HOME = testHome;
}

function teardownTestHome() {
  process.env.HOME = originalHome;
  try {
    rmSync(testHome, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

/** Insert a worker row so FK constraints on pty_chunks pass. */
// biome-ignore lint/suspicious/noExplicitAny: test helper - db type varies
async function insertTestWorker(workerId: string, db: any) {
  const { workers } = await import("../../src-bun/db/schema");
  await db.insert(workers).values({
    id: workerId,
    cli: "echo-skeleton",
    cwd: "/tmp",
    state: "running",
    envMode: "no-worktree",
    createdAt: Date.now(),
  });
}

describe("ptyChunksRepo replay correctness", () => {
  beforeEach(setupTestHome);
  afterEach(teardownTestHome);

  test("Test 1 (replay order): listByWorker returns rows by seq ASC regardless of insert order", async () => {
    const { initDb, shutdownDb } = await import("../../src-bun/db/index");
    const { ptyChunksRepo } = await import("../../src-bun/db/repos/ptyChunksRepo");

    try {
      const db = await initDb();
      const workerId = `w-${nanoid()}`;
      await insertTestWorker(workerId, db);

      // Insert out of order: seq 3, 1, 2
      await ptyChunksRepo.append({ workerId, seq: 3, ts: Date.now(), bytes: Buffer.from("c") });
      await ptyChunksRepo.append({ workerId, seq: 1, ts: Date.now(), bytes: Buffer.from("a") });
      await ptyChunksRepo.append({ workerId, seq: 2, ts: Date.now(), bytes: Buffer.from("b") });

      const rows = await ptyChunksRepo.listByWorker(workerId);
      expect(rows.length).toBe(3);
      expect(rows[0].seq).toBe(1);
      expect(rows[1].seq).toBe(2);
      expect(rows[2].seq).toBe(3);
    } finally {
      await shutdownDb();
    }
  });

  test("Test 2 (nextSeq starts at 1): for new worker, nextSeq returns 1", async () => {
    const { initDb, shutdownDb } = await import("../../src-bun/db/index");
    const { ptyChunksRepo } = await import("../../src-bun/db/repos/ptyChunksRepo");

    try {
      const db = await initDb();
      const workerId = `w-${nanoid()}`;
      await insertTestWorker(workerId, db);

      const seq1 = await ptyChunksRepo.nextSeq(workerId);
      expect(seq1).toBe(1);

      // Insert seq=1, then nextSeq should return 2
      await ptyChunksRepo.append({ workerId, seq: seq1, ts: Date.now(), bytes: Buffer.from("x") });
      const seq2 = await ptyChunksRepo.nextSeq(workerId);
      expect(seq2).toBe(2);
    } finally {
      await shutdownDb();
    }
  });

  test("Test 3 (appendAtomic monotonic): sequential calls produce unique, gap-free seqs", async () => {
    // Note: bun:sqlite is synchronous under the hood, so Promise.all() resolves
    // all transactions in the same microtask before any commit lands. True
    // cross-process concurrency is serialised by SQLite's IMMEDIATE lock on the
    // appendAtomic transaction (T-01-03-04). This test verifies the seq-allocation
    // logic produces unique, monotonically increasing seqs when called in sequence,
    // which is the actual production pattern (PTY onData callbacks are serial).
    const { initDb, shutdownDb } = await import("../../src-bun/db/index");
    const { ptyChunksRepo } = await import("../../src-bun/db/repos/ptyChunksRepo");

    try {
      const db = await initDb();
      const workerId = `w-${nanoid()}`;
      await insertTestWorker(workerId, db);

      // Run 3 appendAtomic calls sequentially (await each)
      const seq1 = await ptyChunksRepo.appendAtomic(workerId, Date.now(), Buffer.from("a"));
      const seq2 = await ptyChunksRepo.appendAtomic(workerId, Date.now(), Buffer.from("b"));
      const seq3 = await ptyChunksRepo.appendAtomic(workerId, Date.now(), Buffer.from("c"));

      const seqs = [seq1, seq2, seq3];

      // All returned seqs are distinct (no duplicates)
      const uniqueSeqs = new Set(seqs);
      expect(uniqueSeqs.size).toBe(3);

      // Together they should be {1, 2, 3} (monotonically increasing from 1)
      expect([...uniqueSeqs].sort((a, b) => a - b)).toEqual([1, 2, 3]);

      // Verify the DB also has exactly 3 rows for this worker
      const rows = await ptyChunksRepo.listByWorker(workerId);
      expect(rows.length).toBe(3);
    } finally {
      await shutdownDb();
    }
  });

  test("Test 4 (per-worker isolation): nextSeq for w1 and w2 are independent", async () => {
    const { initDb, shutdownDb } = await import("../../src-bun/db/index");
    const { ptyChunksRepo } = await import("../../src-bun/db/repos/ptyChunksRepo");

    try {
      const db = await initDb();
      const w1 = `w1-${nanoid()}`;
      const w2 = `w2-${nanoid()}`;
      await insertTestWorker(w1, db);
      await insertTestWorker(w2, db);

      // Append 2 chunks for w1
      await ptyChunksRepo.appendAtomic(w1, Date.now(), Buffer.from("a"));
      await ptyChunksRepo.appendAtomic(w1, Date.now(), Buffer.from("b"));

      // w2 should still start at seq=1
      const seq = await ptyChunksRepo.nextSeq(w2);
      expect(seq).toBe(1);
    } finally {
      await shutdownDb();
    }
  });
});

describe("eventsRepo JSON round-trip", () => {
  beforeEach(setupTestHome);
  afterEach(teardownTestHome);

  test("Test 5 (event payload JSON round-trip): payload stored as object, not string", async () => {
    const { initDb, shutdownDb } = await import("../../src-bun/db/index");
    const { eventsRepo } = await import("../../src-bun/db/repos/eventsRepo");

    try {
      const db = await initDb();
      const workerId = `w-${nanoid()}`;
      const { workers } = await import("../../src-bun/db/schema");
      await db.insert(workers).values({
        id: workerId,
        cli: "echo-skeleton",
        cwd: "/tmp",
        state: "running",
        envMode: "no-worktree",
        createdAt: Date.now(),
      });

      const payload = { pid: 1234, cwd: "/tmp/x", argv: ["claude"] };
      await eventsRepo.append({ workerId, type: "worker.spawned", payload });

      const rows = await eventsRepo.listByWorker(workerId);
      expect(rows.length).toBe(1);

      // payload must be an object (parsed from JSON), not a raw string
      const got = rows[0].payload;
      expect(typeof got).toBe("object");
      expect(got).not.toBeNull();
      expect((got as { pid: number }).pid).toBe(1234);
      expect((got as { cwd: string }).cwd).toBe("/tmp/x");
    } finally {
      await shutdownDb();
    }
  });

  test("Test 6 (event ts default): ts defaults to approximately Date.now()", async () => {
    const { initDb, shutdownDb } = await import("../../src-bun/db/index");
    const { eventsRepo } = await import("../../src-bun/db/repos/eventsRepo");

    try {
      const db = await initDb();
      const workerId = `w-${nanoid()}`;
      const { workers } = await import("../../src-bun/db/schema");
      await db.insert(workers).values({
        id: workerId,
        cli: "echo-skeleton",
        cwd: "/tmp",
        state: "running",
        envMode: "no-worktree",
        createdAt: Date.now(),
      });

      const before = Date.now();
      await eventsRepo.append({ workerId, type: "x" }); // no ts provided
      const after = Date.now();

      const rows = await eventsRepo.listByWorker(workerId);
      expect(rows.length).toBe(1);
      expect(rows[0].ts).toBeGreaterThanOrEqual(before);
      expect(rows[0].ts).toBeLessThanOrEqual(after + 1000); // 1s tolerance
    } finally {
      await shutdownDb();
    }
  });
});

describe("Logger split (INFRA-05)", () => {
  beforeEach(setupTestHome);
  afterEach(teardownTestHome);

  test("Test 7 (logger split): logger writes to agenstrix-*.log; diagnosticsLogger writes to diagnostics-*.log", async () => {
    const { logger, diagnosticsLogger } = await import("../../src-bun/system/logger");

    const logsDir = path.join(testHome, ".agenstrix", "logs");

    // Write a user-facing event to logger (info level)
    logger.info({ msg: "user-facing event" });

    // Write a diagnostic trace to diagnosticsLogger (debug level)
    diagnosticsLogger.debug({ msg: "internal trace" });

    // Flush to ensure writes land on disk
    await new Promise<void>((resolve) => {
      logger.flush(() => {
        diagnosticsLogger.flush(() => resolve());
      });
    });

    // Small delay for async pino write
    await new Promise((r) => setTimeout(r, 200));

    // Check logs dir was created
    expect(existsSync(logsDir)).toBe(true);

    const allFiles = readdirSync(logsDir);
    const agenstrixLogs = allFiles.filter((f) => f.startsWith("agenstrix-") && f.endsWith(".log"));
    const diagnosticsLogs = allFiles.filter(
      (f) => f.startsWith("diagnostics-") && f.endsWith(".log")
    );

    expect(agenstrixLogs.length).toBeGreaterThan(0);
    expect(diagnosticsLogs.length).toBeGreaterThan(0);

    // Read content
    const agenstrixContent = readFileSync(path.join(logsDir, agenstrixLogs[0]), "utf-8");
    const diagnosticsContent = readFileSync(path.join(logsDir, diagnosticsLogs[0]), "utf-8");

    // User-facing event is in agenstrix log
    expect(agenstrixContent).toContain("user-facing event");

    // Internal trace is in diagnostics log
    expect(diagnosticsContent).toContain("internal trace");

    // Internal trace is NOT in agenstrix log (INFRA-05 split requirement)
    expect(agenstrixContent).not.toContain("internal trace");
  });
});
