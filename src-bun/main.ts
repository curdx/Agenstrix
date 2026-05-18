/**
 * Agenstrix boot sequence.
 *
 * Flow (per D-10/11/12/13/14/15/16):
 * 1. parseCli(Bun.argv)
 * 2. If first launch, log "Created ~/.agenstrix/ (database + logs)"
 * 3. If doctor command, call reap() then exit
 * 4. runSelfTest(port) — checks bun version, claude, git, SQLite, port
 * 5. criticalFailure (SQLite unwritable) → print fix + exit(1) — D-12
 * 6. portAvailable=false → print --port hint + exit(1) — D-14
 * 7. initDb() — create DB with WAL, backup, migrate
 * 8. spawnWorker(echo-skeleton) — D-04 placeholder
 * 9. Bun.serve({ port, fetch, websocket, idleTimeout: 0 })
 * 10. openBrowser(url) — D-16
 * 11. Broadcast self-test warnings via SSE — D-10
 * 12. Wire SIGINT/SIGTERM for clean shutdown
 *
 * Exports startServer({ port? }) for tests.
 */
import { parseCli } from "./cli";
import { initDb, shutdownDb, AGENSTRIX_HOME } from "./db/index";
import { spawnWorker, killWorker, listWorkers } from "./worker/index";
import { runSelfTest } from "./system/selftest";
import { reap } from "./system/doctor";
import { openBrowser } from "./system/browser";
import { flushLogger } from "./system/logger";
import { setStartupInfo } from "./gateway/rest";
import { publishSseEvent } from "./gateway/sse";
import gateway, { websocket } from "./gateway/index";
import { existsSync } from "node:fs";
import logger from "./system/logger";

let _server: ReturnType<typeof Bun.serve> | null = null;
let _skeletonWorkerId: string | null = null;

/**
 * Start the server (for both CLI boot and test use).
 */
export async function startServer(opts: { port?: number } = {}): Promise<{
  port: number;
  stop: () => Promise<void>;
  skeletonWorkerId: string;
}> {
  const port = opts.port ?? 3000;

  // First-launch detection (D-15)
  const firstLaunch = !existsSync(AGENSTRIX_HOME);

  // Run self-test
  const selfTest = await runSelfTest(port);

  if (firstLaunch) {
    console.log("Created ~/.agenstrix/ (database + logs)");
  }

  // D-12: SQLite unwritable → hard exit
  if (selfTest.criticalFailure) {
    const msg =
      `FATAL: ~/.agenstrix/ is not writable (SQLite cannot create store.db).\n` +
      `Fix: ensure ${AGENSTRIX_HOME} exists and is writable.\n` +
      `  macOS/Linux: chmod u+w ~/.agenstrix\n` +
      `  Windows: check folder permissions in Explorer`;
    process.stderr.write(msg + "\n");
    process.exit(1);
  }

  // D-14: Port occupied → hard exit with --port hint
  if (!selfTest.portAvailable) {
    process.stderr.write(
      `Port ${port} is already in use.\n` +
        `Start Agenstrix on a different port: bunx agenstrix --port <N>\n`
    );
    process.exit(1);
  }

  // Initialize database
  await initDb();

  // Spawn skeleton echo worker (D-04: single worker placeholder)
  // Use nanoid for unique ID so tests don't collide with prior DB entries
  const { workerId } = await spawnWorker({
    cli: "echo-skeleton",
    cwd: process.cwd(),
    envMode: "no-worktree",
  });
  _skeletonWorkerId = workerId;

  // Set startup info for /healthz response
  setStartupInfo({
    skeletonWorkerId: workerId,
    cwd: process.cwd(),
    selfTestWarnings: selfTest.warnings,
  });

  // Start HTTP/WS/SSE server
  // idleTimeout: 0 — WS connections must not be closed by timeout (WS-1011-01)
  const server = Bun.serve({
    port,
    fetch: gateway.fetch,
    websocket,
    idleTimeout: 0,
  });

  _server = server;

  logger.info({ port, workerId }, "Agenstrix started");
  console.log(`Agenstrix backend listening on http://localhost:${port}`);

  // Broadcast self-test warnings via SSE so UI banner can show them (D-10)
  for (const warning of selfTest.warnings) {
    publishSseEvent({ type: "selftest.warning", warning });
  }

  // Stop function for tests
  const stop = async () => {
    // Kill the skeleton worker
    const workers = listWorkers();
    for (const w of workers) {
      await killWorker(w.id, true);
    }
    // Shutdown DB
    await shutdownDb();
    // Flush logger
    await flushLogger();
    // Stop server
    server.stop();
    _server = null;
    _skeletonWorkerId = null;
  };

  return { port, stop, skeletonWorkerId: workerId };
}

/**
 * Shutdown handler — clean 5-step shutdown (Phase 1 minimum).
 * Phase 5 implements full 11-step protocol.
 */
async function shutdown(exitCode = 0): Promise<never> {
  logger.info("Shutting down Agenstrix…");
  console.log("\nShutting down Agenstrix…");

  try {
    // Step 1: Kill active workers (SIGTERM → 5s → SIGKILL)
    const workers = listWorkers();
    await Promise.all(workers.map((w) => killWorker(w.id, true)));
  } catch {
    // Best effort
  }

  try {
    // Step 2: WAL checkpoint + close SQLite
    await shutdownDb();
  } catch {
    // Best effort
  }

  try {
    // Step 3: Stop HTTP server
    _server?.stop();
  } catch {
    // Best effort
  }

  try {
    // Step 4: Flush pino
    await flushLogger();
  } catch {
    // Best effort
  }

  // Step 5: Exit
  process.exit(exitCode);
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

// Only run boot sequence when executed directly (not when imported by tests)
if (import.meta.main) {
  const args = parseCli(Bun.argv);

  if (args.command === "doctor") {
    await reap();
    process.exit(0);
  }

  // Wire signal handlers for clean shutdown
  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));

  try {
    const { port, skeletonWorkerId } = await startServer({ port: args.port });

    // Auto-open browser (D-16) — fire and forget, silent on SSH/headless
    openBrowser(`http://localhost:${port}`);

    logger.info({ skeletonWorkerId }, "Skeleton worker started — waiting for connections");
  } catch (err) {
    console.error("Failed to start Agenstrix:", err);
    process.exit(1);
  }
}
