import { Hono } from "hono";
import type { SandboxManager } from "../sandbox";

export function sandboxRoutes(manager: SandboxManager) {
  const app = new Hono();

  app.post("/start", async (c) => {
    const env: Record<string, string> = {};
    for (const key of ["LLM_API_KEY", "LLM_BASE_URL", "OPENCODE_MODEL", "ITERATION_SLEEP"]) {
      const val = process.env[key];
      if (val) env[key] = val;
    }
    const containerId = await manager.start(env);
    return c.json({ containerId, status: "started" });
  });

  app.post("/stop", async (c) => {
    await manager.stop();
    return c.json({ status: "stopped" });
  });

  app.get("/status", async (c) => {
    const status = await manager.status();
    return c.json(status);
  });

  return app;
}
