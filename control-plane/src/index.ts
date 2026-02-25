import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createDb } from "./db";
import { promptRoutes } from "./routes/prompt";

const db = createDb("data/sandbox.db");

const app = new Hono();

app.use("*", logger());
app.use("*", cors());

app.get("/health", (c) => c.json({ status: "ok" }));
app.route("/api/prompt", promptRoutes(db));

export default {
  port: 3000,
  fetch: app.fetch,
};
