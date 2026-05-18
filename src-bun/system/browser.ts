/**
 * Auto-open browser on startup (D-16).
 * macOS: open
 * Linux: xdg-open
 * Windows: start
 * SSH/headless: silent failure + print URL
 */
import logger from "./logger";

export function openBrowser(url: string): void {
  const platform = process.platform;
  let cmd: string;
  let args: string[];

  if (platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", url];
  } else {
    // Linux + others
    cmd = "xdg-open";
    args = [url];
  }

  try {
    const proc = Bun.spawn([cmd, ...args], {
      stdout: "ignore",
      stderr: "ignore",
    });
    // Don't await — fire and forget
    void proc.exited;
  } catch {
    // Silent on SSH/headless (D-16: "失败静默忽略，仅打印 URL")
    logger.warn({ url }, "Failed to open browser automatically");
  }

  console.log(`\nAgenstrix running at: ${url}\n`);
}
