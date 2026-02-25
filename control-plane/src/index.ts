import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createDb } from "./db";
import { DockerClient } from "./docker";
import { SandboxManager } from "./sandbox";
import { promptRoutes } from "./routes/prompt";
import { sandboxRoutes } from "./routes/sandbox";

const db = createDb("data/sandbox.db");
const docker = new DockerClient();
const sandbox = new SandboxManager(docker);

const app = new Hono();

app.use("*", logger());
app.use("*", cors());

app.get("/health", (c) => c.json({ status: "ok" }));
app.route("/api/prompt", promptRoutes(db));
app.route("/api/sandbox", sandboxRoutes(sandbox));

export default {
  port: 3000,
  fetch: app.fetch,
};
