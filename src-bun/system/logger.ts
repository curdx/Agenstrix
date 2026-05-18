/**
 * Structured logger using pino.
 * INFRA-05: daily-rotated log files at ~/.agenstrix/logs/agenstrix-YYYY-MM-DD.log
 */
import pino from "pino";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

const AGENSTRIX_HOME = join(os.homedir(), ".agenstrix");
const LOGS_DIR = join(AGENSTRIX_HOME, "logs");

// Ensure logs dir exists
try {
  mkdirSync(LOGS_DIR, { recursive: true });
} catch {
  // Ignore if already exists
}

function getDailyLogPath(): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return join(LOGS_DIR, `agenstrix-${today}.log`);
}

function getDailyDiagnosticsPath(): string {
  const today = new Date().toISOString().slice(0, 10);
  return join(LOGS_DIR, `diagnostics-${today}.log`);
}

const logger = pino(
  {
    level: "info",
  },
  pino.multistream([
    // Main log file (daily rotation via date in filename)
    {
      stream: pino.destination({ dest: getDailyLogPath(), sync: false }),
      level: "info",
    },
    // Diagnostics log (debug level, separate file)
    {
      stream: pino.destination({ dest: getDailyDiagnosticsPath(), sync: false }),
      level: "debug",
    },
    // Stderr mirror at warn level
    {
      stream: process.stderr,
      level: "warn",
    },
  ])
);

export default logger;

/**
 * Flush all pino streams (call on shutdown).
 */
export async function flushLogger(): Promise<void> {
  return new Promise((resolve) => {
    logger.flush((err) => {
      if (err) {
        // Best effort
      }
      resolve();
    });
  });
}
