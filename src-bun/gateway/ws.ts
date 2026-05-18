/**
 * WebSocket gateway for PTY streams (WS-1011-01).
 *
 * Route: WS /ws/worker/:id
 * - Subscribes to bus `worker.output.<id>` → forwards as binary frames
 * - 30s heartbeat (empty binary frame)
 * - idleTimeout: 0 (managed by Bun.serve options, not here)
 * - onMessage: ArrayBuffer → PTY stdin; JSON → resize
 * - onClose: unsubscribes (no PTY kill — browser disconnect ≠ session end)
 *
 * CRITICAL: export { websocket } from hono/bun for Bun's serve() (Landmine #4)
 */
import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "hono/bun";
import { bus } from "../bus/index";
import { sendToWorker, resizeWorker } from "../worker/index";

const app = new Hono();

app.get(
  "/ws/worker/:id",
  upgradeWebSocket((c) => {
    const workerId = c.req.param("id") ?? "";
    let unsubscribe: (() => void) | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    return {
      onOpen(_evt, ws) {
        // Subscribe to PTY output on the bus
        unsubscribe = bus.subscribe(`worker.output.${workerId}`, (payload: unknown) => {
          if (payload instanceof Uint8Array) {
            try {
              // Convert to ArrayBuffer for type safety
              ws.send(payload.buffer as ArrayBuffer);
            } catch {
              // WS may have closed
            }
          }
        });

        // WS-1011-01: 30s heartbeat via empty binary frame
        heartbeatTimer = setInterval(() => {
          try {
            ws.send(new Uint8Array(0));
          } catch {
            if (heartbeatTimer) clearInterval(heartbeatTimer);
          }
        }, 30_000);
      },

      onMessage(evt) {
        const data = evt.data;

        if (data instanceof ArrayBuffer) {
          // Raw keystroke bytes → PTY stdin
          const text = new TextDecoder().decode(data);
          sendToWorker(workerId, text);
        } else if (typeof data === "string") {
          // Control messages: resize, ping
          try {
            const msg = JSON.parse(data) as { type?: string; cols?: number; rows?: number };
            if (msg.type === "resize" && msg.cols !== undefined && msg.rows !== undefined) {
              resizeWorker(workerId, msg.cols, msg.rows);
            }
          } catch {
            // Ignore malformed JSON (T-01-01: Zod validation for resize)
          }
        }
      },

      onClose() {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        unsubscribe?.();
        unsubscribe = null;
        // WS-1011-01: Do NOT kill the PTY — browser disconnect ≠ session end
      },

      onError() {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        unsubscribe?.();
        unsubscribe = null;
      },
    };
  })
);

export { app as wsApp, websocket };
