import { Hono } from "hono";
import type { SandboxManager } from "../sandbox";

export function sandboxRoutes(manager: SandboxManager) {
  const app = new Hono();

  app.post("/start", async (c) => {
    const containerId = await manager.start();
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
