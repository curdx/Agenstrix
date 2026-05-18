/**
 * Unit tests for spawn-env.ts (SEC-01 env allowlist + hard denylist).
 *
 * TDD RED: Tests fail against Plan 01 baseline (no HARD_DENYLIST export, no denylist override).
 * TDD GREEN: Passes after Plan 05 tightened implementation.
 */
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { buildSpawnEnv, ALLOWED_ENV_KEYS, HARD_DENYLIST, HARD_DENYLIST_PREFIXES } from "../../src-bun/worker/spawn-env";

// Save original env before each test, restore after
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  savedEnv = { ...process.env };
});

afterEach(() => {
  // Restore original env
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
});

describe("ALLOWED_ENV_KEYS export", () => {
  test("exports the 6 allowed keys", () => {
    expect(ALLOWED_ENV_KEYS).toContain("PATH");
    expect(ALLOWED_ENV_KEYS).toContain("HOME");
    expect(ALLOWED_ENV_KEYS).toContain("USER");
    expect(ALLOWED_ENV_KEYS).toContain("LANG");
    expect(ALLOWED_ENV_KEYS).toContain("SHELL");
    expect(ALLOWED_ENV_KEYS).toContain("TERM");
  });
});

describe("HARD_DENYLIST export", () => {
  test("HARD_DENYLIST is a Set and contains ANTHROPIC_API_KEY", () => {
    expect(HARD_DENYLIST).toBeInstanceOf(Set);
    expect(HARD_DENYLIST.has("ANTHROPIC_API_KEY")).toBe(true);
  });

  test("HARD_DENYLIST_PREFIXES is an array containing ANTHROPIC_ prefix", () => {
    expect(Array.isArray(HARD_DENYLIST_PREFIXES)).toBe(true);
    expect(HARD_DENYLIST_PREFIXES.some((p) => p === "ANTHROPIC_")).toBe(true);
  });
});

describe("buildSpawnEnv", () => {
  // Test 1: Default allowlist only passes the 6 keys
  test("Test 1 — Default allowlist: only PATH/HOME/USER/LANG/SHELL/TERM pass through", () => {
    // Set up a controlled env
    process.env.PATH = "/usr/bin:/bin";
    process.env.HOME = "/home/testuser";
    process.env.USER = "testuser";
    process.env.LANG = "en_US.UTF-8";
    process.env.SHELL = "/bin/zsh";
    process.env.TERM = "xterm-256color";
    process.env.EXTRA = "should-not-appear";
    process.env.CUSTOM_VAR = "also-should-not-appear";

    const env = buildSpawnEnv();

    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.HOME).toBe("/home/testuser");
    expect(env.USER).toBe("testuser");
    expect(env.LANG).toBe("en_US.UTF-8");
    expect(env.SHELL).toBe("/bin/zsh");
    expect(env.TERM).toBe("xterm-256color");

    // Extra vars must NOT appear
    expect(env.EXTRA).toBeUndefined();
    expect(env.CUSTOM_VAR).toBeUndefined();
  });

  // Test 2: User allowlist extends the default set
  test("Test 2 — User allowlist: extra keys added by user appear if they exist in process.env", () => {
    process.env.PATH = "/usr/bin";
    process.env.HOME = "/home/u";
    process.env.USER = "u";
    process.env.LANG = "C";
    process.env.SHELL = "/bin/sh";
    process.env.TERM = "xterm";
    process.env.MY_VAR = "my_value";
    process.env.NODE_OPTIONS = "--max-old-space-size=4096";

    const env = buildSpawnEnv(["MY_VAR", "NODE_OPTIONS"]);

    // Default keys present
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/u");
    // User-added keys also present
    expect(env.MY_VAR).toBe("my_value");
    expect(env.NODE_OPTIONS).toBe("--max-old-space-size=4096");
  });

  // Test 3: HARD DENYLIST overrides user allowlist
  test("Test 3 — Hard denylist wins: ANTHROPIC_API_KEY excluded even if in user allowlist", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-leakcheck-should-not-appear";

    const env = buildSpawnEnv(["ANTHROPIC_API_KEY"]);

    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    // Ensure the value doesn't appear under any key
    const values = Object.values(env);
    expect(values.some((v) => v.includes("sk-ant-leakcheck"))).toBe(false);
  });

  // Test 4: Full denylist coverage — all known secret vars are stripped
  test("Test 4 — Full denylist: all common API key vars stripped even with allowlist", () => {
    process.env.OPENAI_API_KEY = "sk-should-not-appear";
    process.env.AWS_SECRET_ACCESS_KEY = "aws-secret-should-not-appear";
    process.env.GITHUB_TOKEN = "ghp_should-not-appear";
    process.env.GH_TOKEN = "gh-token-should-not-appear";
    process.env.GITLAB_TOKEN = "gitlab-token-should-not-appear";
    process.env.NPM_TOKEN = "npm-token-should-not-appear";
    process.env.HF_TOKEN = "hf-token-should-not-appear";

    const env = buildSpawnEnv([
      "OPENAI_API_KEY",
      "AWS_SECRET_ACCESS_KEY",
      "GITHUB_TOKEN",
      "GH_TOKEN",
      "GITLAB_TOKEN",
      "NPM_TOKEN",
      "HF_TOKEN",
    ]);

    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GITLAB_TOKEN).toBeUndefined();
    expect(env.NPM_TOKEN).toBeUndefined();
    expect(env.HF_TOKEN).toBeUndefined();
  });

  // Test 5: GIT_* vars are always scrubbed (WORKTREE-CWD-01 regression)
  test("Test 5 — GIT_* scrub: GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE always stripped", () => {
    process.env.GIT_DIR = "/x/.git";
    process.env.GIT_WORK_TREE = "/x";
    process.env.GIT_INDEX_FILE = "/x/.git/index";

    // Even if somehow added to allowlist — should still be scrubbed
    const env = buildSpawnEnv(["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]);

    expect(env.GIT_DIR).toBeUndefined();
    expect(env.GIT_WORK_TREE).toBeUndefined();
    expect(env.GIT_INDEX_FILE).toBeUndefined();
  });

  // Test 6: Missing env vars do not appear as undefined keys
  test("Test 6 — Missing vars excluded: unset vars do not appear in result (no undefined values)", () => {
    // Temporarily remove HOME
    delete process.env.HOME;

    const env = buildSpawnEnv();

    // HOME must not be in the result at all (not even as undefined)
    expect("HOME" in env).toBe(false);

    // All values in the result must be defined strings
    for (const [key, value] of Object.entries(env)) {
      expect(typeof value).toBe("string");
      expect(value).toBeDefined();
    }
  });
});
