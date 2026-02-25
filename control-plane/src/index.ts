import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { upgradeWebSocket, websocket } from "hono/bun";
import { createDb } from "./db";
import { DockerClient } from "./docker";
import { SandboxManager } from "./sandbox";
import { WsBroadcaster } from "./ws";
import { LogStore } from "./logs";
import { promptRoutes } from "./routes/prompt";
import { sandboxRoutes } from "./routes/sandbox";
import { telemetryRoutes } from "./routes/telemetry";

const db = createDb("data/sandbox.db");
const docker = new DockerClient();
const sandbox = new SandboxManager(docker);
const broadcaster = new WsBroadcaster();
const logs = new LogStore("data/logs");

const app = new Hono();

app.use("*", logger());
app.use("*", cors());

app.get("/health", (c) => c.json({ status: "ok" }));
app.route("/api/prompt", promptRoutes(db));
app.route("/api/sandbox", sandboxRoutes(sandbox));
app.route("/api/telemetry", telemetryRoutes(db, broadcaster));

app.get(
  "/ws/live",
  upgradeWebSocket(() => ({
    onOpen(_, ws) {
      broadcaster.register(ws);
      ws.send(JSON.stringify({ type: "connected", timestamp: new Date().toISOString() }));
    },
    onClose(_, ws) {
      broadcaster.remove(ws);
    },
  }))
);

export default {
  port: 3000,
  fetch: app.fetch,
  websocket,
};
