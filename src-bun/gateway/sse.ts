/**
 * SSE gateway — streams system events to browser.
 * Route: GET /sse/events
 *
 * Uses Hono's streamSSE helper with backpressure.
 * Wires stream.onAbort() to clean up bus subscriptions (Hono gotcha in CLAUDE.md).
 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { bus } from "../bus/index";

const app = new Hono();

app.get("/sse/events", (c) => {
  return streamSSE(c, async (stream) => {
    // Send initial keepalive
    await stream.writeSSE({ data: "connected", event: "init" });

    // Subscribe to all events on the bus (wildcard via naming convention)
    const unsubscribe = bus.subscribe("sse.event", async (payload: unknown) => {
      try {
        await stream.writeSSE({
          data: JSON.stringify(payload),
          event: "event",
        });
      } catch {
        // Stream may have aborted
      }
    });

    // Clean up on client disconnect (prevents bus subscription leaks)
    stream.onAbort(() => {
      unsubscribe();
    });

    // Keep alive — stream stays open until client disconnects or process exits
    // The SSE stream is kept alive by the onAbort pattern
    await new Promise<void>((resolve) => {
      stream.onAbort(resolve);
    });
  });
});

export { app as sseApp };

/**
 * Publish a system event to the SSE stream.
 * Called by worker/self-test code to forward events to UI.
 */
export function publishSseEvent(event: unknown): void {
  bus.publish("sse.event", event);
}
