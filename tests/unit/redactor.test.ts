/**
 * Unit tests for the secret redactor (SEC-01).
 * Tests all 4 specific regex patterns: Anthropic, GitHub, OpenAI, AWS.
 * Also tests UTF-8 multi-byte safety and performance guard.
 *
 * TDD RED: These tests FAIL against the identity stub in Plan 01.
 * TDD GREEN: Passes after Plan 05 real implementation.
 */
import { describe, expect, test } from "bun:test";
import { PATTERNS, redactChunk, redactString } from "../../src-bun/pty/redactor";

describe("PATTERNS export", () => {
  test("exports exactly 4 patterns (no broad UNKNOWN-SECRET per Assumption A3)", () => {
    expect(PATTERNS).toHaveLength(4);
    // Verify the 4 specific pattern labels
    const labels = PATTERNS.map((p) => p.label);
    expect(labels).toContain("ANTHROPIC-KEY");
    expect(labels).toContain("GITHUB-TOKEN");
    expect(labels).toContain("OPENAI-KEY");
    expect(labels).toContain("AWS-ACCESS-KEY");
    // Broad UNKNOWN-SECRET pattern dropped per Assumption A3 to avoid false positives
    expect(labels).not.toContain("UNKNOWN-SECRET");
  });
});

describe("redactString — per-pattern tests", () => {
  // Test 1: Anthropic key redaction
  test("Test 1 — Anthropic key: sk-ant-api03-... → [REDACTED-ANTHROPIC-KEY]", () => {
    const input = "Bearer sk-ant-api03-aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890abcdefghij";
    const result = redactString(input);
    expect(result).toContain("[REDACTED-ANTHROPIC-KEY]");
    expect(result).not.toContain("sk-ant-api03-aBcDeFgHiJkLmNoPqRsTuVwXyZ");
    // The "Bearer " prefix must remain
    expect(result).toContain("Bearer ");
  });

  // Test 2: GitHub token redaction
  test("Test 2 — GitHub token: ghp_<36 chars> → [REDACTED-GITHUB-TOKEN]", () => {
    const input = "token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    // ghp_ + 36 alphanumeric chars = exactly 40 total
    const result = redactString(input);
    expect(result).toContain("[REDACTED-GITHUB-TOKEN]");
    expect(result).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    // The "token=" prefix must remain
    expect(result).toContain("token=");
  });

  // Test 3: OpenAI key redaction (sk- but NOT sk-ant-)
  test("Test 3 — OpenAI key: sk-proj-<40+ chars> → [REDACTED-OPENAI-KEY]", () => {
    // A real OpenAI key: sk- followed by 40+ alphanumeric/dash/underscore, no 'ant-' prefix
    const input = "OPENAI_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789abcdefgh";
    const result = redactString(input);
    expect(result).toContain("[REDACTED-OPENAI-KEY]");
    expect(result).not.toContain("sk-proj-abcdefghijklmnopq");
    expect(result).toContain("OPENAI_KEY=");
  });

  // Test 3b: OpenAI key with sk- prefix NOT matching sk-ant-
  test("Test 3b — OpenAI key: negative lookahead prevents sk-ant- double-match", () => {
    const input = "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghij";
    const result = redactString(input);
    // Must be matched as ANTHROPIC-KEY, NOT as OPENAI-KEY
    expect(result).toContain("[REDACTED-ANTHROPIC-KEY]");
    expect(result).not.toContain("[REDACTED-OPENAI-KEY]");
  });

  // Test 4: AWS access key redaction
  test("Test 4 — AWS access key: AKIA<16 uppercase chars> → [REDACTED-AWS-ACCESS-KEY]", () => {
    const input = "AKIAIOSFODNN7EXAMPLE";
    // AKIA + 16 uppercase alphanumeric chars
    const result = redactString(input);
    expect(result).toContain("[REDACTED-AWS-ACCESS-KEY]");
    expect(result).not.toContain("AKIAIOSFODNN");
  });

  // Test 5: No false positive on innocent base64-like string
  test("Test 5 — No false positive: innocent base64 string NOT redacted", () => {
    // 38-char base64 string — under the 40+ threshold for broad patterns.
    // More importantly, the 4 specific patterns (sk-ant-/ghp_/sk-/AKIA) do NOT match base64.
    const input = "here is some base64: aGVsbG8gd29ybGQgZnJvbSB0aGU";
    const result = redactString(input);
    // No pattern should match this innocent string
    expect(result).toBe(input);
    expect(result).not.toContain("[REDACTED-");
  });

  // Test 6: Multiple keys in one string
  test("Test 6 — Multiple keys: both Anthropic AND GitHub keys in one string are redacted", () => {
    const anthropicKey = "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789abcdefghi";
    const githubToken = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const input = `ANTHROPIC=${anthropicKey} GITHUB=${githubToken}`;
    const result = redactString(input);
    expect(result).toContain("[REDACTED-ANTHROPIC-KEY]");
    expect(result).toContain("[REDACTED-GITHUB-TOKEN]");
    expect(result).not.toContain("sk-ant-api03-");
    expect(result).not.toContain("ghp_ABCDEFGHIJ");
    // Prefixes must remain
    expect(result).toContain("ANTHROPIC=");
    expect(result).toContain("GITHUB=");
  });
});

describe("redactChunk — binary chunk handling", () => {
  // Test 7: UTF-8 multi-byte characters preserved
  test("Test 7 — UTF-8 safety: Chinese chars + secret key → no mojibake", () => {
    const input = "hello 你好 sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789abcde";
    const inputBytes = new TextEncoder().encode(input);
    const result = redactChunk(inputBytes);
    const decoded = new TextDecoder("utf-8").decode(result);
    // Chinese characters must survive intact
    expect(decoded).toContain("你好");
    expect(decoded).toContain("hello ");
    // Secret must be redacted
    expect(decoded).toContain("[REDACTED-ANTHROPIC-KEY]");
    expect(decoded).not.toContain("sk-ant-api03-");
  });

  // Test 8: Passthrough identity for innocent ASCII
  test("Test 8 — Identity passthrough: plain ASCII without secrets returns byte-equal result", () => {
    const input = "plain ascii output\n";
    const inputBytes = new TextEncoder().encode(input);
    const result = redactChunk(inputBytes);
    // Bytes must be equal (content identity)
    expect(result).toEqual(inputBytes);
  });

  // Test 9: 50KB chunk of random alphanumerics — no spurious replacements
  test("Test 9 — No spurious replacements: 50KB alphanumeric chunk passes through unchanged", () => {
    // Generate a 50KB chunk that contains none of the secret prefixes
    // Use 'B' repeated — no 'sk-', no 'ghp_', no 'AKIA'
    const alphanumericChunk = "B".repeat(51200);
    const inputBytes = new TextEncoder().encode(alphanumericChunk);
    const result = redactChunk(inputBytes);
    expect(result).toEqual(inputBytes);
  });

  // Test 10: Performance guard — 100KB chunk < 50ms (guards against catastrophic backtracking)
  test("Test 10 — Performance guard: 100KB chunk with secrets completes in < 50ms", () => {
    // Construct: 100KB 'A' prefix + secret + 'B' suffix
    // This exercises the pattern matching on a large payload
    const bigChunk =
      "A".repeat(50000) +
      "sk-ant-api03-fakekey1234567890abcdefghijklmnopqrstuvwxyz" +
      "B".repeat(50000);
    const inputBytes = new TextEncoder().encode(bigChunk);

    const start = performance.now();
    const result = redactChunk(inputBytes);
    const elapsed = performance.now() - start;

    // Guard: must complete in < 50ms (loose ceiling for catastrophic regex detection)
    expect(elapsed).toBeLessThan(50);

    // Also verify the secret was actually redacted
    const decoded = new TextDecoder().decode(result);
    expect(decoded).toContain("[REDACTED-ANTHROPIC-KEY]");
    expect(decoded).not.toContain("sk-ant-api03-fakekey");
  });
});
