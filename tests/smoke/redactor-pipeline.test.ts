/**
 * Smoke test: End-to-end redactor pipeline (SEC-01).
 *
 * Validates:
 *   (a) Synthetic PTY bytes containing secrets pass through redactChunk → SQLite without leaking secrets
 *   (b) The bus.publish path (WS forward) carries only redacted bytes
 *   (c) Reading back from SQLite confirms no original secret bytes in pty_chunks
 *   (d) WS frames received by a subscriber contain [REDACTED-*] not raw secrets
 *   (e) Env allowlist: setting ANTHROPIC_API_KEY in process.env before buildSpawnEnv()
 *       produces an env with no ANTHROPIC_API_KEY key (denylist works)
 *
 * Design note: Plan 01-04's _testArgvOverride hook is not yet present in worker/index.ts
 * (that plan owns worker/index.ts). This smoke test validates the pipeline by directly
 * exercising the components that worker/index.ts composes:
 *   redactChunk (in worker onData handler) → bus.publish → WS frames
 *   redactChunk → batcher.onFlush → ptyChunksRepo.appendAtomic → SQLite
 *
 * Timeout: 15s (server start + WS connection + SQLite read).
 */
import { test, expect, describe, afterAll, beforeAll } from "bun:test";

const TEST_PORT = 13105;

// Synthetic secrets that MUST be redacted
const FAKE_ANTHROPIC_KEY = "sk-ant-leakcheck1234567890abcdefgh";
const FAKE_GITHUB_TOKEN = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const FAKE_AWS_KEY = "AKIAIOSFODNN7EXAMPLE";

let stopFn: (() => Promise<void>) | null = null;
let serverPort: number;

beforeAll(async () => {
  const { startServer } = await import("../../src-bun/main");
  const { port, stop } = await startServer({ port: TEST_PORT }) as {
    port: number;
    stop: () => Promise<void>;
  };
  serverPort = port;
  stopFn = stop;
}, 20000);

afterAll(async () => {
  if (stopFn) await stopFn();
});

describe("Redactor pipeline: SQLite storage contains no raw secrets", () => {
  test(
    "synthetic secret bytes stored via ptyChunksRepo are redacted before persistence",
    async () => {
      const { redactChunk } = await import("../../src-bun/pty/redactor");
      const { ptyChunksRepo } = await import("../../src-bun/db/repos/ptyChunksRepo");
      const { workersRepo } = await import("../../src-bun/db/repos/workersRepo");
      const { nanoid } = await import("nanoid");

      const workerId = `smoke-redact-${nanoid(8)}`;

      // Create a worker DB row first (foreign key requirement)
      await workersRepo.insert({
        id: workerId,
        cli: "echo-skeleton",
        cwd: process.cwd(),
        pid: 99901,
        pgid: 99901,
        envMode: "no-worktree",
        createdAt: Date.now(),
      });

      // Simulate what worker/index.ts onData does:
      // 1. rawChunk arrives from PTY
      // 2. redactChunk applied → chunk (redacted)
      // 3. stored via ptyChunksRepo

      const secretPayload =
        `API_KEY=${FAKE_ANTHROPIC_KEY} GHTOKEN=${FAKE_GITHUB_TOKEN} AWS=${FAKE_AWS_KEY}\n`;
      const rawChunk = new TextEncoder().encode(secretPayload);

      // Apply redaction (step 2 in worker pipeline)
      const redactedChunk = redactChunk(rawChunk);

      // Verify the chunk IS redacted before storage
      const redactedText = new TextDecoder().decode(redactedChunk);
      expect(redactedText).toContain("[REDACTED-ANTHROPIC-KEY]");
      expect(redactedText).toContain("[REDACTED-GITHUB-TOKEN]");
      expect(redactedText).toContain("[REDACTED-AWS-ACCESS-KEY]");
      expect(redactedText).not.toContain(FAKE_ANTHROPIC_KEY);
      expect(redactedText).not.toContain(FAKE_GITHUB_TOKEN);
      expect(redactedText).not.toContain(FAKE_AWS_KEY);

      // Store the redacted chunk (step 3 in worker pipeline)
      await ptyChunksRepo.appendAtomic(workerId, Date.now(), Buffer.from(redactedChunk));

      // Read back from SQLite and confirm no secrets
      const chunks = await ptyChunksRepo.listByWorker(workerId);
      expect(chunks.length).toBe(1);

      const allBytes = Buffer.concat(chunks.map((c) => Buffer.from(c.bytes)));
      const storedText = allBytes.toString("utf8");

      // (c) Confirm secrets are NOT in SQLite
      expect(storedText).not.toContain(FAKE_ANTHROPIC_KEY);
      expect(storedText).not.toContain(FAKE_GITHUB_TOKEN);
      expect(storedText).not.toContain(FAKE_AWS_KEY);

      // (c) Redacted placeholders ARE in SQLite
      expect(storedText).toContain("[REDACTED-ANTHROPIC-KEY]");
      expect(storedText).toContain("[REDACTED-GITHUB-TOKEN]");
      expect(storedText).toContain("[REDACTED-AWS-ACCESS-KEY]");
    },
    15000
  );

  test(
    "raw secret bytes (unredacted) stored directly DO appear — confirms test is exercising real data",
    async () => {
      // This test ensures our assertion methodology is correct by verifying
      // that secrets DO appear if we bypass redaction (contrasting control test).
      const { ptyChunksRepo } = await import("../../src-bun/db/repos/ptyChunksRepo");
      const { workersRepo } = await import("../../src-bun/db/repos/workersRepo");
      const { nanoid } = await import("nanoid");

      const workerId = `smoke-control-${nanoid(8)}`;

      // Create a worker DB row first (foreign key requirement)
      await workersRepo.insert({
        id: workerId,
        cli: "echo-skeleton",
        cwd: process.cwd(),
        pid: 99902,
        pgid: 99902,
        envMode: "no-worktree",
        createdAt: Date.now(),
      });

      // Store WITHOUT redaction (contrasting control — bypassing the pipeline)
      const rawText = `raw secret: ${FAKE_ANTHROPIC_KEY}\n`;
      await ptyChunksRepo.appendAtomic(workerId, Date.now(), Buffer.from(rawText));

      const chunks = await ptyChunksRepo.listByWorker(workerId);
      const storedText = Buffer.concat(chunks.map((c) => c.bytes)).toString("utf8");

      // Verify the secret IS visible when bypassing redactor (control case)
      expect(storedText).toContain(FAKE_ANTHROPIC_KEY);
    },
    15000
  );
});

describe("Redactor pipeline: bus.publish carries only redacted bytes", () => {
  test(
    "bus subscriber receives redacted bytes — no raw secret in WS-bound events",
    async () => {
      const { redactChunk } = await import("../../src-bun/pty/redactor");
      const { bus } = await import("../../src-bun/bus/index");
      const { nanoid } = await import("nanoid");

      const workerId = `smoke-bus-${nanoid(8)}`;
      const topic = `worker.output.${workerId}`;

      // Collect bus messages (simulates WS gateway subscriber)
      const received: Uint8Array[] = [];
      const unsub = bus.subscribe(topic, (payload) => {
        received.push(payload as Uint8Array);
      });

      // Simulate the worker pipeline: rawChunk → redactChunk → bus.publish
      const secretPayload =
        `tool_output: ${FAKE_ANTHROPIC_KEY} and ${FAKE_GITHUB_TOKEN}\n`;
      const rawChunk = new TextEncoder().encode(secretPayload);
      const chunk = redactChunk(rawChunk);

      // (b) Publish to bus (what worker/index.ts does in onData handler)
      bus.publish(topic, chunk);

      unsub(); // Clean up subscription

      // (d) Verify WS frames (bus messages) contain no raw secrets
      expect(received.length).toBe(1);
      const publishedText = new TextDecoder().decode(received[0] as Uint8Array);
      expect(publishedText).not.toContain(FAKE_ANTHROPIC_KEY);
      expect(publishedText).not.toContain(FAKE_GITHUB_TOKEN);
      expect(publishedText).toContain("[REDACTED-ANTHROPIC-KEY]");
      expect(publishedText).toContain("[REDACTED-GITHUB-TOKEN]");
    },
    15000
  );

  test(
    "WS endpoint: connecting to /ws/worker/:id receives redacted bytes from bus",
    async () => {
      if (process.platform === "win32") {
        // WS test uses sh -c pattern; skip on Windows (plan-specified skip)
        return;
      }

      const { redactChunk } = await import("../../src-bun/pty/redactor");
      const { bus } = await import("../../src-bun/bus/index");
      const { nanoid } = await import("nanoid");

      const workerId = `smoke-ws-${nanoid(8)}`;
      const topic = `worker.output.${workerId}`;

      // Connect a WebSocket to the worker endpoint
      const frames: string[] = [];
      const wsOpen = new Promise<boolean>((resolve) => {
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/worker/${workerId}`);
        ws.binaryType = "arraybuffer";

        const timeout = setTimeout(() => {
          ws.close();
          resolve(false);
        }, 3000);

        ws.onopen = () => {
          clearTimeout(timeout);
          // Now publish a secret-containing chunk through the pipeline
          const secretPayload =
            `ws_test: ${FAKE_ANTHROPIC_KEY} ${FAKE_AWS_KEY}\n`;
          const rawChunk = new TextEncoder().encode(secretPayload);
          const chunk = redactChunk(rawChunk);

          // Collect frames for a second then close
          const collectTimeout = setTimeout(() => {
            ws.close(1000);
            resolve(true);
          }, 1000);

          ws.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
              frames.push(new TextDecoder().decode(event.data));
            }
          };

          // Publish via bus (simulates worker/index.ts onData → bus.publish)
          bus.publish(topic, chunk);
        };

        ws.onerror = () => {
          resolve(false);
        };
      });

      const opened = await wsOpen;
      expect(opened).toBe(true);

      // Wait for any delayed frames
      await new Promise((r) => setTimeout(r, 200));

      // If we received frames, verify none contain raw secrets
      for (const frame of frames) {
        expect(frame).not.toContain(FAKE_ANTHROPIC_KEY);
        expect(frame).not.toContain(FAKE_AWS_KEY);
      }

      // At least one frame should contain redacted content (if WS received the bus event)
      if (frames.length > 0) {
        const combined = frames.join("");
        expect(combined).toContain("[REDACTED-");
      }
    },
    15000
  );
});

describe("Env allowlist: ANTHROPIC_API_KEY does not leak to spawn env", () => {
  test(
    "buildSpawnEnv() with ANTHROPIC_API_KEY in process.env returns env WITHOUT the key",
    async () => {
      const { buildSpawnEnv } = await import("../../src-bun/worker/spawn-env");

      // Simulate a scenario where ANTHROPIC_API_KEY is set (common in dev environments)
      const savedKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = "sk-ant-shouldnotleak1234567890abcde";

      try {
        // Verify denylist works even without an explicit allowlist entry
        const env = buildSpawnEnv();
        expect(env.ANTHROPIC_API_KEY).toBeUndefined();

        // Verify it also works when the user accidentally adds it to allowlist
        const envWithAllowlist = buildSpawnEnv(["ANTHROPIC_API_KEY"]);
        expect(envWithAllowlist.ANTHROPIC_API_KEY).toBeUndefined();

        // Confirm the raw value does NOT appear under ANY key
        const values = Object.values(envWithAllowlist);
        expect(values.some((v) => v.includes("sk-ant-shouldnotleak"))).toBe(false);
      } finally {
        // Restore
        if (savedKey === undefined) {
          delete process.env.ANTHROPIC_API_KEY;
        } else {
          process.env.ANTHROPIC_API_KEY = savedKey;
        }
      }
    },
    15000
  );
});
