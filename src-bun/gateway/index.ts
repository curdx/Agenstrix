/**
 * Hono gateway assembly.
 *
 * CRITICAL: export default { fetch: app.fetch, websocket }
 * The `websocket` export from hono/bun is MANDATORY for Bun's WS upgrade.
 * Forgetting it causes silent WS upgrade failures (Landmine #4).
 */
import { Hono } from "hono";
import { restApp } from "./rest";
import { sseApp } from "./sse";
import { websocket, wsApp } from "./ws";

const app = new Hono();

// Mount sub-apps
app.route("/", restApp);
app.route("/", wsApp);
app.route("/", sseApp);

// MANDATORY: export { fetch, websocket } for Bun.serve() WebSocket support
export default { fetch: app.fetch, websocket };
export { websocket };
