import { Hono } from "hono";
import type { createDb } from "../db";

export function promptRoutes(db: ReturnType<typeof createDb>) {
  const app = new Hono();

  app.get("/", (c) => {
    const prompt = db.getLatestPrompt();
    return c.json({ content: prompt?.content ?? "", updated_at: prompt?.updated_at ?? null });
  });

  app.put("/", async (c) => {
    const body = await c.req.json<{ content: string }>();
    if (!body.content) {
      return c.json({ error: "content is required" }, 400);
    }
    const previous = db.getLatestPrompt();
    db.insertPrompt(body.content);
    return c.json({
      previous: previous?.content ?? null,
      current: body.content,
    });
  });

  return app;
}
