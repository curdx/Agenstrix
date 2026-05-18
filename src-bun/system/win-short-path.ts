/**
 * Resolve a path to its Windows 8.3 short-name form using cmd /c for %i in...
 *
 * IMPORTANT: This uses node:child_process execSync (synchronous, blocking).
 * MUST only be called at worker spawn time, never inside an HTTP/WS request handler —
 * the execSync call blocks the Bun event loop for the duration of the cmd.exe round trip
 * (typically 50–200ms on Windows). See RESEARCH.md §Pitfalls.
 */
import { execSync } from "node:child_process";

/**
 * Returns an ASCII-only 8.3 short path for non-ASCII Windows paths.
 * No-op on POSIX (returns input unchanged).
 * Uses `cmd /c for %i in ("<path>") do echo %~si` fallback per Pattern 8 / Assumption A4.
 *
 * Short-path rationale:
 * Windows ConPTY + old CMD have trouble with non-ASCII cwds because cmd.exe uses the
 * legacy ACP codepage for path resolution. Converting to 8.3 short names (always ASCII)
 * sidesteps codepage issues entirely. See RESEARCH.md §Assumption A4.
 */
export function getWindowsShortPath(longPath: string): string {
  if (process.platform !== "win32") return longPath;
  // ASCII-only fast path: every char code <= 127 means no non-ASCII chars
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ASCII range check
  if (/^[\x00-\x7F]+$/.test(longPath)) return longPath;
  try {
    // cmd.exe trick: `for %i in ("path") do @echo %~si` prints the short name
    // Escape double-quotes in path; PowerShell or special chars not supported in Phase 1
    const escaped = longPath.replace(/"/g, '""');
    const out = execSync(`cmd /c for %i in ("${escaped}") do @echo %~si`, {
      encoding: "utf8",
      windowsHide: true,
    }).trim();
    // execSync may return multi-line if iteration matched more than one; take first non-empty
    const firstLine = out.split(/\r?\n/).find((l) => l.length > 0);
    return firstLine || longPath;
  } catch {
    // Best-effort: return original path if cmd.exe fails
    return longPath;
  }
}
