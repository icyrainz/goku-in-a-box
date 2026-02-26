import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { upgradeWebSocket, websocket } from "hono/bun";
import { createDb } from "./db";
import { DockerClient } from "./docker";
import { SandboxManager } from "./sandbox";
import { WsBroadcaster } from "./ws";
import { LogStore } from "./logs";
import { createLlm } from "./llm";
import { promptRoutes } from "./routes/prompt";
import { sandboxRoutes } from "./routes/sandbox";
import { telemetryRoutes } from "./routes/telemetry";
import { filesRoutes } from "./routes/files";
import { snapshotRoutes } from "./routes/snapshots";

const db = createDb("data/sandbox.db");
const docker = new DockerClient();
const sandbox = new SandboxManager(docker);
sandbox.reconnect().catch(() => {}); // re-attach to running container if any
const broadcaster = new WsBroadcaster();
const logs = new LogStore("data/logs");

// Control plane LLM (for summaries, etc.) — separate from sandbox LLM
const cpLlm = process.env.CP_LLM_BASE_URL
  ? createLlm({
      baseUrl: process.env.CP_LLM_BASE_URL,
      apiKey: process.env.CP_LLM_API_KEY ?? process.env.LLM_API_KEY ?? "",
      model: process.env.CP_LLM_MODEL ?? "Qwen3.5-27B",
    })
  : process.env.LLM_HOST
    ? createLlm({
        baseUrl: `${process.env.LLM_HOST}/v1`,
        apiKey: process.env.LLM_API_KEY ?? "",
        model: process.env.CP_LLM_MODEL ?? "Qwen3.5-27B",
      })
    : undefined;

const app = new Hono();

app.use("*", logger());
app.use("*", cors());

app.get("/health", (c) => c.json({ status: "ok" }));
app.route("/api/prompt", promptRoutes(db));
app.route("/api/sandbox", sandboxRoutes(sandbox, db));
app.route("/api/telemetry", telemetryRoutes(db, broadcaster, cpLlm));
app.route("/api/sandbox/files", filesRoutes(sandbox, docker));
app.route("/api/snapshots", snapshotRoutes(sandbox, docker, db));

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
