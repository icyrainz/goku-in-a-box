import { Hono } from "hono";
import type { SandboxManager, AgentType } from "../sandbox";
import type { createDb } from "../db";
import type { WsBroadcaster } from "../ws";

export function sandboxRoutes(manager: SandboxManager, db: ReturnType<typeof createDb>, broadcaster: WsBroadcaster) {
  const app = new Hono();

  app.post("/start", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const agentType: AgentType = body.agentType === "goose" ? "goose" : "opencode";

    const env: Record<string, string> = {};

    if (agentType === "opencode") {
      for (const [envKey, procKey] of [
        ["LLM_API_KEY", "LLM_API_KEY"],
        ["LLM_BASE_URL", "OPENCODE_LLM_HOST"],
        ["OPENCODE_MODEL", "OPENCODE_MODEL"],
        ["ITERATION_SLEEP", "ITERATION_SLEEP"],
      ] as const) {
        const val = process.env[procKey];
        if (val) env[envKey] = val;
      }
    } else {
      // Goose
      const apiKey = process.env.LLM_API_KEY;
      if (apiKey) env["OPENAI_API_KEY"] = apiKey;

      const host = process.env.GOOSE_LLM_HOST;
      if (host) env["OPENAI_HOST"] = host;

      const model = process.env.GOOSE_MODEL;
      if (model) env["GOOSE_MODEL"] = model;

      env["GOOSE_PROVIDER"] = "openai";
      env["GOOSE_MODE"] = "auto";
      env["GOOSE_DISABLE_KEYRING"] = "1";

      const sleep = process.env.ITERATION_SLEEP;
      if (sleep) env["ITERATION_SLEEP"] = sleep;
    }

    db.clearPrompt();
    db.closeOpenIterations();
    const containerId = await manager.start(agentType, env);
    db.endAllOpenSessions();
    db.createSession(containerId, agentType);
    broadcaster.broadcast({ type: "session_start", data: { containerId, agentType } });
    return c.json({ containerId, agentType, status: "started" });
  });

  app.post("/stop", async (c) => {
    const containerId = manager.containerId;
    await manager.stop();
    db.closeOpenIterations();
    if (containerId) db.endSession(containerId);
    return c.json({ status: "stopped" });
  });

  app.get("/status", async (c) => {
    const status = await manager.status();
    const session = db.getActiveSession() ?? db.getLatestSession();
    return c.json({ ...status, sessionId: session?.container_id ?? null });
  });

  return app;
}
