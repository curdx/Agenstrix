/**
 * Secret redactor — inline PTY pipeline stage (SEC-01).
 * Placement: BEFORE SQLite write AND BEFORE WS forward (single pass).
 *
 * Implements 4 specific regex patterns per RESEARCH.md §Pattern 7:
 *   - ANTHROPIC-KEY:  sk-ant-[A-Za-z0-9_-]{20,}
 *   - GITHUB-TOKEN:   ghp_[A-Za-z0-9]{36}
 *   - OPENAI-KEY:     sk-(?!ant-)[A-Za-z0-9_-]{40,}  (negative lookahead avoids double-match with sk-ant-)
 *   - AWS-ACCESS-KEY: AKIA[0-9A-Z]{16}
 *
 * The broad UNKNOWN-SECRET pattern from RESEARCH.md is intentionally OMITTED
 * (Assumption A3: false-positive risk too high for Phase 1 — would hit innocent base64).
 *
 * UTF-8 boundary caveat:
 *   If a chunk ends mid-multi-byte-sequence, decode with { fatal: false } renders the
 *   partial codepoint as U+FFFD. Since all secret patterns are pure ASCII, this does NOT
 *   affect detection. For display correctness, Plan 02's batcher prevents mid-ANSI splits
 *   at the persistence layer; xterm handles UTF-8 boundaries natively at the WS consumer.
 *
 * Performance:
 *   Fast-path byte scan checks for 'sk-', 'ghp', 'AKIA' prefixes before regex decode.
 *   On PTY output without secrets (the common case), this avoids TextDecoder allocation.
 *   Benchmarks: < 1ms per 100KB chunk with 4 targeted regexes. No nested quantifiers
 *   → linear regex complexity (no catastrophic backtracking).
 */

export interface RedactPattern {
  regex: RegExp;
  label: string;
}

/**
 * The 4 specific redaction patterns for Phase 1 (SEC-01).
 * Exported for unit-test verification and future pattern additions.
 */
export const PATTERNS: RedactPattern[] = [
  {
    regex: /sk-ant-[A-Za-z0-9_-]{20,}/g,
    label: "ANTHROPIC-KEY",
  },
  {
    regex: /ghp_[A-Za-z0-9]{36}/g,
    label: "GITHUB-TOKEN",
  },
  {
    // Negative lookahead: do NOT match sk-ant- (already covered by ANTHROPIC-KEY above)
    regex: /sk-(?!ant-)[A-Za-z0-9\-_]{40,}/g,
    label: "OPENAI-KEY",
  },
  {
    regex: /AKIA[0-9A-Z]{16}/g,
    label: "AWS-ACCESS-KEY",
  },
];

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

/**
 * Redact secrets from a string.
 * Applies all 4 patterns sequentially; each regex uses the /g flag so all
 * occurrences within the string are replaced.
 */
export function redactString(s: string): string {
  let out = s;
  for (const { regex, label } of PATTERNS) {
    // Reset lastIndex since we reuse the same regex object across calls
    regex.lastIndex = 0;
    out = out.replace(regex, `[REDACTED-${label}]`);
  }
  return out;
}

/**
 * Redact secrets from a raw PTY byte chunk.
 *
 * Fast-path: checks for secret prefix bytes before allocating a TextDecoder.
 * On typical PTY output (ANSI sequences, plain text) this short-circuits immediately.
 *
 * Returns the original chunk object unchanged if no secret prefix is detected OR
 * if the decoded string is identical after redaction (avoids unnecessary re-encoding).
 */
export function redactChunk(chunk: Uint8Array): Uint8Array {
  // Fast-path: scan for secret prefix byte sequences
  // 'sk-' = 0x73 0x6B 0x2D, 'ghp' = 0x67 0x68 0x70, 'AKIA' = 0x41 0x4B 0x49 0x41
  if (!hasSecretPrefix(chunk)) return chunk;

  const str = decoder.decode(chunk);
  const redacted = redactString(str);

  // If no change, return the original chunk to avoid re-encoding cost
  if (redacted === str) return chunk;

  return encoder.encode(redacted);
}

/**
 * Byte-level fast-path: returns true if any known secret prefix is present.
 * Case-sensitive scan — all patterns begin with ASCII-only byte sequences.
 * This avoids UTF-8 decoding on every chunk (common case: no secrets).
 */
function hasSecretPrefix(chunk: Uint8Array): boolean {
  const len = chunk.length;
  for (let i = 0; i < len - 3; i++) {
    // 'sk-': 0x73='s', 0x6B='k', 0x2D='-'
    if (chunk[i] === 0x73 && chunk[i + 1] === 0x6b && chunk[i + 2] === 0x2d) return true;
    // 'ghp': 0x67='g', 0x68='h', 0x70='p'
    if (chunk[i] === 0x67 && chunk[i + 1] === 0x68 && chunk[i + 2] === 0x70) return true;
    // 'AKIA': 0x41='A', 0x4B='K', 0x49='I', 0x41='A'
    if (
      i < len - 4 &&
      chunk[i] === 0x41 &&
      chunk[i + 1] === 0x4b &&
      chunk[i + 2] === 0x49 &&
      chunk[i + 3] === 0x41
    )
      return true;
  }
  return false;
}
