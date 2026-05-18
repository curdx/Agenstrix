/**
 * Doctor — orphan process reaper.
 * STUB in Phase 1: prints a notice. Plan 04 fully implements orphan scanning.
 */
import { join } from "node:path";
import os from "node:os";
import { existsSync, readFileSync } from "node:fs";

const RUNNING_FILE = join(os.homedir(), ".agenstrix", "running.json");

/**
 * STUB: Plan 04 replaces with real orphan scanner.
 * Reads running.json, checks if PIDs are still alive, prompts user to kill orphans.
 */
export async function reap(): Promise<void> {
  console.log("agenstrix doctor --reap: scanning for orphan processes…");

  if (!existsSync(RUNNING_FILE)) {
    console.log("No running.json found — no orphans to scan.");
    return;
  }

  try {
    const data = JSON.parse(readFileSync(RUNNING_FILE, "utf8")) as Record<
      string,
      { pid: number; pgid: number; startedAt: number }
    >;
    const workerIds = Object.keys(data);

    if (workerIds.length === 0) {
      console.log("No workers in running.json — no orphans detected.");
      return;
    }

    const orphans: string[] = [];
    for (const [workerId, { pid }] of Object.entries(data)) {
      if (isProcessAlive(pid)) {
        orphans.push(`Worker ${workerId} (PID ${pid})`);
      }
    }

    if (orphans.length === 0) {
      console.log("All tracked processes have exited — no orphans.");
    } else {
      console.log(`Found ${orphans.length} potential orphan(s):`);
      for (const o of orphans) {
        console.log(`  ${o}`);
      }
      console.log(
        "\nFull orphan reaper with interactive kill prompt not yet implemented — see Plan 04."
      );
      console.log(
        "To manually kill orphans, use: kill -9 <PID> (macOS/Linux) or taskkill /F /PID <PID> (Windows)"
      );
    }
  } catch {
    console.log("Failed to parse running.json — file may be corrupted.");
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
