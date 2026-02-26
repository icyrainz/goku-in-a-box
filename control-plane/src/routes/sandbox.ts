import { Hono } from "hono";
import type { SandboxManager, AgentType } from "../sandbox";

export function sandboxRoutes(manager: SandboxManager) {
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
      ]) {
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

    const containerId = await manager.start(agentType, env);
    return c.json({ containerId, agentType, status: "started" });
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
