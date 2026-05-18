/**
 * CLI argument parser (D-13).
 * Supports:
 *   agenstrix          → { command: "start", port: 3000 }
 *   agenstrix start    → { command: "start", port: 3000 }
 *   agenstrix doctor   → { command: "doctor" }
 *   agenstrix --reap   → { command: "doctor", reap: true }
 *   agenstrix doctor --reap → { command: "doctor", reap: true }
 *   agenstrix doctor --reap --yes → { command: "doctor", reap: true, yes: true }
 *   --port <N>         → overrides default port
 */

export interface CliArgs {
  command: "start" | "doctor";
  port: number;
  reap: boolean;
  /** Non-interactive mode for doctor --reap: kills orphans without prompting. */
  yes: boolean;
}

export function parseCli(argv: string[]): CliArgs {
  // Strip the bun executable and script path (Bun.argv[0] = "bun", [1] = script path)
  // Process only the user-visible arguments
  const args = argv.slice(2);

  let command: "start" | "doctor" = "start";
  let port = 3000;
  let reap = false;
  let yes = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "start") {
      command = "start";
    } else if (arg === "doctor") {
      command = "doctor";
    } else if (arg === "--reap") {
      reap = true;
      if (command !== "doctor") command = "doctor";
    } else if (arg === "--yes" || arg === "-y") {
      yes = true;
    } else if (arg === "--port" && i + 1 < args.length) {
      const portStr = args[i + 1];
      const parsed = portStr ? parseInt(portStr, 10) : NaN;
      if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
        port = parsed;
        i++; // Skip the port value
      } else {
        console.error(`Invalid port value: ${portStr}`);
        process.exit(1);
      }
    }
  }

  return { command, port, reap, yes };
}
