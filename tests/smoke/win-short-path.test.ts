/**
 * Windows-only: getWindowsShortPath smoke test.
 *
 * Validates that the cmd.exe-based short-path resolution converts a non-ASCII
 * directory name into an ASCII-only 8.3 short path, and that the resulting
 * path still exists on the filesystem.
 *
 * This test CANNOT be validated locally on macOS — it will be (skipped) here
 * and exercised by the CI windows-latest runner.
 *
 * Short-path rationale (RESEARCH.md §Assumption A4 / §Pattern 8):
 * Windows ConPTY + old CMD have trouble with non-ASCII cwds because:
 * (a) cmd.exe uses legacy ACP codepage for paths by default
 * (b) ConPTY passes cwd as-is to CreateProcess; if non-ASCII chars aren't in
 *     the current codepage, the spawn silently uses the wrong cwd or fails.
 * Conversion to 8.3 short names (always ASCII) sidesteps this entirely.
 */
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmdirSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { getWindowsShortPath } from "../../src-bun/system/win-short-path";

const IS_WINDOWS = process.platform === "win32";

test.skipIf(!IS_WINDOWS)(
  "getWindowsShortPath: non-ASCII directory resolves to ASCII-only 8.3 path",
  () => {
    // Create a temp directory with a non-ASCII component
    // "agenstrix-测试-" uses CJK characters to guarantee non-ASCII
    let tmpdir: string;
    try {
      tmpdir = mkdtempSync(join(os.tmpdir(), "agenstrix-测试-"));
    } catch {
      // If Windows tmpdir itself cannot accept non-ASCII names (old codepage),
      // use a Latin-1 non-ASCII fallback to still exercise the function
      tmpdir = mkdtempSync(join(os.tmpdir(), "agenstrix-tëst-"));
    }

    try {
      const shortPath = getWindowsShortPath(tmpdir);

      // Result must be ASCII-only: no char code above 127
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ASCII range check
      expect(/^[\x00-\x7F]+$/.test(shortPath)).toBe(true);

      // Result must still be a valid, existing path
      expect(existsSync(shortPath)).toBe(true);
    } finally {
      // Clean up
      try {
        rmdirSync(tmpdir);
      } catch {
        // Ignore cleanup failure in tests
      }
    }
  }
);

test.skipIf(!IS_WINDOWS)(
  "getWindowsShortPath: ASCII-only path returns unchanged (fast path)",
  () => {
    const asciiPath = "C:\\Users\\test\\agenstrix";
    const result = getWindowsShortPath(asciiPath);
    // ASCII-only paths short-circuit without calling cmd.exe
    expect(result).toBe(asciiPath);
  }
);

test.skipIf(IS_WINDOWS)("getWindowsShortPath: no-op on POSIX (returns input unchanged)", () => {
  const posixPath = "/tmp/agenstrix-测试";
  const result = getWindowsShortPath(posixPath);
  expect(result).toBe(posixPath);
});
