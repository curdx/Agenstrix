/**
 * Structured logger using pino (INFRA-05).
 *
 * Exports:
 * - `logger`            — user-facing events; info+ to agenstrix-YYYY-MM-DD.log
 * - `diagnosticsLogger` — internal traces; debug+ to diagnostics-YYYY-MM-DD.log
 * - `flushLogger()`     — flush both streams (call on shutdown)
 *
 * Both loggers also mirror warn/error to stderr.
 *
 * Path resolution uses process.env.HOME so tests can override HOME to an isolated
 * tmpdir before importing this module.
 */

import { mkdirSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import pino from "pino";

function getLogsDir(): string {
  const home = process.env.HOME ?? os.homedir();
  return join(home, ".agenstrix", "logs");
}

function getDailyLogPath(prefix: string): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return join(getLogsDir(), `${prefix}-${today}.log`);
}

// Ensure logs dir exists at module load time.
// Re-evaluated lazily on first use via pino.destination so that if HOME
// is overridden by a test, the destination still resolves correctly.
try {
  mkdirSync(getLogsDir(), { recursive: true });
} catch {
  // Ignore if already exists
}

/**
 * Main (user-facing) logger.
 * - info+ writes to agenstrix-YYYY-MM-DD.log (daily rotation by filename)
 * - warn+ mirrors to stderr
 */
export const logger = pino(
  { level: "info" },
  pino.multistream([
    {
      stream: pino.destination({ dest: getDailyLogPath("agenstrix"), sync: false }),
      level: "info",
    },
    {
      stream: process.stderr,
      level: "warn",
    },
  ])
);

/**
 * Diagnostics logger for internal traces.
 * - debug+ writes to diagnostics-YYYY-MM-DD.log (daily rotation by filename)
 * - warn+ mirrors to stderr
 */
export const diagnosticsLogger = pino(
  { level: "debug" },
  pino.multistream([
    {
      stream: pino.destination({ dest: getDailyLogPath("diagnostics"), sync: false }),
      level: "debug",
    },
    {
      stream: process.stderr,
      level: "warn",
    },
  ])
);

/**
 * Flush all pino streams (call on shutdown).
 */
export async function flushLogger(): Promise<void> {
  return new Promise((resolve) => {
    let pending = 2;
    const done = () => {
      pending -= 1;
      if (pending === 0) resolve();
    };
    logger.flush((err) => {
      void err; // best effort
      done();
    });
    diagnosticsLogger.flush((err) => {
      void err; // best effort
      done();
    });
  });
}

export default logger;
